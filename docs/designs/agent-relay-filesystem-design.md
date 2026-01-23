# Agent Relay File System Design

## Production-Grade Ledger-Based Message Detection

**Version**: 1.0.0
**Status**: Draft for Review
**Author**: FileManager Agent

---

## 1. Directory Structure

```
~/.agent-relay/
├── ledger.db                    # SQLite ledger (single source of truth)
├── ledger.db-wal                # Write-ahead log (automatic)
├── ledger.db-shm                # Shared memory (automatic)
├── config.json                  # Global configuration
├── .lock                        # Global orchestrator lock file
│
├── agents/                      # Per-agent isolated directories
│   └── {agent-name}/
│       ├── outbox/              # Messages TO orchestrator
│       │   ├── .pending/        # Temp files during atomic write
│       │   └── {timestamp}-{uuid}.msg
│       ├── inbox/               # Messages FROM orchestrator
│       │   └── {timestamp}-{uuid}.msg
│       └── meta.json            # Agent metadata (pid, started_at, etc.)
│
├── attachments/                 # Large file attachments (referenced by hash)
│   └── {sha256-prefix}/
│       └── {full-sha256}        # Content-addressable storage
│
├── archive/                     # Processed messages (configurable retention)
│   └── {date}/
│       └── {agent-name}/
│           └── {timestamp}-{uuid}.msg
│
└── tmp/                         # System-wide temp directory
    └── {random}/                # Per-operation temp dirs
```

### Design Rationale

1. **Agent Isolation**: Each agent has its own directory preventing cross-agent interference
2. **Outbox/Inbox Pattern**: Clear directional flow - agents write to outbox, read from inbox
3. **Content-Addressable Attachments**: Deduplication and integrity verification built-in
4. **Archive for Auditability**: Processed messages retained for debugging/compliance
5. **Dedicated Temp Space**: Atomic operations use system-wide tmp, not agent dirs

---

## 2. Ledger System Design

### 2.1 SQLite as Ledger (Recommended)

SQLite provides ACID guarantees, handles concurrent access, and survives crashes gracefully.

```sql
-- Schema: ledger.db

-- Tracks all known message files
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Identity
    message_id TEXT UNIQUE NOT NULL,        -- UUID from filename
    agent_name TEXT NOT NULL,
    direction TEXT NOT NULL,                -- 'outbox' | 'inbox'

    -- File metadata (for change detection)
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_mtime_ns INTEGER NOT NULL,         -- Nanosecond precision
    file_inode INTEGER,                     -- For move detection
    checksum TEXT,                          -- SHA256 of content (optional, for verification)

    -- Processing state
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'failed' | 'archived'

    -- Message metadata (parsed from file)
    message_type TEXT,                      -- 'spawn' | 'release' | 'send' | 'ack' | etc.
    target TEXT,                            -- TO: field

    -- Timestamps
    discovered_at INTEGER NOT NULL,         -- When orchestrator found it
    processed_at INTEGER,                   -- When processing completed

    -- Error handling
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,

    -- Indexes for common queries
    UNIQUE(file_path)
);

CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_agent ON messages(agent_name, direction);
CREATE INDEX idx_messages_discovered ON messages(discovered_at);

-- Tracks orchestrator state for crash recovery
CREATE TABLE orchestrator_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
);

-- Tracks agent registrations
CREATE TABLE agents (
    name TEXT PRIMARY KEY,
    registered_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    pid INTEGER,
    status TEXT DEFAULT 'active'            -- 'active' | 'inactive' | 'terminated'
);

-- Write-ahead intent log for atomic multi-step operations
CREATE TABLE pending_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_type TEXT NOT NULL,           -- 'spawn' | 'release' | 'deliver'
    payload TEXT NOT NULL,                  -- JSON payload
    created_at INTEGER NOT NULL,
    completed_at INTEGER
);
```

### 2.2 Detection Algorithm

