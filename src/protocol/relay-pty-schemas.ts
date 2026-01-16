/**
 * Relay PTY Protocol Schemas
 *
 * This file documents the data formats used in the relay-pty message flow:
 *
 * 1. Agent → File (outbox)     : RelayFileFormat
 * 2. relay-pty → Orchestrator  : ParsedRelayCommand (JSON on stderr)
 * 3. Orchestrator → Socket     : InjectRequest (JSON)
 * 4. Socket → Agent PTY        : Plain text injection
 */

// =============================================================================
// STEP 1: Agent writes to outbox file
// =============================================================================

/**
 * File format that agents write to /tmp/relay-outbox/$AGENT_RELAY_NAME/<filename>
 *
 * Header-based format (preferred over JSON):
 * - Headers are key: value pairs, one per line
 * - Blank line separates headers from body
 * - Body is free-form text (no escaping needed)
 *
 * @example Message
 * ```
 * TO: Bob
 * THREAD: feature-123
 *
 * Hello Bob, can you review PR #42?
 * ```
 *
 * @example Spawn
 * ```
 * KIND: spawn
 * NAME: ReviewerAgent
 * CLI: claude
 *
 * You are a code reviewer.
 * Review the changes in src/auth/*.ts
 * ```
 *
 * @example Release
 * ```
 * KIND: release
 * NAME: ReviewerAgent
 * ```
 */
export interface RelayFileFormat {
  // === Headers (case-insensitive) ===

  /** Target agent name, "*" for broadcast, or "#channel" */
  TO?: string;

  /** Message type: "message" (default), "spawn", or "release" */
  KIND?: 'message' | 'spawn' | 'release';

  /** Agent name (required for spawn/release) */
  NAME?: string;

  /** CLI to use for spawning (required for spawn) */
  CLI?: string;

  /** Thread identifier for grouping related messages */
  THREAD?: string;

  // === Body (after blank line) ===

  /** Message content or task description (for spawn) */
  body?: string;
}

// =============================================================================
// STEP 2: relay-pty emits JSON to stderr (captured by orchestrator)
// =============================================================================

/**
 * JSON format emitted by relay-pty to stderr when it detects a relay command.
 * The orchestrator parses this to route messages.
 *
 * @example
 * ```json
 * {
 *   "type": "relay_command",
 *   "kind": "message",
 *   "from": "Alice",
 *   "to": "Bob",
 *   "body": "Hello!",
 *   "raw": "->relay-file:msg-001"
 * }
 * ```
 */
export interface ParsedRelayCommand {
  /** Always "relay_command" */
  type: 'relay_command';

  /** Command type */
  kind: 'message' | 'spawn' | 'release';

  /** Sender agent name */
  from: string;

  /** Target agent name (or "spawn"/"release" for those commands) */
  to: string;

  /** Message body or task description */
  body: string;

  /** Original raw text that was parsed */
  raw: string;

  /** Thread identifier (optional) */
  thread?: string;

  /** For spawn: agent name to spawn */
  spawn_name?: string;

  /** For spawn: CLI to use */
  spawn_cli?: string;

  /** For spawn: task description */
  spawn_task?: string;

  /** For release: agent name to release */
  release_name?: string;
}

// =============================================================================
// STEP 3: Orchestrator sends to relay-pty socket for injection
// =============================================================================

/**
 * JSON format sent to the relay-pty Unix socket for message injection.
 * Socket path: /tmp/relay-pty-{agentName}.sock
 *
 * @example
 * ```json
 * {
 *   "type": "inject",
 *   "id": "msg-abc123",
 *   "from": "Alice",
 *   "body": "Hello Bob!",
 *   "priority": 0
 * }
 * ```
 */
export type InjectRequest =
  | {
      type: 'inject';
      /** Unique message ID for tracking */
      id: string;
      /** Sender name (shown as "Relay message from {from}") */
      from: string;
      /** Message body to inject */
      body: string;
      /** Priority (lower = higher priority, default 0) */
      priority?: number;
    }
  | {
      type: 'status';
    }
  | {
      type: 'shutdown';
    };

