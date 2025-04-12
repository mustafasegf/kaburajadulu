import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// Servers table to store server configuration
export const servers = sqliteTable("servers", {
  id: text("id").primaryKey(), // Server/Guild ID
  channelId: text("channel_id"),
  categoryId: text("category_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Stage sessions table
export const stageSessions = sqliteTable("stage_sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()), // Unique session ID
  stageId: text("stage_id").notNull(), // Discord Stage ID
  startTime: integer("start_time", { mode: "timestamp" }).notNull(),
  endTime: integer("end_time", { mode: "timestamp" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  uniqueUserCount: integer("unique_user_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// User participation records
export const stageUsers = sqliteTable("stage_users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id").notNull()
    .references(() => stageSessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(), // Discord user ID
  username: text("username").notNull(),
  joinTime: integer("join_time", { mode: "timestamp" }).notNull(),
  leaveTime: integer("leave_time", { mode: "timestamp" }),
  totalTimeMs: integer("total_time_ms").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => {
  return {
    userSessionIdx: primaryKey({ columns: [table.userId, table.sessionId] })
  };
});

// User roles
export const userRoles = sqliteTable("user_roles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  stageUserId: text("stage_user_id").notNull()
    .references(() => stageUsers.id, { onDelete: "cascade" }),
  roleName: text("role_name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Timeline data points
export const timelinePoints = sqliteTable("timeline_points", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id").notNull()
    .references(() => stageSessions.id, { onDelete: "cascade" }),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  userCount: integer("user_count").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