```
ORCHESTRATOR DETECTION LOOP:
┌─────────────────────────────────────────────────────────────────┐
│  1. SCAN PHASE (every 100-500ms)                                │
│     ├─ List all agents/{name}/outbox/*.msg files                │
│     ├─ For each file:                                           │
│     │   ├─ Get stat (size, mtime, inode)                        │
│     │   ├─ Skip if in ledger with same size+mtime (unchanged)   │
│     │   ├─ Skip if file size is 0 (still being created)         │
│     │   └─ Skip if mtime < 100ms ago (might be partial write)   │
│     └─ Collect new/changed files                                │
│                                                                 │
│  2. VALIDATION PHASE                                            │
│     ├─ For each candidate file:                                 │
│     │   ├─ Check for .pending marker (skip if exists)           │
│     │   ├─ Attempt parse of message format                      │
│     │   ├─ If parse fails, check age:                           │
│     │   │   ├─ < 5s old: skip (may be partial)                  │
│     │   │   └─ > 5s old: mark as malformed                      │
│     │   └─ Verify file hasn't changed during parse              │
│     └─ Return validated messages                                │
│                                                                 │
│  3. LEDGER UPDATE PHASE (single transaction)                    │
│     ├─ BEGIN IMMEDIATE TRANSACTION                              │
│     ├─ INSERT new messages with status='pending'                │
│     ├─ UPDATE changed messages (re-parse required)              │
│     └─ COMMIT                                                   │
│                                                                 │
│  4. PROCESSING PHASE                                            │
│     ├─ SELECT messages WHERE status='pending' ORDER BY id       │
│     ├─ For each message:                                        │
│     │   ├─ UPDATE status='processing' WHERE id=? AND status='pending' │
│     │   │   (atomic claim - prevents duplicate processing)      │
│     │   ├─ Execute message handler                              │
│     │   ├─ On success: UPDATE status='completed'                │
│     │   ├─ On failure: UPDATE status='failed', retry_count++    │
│     │   └─ Move to archive (optional)                           │
│     └─ Loop until no pending messages                           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Partial Write Detection

Multiple layers of defense against reading incomplete files:

1. **Settle Time**: Ignore files modified < 100ms ago
2. **Stable Size Check**: Re-stat file after initial read, verify size unchanged
3. **Atomic Write Protocol**: Agents must use temp+rename pattern (see Section 3)
4. **Parse Validation**: Message must parse completely with valid structure
5. **Optional Checksum**: Agents can include content hash in filename or header

### 2.4 Crash Recovery

On orchestrator restart:

```sql
-- 1. Find interrupted operations
SELECT * FROM messages WHERE status = 'processing';

-- 2. For each, verify file still exists
-- 3. If exists: reset to 'pending' for reprocessing
-- 4. If missing: mark as 'failed' with 'file_disappeared' error

-- 5. Check pending_operations table for incomplete multi-step ops
SELECT * FROM pending_operations WHERE completed_at IS NULL;
-- Either complete or rollback based on operation type
```

---

## 3. File Write Protocol

### 3.1 Atomic Write Pattern (Required for Agents)

```
ATOMIC FILE WRITE:
┌─────────────────────────────────────────────────────────────────┐
│  1. Generate unique filename                                    │
│     filename = "{timestamp_ns}-{uuid}.msg"                      │
│     Example: "1706123456789012345-a1b2c3d4.msg"                  │
│                                                                 │
│  2. Create temp file in .pending directory                      │
│     temp_path = "~/.agent-relay/agents/{name}/outbox/.pending/{filename}" │
│     Write complete content to temp file                         │
│     fsync() the file                                            │
│     close() the file                                            │
│                                                                 │
│  3. Atomic rename to final location                             │
│     final_path = "~/.agent-relay/agents/{name}/outbox/{filename}" │
│     rename(temp_path, final_path)                               │
│     (rename is atomic on POSIX within same filesystem)          │
│                                                                 │
│  4. fsync() parent directory (ensures rename is durable)        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Message File Format

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER SECTION (required)                                      │
│  ─────────────────────────                                      │
│  TO: TargetAgent                    # Required                  │
│  KIND: spawn                        # Optional, default=message │
│  THREAD: thread-id                  # Optional                  │
│  PRIORITY: 1                        # Optional, 0=highest       │
│  CHECKSUM: sha256:abc123...         # Optional, content hash    │
│                                                                 │
│  [blank line - separates header from body]                      │
│                                                                 │
│  BODY SECTION                                                   │
│  ────────────                                                   │
│  Message content here...                                        │
│  Can be multi-line.                                             │
│  Supports any text content.                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 File Naming Convention

```
{timestamp_ns}-{uuid}.msg

Components:
- timestamp_ns: Nanosecond Unix timestamp (ensures ordering)
- uuid: 8-character random hex (ensures uniqueness)
- .msg: Extension for easy filtering

Examples:
- 1706123456789012345-a1b2c3d4.msg
- 1706123456789123456-deadbeef.msg
```

### 3.4 Large Attachments

For messages with large payloads (>1MB recommended threshold):

