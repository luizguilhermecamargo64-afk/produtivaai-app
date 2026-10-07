import { TRPCError } from "@trpc/server";
import * as db from "./db";

export const CHECKOUT_LINKS = {
  PRO: "https://mpago.la/14CRH6L",
  BUSINESS: "https://mpago.la/2dbzEGa",
} as const;

const quotaLocks = new Map<number, Promise<void>>();

type AsyncAction<T> = () => Promise<T>;

async function withQuotaLock<T>(userId: number, action: AsyncAction<T>) {
  const previous = quotaLocks.get(userId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const queue = previous.then(() => current);
  quotaLocks.set(userId, queue);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (quotaLocks.get(userId) === queue) quotaLocks.delete(userId);
  }
}

async function currentPlanOrThrow(userId: number) {
  const plan = await db.getCurrentPlan(userId);
  if (!plan) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível carregar o plano." });
  return plan;
}

export async function billingOverview(userId: number) {
  const data = await db.getPlanAndUsage(userId);
  const plan = data.plan;
  if (!plan) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Os planos ainda não estão disponíveis." });
  const conversationPercent = plan.conversationLimit > 0 ? Math.min(100, Math.round((data.usage.conversations / plan.conversationLimit) * 100)) : 0;
  return { ...data, conversationPercent, checkoutLinks: CHECKOUT_LINKS };
}

export async function assertConversationQuota(userId: number) {
  const plan = await currentPlanOrThrow(userId);
  const used = await db.countMonthlyConversations(userId);
  if (plan.conversationLimit >= 0 && used >= plan.conversationLimit) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Você atingiu o limite do seu plano. Faça upgrade para continuar." });
  }
  return plan;
}

export async function assertProjectQuota(userId: number) {
  const plan = await currentPlanOrThrow(userId);
  const used = await db.countOwnedProjects(userId);
  if (plan.projectLimit >= 0 && used >= plan.projectLimit) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Você atingiu o limite de projetos do seu plano. Faça upgrade para continuar." });
  }
  return plan;
}

export async function assertTaskQuota(userId: number) {
  const plan = await currentPlanOrThrow(userId);
  const used = await db.countOwnedTasks(userId);
  if (plan.taskLimit >= 0 && used >= plan.taskLimit) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Você atingiu o limite de tarefas do seu plano. Faça upgrade para continuar." });
  }
  return plan;
}

export async function assertAiQuota(userId: number) {
  const plan = await currentPlanOrThrow(userId);
  const used = await db.countMonthlyAiRequests(userId);
  const limit = plan.conversationLimit < 0 ? -1 : Math.max(plan.conversationLimit * 4, plan.conversationLimit);
  if (limit >= 0 && used >= limit) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Você atingiu o limite do seu plano. Faça upgrade para continuar." });
  }
  return plan;
}

export async function withConversationQuota<T>(userId: number, action: AsyncAction<T>) {
  return withQuotaLock(userId, async () => { await assertConversationQuota(userId); return action(); });
}

export async function withProjectQuota<T>(userId: number, action: AsyncAction<T>) {
  return withQuotaLock(userId, async () => { await assertProjectQuota(userId); return action(); });
}

export async function withTaskQuota<T>(userId: number, action: AsyncAction<T>) {
  return withQuotaLock(userId, async () => { await assertTaskQuota(userId); return action(); });
}

export function checkoutForPlan(code: "PRO" | "BUSINESS") {
  return CHECKOUT_LINKS[code];
}
