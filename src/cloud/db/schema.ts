/**
 * Agent Relay Cloud - Drizzle Schema
 *
 * Type-safe database schema with PostgreSQL support.
 * Generate migrations: npm run db:generate
 * Run migrations: npm run db:migrate
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  bigint,
  jsonb,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================================
// Users
// ============================================================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubId: varchar('github_id', { length: 255 }).unique().notNull(),
  githubUsername: varchar('github_username', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  avatarUrl: varchar('avatar_url', { length: 512 }),
  plan: varchar('plan', { length: 50 }).notNull().default('free'),
  onboardingCompletedAt: timestamp('onboarding_completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  credentials: many(credentials),
  workspaces: many(workspaces),
  repositories: many(repositories),
  linkedDaemons: many(linkedDaemons),
}));

// ============================================================================
// Credentials (provider tokens)
// ============================================================================

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 50 }).notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  scopes: text('scopes').array(),
  providerAccountId: varchar('provider_account_id', { length: 255 }),
  providerAccountEmail: varchar('provider_account_email', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userProviderIdx: unique('credentials_user_provider_unique').on(table.userId, table.provider),
  userIdIdx: index('idx_credentials_user_id').on(table.userId),
}));

export const credentialsRelations = relations(credentials, ({ one }) => ({
  user: one(users, {
    fields: [credentials.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Workspaces
// ============================================================================

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('provisioning'),
  computeProvider: varchar('compute_provider', { length: 50 }).notNull(),
  computeId: varchar('compute_id', { length: 255 }),
  publicUrl: varchar('public_url', { length: 255 }),
  customDomain: varchar('custom_domain', { length: 255 }),
  customDomainStatus: varchar('custom_domain_status', { length: 50 }),
  config: jsonb('config').notNull().default({}),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_workspaces_user_id').on(table.userId),
  customDomainIdx: index('idx_workspaces_custom_domain').on(table.customDomain),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  user: one(users, {
    fields: [workspaces.userId],
    references: [users.id],
  }),
  members: many(workspaceMembers),
  repositories: many(repositories),
}));

// ============================================================================
// Workspace Members
// ============================================================================

export const workspaceMembers = pgTable('workspace_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 50 }).notNull().default('member'),
  invitedBy: uuid('invited_by').references(() => users.id),
  invitedAt: timestamp('invited_at').defaultNow(),
  acceptedAt: timestamp('accepted_at'),
}, (table) => ({
  workspaceUserIdx: unique('workspace_members_workspace_user_unique').on(table.workspaceId, table.userId),
  workspaceIdIdx: index('idx_workspace_members_workspace_id').on(table.workspaceId),
  userIdIdx: index('idx_workspace_members_user_id').on(table.userId),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [workspaceMembers.userId],
    references: [users.id],
  }),
  inviter: one(users, {
    fields: [workspaceMembers.invitedBy],
    references: [users.id],
  }),
}));

// ============================================================================
// Repositories
// ============================================================================

export const repositories = pgTable('repositories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  githubFullName: varchar('github_full_name', { length: 255 }).notNull(),
  githubId: bigint('github_id', { mode: 'number' }).notNull(),
  defaultBranch: varchar('default_branch', { length: 255 }).notNull().default('main'),
  isPrivate: boolean('is_private').notNull().default(false),
  syncStatus: varchar('sync_status', { length: 50 }).notNull().default('pending'),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userGithubIdx: unique('repositories_user_github_unique').on(table.userId, table.githubFullName),
  userIdIdx: index('idx_repositories_user_id').on(table.userId),
  workspaceIdIdx: index('idx_repositories_workspace_id').on(table.workspaceId),
}));

export const repositoriesRelations = relations(repositories, ({ one }) => ({
  user: one(users, {
    fields: [repositories.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [repositories.workspaceId],
    references: [workspaces.id],
  }),
}));

// ============================================================================
// Linked Daemons (local agent-relay instances)
// ============================================================================

export const linkedDaemons = pgTable('linked_daemons', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  machineId: varchar('machine_id', { length: 255 }).notNull(),
  apiKeyHash: varchar('api_key_hash', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('offline'),
  lastSeenAt: timestamp('last_seen_at'),
  metadata: jsonb('metadata').notNull().default({}),
  pendingUpdates: jsonb('pending_updates').notNull().default([]),
  messageQueue: jsonb('message_queue').notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userMachineIdx: unique('linked_daemons_user_machine_unique').on(table.userId, table.machineId),
  userIdIdx: index('idx_linked_daemons_user_id').on(table.userId),
  apiKeyHashIdx: index('idx_linked_daemons_api_key_hash').on(table.apiKeyHash),
  statusIdx: index('idx_linked_daemons_status').on(table.status),
}));

export const linkedDaemonsRelations = relations(linkedDaemons, ({ one }) => ({
  user: one(users, {
    fields: [linkedDaemons.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Subscriptions (billing)
// ============================================================================

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }).unique(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  plan: varchar('plan', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('active'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// Usage Records
// ============================================================================

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  metric: varchar('metric', { length: 100 }).notNull(),
  value: bigint('value', { mode: 'number' }).notNull(),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_usage_records_user_id').on(table.userId),
  recordedAtIdx: index('idx_usage_records_recorded_at').on(table.recordedAt),
}));

// ============================================================================
// Type exports
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type LinkedDaemon = typeof linkedDaemons.$inferSelect;
export type NewLinkedDaemon = typeof linkedDaemons.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;
