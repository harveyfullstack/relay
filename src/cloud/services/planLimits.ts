/**
 * Plan Limits Service
 *
 * Defines resource limits for each plan tier and provides
 * functions to check if users are within their limits.
 */

import { db, PlanType, usageRecordsTable } from '../db/index.js';
import { eq, and, gte, sql } from 'drizzle-orm';
import { getDb } from '../db/drizzle.js';

/**
 * Resource limits for each plan tier
 */
export interface PlanLimits {
  maxWorkspaces: number;
  maxAgentsPerWorkspace: number;
  maxComputeHoursPerMonth: number;
}

/**
 * Plan limits configuration
 */
export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxWorkspaces: 2,
    maxAgentsPerWorkspace: 3,
    maxComputeHoursPerMonth: 10,
  },
  pro: {
    maxWorkspaces: 10,
    maxAgentsPerWorkspace: 10,
    maxComputeHoursPerMonth: 100,
  },
  team: {
    maxWorkspaces: 50,
    maxAgentsPerWorkspace: 25,
    maxComputeHoursPerMonth: 500,
  },
  enterprise: {
    maxWorkspaces: Infinity,
    maxAgentsPerWorkspace: Infinity,
    maxComputeHoursPerMonth: Infinity,
  },
};

/**
 * Get plan limits for a given plan type
 */
export function getPlanLimits(plan: PlanType): PlanLimits {
  return PLAN_LIMITS[plan];
}

/**
 * Current usage for a user
 */
export interface UserUsage {
  workspaceCount: number;
  computeHoursThisMonth: number;
}

/**
 * Get current usage for a user
 */
export async function getUserUsage(userId: string): Promise<UserUsage> {
  // Get workspace count
  const workspaces = await db.workspaces.findByUserId(userId);
  const workspaceCount = workspaces.length;

  // Get compute hours this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const drizzleDb = getDb();
  const computeHoursResult = await drizzleDb
    .select({ total: sql<number>`COALESCE(SUM(${usageRecordsTable.value}), 0)` })
    .from(usageRecordsTable)
    .where(
      and(
        eq(usageRecordsTable.userId, userId),
        eq(usageRecordsTable.metric, 'compute_hours'),
        gte(usageRecordsTable.recordedAt, startOfMonth)
      )
    );

  const computeHoursThisMonth = Number(computeHoursResult[0]?.total || 0);

  return {
    workspaceCount,
    computeHoursThisMonth,
  };
}

/**
 * Check if user can create a new workspace
 */
export async function canCreateWorkspace(userId: string): Promise<{
  allowed: boolean;
  reason?: string;
  limit?: number;
  current?: number;
}> {
  const user = await db.users.findById(userId);
  if (!user) {
    return { allowed: false, reason: 'User not found' };
  }

  const plan = (user.plan as PlanType) || 'free';
  const limits = getPlanLimits(plan);
  const usage = await getUserUsage(userId);

  if (usage.workspaceCount >= limits.maxWorkspaces) {
    return {
      allowed: false,
      reason: `Workspace limit reached for ${plan} plan`,
      limit: limits.maxWorkspaces,
      current: usage.workspaceCount,
    };
  }

  return { allowed: true };
}

/**
 * Check if user can spawn agents in a workspace
 */
export async function canSpawnAgent(
  userId: string,
  workspaceId: string,
  currentAgentCount: number
): Promise<{
  allowed: boolean;
  reason?: string;
  limit?: number;
  current?: number;
}> {
  const user = await db.users.findById(userId);
  if (!user) {
    return { allowed: false, reason: 'User not found' };
  }

  const plan = (user.plan as PlanType) || 'free';
  const limits = getPlanLimits(plan);

  if (currentAgentCount >= limits.maxAgentsPerWorkspace) {
    return {
      allowed: false,
      reason: `Agent limit reached for ${plan} plan`,
      limit: limits.maxAgentsPerWorkspace,
      current: currentAgentCount,
    };
  }

  return { allowed: true };
}

/**
 * Check if user has compute hours available
 */
export async function hasComputeHoursAvailable(userId: string): Promise<{
  available: boolean;
  reason?: string;
  limit?: number;
  current?: number;
}> {
  const user = await db.users.findById(userId);
  if (!user) {
    return { available: false, reason: 'User not found' };
  }

  const plan = (user.plan as PlanType) || 'free';
  const limits = getPlanLimits(plan);
  const usage = await getUserUsage(userId);

  // Enterprise has unlimited
  if (limits.maxComputeHoursPerMonth === Infinity) {
    return { available: true };
  }

  if (usage.computeHoursThisMonth >= limits.maxComputeHoursPerMonth) {
    return {
      available: false,
      reason: `Compute hours limit reached for ${plan} plan`,
      limit: limits.maxComputeHoursPerMonth,
      current: usage.computeHoursThisMonth,
    };
  }

  return { available: true };
}

/**
 * Get remaining quota for a user
 */
export async function getRemainingQuota(userId: string): Promise<{
  plan: PlanType;
  limits: PlanLimits;
  usage: UserUsage;
  remaining: {
    workspaces: number;
    computeHours: number;
  };
}> {
  const user = await db.users.findById(userId);
  const plan = ((user?.plan as PlanType) || 'free') as PlanType;
  const limits = getPlanLimits(plan);
  const usage = await getUserUsage(userId);

  return {
    plan,
    limits,
    usage,
    remaining: {
      workspaces:
        limits.maxWorkspaces === Infinity
          ? Infinity
          : Math.max(0, limits.maxWorkspaces - usage.workspaceCount),
      computeHours:
        limits.maxComputeHoursPerMonth === Infinity
          ? Infinity
          : Math.max(0, limits.maxComputeHoursPerMonth - usage.computeHoursThisMonth),
    },
  };
}

/**
 * Record compute usage
 */
export async function recordComputeUsage(
  userId: string,
  workspaceId: string,
  hours: number
): Promise<void> {
  const drizzleDb = getDb();
  await drizzleDb.insert(usageRecordsTable).values({
    userId,
    workspaceId,
    metric: 'compute_hours',
    value: Math.round(hours * 100) / 100, // Round to 2 decimal places
    recordedAt: new Date(),
  });
}
