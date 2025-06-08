import { sqliteTable, text, integer, index, unique } from "drizzle-orm/sqlite-core";

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  serverId: text("server_id").notNull(),
  serverName: text("server_name").notNull(),
  channelName: text("channel_name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const stageSessions = sqliteTable("stage_sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()), // TODO: change to ulid or uuidv7
  serverId: text("server_id").notNull(),
  channelId: text("channel_id").notNull(),
  startTime: integer("start_time", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  endTime: integer("end_time", { mode: "timestamp" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  uniqueUserCount: integer("unique_user_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const stageUsers = sqliteTable("stage_users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id").notNull()
    .references(() => stageSessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  displayname: text("name").notNull(),
  joinTime: integer("join_time", { mode: "timestamp" }).notNull(),
  leaveTime: integer("leave_time", { mode: "timestamp" }),
  totalTimeMs: integer("total_time_ms").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("stage_user_index").on(table.userId, table.sessionId),
  unique().on(table.userId, table.sessionId),
]);

export const stickyMessage = sqliteTable("sticky_message", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  channelId: text("channel_id").notNull(),
  serverId: text("server_id").notNull(),
  serverName: text("server_name").notNull(),
  channelName: text("channel_name").notNull(),
  message: text("message").notNull(),
  lastMessageId: text("last_message_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
