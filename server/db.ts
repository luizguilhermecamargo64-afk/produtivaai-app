import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gte, like, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  apiUsage,
  conversations,
  InsertUser,
  messages,
  plans,
  profiles,
  projectMembers,
  projects,
  settings,
  subscriptionEvents,
  subscriptions,
  tasks,
  usageLogs,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let plansReady = false;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL, { mode: "default" });
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function checkDatabase() {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

const PLAN_SEEDS = [
  { code: "FREE", name: "Free", priceCents: 0, conversationLimit: 30, projectLimit: 2, taskLimit: 30, historyDays: 7, advancedModels: false, exportEnabled: false, priority: 1 },
  { code: "PRO", name: "Pro", priceCents: 3990, conversationLimit: 500, projectLimit: 20, taskLimit: 500, historyDays: 0, advancedModels: true, exportEnabled: true, priority: 2 },
  { code: "BUSINESS", name: "Business", priceCents: 9990, conversationLimit: 2000, projectLimit: -1, taskLimit: -1, historyDays: 0, advancedModels: true, exportEnabled: true, priority: 3 },
] as const;

export async function ensurePlans() {
  const db = await getDb();
  if (!db || plansReady) return;
  const existing = await db.select({ code: plans.code }).from(plans);
  const existingCodes = new Set(existing.map(plan => plan.code));
  const missing = PLAN_SEEDS.filter(plan => !existingCodes.has(plan.code));
  if (missing.length > 0) {
    await db.insert(plans).values(missing.map(plan => ({ ...plan, currency: "BRL", billingInterval: "month" })));
  }
  plansReady = true;
}

export async function upsertUser(user: Pick<InsertUser, "openId"> & Partial<Omit<InsertUser, "openId">>): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const existing = await getUserByOpenId(user.openId);
  const values: InsertUser = { openId: user.openId, email: user.email ?? existing?.email ?? "" };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      (values as Record<string, unknown>)[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= new Date();
  updateSet.lastSignedIn ??= values.lastSignedIn;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const normalizedEmail = email.trim().toLowerCase();
  const result = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  return result[0];
}

export async function createLocalUser(values: { name: string; email: string; passwordHash: string; passwordSalt: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const email = values.email.trim().toLowerCase();
  const existing = await getUserByEmail(email);
  if (existing) throw new Error("EMAIL_ALREADY_EXISTS");
  const openId = `local_${randomLocalId()}`;
  const result = await db.insert(users).values({ openId, name: values.name.trim(), email, passwordHash: values.passwordHash, passwordSalt: values.passwordSalt, loginMethod: "email", role: "user", lastSignedIn: new Date() });
  const id = Number(result[0]?.insertId);
  const user = await getUserById(id);
  if (!user) throw new Error("USER_CREATION_FAILED");
  await getProfile(user.id);
  return user;
}

function randomLocalId() {
  return randomBytes(24).toString("hex");
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getProfile(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (result[0]) return result[0];
  await db.insert(profiles).values({ userId, displayName: null });
  const created = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return created[0];
}

export async function updateProfile(userId: number, values: Partial<typeof profiles.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await getProfile(userId);
  await db.update(profiles).set({ ...values, updatedAt: new Date() }).where(eq(profiles.userId, userId));
  return getProfile(userId);
}

export async function getPlans() {
  await ensurePlans();
  const db = await getDb();
  if (!db) return [];
  return db.select().from(plans).orderBy(asc(plans.priority));
}

export async function getPlanByCode(code: string) {
  await ensurePlans();
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(plans).where(eq(plans.code, code)).limit(1);
  return result[0];
}

export async function getCurrentSubscription(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1);
  return result[0];
}

export async function getCurrentPlan(userId: number) {
  const active = await getCurrentSubscription(userId);
  if (active) return active.plan;
  return getPlanByCode("FREE");
}

function monthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export async function getUsage(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const start = monthStart();
  const [conversationsCount, projectsCount, tasksCount, completedCount, messagesCount, aiRequests] = await Promise.all([
    db.select({ value: count() }).from(conversations).where(and(eq(conversations.userId, userId), gte(conversations.createdAt, start))),
    db.select({ value: count() }).from(projects).where(eq(projects.ownerId, userId)),
    db.select({ value: count() }).from(tasks).where(eq(tasks.userId, userId)),
    db.select({ value: count() }).from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.status, "done"))),
    db.select({ value: count() }).from(messages).where(eq(messages.userId, userId)),
    db.select({ value: count() }).from(usageLogs).where(and(eq(usageLogs.userId, userId), gte(usageLogs.createdAt, start))),
  ]);
  return {
    conversations: Number(conversationsCount[0]?.value ?? 0),
    projects: Number(projectsCount[0]?.value ?? 0),
    tasks: Number(tasksCount[0]?.value ?? 0),
    completedTasks: Number(completedCount[0]?.value ?? 0),
    messages: Number(messagesCount[0]?.value ?? 0),
    aiRequests: Number(aiRequests[0]?.value ?? 0),
  };
}