/**
 * Response from relay-pty socket
 */
export type InjectResponse =
  | {
      type: 'inject_result';
      id: string;
      status: 'queued' | 'injecting' | 'delivered' | 'failed';
      timestamp: number;
      error?: string;
    }
  | {
      type: 'status_result';
      agent_idle: boolean;
      queue_length: number;
      last_output_ms: number;
    };

// =============================================================================
// STEP 4: What gets injected into the agent's terminal
// =============================================================================

/**
 * The final format injected into the recipient agent's PTY as plain text.
 * NOT JSON - this is human-readable text that appears in the agent's terminal.
 *
 * Format: "Relay message from {sender} [{shortId}]: {body}"
 *
 * @example First attempt
 * ```
 * Relay message from Alice [abc1234]: Hello Bob, can you review PR #42?
 * ```
 *
 * @example Retry (1st retry)
 * ```
 * [RETRY] Relay message from Alice [abc1234]: Hello Bob, can you review PR #42?
 * ```
 *
 * @example Urgent (2+ retries)
 * ```
 * [URGENT - PLEASE ACKNOWLEDGE] Relay message from Alice [abc1234]: Hello Bob!
 * ```
 */
export type InjectedMessageFormat = string;

// =============================================================================
// Complete Flow Diagram
// =============================================================================

/**
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                        COMPLETE MESSAGE FLOW                                 │
 * │                                                                              │
 * │  STEP 1: Agent writes file                                                   │
 * │  ┌──────────────────────────────────────────────────────────────────────┐   │
 * │  │ cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/msg-001 << 'EOF'           │   │
 * │  │ TO: Bob                                                               │   │
 * │  │ THREAD: feature-123                                                   │   │
 * │  │                                                                       │   │
 * │  │ Hello Bob, can you review PR #42?                                     │   │
 * │  │ EOF                                                                   │   │
 * │  └──────────────────────────────────────────────────────────────────────┘   │
 * │                              │                                               │
 * │                              ▼                                               │
 * │  STEP 2: Agent outputs trigger                                               │
 * │  ┌──────────────────────────────────────────────────────────────────────┐   │
 * │  │ ->relay-file:msg-001                                                  │   │
 * │  └──────────────────────────────────────────────────────────────────────┘   │
 * │                              │                                               │
 * │                              ▼                                               │
 * │  STEP 3: relay-pty reads file, emits JSON to stderr                          │
 * │  ┌──────────────────────────────────────────────────────────────────────┐   │
 * │  │ {"type":"relay_command","kind":"message","from":"Alice",             │   │
 * │  │  "to":"Bob","body":"Hello Bob, can you review PR #42?",              │   │
 * │  │  "thread":"feature-123","raw":"->relay-file:msg-001"}                │   │
 * │  └──────────────────────────────────────────────────────────────────────┘   │
 * │                              │                                               │
 * │                              ▼                                               │
 * │  STEP 4: Orchestrator routes to Bob's relay-pty socket                       │
 * │  ┌──────────────────────────────────────────────────────────────────────┐   │
 * │  │ {"type":"inject","id":"msg-abc123","from":"Alice",                   │   │
 * │  │  "body":"Hello Bob, can you review PR #42?","priority":0}            │   │
 * │  └──────────────────────────────────────────────────────────────────────┘   │
 * │                              │                                               │
 * │                              ▼                                               │
 * │  STEP 5: Bob's relay-pty injects plain text into PTY                         │
 * │  ┌──────────────────────────────────────────────────────────────────────┐   │
 * │  │ Relay message from Alice [abc1234]: Hello Bob, can you review PR #42?│   │
 * │  └──────────────────────────────────────────────────────────────────────┘   │
 * │                                                                              │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * ```
 */
