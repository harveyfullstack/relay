/**
 * SQLite Migration Runner for Relay Ledger
 *
 * Provides a lightweight migration system for the relay-ledger.db SQLite database.
 * Tracks applied migrations in a __migrations table and runs them in order.
 *
 * Features:
 * - Sequential migration execution by name
 * - Idempotent (safe to run multiple times)
 * - Tracks applied migrations with timestamps
 * - Embedded SQL for portability (no file dependencies)
 */

import type Database from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

export interface MigrationRecord {
  id: number;
  name: string;
  appliedAt: number;
  checksum: string;
}

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  errors: Array<{ name: string; error: string }>;
}

// ============================================================================
// Embedded Migrations
// ============================================================================

/**
 * Embedded migrations - SQL is stored directly in code for portability.
 * Add new migrations to this array in order.
 */
const EMBEDDED_MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: '0001_initial',
    sql: `
-- Relay Ledger - Initial Schema
-- Migration 0001: Initial tables for relay file tracking

-- Main relay files table
CREATE TABLE IF NOT EXISTS relay_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL UNIQUE,
  source_path TEXT NOT NULL,
  archive_path TEXT,
  agent_name TEXT NOT NULL,
  message_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retries INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  discovered_at INTEGER NOT NULL,
  processed_at INTEGER,
  archived_at INTEGER,
  error TEXT,
  content_hash TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  file_mtime_ns INTEGER,
  file_inode INTEGER,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_relay_files_status ON relay_files(status);
CREATE INDEX IF NOT EXISTS idx_relay_files_agent ON relay_files(agent_name);
CREATE INDEX IF NOT EXISTS idx_relay_files_discovered ON relay_files(discovered_at);
CREATE INDEX IF NOT EXISTS idx_relay_files_source ON relay_files(source_path);

-- Agents registry table
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT,
  CONSTRAINT valid_agent_status CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen_at);

-- Orchestrator state table (key-value store for crash recovery)
CREATE TABLE IF NOT EXISTS orchestrator_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Pending operations table (crash recovery atomicity)
CREATE TABLE IF NOT EXISTS pending_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  error TEXT,
  CONSTRAINT valid_operation_type CHECK (operation_type IN ('process', 'archive', 'cleanup'))
);

CREATE INDEX IF NOT EXISTS idx_pending_ops_type ON pending_operations(operation_type);
CREATE INDEX IF NOT EXISTS idx_pending_ops_target ON pending_operations(target_id);
    `,
  },
  {
    name: '0002_symlink_paths',
    sql: `
-- Migration 0002: Add symlink path tracking for production workspace support
-- Workspaces in cloud/production may be symlinked for isolation.
-- We store both the original symlink path (for debugging) and canonical path (for operations).

-- Add symlink_path column to track original path (may be symlink)
ALTER TABLE relay_files ADD COLUMN symlink_path TEXT;

-- Create index for symlink lookups
CREATE INDEX IF NOT EXISTS idx_relay_files_symlink ON relay_files(symlink_path);
    `,
  },
];

// ============================================================================
// Migration Runner
// ============================================================================

/**
 * Create the migrations tracking table if it doesn't exist
 */
export function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL,
      checksum TEXT NOT NULL
    );
  `);
}

/**
 * Get all applied migrations
 */
export function getAppliedMigrations(db: Database.Database): MigrationRecord[] {
  const rows = db.prepare(`
    SELECT id, name, applied_at, checksum FROM __migrations ORDER BY id ASC
  `).all() as Array<{ id: number; name: string; applied_at: number; checksum: string }>;

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    appliedAt: row.applied_at,
    checksum: row.checksum,
  }));
}

/**
 * Check if a specific migration has been applied
 */
export function isMigrationApplied(db: Database.Database, name: string): boolean {
  const row = db.prepare(`SELECT 1 FROM __migrations WHERE name = ?`).get(name);
  return row !== undefined;
}

/**
 * Record a migration as applied
 */
export function recordMigration(db: Database.Database, name: string, checksum: string): void {
  db.prepare(`
    INSERT INTO __migrations (name, applied_at, checksum) VALUES (?, ?, ?)
  `).run(name, Date.now(), checksum);
}

/**
 * Calculate a simple checksum for migration content
 */
export function calculateChecksum(sql: string): string {
  // Simple hash for migration verification
  let hash = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Load migrations from embedded definitions
 */
export function loadMigrationFiles(): MigrationFile[] {
  return EMBEDDED_MIGRATIONS.map(m => ({
    name: m.name,
    sql: m.sql,
    checksum: calculateChecksum(m.sql),
  }));
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): MigrationResult {
  const result: MigrationResult = {
    applied: [],
    skipped: [],
    errors: [],
  };

  // Ensure migrations table exists
  ensureMigrationsTable(db);

  // Load all migrations
  const migrations = loadMigrationFiles();

  // Get applied migrations
  const applied = new Set(getAppliedMigrations(db).map(m => m.name));

  // Run pending migrations in order
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      result.skipped.push(migration.name);
      continue;
    }

    try {
      // Run migration in a transaction
      db.transaction(() => {
        db.exec(migration.sql);
        recordMigration(db, migration.name, migration.checksum);
      })();

      result.applied.push(migration.name);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.errors.push({ name: migration.name, error: errorMessage });
      // Stop on first error
      break;
    }
  }

  return result;
}

/**
 * Get pending migrations that haven't been applied yet
 */
export function getPendingMigrations(db: Database.Database): MigrationFile[] {
  ensureMigrationsTable(db);
  const applied = new Set(getAppliedMigrations(db).map(m => m.name));
  return loadMigrationFiles().filter(m => !applied.has(m.name));
}

/**
 * Verify migration checksums match what was originally applied
 */
export function verifyMigrations(db: Database.Database): Array<{ name: string; expected: string; actual: string }> {
  const applied = getAppliedMigrations(db);
  const files = loadMigrationFiles();
  const fileMap = new Map(files.map(f => [f.name, f]));
  const mismatches: Array<{ name: string; expected: string; actual: string }> = [];

  for (const record of applied) {
    const file = fileMap.get(record.name);
    if (file && file.checksum !== record.checksum) {
      mismatches.push({
        name: record.name,
        expected: record.checksum,
        actual: file.checksum,
      });
    }
  }

  return mismatches;
}