```
1. Write attachment to content-addressable store:
   hash = sha256(content)
   path = ~/.agent-relay/attachments/{hash[0:2]}/{hash}
   (use same atomic write pattern)

2. Reference in message:
   TO: Worker
   KIND: message
   ATTACHMENT: sha256:abc123def456...

   Process this file.
```

---

## 4. Message Routing Specification

### 4.1 Message Types (KIND header)

| KIND | Description | Required Fields |
|------|-------------|-----------------|
| `message` | Standard message delivery | TO |
| `spawn` | Request agent spawn | NAME, CLI in body |
| `release` | Request agent release | NAME in body |
| `ack` | Acknowledgment | (references previous message) |
| `nack` | Negative acknowledgment | (with error in body) |
| `status` | Status update | (agent status in body) |
| `continuity` | Save/load agent state | ACTION in body |

### 4.2 Routing Rules

```
TO Value         Routing Behavior
─────────────────────────────────────────────────────────
AgentName        Direct delivery to agent's inbox
*                Broadcast to all active agents
#channel         Channel message (all subscribers)
Lead             Special: always routes to lead agent
__orchestrator__ Internal: handled by orchestrator directly
```

### 4.3 Spawn Message Format

```
TO: __orchestrator__
KIND: spawn

NAME: WorkerAgent
CLI: claude
PROMPT: You are a worker agent. Complete the assigned task.
WORKING_DIR: /path/to/project
ENV: KEY1=value1,KEY2=value2
```

### 4.4 Release Message Format

```
TO: __orchestrator__
KIND: release

NAME: WorkerAgent
REASON: Task completed successfully
```

---

## 5. Security Considerations

### 5.1 File Permissions

```bash
# Directory permissions
~/.agent-relay/                    drwx------  (700) - owner only
~/.agent-relay/agents/             drwx------  (700)
~/.agent-relay/agents/{name}/      drwx------  (700)
~/.agent-relay/ledger.db           -rw-------  (600) - owner only
~/.agent-relay/config.json         -rw-------  (600)

# Message files (created by agents)
~/.agent-relay/agents/{name}/outbox/*.msg  -rw-------  (600)
```

### 5.2 Directory Traversal Prevention

```python
def safe_path(base_dir: str, relative_path: str) -> str:
    """Prevent directory traversal attacks."""
    # Resolve to absolute path
    full_path = os.path.realpath(os.path.join(base_dir, relative_path))
    base_resolved = os.path.realpath(base_dir)

    # Verify path is within base directory
    if not full_path.startswith(base_resolved + os.sep):
        raise SecurityError(f"Path traversal attempt: {relative_path}")

    return full_path
```

### 5.3 Agent Name Validation

```python
import re

VALID_AGENT_NAME = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]{0,62}$')

def validate_agent_name(name: str) -> bool:
    """
    Agent names must:
    - Start with a letter
    - Contain only alphanumeric, underscore, hyphen
    - Be 1-63 characters long
    - Not be a reserved name
    """
    RESERVED = {'__orchestrator__', 'system', 'root', 'admin'}

    if name.lower() in RESERVED:
        return False

    return bool(VALID_AGENT_NAME.match(name))
```

### 5.4 Ledger Tampering Prevention

1. **SQLite WAL Mode**: Provides atomic updates and crash recovery
2. **Checksum Verification**: Optional SHA256 in message files
3. **Audit Log**: All ledger changes logged with timestamps
4. **Read-Only for Agents**: Agents cannot access ledger.db directly

### 5.5 Race Condition Handling

| Race Condition | Mitigation |
|----------------|------------|
| Two agents write same filename | UUID in filename makes collision impossible |
| Orchestrator reads partial file | Settle time + stable size check + atomic rename |
| Concurrent ledger updates | SQLite handles with transactions |
| Duplicate message processing | Atomic status update with WHERE clause |
| Orchestrator restart during processing | Crash recovery protocol (Section 2.4) |

---

## 6. Edge Cases and Handling

### 6.1 Partial Write Recovery

```
Scenario: Agent crashes mid-write
Detection: File in .pending/ older than 30 seconds
Action: Delete orphaned temp file, log warning
```

### 6.2 Disk Full

```
Scenario: Disk fills during write
Detection: Write fails with ENOSPC
Action:
  1. Agent should catch error and retry with backoff
  2. Orchestrator monitors disk space, alerts at 90%
  3. Auto-archive old messages when space low
```

### 6.3 File Descriptor Exhaustion

