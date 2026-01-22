-- Relay Ledger - Initial Schema
-- Migration 0001: Initial tables for relay file tracking
--
-- Tables:
-- - relay_files: Tracks relay message files through lifecycle
-- - agents: Registry of known agents
-- - orchestrator_state: Key-value store for orchestrator persistence
-- - pending_operations: Crash recovery for incomplete operations

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
