/**
 * Outbox Watcher for MCP and File-Based Agents
 *
 * Watches the .agent-relay/outbox directory for message files and processes
 * them directly. This enables MCP tools to send messages via file-based
 * protocol without needing relay-pty triggers.
 *
 * File format (same as relay-pty protocol):
 * - outbox/{agent}/msg - Send message
 * - outbox/{agent}/spawn - Spawn agent
 * - outbox/{agent}/release - Release agent
 */

import { watch, existsSync, mkdirSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { EventEmitter } from 'node:events';
import type { FSWatcher } from 'node:fs';

export interface OutboxMessage {
  from: string;
  to: string;
  body: string;
  thread?: string;
  channel?: string;
}

export interface OutboxSpawn {
  from: string;
  name: string;
  cli: string;
  task: string;
  model?: string;
  cwd?: string;
}

export interface OutboxRelease {
  from: string;
  name: string;
  reason?: string;
}

export interface OutboxWatcherConfig {
  /** Path to .agent-relay directory */
  relayDir: string;
  /** Debounce time for file changes (ms) */
  debounceMs?: number;
}

type OutboxEvent =
  | { type: 'message'; data: OutboxMessage }
  | { type: 'spawn'; data: OutboxSpawn }
  | { type: 'release'; data: OutboxRelease };

/**
 * Parse a message file in relay-pty format.
 * Format:
 * TO: target
 * THREAD: optional-thread
 *
 * Message body
 */
function parseMessageFile(content: string, from: string): OutboxMessage | null {
  const lines = content.split('\n');
  let to = '';
  let thread: string | undefined;
  let channel: string | undefined;
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') {
      bodyStart = i + 1;
      break;
    }
    if (line.startsWith('TO: ')) {
      to = line.slice(4).trim();
    } else if (line.startsWith('THREAD: ')) {
      thread = line.slice(8).trim();
    } else if (line.startsWith('CHANNEL: ')) {
      channel = line.slice(9).trim();
    }
  }

  if (!to) return null;

  const body = lines.slice(bodyStart).join('\n').trim();
  return { from, to, body, thread, channel };
}

/**
 * Parse a spawn file.
 * Format:
 * KIND: spawn
 * NAME: agent-name
 * CLI: claude
 * MODEL: optional
 * CWD: optional
 *
 * Task description
 */
function parseSpawnFile(content: string, from: string): OutboxSpawn | null {
  const lines = content.split('\n');
  let name = '';
  let cli = '';
  let model: string | undefined;
  let cwd: string | undefined;
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') {
      bodyStart = i + 1;
      break;
    }
    if (line.startsWith('NAME: ')) {
      name = line.slice(6).trim();
    } else if (line.startsWith('CLI: ')) {
      cli = line.slice(5).trim();
    } else if (line.startsWith('MODEL: ')) {
      model = line.slice(7).trim();
    } else if (line.startsWith('CWD: ')) {
      cwd = line.slice(5).trim();
    }
  }

  if (!name || !cli) return null;

  const task = lines.slice(bodyStart).join('\n').trim();
  return { from, name, cli, task, model, cwd };
}

/**
 * Parse a release file.
 * Format:
 * KIND: release
 * NAME: agent-name
 *
 * Optional reason
 */
function parseReleaseFile(content: string, from: string): OutboxRelease | null {
  const lines = content.split('\n');
  let name = '';
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') {
      bodyStart = i + 1;
      break;
    }
    if (line.startsWith('NAME: ')) {
      name = line.slice(6).trim();
    }
  }

  if (!name) return null;

  const reason = lines.slice(bodyStart).join('\n').trim() || undefined;
  return { from, name, reason };
}

export class OutboxWatcher extends EventEmitter {
  private config: OutboxWatcherConfig;
  private outboxDir: string;
  private watchers = new Map<string, FSWatcher>();
  private debounceMs: number;
  private pendingFiles = new Map<string, NodeJS.Timeout>();
  private running = false;

  constructor(config: OutboxWatcherConfig) {
    super();
    this.config = config;
    this.outboxDir = join(config.relayDir, 'outbox');
    this.debounceMs = config.debounceMs ?? 100;
  }