```
Scenario: Too many open files (ulimit)
Detection: EMFILE/ENFILE errors
Action:
  1. Orchestrator uses inotify (single fd) not polling
  2. Batch file operations
  3. Close files promptly after reading
```

### 6.4 Clock Skew

```
Scenario: System clock jumps backward
Detection: New file has older timestamp than last processed
Action:
  1. Use monotonic sequence number as tiebreaker
  2. Process based on discovery order, not filename timestamp
  3. Log warning about clock skew
```

### 6.5 Symbolic Link Attacks

```
Scenario: Malicious symlink in agent directory
Detection: Check file type before processing
Action:
  1. Reject symlinks in message directories
  2. Use O_NOFOLLOW when opening files
  3. Verify realpath stays within ~/.agent-relay
```

---

## 7. Production Readiness Checklist

### 7.1 Reliability

- [ ] Atomic file writes with temp+rename pattern
- [ ] SQLite WAL mode for crash-safe ledger
- [ ] Idempotent message processing
- [ ] Automatic crash recovery on restart
- [ ] Graceful handling of malformed messages
- [ ] Exponential backoff for retries

### 7.2 Performance

- [ ] fsnotify/inotify for file change detection (not polling)
- [ ] Batch ledger updates in single transaction
- [ ] Message file size limits enforced
- [ ] Archive rotation to prevent unbounded growth
- [ ] Efficient directory listing (readdir, not glob)

### 7.3 Observability

- [ ] Structured logging for all operations
- [ ] Metrics: messages/sec, processing latency, queue depth
- [ ] Health check endpoint
- [ ] Ledger state can be inspected (sqlite3 CLI)
- [ ] Audit trail for security events

### 7.4 Security

- [ ] Restrictive file permissions (700/600)
- [ ] Agent name validation
- [ ] Path traversal prevention
- [ ] No symlink following
- [ ] Rate limiting per agent
- [ ] Message size limits

### 7.5 Operations

- [ ] Clean shutdown signal handling
- [ ] Ledger backup/restore procedure
- [ ] Log rotation configuration
- [ ] Disk space monitoring
- [ ] Agent timeout/cleanup for orphaned agents

### 7.6 Testing

- [ ] Unit tests for all components
- [ ] Integration tests with concurrent writes
- [ ] Chaos testing (kill orchestrator during processing)
- [ ] Fuzz testing for message parser
- [ ] Load testing with many agents

---

## 8. Implementation Priority

### Phase 1: Core (MVP)
1. Directory structure creation
2. SQLite ledger with basic schema
3. Atomic file write protocol
4. Simple detection loop (polling)
5. Basic spawn/release handling

### Phase 2: Reliability
1. fsnotify integration
2. Crash recovery
3. Retry logic with backoff
4. Partial write detection
5. Archive management

### Phase 3: Production Hardening
1. Security hardening
2. Metrics and monitoring
3. Rate limiting
4. Comprehensive logging
5. Performance optimization

---

## Appendix A: Example Agent Implementation (Shell)

```bash
#!/bin/bash
# Example: Writing a message atomically

RELAY_DIR="$HOME/.agent-relay"
AGENT_NAME="${AGENT_RELAY_NAME:-myagent}"
OUTBOX="$RELAY_DIR/agents/$AGENT_NAME/outbox"
PENDING="$OUTBOX/.pending"

# Ensure directories exist
mkdir -p "$PENDING"

# Generate unique filename
TIMESTAMP=$(date +%s%N)
UUID=$(head -c 4 /dev/urandom | xxd -p)
FILENAME="${TIMESTAMP}-${UUID}.msg"

# Write to temp file
TEMP_FILE="$PENDING/$FILENAME"
cat > "$TEMP_FILE" << 'EOF'
TO: Lead

ACK: Task received and understood.
EOF

# Sync to disk
sync "$TEMP_FILE"

# Atomic rename to final location
mv "$TEMP_FILE" "$OUTBOX/$FILENAME"

# Sync parent directory
sync "$OUTBOX"

echo "Message written: $FILENAME"
```

---

## Appendix B: SQLite Configuration

```sql
-- Recommended PRAGMA settings for ledger.db

PRAGMA journal_mode = WAL;          -- Write-ahead logging
PRAGMA synchronous = NORMAL;        -- Balance durability/performance
PRAGMA foreign_keys = ON;           -- Enforce referential integrity
PRAGMA busy_timeout = 5000;         -- 5s timeout for locks
PRAGMA cache_size = -2000;          -- 2MB cache
PRAGMA temp_store = MEMORY;         -- Temp tables in memory
```

---

*End of Design Document*
