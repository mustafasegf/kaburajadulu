import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";
import { eq, and, desc } from "drizzle-orm";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

const url = process.env.DATABASE_URL?.replace("file:./", "") || "sqlite.db";

const sqlite = new Database(url);
export const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: "./migration" });

export type Channel = InferSelectModel<typeof schema.channels>;
export type ChannelInsert = InferInsertModel<typeof schema.channels>;

export type StageSession = InferSelectModel<typeof schema.stageSessions>;
export type StageSessionInsert = InferInsertModel<typeof schema.stageSessions>;

export type StageUser = InferSelectModel<typeof schema.stageUsers>;
export type StageUserInsert = InferInsertModel<typeof schema.stageUsers>;

export function addChannel(props: ChannelInsert): Channel {
  return db.insert(schema.channels)
    .values(props)
    .onConflictDoUpdate({
      target: schema.channels.id,
      set: {
        ...props,
        updatedAt: new Date(),
      },
    })
    .returning()
    .get();
}

export function listChannelFromServerId(serverId: string): Channel[] {
  return db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.serverId, serverId))
    .all();
}

export function getChannelFromChannelAndServer(channelId: string, serverId: string): Channel | undefined {
  return db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.channelId, channelId),
        eq(schema.channels.serverId, serverId),
      )
    ).get()
}

export function addStageSession(props: StageSessionInsert): StageSession {
  return db.insert(schema.stageSessions)
    .values(props)
    .onConflictDoNothing()
    .returning()
    .get();
}

export function getActiveStageSession(channelId: string): StageSession | undefined {
  return db.select()
    .from(schema.stageSessions)
    .where(and(
      eq(schema.stageSessions.channelId, channelId),
      eq(schema.stageSessions.isActive, true)
    ))
    .orderBy(desc(schema.stageSessions.startTime))
    .get();
}

export function endStageSession(sessionId: string, endTime: Date): StageSession {
  return db.update(schema.stageSessions)
    .set({
      endTime,
      isActive: false,
      updatedAt: new Date()
    })
    .where(eq(schema.stageSessions.id, sessionId))
    .returning()
    .get();
}

export function updateSessionUniqueUserCount(sessionId: string, count: number) {
  return db.update(schema.stageSessions)
    .set({
      uniqueUserCount: count,
      updatedAt: new Date()
    })
    .where(eq(schema.stageSessions.id, sessionId))
    .returning()
    .get();
}

export function upsertStageUser(props: StageUserInsert) {
  return db.insert(schema.stageUsers)
    .values(props)
    .onConflictDoUpdate({
      target: [schema.stageUsers.userId, schema.stageUsers.sessionId],
      set: {
        joinTime: props.joinTime,
        leaveTime: props.leaveTime,
        totalTimeMs: props.totalTimeMs,
        updatedAt: new Date()
      }
    })
    .get();
}

export function getStageUser(sessionId: string, userId: string) {
  return db.select()
    .from(schema.stageUsers)
    .where(and(
      eq(schema.stageUsers.sessionId, sessionId),
      eq(schema.stageUsers.userId, userId)
    ))
    .get();
}

export function getUsersForSession(sessionId: string) {
  return db.select()
    .from(schema.stageUsers)
    .where(eq(schema.stageUsers.sessionId, sessionId))
    .all();
}

export function markUserLeave(sessionId: string, userId: string, leaveTime: Date, totalTimeMs: number) {
  return db.update(schema.stageUsers)
    .set({
      leaveTime,
      totalTimeMs,
      updatedAt: new Date()
    })
    .where(and(
      eq(schema.stageUsers.sessionId, sessionId),
      eq(schema.stageUsers.userId, userId)
    ))
    .returning()
    .get();
}

export function getAverageTimeSpent(sessionId: string) {
  const users = getUsersForSession(sessionId);
  if (users.length === 0) return 0;

  const totalTime = users.reduce((sum, user) => sum + user.totalTimeMs, 0);
  return totalTime / users.length;
}