  /**
   * Start watching the outbox directory.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Ensure outbox directory exists
    if (!existsSync(this.outboxDir)) {
      mkdirSync(this.outboxDir, { recursive: true });
    }

    // Watch main outbox directory for new agent directories
    this.watchDirectory(this.outboxDir);

    // Watch existing agent directories
    try {
      const agents = readdirSync(this.outboxDir, { withFileTypes: true });
      for (const agent of agents) {
        if (agent.isDirectory() && !agent.name.startsWith('.')) {
          this.watchAgentOutbox(agent.name);
        }
      }
    } catch {
      // Directory might not exist yet
    }

    // Process any existing files
    this.processExistingFiles();
  }

  /**
   * Stop watching.
   */
  stop(): void {
    this.running = false;
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    for (const [, timeout] of this.pendingFiles) {
      clearTimeout(timeout);
    }
    this.pendingFiles.clear();
  }

  /**
   * Watch the main outbox directory for new agent directories.
   */
  private watchDirectory(dir: string): void {
    if (this.watchers.has(dir)) return;

    try {
      const watcher = watch(dir, (eventType, filename) => {
        if (!filename || filename.startsWith('.')) return;
        const agentDir = join(dir, filename);
        if (existsSync(agentDir)) {
          this.watchAgentOutbox(filename);
        }
      });
      this.watchers.set(dir, watcher);
    } catch {
      // Watch might fail if directory doesn't exist
    }
  }

  /**
   * Watch an agent's outbox directory for files.
   */
  private watchAgentOutbox(agentName: string): void {
    const agentDir = join(this.outboxDir, agentName);
    if (this.watchers.has(agentDir)) return;

    try {
      const watcher = watch(agentDir, (eventType, filename) => {
        if (!filename || filename.startsWith('.')) return;
        this.scheduleProcessFile(agentName, filename);
      });
      this.watchers.set(agentDir, watcher);
    } catch {
      // Watch might fail if directory doesn't exist
    }
  }

  /**
   * Schedule processing a file with debounce.
   */
  private scheduleProcessFile(agentName: string, filename: string): void {
    const key = `${agentName}/${filename}`;

    // Clear existing timeout
    const existing = this.pendingFiles.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule processing
    const timeout = setTimeout(() => {
      this.pendingFiles.delete(key);
      this.processFile(agentName, filename);
    }, this.debounceMs);

    this.pendingFiles.set(key, timeout);
  }

  /**
   * Process a file from an agent's outbox.
   */
  private processFile(agentName: string, filename: string): void {
    const filePath = join(this.outboxDir, agentName, filename);

    if (!existsSync(filePath)) return;

    try {
      const content = readFileSync(filePath, 'utf-8');

      let event: OutboxEvent | null = null;

      if (filename === 'msg' || filename.startsWith('msg-')) {
        const msg = parseMessageFile(content, agentName);
        if (msg) {
          event = { type: 'message', data: msg };
        }
      } else if (filename === 'spawn' || filename.startsWith('spawn-')) {
        const spawn = parseSpawnFile(content, agentName);
        if (spawn) {
          event = { type: 'spawn', data: spawn };
        }
      } else if (filename === 'release' || filename.startsWith('release-')) {
        const release = parseReleaseFile(content, agentName);
        if (release) {
          event = { type: 'release', data: release };
        }
      }

      if (event) {
        this.emit(event.type, event.data);
        // Delete the file after processing
        try {
          unlinkSync(filePath);
        } catch {
          // File might already be deleted
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  /**
   * Process any existing files in outbox directories.
   */
  private processExistingFiles(): void {
    try {
      const agents = readdirSync(this.outboxDir, { withFileTypes: true });
      for (const agent of agents) {
        if (!agent.isDirectory() || agent.name.startsWith('.')) continue;

        const agentDir = join(this.outboxDir, agent.name);
        try {
          const files = readdirSync(agentDir, { withFileTypes: true });
          for (const file of files) {
            if (file.isFile() && !file.name.startsWith('.')) {
              this.processFile(agent.name, file.name);
            }
          }
        } catch {
          // Agent directory might not exist
        }
      }
    } catch {
      // Outbox directory might not exist
    }
  }
}

/**
 * Create an outbox watcher for the given relay directory.
 */
export function createOutboxWatcher(relayDir: string): OutboxWatcher {
  return new OutboxWatcher({ relayDir });
}