export async function getDashboardSummary(userId: number) {
  const [plan, usage, profile] = await Promise.all([getCurrentPlan(userId), getUsage(userId), getProfile(userId)]);
  return { plan, usage, profile };
}

export async function listProjects(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select({ project: projects }).from(projects)
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(or(eq(projects.ownerId, userId), eq(projectMembers.userId, userId)))
    .orderBy(desc(projects.updatedAt));
  const seen = new Set<number>();
  return rows.map(row => row.project).filter(project => {
    if (seen.has(project.id)) return false;
    seen.add(project.id);
    return true;
  });
}

export async function getProject(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select({ project: projects }).from(projects)
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.id, projectId), or(eq(projects.ownerId, userId), eq(projectMembers.userId, userId))))
    .limit(1);
  return result[0]?.project;
}

export async function getProjectAccess(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select({ project: projects, memberRole: projectMembers.role }).from(projects)
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
    .where(and(eq(projects.id, projectId), or(eq(projects.ownerId, userId), eq(projectMembers.userId, userId))))
    .limit(1);
  const row = result[0];
  if (!row) return undefined;
  return { project: row.project, role: row.project.ownerId === userId ? "owner" as const : row.memberRole || "viewer" as const };
}

export async function createProject(userId: number, values: { name: string; description?: string; instructions?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(projects).values({ ownerId: userId, ...values });
  const id = Number(result[0].insertId);
  return getProject(userId, id);
}

export async function updateProject(userId: number, projectId: number, values: { name?: string; description?: string; instructions?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const existing = await getProject(userId, projectId);
  if (!existing || existing.ownerId !== userId) return undefined;
  await db.update(projects).set({ ...values, updatedAt: new Date() }).where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)));
  return getProject(userId, projectId);
}

export async function deleteProject(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)));
  return result[0].affectedRows > 0;
}

export async function listTasks(userId: number, filters?: { status?: "todo" | "in_progress" | "done"; search?: string; projectId?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const conditions = [eq(tasks.userId, userId)];
  if (filters?.status) conditions.push(eq(tasks.status, filters.status));
  if (filters?.projectId) conditions.push(eq(tasks.projectId, filters.projectId));
  if (filters?.search) conditions.push(like(tasks.title, `%${filters.search}%`));
  return db.select().from(tasks).where(and(...conditions)).orderBy(asc(tasks.status), asc(tasks.dueDate), desc(tasks.createdAt));
}

export async function getTask(userId: number, taskId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId))).limit(1);
  return result[0];
}

export async function createTask(userId: number, values: Omit<typeof tasks.$inferInsert, "userId">) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(tasks).values({ ...values, userId });
  return getTask(userId, Number(result[0].insertId));
}

export async function updateTask(userId: number, taskId: number, values: Partial<typeof tasks.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(tasks).set({ ...values, updatedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  return getTask(userId, taskId);
}

export async function deleteTask(userId: number, taskId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  return result[0].affectedRows > 0;
}

export async function createConversation(userId: number, values: { title: string; projectId?: number; mode?: "general" | "study" | "work" }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(conversations).values({ userId, title: values.title, projectId: values.projectId ?? null, mode: values.mode ?? "general" });
  return getConversation(userId, Number(result[0].insertId));
}

export async function listConversations(userId: number, limit = 30, cursor?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const where = cursor ? and(eq(conversations.userId, userId), lt(conversations.id, cursor), eq(conversations.archived, false)) : and(eq(conversations.userId, userId), eq(conversations.archived, false));
  const rows = await db.select().from(conversations).where(where).orderBy(desc(conversations.updatedAt)).limit(Math.min(limit, 50));
  return { items: rows, nextCursor: rows.length === Math.min(limit, 50) ? rows[rows.length - 1]?.id : null };
}

export async function getConversation(userId: number, conversationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))).limit(1);
  return result[0];
}

