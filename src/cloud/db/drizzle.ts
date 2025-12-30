/**
 * Agent Relay Cloud - Drizzle Database Client
 *
 * Type-safe database access using Drizzle ORM.
 * Use this instead of the raw pg client for new code.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, and, sql, desc, lt, isNull, isNotNull } from 'drizzle-orm';
import * as schema from './schema.js';
import { getConfig } from '../config.js';

// Types
export type {
  User,
  NewUser,
  Credential,
  NewCredential,
  Workspace,
  NewWorkspace,
  WorkspaceMember,
  NewWorkspaceMember,
  Repository,
  NewRepository,
  LinkedDaemon,
  NewLinkedDaemon,
  Subscription,
  NewSubscription,
  UsageRecord,
  NewUsageRecord,
} from './schema.js';

// Re-export schema for direct table access
export * from './schema.js';

// Initialize pool and drizzle lazily
let pool: Pool | null = null;
let drizzleDb: ReturnType<typeof drizzle> | null = null;

function getPool(): Pool {
  if (!pool) {
    const config = getConfig();
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

export function getDb() {
  if (!drizzleDb) {
    drizzleDb = drizzle(getPool(), { schema });
  }
  return drizzleDb;
}

// ============================================================================
// User Queries
// ============================================================================

export const userQueries = {
  async findById(id: string) {
    const db = getDb();
    const result = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return result[0] ?? null;
  },

  async findByGithubId(githubId: string) {
    const db = getDb();
    const result = await db.select().from(schema.users).where(eq(schema.users.githubId, githubId));
    return result[0] ?? null;
  },

  async findByEmail(email: string) {
    const db = getDb();
    const result = await db.select().from(schema.users).where(eq(schema.users.email, email));
    return result[0] ?? null;
  },

  async upsert(data: schema.NewUser) {
    const db = getDb();
    const result = await db
      .insert(schema.users)
      .values(data)
      .onConflictDoUpdate({
        target: schema.users.githubId,
        set: {
          githubUsername: data.githubUsername,
          email: data.email,
          avatarUrl: data.avatarUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  },

  async completeOnboarding(userId: string) {
    const db = getDb();
    await db
      .update(schema.users)
      .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  },
};

// ============================================================================
// Credential Queries
// ============================================================================

export const credentialQueries = {
  async findByUserId(userId: string) {
    const db = getDb();
    return db.select().from(schema.credentials).where(eq(schema.credentials.userId, userId));
  },

  async findByUserAndProvider(userId: string, provider: string) {
    const db = getDb();
    const result = await db
      .select()
      .from(schema.credentials)
      .where(and(eq(schema.credentials.userId, userId), eq(schema.credentials.provider, provider)));
    return result[0] ?? null;
  },

  async upsert(data: schema.NewCredential) {
    const db = getDb();
    const result = await db
      .insert(schema.credentials)
      .values(data)
      .onConflictDoUpdate({
        target: [schema.credentials.userId, schema.credentials.provider],
        set: {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? sql`credentials.refresh_token`,
          tokenExpiresAt: data.tokenExpiresAt,
          scopes: data.scopes,
          providerAccountId: data.providerAccountId,
          providerAccountEmail: data.providerAccountEmail,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  },

  async delete(userId: string, provider: string) {
    const db = getDb();
    await db
      .delete(schema.credentials)
      .where(and(eq(schema.credentials.userId, userId), eq(schema.credentials.provider, provider)));
  },
};

// ============================================================================
// Workspace Queries
// ============================================================================

export const workspaceQueries = {
  async findById(id: string) {
    const db = getDb();
    const result = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id));
    return result[0] ?? null;
  },

  async findByUserId(userId: string) {
    const db = getDb();
    return db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.userId, userId))
      .orderBy(desc(schema.workspaces.createdAt));
  },

  async findByCustomDomain(domain: string) {
    const db = getDb();
    const result = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.customDomain, domain));
    return result[0] ?? null;
  },

  async create(data: schema.NewWorkspace) {
    const db = getDb();
    const result = await db.insert(schema.workspaces).values(data).returning();
    return result[0];
  },

  async updateStatus(
    id: string,
    status: string,
    options?: { computeId?: string; publicUrl?: string; errorMessage?: string }
  ) {
    const db = getDb();
    await db
      .update(schema.workspaces)
      .set({
        status,
        computeId: options?.computeId,
        publicUrl: options?.publicUrl,
        errorMessage: options?.errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, id));
  },

  async delete(id: string) {
    const db = getDb();
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  },
};

// ============================================================================
// Linked Daemon Queries
// ============================================================================

export const linkedDaemonQueries = {
  async findById(id: string) {
    const db = getDb();
    const result = await db.select().from(schema.linkedDaemons).where(eq(schema.linkedDaemons.id, id));
    return result[0] ?? null;
  },

  async findByUserId(userId: string) {
    const db = getDb();
    return db
      .select()
      .from(schema.linkedDaemons)
      .where(eq(schema.linkedDaemons.userId, userId))
      .orderBy(desc(schema.linkedDaemons.lastSeenAt));
  },

  async findByMachineId(userId: string, machineId: string) {
    const db = getDb();
    const result = await db
      .select()
      .from(schema.linkedDaemons)
      .where(
        and(eq(schema.linkedDaemons.userId, userId), eq(schema.linkedDaemons.machineId, machineId))
      );
    return result[0] ?? null;
  },

  async findByApiKeyHash(apiKeyHash: string) {
    const db = getDb();
    const result = await db
      .select()
      .from(schema.linkedDaemons)
      .where(eq(schema.linkedDaemons.apiKeyHash, apiKeyHash));
    return result[0] ?? null;
  },

  async create(data: schema.NewLinkedDaemon) {
    const db = getDb();
    const result = await db
      .insert(schema.linkedDaemons)
      .values({ ...data, lastSeenAt: new Date() })
      .returning();
    return result[0];
  },

  async update(id: string, data: Partial<schema.LinkedDaemon>) {
    const db = getDb();
    await db
      .update(schema.linkedDaemons)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.linkedDaemons.id, id));
  },

  async updateLastSeen(id: string) {
    const db = getDb();
    await db
      .update(schema.linkedDaemons)
      .set({ lastSeenAt: new Date(), status: 'online', updatedAt: new Date() })
      .where(eq(schema.linkedDaemons.id, id));
  },

  async delete(id: string) {
    const db = getDb();
    await db.delete(schema.linkedDaemons).where(eq(schema.linkedDaemons.id, id));
  },

  async markStale() {
    const db = getDb();
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const result = await db
      .update(schema.linkedDaemons)
      .set({ status: 'offline' })
      .where(
        and(
          eq(schema.linkedDaemons.status, 'online'),
          lt(schema.linkedDaemons.lastSeenAt, twoMinutesAgo)
        )
      );
    return result.rowCount ?? 0;
  },

  // Get all agents from all daemons for a user (cross-machine discovery)
  async getAllAgentsForUser(userId: string): Promise<
    Array<{
      daemonId: string;
      daemonName: string;
      machineId: string;
      agents: Array<{ name: string; status: string }>;
    }>
  > {
    const db = getDb();
    const daemons = await db
      .select()
      .from(schema.linkedDaemons)
      .where(eq(schema.linkedDaemons.userId, userId));

    return daemons.map((d) => ({
      daemonId: d.id,
      daemonName: d.name,
      machineId: d.machineId,
      agents: ((d.metadata as any)?.agents as Array<{ name: string; status: string }>) || [],
    }));
  },
};

// ============================================================================
// Repository Queries
// ============================================================================

export const repositoryQueries = {
  async findByUserId(userId: string) {
    const db = getDb();
    return db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.userId, userId))
      .orderBy(schema.repositories.githubFullName);
  },

  async findByWorkspaceId(workspaceId: string) {
    const db = getDb();
    return db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.workspaceId, workspaceId));
  },

  async upsert(data: schema.NewRepository) {
    const db = getDb();
    const result = await db
      .insert(schema.repositories)
      .values(data)
      .onConflictDoUpdate({
        target: [schema.repositories.userId, schema.repositories.githubFullName],
        set: {
          githubId: data.githubId,
          defaultBranch: data.defaultBranch,
          isPrivate: data.isPrivate,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  },
};

// ============================================================================
// Migration helper
// ============================================================================

export async function runMigrations() {
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const db = getDb();
  await migrate(db, { migrationsFolder: './src/cloud/db/migrations' });
  console.log('Migrations complete');
}

// ============================================================================
// Close connections
// ============================================================================

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
    drizzleDb = null;
  }
}
