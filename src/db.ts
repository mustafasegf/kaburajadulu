import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";
import { eq, and, isNull } from "drizzle-orm";
import { type InferSelectModel, type InferInsertModel } from "drizzle-orm";

const url = process.env.DATABASE_URL?.replace("file:./", "") || "sqlite.db";

const sqlite = new Database(url);
export const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: "./migration" });

// Type definitions for our models
export type Server = InferSelectModel<typeof schema.servers>;
export type ServerInsert = InferInsertModel<typeof schema.servers>;

export type StageSession = InferSelectModel<typeof schema.stageSessions>;
export type StageSessionInsert = InferInsertModel<typeof schema.stageSessions>;

export type StageUser = InferSelectModel<typeof schema.stageUsers>;
export type StageUserInsert = InferInsertModel<typeof schema.stageUsers>;

export type UserRole = InferSelectModel<typeof schema.userRoles>;
export type UserRoleInsert = InferInsertModel<typeof schema.userRoles>;

export type TimelinePoint = InferSelectModel<typeof schema.timelinePoints>;
export type TimelinePointInsert = InferInsertModel<typeof schema.timelinePoints>;

// Server configuration functions
export function createServer(props: ServerInsert) {
  return db.insert(schema.servers)
    .values(props)
    .onConflictDoUpdate({
      target: schema.servers.id,
      set: {
        channelId: props.channelId,
        categoryId: props.categoryId,
        updatedAt: new Date()
      }
    })
    .returning()
    .get();
}

export function getServer(serverId: string) {
  return db.select().from(schema.servers).where(eq(schema.servers.id, serverId)).get();
}

// Stage session functions
export function createStageSession(props: StageSessionInsert) {
  return db.insert(schema.stageSessions)
    .values(props)
    .returning()
    .get();
}

export function getActiveStageSession(stageId: string) {
  return db.select()
    .from(schema.stageSessions)
    .where(and(
      eq(schema.stageSessions.stageId, stageId),
      eq(schema.stageSessions.isActive, true)
    ))
    .get();
}

export function endStageSession(sessionId: string, endTime: Date) {
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

// User participation tracking functions
export function upsertStageUser(props: StageUserInsert) {
  return db.insert(schema.stageUsers)
    .values(props)
    .onConflictDoUpdate({
      target: schema.stageUsers.userSessionIdx,
      set: {
        joinTime: props.joinTime,
        leaveTime: props.leaveTime,
        totalTimeMs: props.totalTimeMs,
        updatedAt: new Date()
      }
    })
    .returning()
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

// Role tracking functions
export function addUserRole(stageUserId: string, roleName: string) {
  return db.insert(schema.userRoles)
    .values({ stageUserId, roleName })
    .onConflictDoNothing()
    .returning()
    .get();
}

export function getUserRoles(stageUserId: string) {
  return db.select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.stageUserId, stageUserId))
    .all();
}

// Timeline functions
export function addTimelinePoint(sessionId: string, timestamp: Date, userCount: number) {
  return db.insert(schema.timelinePoints)
    .values({ sessionId, timestamp, userCount })
    .returning()
    .get();
}

export function getTimelinePoints(sessionId: string) {
  return db.select()
    .from(schema.timelinePoints)
    .where(eq(schema.timelinePoints.sessionId, sessionId))
    .orderBy(schema.timelinePoints.timestamp)
    .all();
}

// Stats queries
export function getAverageTimeSpent(sessionId: string) {
  const users = getUsersForSession(sessionId);
  if (users.length === 0) return 0;
  
  const totalTime = users.reduce((sum, user) => sum + user.totalTimeMs, 0);
  return totalTime / users.length;
}