export async function updateConversation(userId: number, conversationId: number, values: { title?: string; mode?: "general" | "study" | "work"; archived?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(conversations).set({ ...values, updatedAt: new Date() }).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  return getConversation(userId, conversationId);
}

export async function listMessages(userId: number, conversationId: number, limit = 100, cursor?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const conversation = await getConversation(userId, conversationId);
  if (!conversation) return null;
  const where = cursor ? and(eq(messages.userId, userId), eq(messages.conversationId, conversationId), lt(messages.id, cursor)) : and(eq(messages.userId, userId), eq(messages.conversationId, conversationId));
  const rows = await db.select().from(messages).where(where).orderBy(asc(messages.createdAt)).limit(Math.min(limit, 100));
  return { conversation, items: rows, nextCursor: rows.length === Math.min(limit, 100) ? rows[0]?.id : null };
}

export async function addMessage(values: typeof messages.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.insert(messages).values(values);
  const created = await db.select().from(messages).where(eq(messages.id, Number(result[0].insertId))).limit(1);
  return created[0];
}

export async function addUsageLog(values: typeof usageLogs.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(usageLogs).values(values);
}

export async function addApiUsage(values: typeof apiUsage.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(apiUsage).values(values);
}

export async function globalSearch(userId: number, query: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const term = `%${query.trim().slice(0, 120)}%`;
  const [conversationRows, messageRows, projectRows, taskRows] = await Promise.all([
    db.select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt }).from(conversations).where(and(eq(conversations.userId, userId), like(conversations.title, term))).orderBy(desc(conversations.updatedAt)).limit(15),
    db.select({ id: messages.id, conversationId: messages.conversationId, content: messages.content, createdAt: messages.createdAt }).from(messages).where(and(eq(messages.userId, userId), like(messages.content, term))).orderBy(desc(messages.createdAt)).limit(15),
    db.select({ id: projects.id, name: projects.name, description: projects.description, updatedAt: projects.updatedAt }).from(projects).where(and(eq(projects.ownerId, userId), or(like(projects.name, term), like(projects.description, term)))).orderBy(desc(projects.updatedAt)).limit(15),
    db.select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate }).from(tasks).where(and(eq(tasks.userId, userId), or(like(tasks.title, term), like(tasks.description, term)))).orderBy(desc(tasks.updatedAt)).limit(15),
  ]);
  return { conversations: conversationRows, messages: messageRows, projects: projectRows, tasks: taskRows };
}

export async function getSettings(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.select().from(settings).where(eq(settings.userId, userId)).orderBy(asc(settings.key));
}

export async function setSetting(userId: number, key: string, value: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(settings).values({ userId, key, value }).onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
  return getSettings(userId);
}

export async function findSubscriptionEvent(eventId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select().from(subscriptionEvents).where(eq(subscriptionEvents.eventId, eventId)).limit(1);
  return result[0];
}

export async function claimSubscriptionEvent(values: typeof subscriptionEvents.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  try {
    await db.insert(subscriptionEvents).values(values);
    return true;
  } catch {
    const existing = await findSubscriptionEvent(values.eventId);
    if (existing) return false;
    throw new Error("Could not claim subscription event");
  }
}

export async function recordSubscriptionEvent(values: typeof subscriptionEvents.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(subscriptionEvents).values(values).onDuplicateKeyUpdate({ set: { processingResult: values.processingResult, status: values.status } });
}

export async function activateSubscription(userId: number, planId: number, providerPaymentId: string, providerSubscriptionId?: string, status: "active" | "pending" | "cancelled" | "expired" | "past_due" | "rejected" = "active") {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(subscriptions).set({ status: "expired", updatedAt: new Date() }).where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")));
  await db.insert(subscriptions).values({ userId, planId, provider: "mercadopago", providerPaymentId, providerSubscriptionId: providerSubscriptionId ?? null, status, startedAt: status === "active" ? new Date() : null });
}

export async function getSubscriptionHistory(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.select({ subscription: subscriptions, plan: plans }).from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId)).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)).limit(30);
}

export async function getPlanAndUsage(userId: number) {
  const [plan, usage, history] = await Promise.all([getCurrentPlan(userId), getUsage(userId), getSubscriptionHistory(userId)]);
  return { plan, usage, history };
}

export async function countOwnedProjects(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select({ value: count() }).from(projects).where(eq(projects.ownerId, userId));
  return Number(result[0]?.value ?? 0);
}

export async function countOwnedTasks(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select({ value: count() }).from(tasks).where(eq(tasks.userId, userId));
  return Number(result[0]?.value ?? 0);
}

export async function countMonthlyConversations(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select({ value: count() }).from(conversations).where(and(eq(conversations.userId, userId), gte(conversations.createdAt, monthStart())));
  return Number(result[0]?.value ?? 0);
}

export async function countMonthlyAiRequests(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select({ value: count() }).from(usageLogs).where(and(eq(usageLogs.userId, userId), gte(usageLogs.createdAt, monthStart())));
  return Number(result[0]?.value ?? 0);
}
