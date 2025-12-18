/**
 * Types for Agent Relay Supervisor
 */

export type CLIType = 'claude' | 'codex' | 'cursor' | 'custom';

/** A key decision made by the agent (append-only) */
export interface Decision {
  /** Short description of what was decided */
  what: string;
  /** Why this decision was made */
  why: string;
  /** When the decision was made */
  timestamp: string;
}

/** An active TODO/task */
export interface Todo {
  /** Task description */
  task: string;
  /** Owner agent name (if assigned) */
  owner?: string;
  /** Priority: high, normal, low */
  priority: 'high' | 'normal' | 'low';
  /** When added */
  addedTs: string;
}

/** A file modification record */
export interface FileModification {
  /** File path relative to cwd */
  path: string;
  /** Short intent/reason for modification */
  intent: string;
  /** When modified */
  timestamp: string;
}

/** Reference to external command/output */
export interface ExternalRef {
  /** Command that was run */
  command: string;
  /** Key result/output summary */
  resultSummary: string;
  /** When run */
  timestamp: string;
  /** Optional pointer to full log file */
  logPath?: string;
}

export interface AgentState {
  /** Schema version for migrations */
  version: number;
  /** Agent name */
  name: string;
  /** CLI type */
  cli: CLIType;
  /** Supervisor-visible status (best-effort; lockfile is source of truth) */
  status?: 'idle' | 'running' | 'blocked';
  /** Rolling summary of conversation (1-2k chars) */
  summary: string;
  /** Last N relay message exchanges */
  recentMessages: RelayExchange[];
  /** Working directory */
  cwd: string;
  /** Custom CLI command (for 'custom' type) */
  customCommand?: string;
  /** Last active timestamp */
  lastActiveTs: string;
  /** Created timestamp */
  createdTs: string;
  /** Last processed inbox timestamp (for restart deduplication) */
  lastProcessedInboxTs?: string;
  /** Stable key decisions (append-only) */
  decisions: Decision[];
  /** Active TODOs/tasks */
  openTodos: Todo[];
  /** Files touched with intent */
  filesModified: FileModification[];
  /** External command/output references */
  externalRefs: ExternalRef[];
}

export interface RelayExchange {
  /** Direction: sent or received */
  direction: 'sent' | 'received';
  /** Other agent name */
  peer: string;
  /** Message body */
  body: string;
  /** Timestamp */
  timestamp: string;
}

export interface SupervisorConfig {
  /** Base directory for agent data */
  dataDir: string;
  /** Polling interval in milliseconds */
  pollIntervalMs: number;
  /** Maximum recent messages to keep in state */
  maxRecentMessages: number;
  /** Maximum summary length in characters */
  maxSummaryLength: number;
  /** Socket path for daemon connection */
  socketPath: string;
  /** Enable verbose logging */
  verbose: boolean;
}

export interface SpawnResult {
  /** Exit code */
  exitCode: number;
  /** Stdout content */
  stdout: string;
  /** Stderr content */
  stderr: string;
  /** Parsed relay commands from output */
  relayCommands: ParsedRelayCommand[];
  /** Parsed state markers from output */
  stateMarkers: {
    decisions: { what: string; why: string }[];
    todos: { task: string; priority: 'high' | 'normal' | 'low'; owner?: string }[];
    dones: { taskMatch: string }[];
    summary?: string;
  };
}

export interface ParsedRelayCommand {
  to: string;
  body: string;
  kind: 'message' | 'thinking' | 'state';
}

export interface AgentRegistration {
  name: string;
  cli: CLIType;
  cwd: string;
  customCommand?: string;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  dataDir: '/tmp/agent-relay',
  pollIntervalMs: 2000,
  maxRecentMessages: 20,
  maxSummaryLength: 2000,
  socketPath: '/tmp/agent-relay.sock',
  verbose: false,
};
