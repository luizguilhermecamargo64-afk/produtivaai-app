import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildToolTurns, callAI } from "./ai";
import * as db from "./db";
import { assertAiQuota, billingOverview, withConversationQuota, withProjectQuota, withTaskQuota } from "./billing";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { toPublicUser } from "./auth/local";
import { clearLocalSessionCookie, createLocalSession, hashPassword, LOCAL_PASSWORD_MAX_LENGTH, LOCAL_PASSWORD_MIN_LENGTH, normalizeEmailForAuth, setLocalSessionCookie, verifyPassword } from "./_core/localAuth";

const id = z.coerce.number().int().positive();
const optionalText = z.string().trim().max(30_000).optional();
const taskStatus = z.enum(["todo", "in_progress", "done"]);
const taskPriority = z.enum(["low", "medium", "high"]);
const mode = z.enum(["general", "study", "work"]);

async function requireDatabase() {
  if (!(await db.checkDatabase())) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "O banco de dados ainda não está configurado. Configure DATABASE_URL para criar uma conta ou entrar.",
    });
  }
}

function cleanTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 180) || "Nova conversa";
}

async function assertProjectWriteAccess(userId: number, projectId: number) {
  const access = await db.getProjectAccess(userId, projectId);
  if (!access) throw new TRPCError({ code: "NOT_FOUND", message: "Projeto não encontrado." });
  if (access.role === "viewer") throw new TRPCError({ code: "FORBIDDEN", message: "Você não tem permissão para alterar este projeto." });
  return access.project;
}

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ? toPublicUser(opts.ctx.user) : null),
    register: publicProcedure.input(z.object({
      name: z.string().trim().min(2, "Informe seu nome.").max(160),
      email: z.string().trim().email("Informe um e-mail válido.").max(320),
      password: z.string().min(LOCAL_PASSWORD_MIN_LENGTH, `A senha precisa ter pelo menos ${LOCAL_PASSWORD_MIN_LENGTH} caracteres.`).max(LOCAL_PASSWORD_MAX_LENGTH),
      confirmPassword: z.string().min(LOCAL_PASSWORD_MIN_LENGTH),
    })).mutation(async ({ ctx, input }) => {
      await requireDatabase();
      if (input.password !== input.confirmPassword) throw new TRPCError({ code: "BAD_REQUEST", message: "As senhas não coincidem." });
      const name = input.name.trim();
      const email = normalizeEmailForAuth(input.email);
      if (await db.getUserByEmail(email)) throw new TRPCError({ code: "CONFLICT", message: "Este e-mail já está cadastrado." });
      let user;
      try {
        const credentials = hashPassword(input.password);
        user = await db.createLocalUser({ name, email, passwordHash: credentials.passwordHash, passwordSalt: credentials.passwordSalt });
      } catch (error) {
        if (await db.getUserByEmail(email)) throw new TRPCError({ code: "CONFLICT", message: "Este e-mail já está cadastrado." });
        throw error;
      }
      if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar sua conta." });
      setLocalSessionCookie(ctx.req, ctx.res, await createLocalSession(user));
      return { success: true, user: toPublicUser(user) };
    }),
    login: publicProcedure.input(z.object({
      email: z.string().trim().email("Informe um e-mail válido.").max(320),
      password: z.string().min(1, "Informe sua senha.").max(LOCAL_PASSWORD_MAX_LENGTH),
    })).mutation(async ({ ctx, input }) => {
      await requireDatabase();
      const user = await db.getUserByEmail(normalizeEmailForAuth(input.email));
      if (!user || !user.passwordHash || !user.passwordSalt) throw new TRPCError({ code: "UNAUTHORIZED", message: "E-mail ou senha inválidos." });
      const valid = verifyPassword(input.password, user.passwordHash, user.passwordSalt);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "E-mail ou senha inválidos." });
      await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
      const updatedUser = await db.getUserById(user.id);
      if (!updatedUser) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível carregar sua conta." });
      setLocalSessionCookie(ctx.req, ctx.res, await createLocalSession(updatedUser));
      return { success: true, user: toPublicUser(updatedUser) };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      clearLocalSessionCookie(ctx.req, ctx.res);
      return { success: true } as const;
    }),
  }),

  dashboard: router({
    summary: protectedProcedure.query(({ ctx }) => db.getDashboardSummary(ctx.user.id)),
  }),

  profile: router({
    get: protectedProcedure.query(({ ctx }) => db.getProfile(ctx.user.id)),
    update: protectedProcedure.input(z.object({
      displayName: z.string().trim().max(160).nullable().optional(),
      avatarUrl: z.string().url().max(500).nullable().optional(),
      theme: z.enum(["light", "dark", "system"]).optional(),
      language: z.string().trim().max(12).optional(),
      aiBehavior: z.enum(["balanced", "direct", "coach"]).optional(),
      aiModel: z.string().trim().max(120).nullable().optional(),
    })).mutation(({ ctx, input }) => db.updateProfile(ctx.user.id, input)),
  }),

  plans: router({
    list: publicProcedure.query(() => db.getPlans()),
  }),

  billing: router({
    overview: protectedProcedure.query(({ ctx }) => billingOverview(ctx.user.id)),
  }),

  projects: router({
    list: protectedProcedure.query(({ ctx }) => db.listProjects(ctx.user.id)),
    get: protectedProcedure.input(z.object({ projectId: id })).query(({ ctx, input }) => db.getProject(ctx.user.id, input.projectId)),
    create: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(160), description: optionalText, instructions: optionalText })).mutation(async ({ ctx, input }) => {
      return withProjectQuota(ctx.user.id, () => db.createProject(ctx.user.id, input));
    }),
    update: protectedProcedure.input(z.object({ projectId: id, name: z.string().trim().min(1).max(160).optional(), description: optionalText, instructions: optionalText })).mutation(async ({ ctx, input }) => {
      const result = await db.updateProject(ctx.user.id, input.projectId, { name: input.name, description: input.description, instructions: input.instructions });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Projeto não encontrado." });
      return result;
    }),
    delete: protectedProcedure.input(z.object({ projectId: id })).mutation(async ({ ctx, input }) => {
      const deleted = await db.deleteProject(ctx.user.id, input.projectId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Projeto não encontrado." });
      return { success: true };
    }),
  }),

  tasks: router({
    list: protectedProcedure.input(z.object({ status: taskStatus.optional(), search: z.string().trim().max(120).optional(), projectId: id.optional() }).optional()).query(({ ctx, input }) => db.listTasks(ctx.user.id, input)),
    create: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(180), description: optionalText, priority: taskPriority.default("medium"), status: taskStatus.default("todo"), dueDate: z.string().datetime().nullable().optional(), projectId: id.nullable().optional() })).mutation(async ({ ctx, input }) => {
      if (input.projectId) await assertProjectWriteAccess(ctx.user.id, input.projectId);
      return withTaskQuota(ctx.user.id, () => db.createTask(ctx.user.id, { title: input.title, description: input.description, priority: input.priority, status: input.status, dueDate: input.dueDate ? new Date(input.dueDate) : null, projectId: input.projectId ?? null }));
    }),
    update: protectedProcedure.input(z.object({ taskId: id, title: z.string().trim().min(1).max(180).optional(), description: optionalText, priority: taskPriority.optional(), status: taskStatus.optional(), dueDate: z.string().datetime().nullable().optional(), projectId: id.nullable().optional() })).mutation(async ({ ctx, input }) => {
      if (input.projectId) await assertProjectWriteAccess(ctx.user.id, input.projectId);
      const result = await db.updateTask(ctx.user.id, input.taskId, { title: input.title, description: input.description, priority: input.priority, status: input.status, dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null, projectId: input.projectId });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada." });
      return result;
    }),
    delete: protectedProcedure.input(z.object({ taskId: id })).mutation(async ({ ctx, input }) => {
      const deleted = await db.deleteTask(ctx.user.id, input.taskId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada." });
      return { success: true };
    }),
  }),

  search: router({
    all: protectedProcedure.input(z.object({ query: z.string().trim().min(2).max(120) })).query(({ ctx, input }) => db.globalSearch(ctx.user.id, input.query)),
  }),

  chat: router({
    list: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: id.optional() }).optional()).query(({ ctx, input }) => db.listConversations(ctx.user.id, input?.limit ?? 30, input?.cursor)),
    messages: protectedProcedure.input(z.object({ conversationId: id, limit: z.number().int().min(1).max(100).optional(), cursor: id.optional() })).query(async ({ ctx, input }) => {
      const result = await db.listMessages(ctx.user.id, input.conversationId, input.limit ?? 100, input.cursor);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada." });
      return result;
    }),
    create: protectedProcedure.input(z.object({ title: z.string().trim().max(180).optional(), projectId: id.nullable().optional(), mode: mode.optional() })).mutation(async ({ ctx, input }) => {
      if (input.projectId) await assertProjectWriteAccess(ctx.user.id, input.projectId);
      return withConversationQuota(ctx.user.id, () => db.createConversation(ctx.user.id, { title: cleanTitle(input.title || "Nova conversa"), projectId: input.projectId ?? undefined, mode: input.mode }));
    }),
    rename: protectedProcedure.input(z.object({ conversationId: id, title: z.string().trim().min(1).max(180) })).mutation(async ({ ctx, input }) => {
      const result = await db.updateConversation(ctx.user.id, input.conversationId, { title: cleanTitle(input.title) });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada." });
      return result;
    }),
    archive: protectedProcedure.input(z.object({ conversationId: id })).mutation(async ({ ctx, input }) => {
      const result = await db.updateConversation(ctx.user.id, input.conversationId, { archived: true });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada." });
      return { success: true };
    }),
    send: protectedProcedure.input(z.object({ conversationId: id.nullable().optional(), content: z.string().trim().min(1).max(30_000), mode: mode.optional() })).mutation(async ({ ctx, input }) => {
      let conversation = input.conversationId ? await db.getConversation(ctx.user.id, input.conversationId) : undefined;
      if (input.conversationId && !conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversa não encontrada." });
      if (!conversation) {
        conversation = await withConversationQuota(ctx.user.id, () => db.createConversation(ctx.user.id, { title: cleanTitle(input.content), mode: input.mode ?? "general" }));
      }
      if (!conversation) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a conversa." });
      await assertAiQuota(ctx.user.id);
      const project = conversation.projectId ? await db.getProject(ctx.user.id, conversation.projectId) : undefined;
      await db.addMessage({ conversationId: conversation.id, userId: ctx.user.id, role: "user", content: input.content, status: "success" });
      const history = await db.listMessages(ctx.user.id, conversation.id, 24);
      const turns = [
        { role: "system" as const, content: `Você é o ProdutivaAI, um assistente de produtividade lúcido e prático. Responda em português do Brasil. Modo atual: ${conversation.mode}. Não invente fatos, fontes ou ações realizadas. Seja claro e entregue próximos passos quando útil.${project?.instructions ? ` Instruções do projeto: ${project.instructions.slice(0, 4000)}` : ""}` },
        ...((history?.items || []).filter(message => message.status === "success" && (message.role === "user" || message.role === "assistant")).map(message => ({ role: message.role, content: message.content })) as Array<{ role: "user" | "assistant"; content: string }>),
      ];
      try {
        const result = await callAI(ctx.user.id, turns, { model: undefined });
        const assistant = await db.addMessage({ conversationId: conversation.id, userId: ctx.user.id, role: "assistant", content: result.content, model: result.model, tokensInput: result.tokensInput, tokensOutput: result.tokensOutput, status: "success" });
        await Promise.all([
          db.addUsageLog({ userId: ctx.user.id, conversationId: conversation.id, model: result.model, operation: "chat", requestCount: 1, tokensInput: result.tokensInput, tokensOutput: result.tokensOutput, status: "success" }),
          db.addApiUsage({ userId: ctx.user.id, model: result.model, requestCount: 1, tokensInput: result.tokensInput, tokensOutput: result.tokensOutput }),
        ]);
        if (conversation.title === "Nova conversa") await db.updateConversation(ctx.user.id, conversation.id, { title: cleanTitle(input.content) });
        return { conversationId: conversation.id, message: assistant, model: result.model };
      } catch (error) {
        await db.addUsageLog({ userId: ctx.user.id, conversationId: conversation.id, model: null, operation: "chat", requestCount: 1, status: "error" }).catch(() => undefined);
        throw error;
      }
    }),
  }),

    ai: router({
    runTool: protectedProcedure.input(z.object({ tool: z.enum(["summarize", "analyze", "explain", "improve", "ideas", "plan", "rewrite", "study", "work"]), input: z.string().trim().min(1).max(30_000), context: z.string().trim().max(4000).optional() })).mutation(async ({ ctx, input }) => {
      await assertAiQuota(ctx.user.id);
      const result = await callAI(ctx.user.id, buildToolTurns(input.tool, input.input, input.context));
      await Promise.all([
        db.addUsageLog({ userId: ctx.user.id, model: result.model, operation: `tool:${input.tool}`, requestCount: 1, tokensInput: result.tokensInput, tokensOutput: result.tokensOutput, status: "success" }),
        db.addApiUsage({ userId: ctx.user.id, model: result.model, requestCount: 1, tokensInput: result.tokensInput, tokensOutput: result.tokensOutput }),
      ]);
      return result;
    }),
  }),

  settings: router({
    get: protectedProcedure.query(({ ctx }) => db.getSettings(ctx.user.id)),
    set: protectedProcedure.input(z.object({ key: z.string().trim().min(1).max(80), value: z.string().max(4000).nullable() })).mutation(({ ctx, input }) => db.setSetting(ctx.user.id, input.key, input.value)),
  }),
});

export type AppRouter = typeof appRouter;
