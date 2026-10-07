import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 128 }),
  passwordSalt: varchar("passwordSalt", { length: 64 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const profiles = mysqlTable("profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("displayName", { length: 160 }),
  avatarUrl: varchar("avatarUrl", { length: 500 }),
  theme: mysqlEnum("theme", ["light", "dark", "system"]).default("light").notNull(),
  language: varchar("language", { length: 12 }).default("pt-BR").notNull(),
  aiBehavior: varchar("aiBehavior", { length: 32 }).default("balanced").notNull(),
  aiModel: varchar("aiModel", { length: 120 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ profilesUserIdx: uniqueIndex("profiles_user_idx").on(table.userId) }));

export const plans = mysqlTable("plans", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 24 }).notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
  priceCents: int("priceCents").notNull(),
  currency: varchar("currency", { length: 3 }).default("BRL").notNull(),
  billingInterval: varchar("billingInterval", { length: 16 }).default("month").notNull(),
  conversationLimit: int("conversationLimit").notNull(),
  projectLimit: int("projectLimit").notNull(),
  taskLimit: int("taskLimit").notNull(),
  historyDays: int("historyDays").notNull(),
  advancedModels: boolean("advancedModels").default(false).notNull(),
  exportEnabled: boolean("exportEnabled").default(false).notNull(),
  priority: int("priority").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ plansCodeIdx: uniqueIndex("plans_code_idx").on(table.code) }));

export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: int("planId").notNull().references(() => plans.id),
  provider: varchar("provider", { length: 32 }).default("internal").notNull(),
  providerSubscriptionId: varchar("providerSubscriptionId", { length: 160 }),
  providerPaymentId: varchar("providerPaymentId", { length: 160 }),
  status: mysqlEnum("status", ["active", "pending", "cancelled", "expired", "past_due", "rejected"]).default("pending").notNull(),
  startedAt: timestamp("startedAt"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ subscriptionUserIdx: index("subscriptions_user_idx").on(table.userId, table.status) }));

export const subscriptionEvents = mysqlTable("subscription_events", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 180 }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  eventType: varchar("eventType", { length: 120 }).notNull(),
  externalPaymentId: varchar("externalPaymentId", { length: 160 }),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  planCode: varchar("planCode", { length: 24 }),
  status: varchar("status", { length: 32 }).notNull(),
  processingResult: varchar("processingResult", { length: 120 }).notNull(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
}, table => ({ eventIdIdx: uniqueIndex("subscription_events_event_idx").on(table.eventId) }));

export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  instructions: text("instructions"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ projectsOwnerIdx: index("projects_owner_idx").on(table.ownerId, table.createdAt) }));

export const projectMembers = mysqlTable("project_members", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: mysqlEnum("role", ["viewer", "editor", "owner"]).default("viewer").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ memberUniqueIdx: uniqueIndex("project_member_unique_idx").on(table.projectId, table.userId) }));

export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: int("projectId").references(() => projects.id, { onDelete: "set null" }),
  title: varchar("title", { length: 180 }).notNull(),
  mode: mysqlEnum("mode", ["general", "study", "work"]).default("general").notNull(),
  archived: boolean("archived").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ conversationUserIdx: index("conversations_user_idx").on(table.userId, table.updatedAt) }));

export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: mysqlEnum("role", ["system", "user", "assistant", "tool"]).notNull(),
  content: text("content").notNull(),
  model: varchar("model", { length: 120 }),
  tokensInput: int("tokensInput"),
  tokensOutput: int("tokensOutput"),
  status: mysqlEnum("status", ["pending", "success", "error", "cancelled"]).default("success").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ messagesConversationIdx: index("messages_conversation_idx").on(table.conversationId, table.createdAt) }));

export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: int("projectId").references(() => projects.id, { onDelete: "set null" }),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description"),
  priority: mysqlEnum("priority", ["low", "medium", "high"]).default("medium").notNull(),
  status: mysqlEnum("status", ["todo", "in_progress", "done"]).default("todo").notNull(),
  dueDate: timestamp("dueDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ tasksUserIdx: index("tasks_user_idx").on(table.userId, table.status, table.dueDate) }));

export const usageLogs = mysqlTable("usage_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: int("conversationId").references(() => conversations.id, { onDelete: "set null" }),
  model: varchar("model", { length: 120 }),
  operation: varchar("operation", { length: 80 }).notNull(),
  requestCount: int("requestCount").default(1).notNull(),
  tokensInput: int("tokensInput"),
  tokensOutput: int("tokensOutput"),
  status: varchar("status", { length: 32 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ usageUserIdx: index("usage_user_idx").on(table.userId, table.createdAt) }));

export const apiUsage = mysqlTable("api_usage", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  model: varchar("model", { length: 120 }),
  requestCount: int("requestCount").default(1).notNull(),
  tokensInput: int("tokensInput"),
  tokensOutput: int("tokensOutput"),
  windowStart: timestamp("windowStart").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ apiUsageUserIdx: index("api_usage_user_idx").on(table.userId, table.windowStart) }));

export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 80 }).notNull(),
  value: text("value"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ settingsUniqueIdx: uniqueIndex("settings_user_key_idx").on(table.userId, table.key) }));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
