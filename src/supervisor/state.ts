/**
 * Agent State Management
 *
 * Handles persistent state for spawn-per-message architecture.
 * Each agent has a state.json that maintains context across spawns.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentState,
  RelayExchange,
  CLIType,
  SupervisorConfig,
} from './types.js';
import { parseInboxMarkdown } from './inbox.js';

/** Current state schema version */
const STATE_VERSION = 1;

/**
 * State Manager for a single agent
 */
export class StateManager {
  private statePath: string;
  private lockPath: string;
  private config: SupervisorConfig;
  private agentName: string;

  constructor(agentName: string, config: SupervisorConfig) {
    this.agentName = agentName;
    this.config = config;
    const agentDir = path.join(config.dataDir, agentName);
    this.statePath = path.join(agentDir, 'state.json');
    this.lockPath = path.join(agentDir, 'agent.lock');
  }

  /**
   * Initialize state directory
   */
  ensureDir(): void {
    const dir = path.dirname(this.statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Check if state file exists
   */
  exists(): boolean {
    return fs.existsSync(this.statePath);
  }

  /**
   * Load agent state from disk
   */
  load(): AgentState | null {
    if (!this.exists()) {
      return null;
    }
    try {
      const content = fs.readFileSync(this.statePath, 'utf-8');
      const state = JSON.parse(content) as AgentState;
      // Migrate older state formats
      return this.migrateState(state);
    } catch (err) {
      console.error(`[state] Failed to load state for ${this.agentName}:`, err);
      return null;
    }
  }

  /**
   * Save agent state to disk
   */
  save(state: AgentState): void {
    this.ensureDir();
    const tmpPath = `${this.statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.statePath);
  }

  /**
   * Create initial state for a new agent
   */
  create(cli: CLIType, cwd: string, customCommand?: string): AgentState {
    const now = new Date().toISOString();
    const state: AgentState = {
      version: STATE_VERSION,
      name: this.agentName,
      cli,
      summary: '',
      recentMessages: [],
      cwd,
      customCommand,
      lastActiveTs: now,
      createdTs: now,
      status: 'idle',
      decisions: [],
      openTodos: [],
      filesModified: [],
      externalRefs: [],
    };
    this.save(state);
    return state;
  }

  /**
   * Update state with a new relay exchange
   */
  addExchange(state: AgentState, exchange: RelayExchange): AgentState {
    const updated = { ...state };
    updated.recentMessages = [
      ...state.recentMessages,
      exchange,
    ].slice(-this.config.maxRecentMessages);
    updated.lastActiveTs = new Date().toISOString();
    this.save(updated);
    return updated;
  }

  /**
   * Update the rolling summary
   */
  updateSummary(state: AgentState, newSummary: string): AgentState {
    const updated = { ...state };
    // Truncate if too long
    updated.summary = newSummary.length > this.config.maxSummaryLength
      ? newSummary.substring(0, this.config.maxSummaryLength) + '...'
      : newSummary;
    updated.lastActiveTs = new Date().toISOString();
    this.save(updated);
    return updated;
  }

  /**
   * Update supervisor-tracked status for the agent.
   */
  setStatus(state: AgentState, status: NonNullable<AgentState['status']>): AgentState {
    const updated = { ...state, status };
    updated.lastActiveTs = new Date().toISOString();
    this.save(updated);
    return updated;
  }

  /**
   * Parse inbox content and record received exchanges into state.
   */
  recordInboxReceived(state: AgentState, inboxContent: string): AgentState {
    const messages = parseInboxMarkdown(inboxContent);
    let updated = state;
    for (const msg of messages) {
      updated = this.addExchange(updated, {
        direction: 'received',
        peer: msg.from,
        body: msg.body,
        timestamp: msg.timestamp || new Date().toISOString(),
      });
    }
    return updated;
  }

  /**
   * Mark inbox as processed (for restart deduplication)
   */
  markInboxProcessed(state: AgentState, timestamp?: string): AgentState {
    const updated = { ...state };
    updated.lastProcessedInboxTs = timestamp || new Date().toISOString();
    updated.lastActiveTs = new Date().toISOString();
    this.save(updated);
    return updated;
  }

  /**
   * Check if messages should be skipped based on timestamp
   * Returns true if the message timestamp is older than lastProcessedInboxTs
   */
  shouldSkipMessage(state: AgentState, messageTs: string): boolean {
    if (!state.lastProcessedInboxTs) return false;
    return new Date(messageTs) <= new Date(state.lastProcessedInboxTs);
  }

  /**
   * Add a decision (append-only)
   */
  addDecision(state: AgentState, what: string, why: string): AgentState {
    const updated = { ...state };
    updated.decisions = [
      ...state.decisions,
      {
        what,
        why,
        timestamp: new Date().toISOString(),
      },
    ];
    updated.lastActiveTs = new Date().toISOString();
    this.save(updated);
    return updated;
  }

  /**
   * Add a TODO item
   */
  addTodo(state: AgentState, task: string, priority: 'high' | 'normal' | 'low' = 'normal', owner?: string): AgentState {
    const updated = { ...state };
    updated.openTodos = [
      ...state.openTodos,
      {
        task,
        owner,
        priority,
        addedTs: new Date().toISOString(),
      },
    ];
    updated.lastActiveTs = new Date().toISOString();
    this.save(updated);
    return updated;
  }

  /**
   * Complete (remove) a TODO item by task text match
   */
  completeTodo(state: AgentState, taskMatch: string): AgentState {
    const updated = { ...state };
    updated.openTodos = state.openTodos.filter(
      (todo) => !todo.task.toLowerCase().includes(taskMatch.toLowerCase())
    );
    updated.lastActiveTs = new Date().toISOString();
    this.save(updated);
    return updated;
  }

  /**
   * Record a file modification
   */
  addFileModification(state: AgentState, filePath: string, intent: string): AgentState {
    const updated = { ...state };
    // Replace existing entry for same path or append
    const existing = state.filesModified.findIndex((f) => f.path === filePath);
    if (existing >= 0) {
      updated.filesModified = [...state.filesModified];
      updated.filesModified[existing] = {
        path: filePath,
        intent,
        timestamp: new Date().toISOString(),
      };
    } else {
      updated.filesModified = [
        ...state.filesModified,
        {
          path: filePath,
          intent,
          timestamp: new Date().toISOString(),
        },
      ];
    }
    updated.lastActiveTs = new Date().toISOString();
    this.save(updated);
    return updated;
  }

  /**
   * Record an external command/reference
   */
  addExternalRef(state: AgentState, command: string, resultSummary: string, logPath?: string): AgentState {
    const updated = { ...state };
    const maxRefs = 20; // Keep bounded
    updated.externalRefs = [
      ...state.externalRefs.slice(-maxRefs + 1),
      {
        command,
        resultSummary,
        timestamp: new Date().toISOString(),
        logPath,
      },
    ];
    updated.lastActiveTs = new Date().toISOString();
    this.save(updated);
    return updated;
  }

  /**
   * Migrate old state to current version
   */
  migrateState(state: AgentState): AgentState {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = state as any;
    if (!s.version || s.version < STATE_VERSION) {
      // Add missing fields from v1
      s.version = STATE_VERSION;
      s.status = s.status || 'idle';
      s.decisions = s.decisions || [];
      s.openTodos = s.openTodos || [];
      s.filesModified = s.filesModified || [];
      s.externalRefs = s.externalRefs || [];
      this.save(s as AgentState);
    }
    return s as AgentState;
  }

  /**
   * Try to acquire lock for this agent
   * Returns true if lock acquired, false if already locked
   */
  tryLock(): boolean {
    this.ensureDir();
    try {
      // Try to create lock file exclusively
      const fd = fs.openSync(this.lockPath, 'wx');
      fs.writeSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
      fs.closeSync(fd);
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Lock exists, check if stale (older than 5 minutes)
        try {
          const stat = fs.statSync(this.lockPath);
          const age = Date.now() - stat.mtimeMs;
          if (age > 5 * 60 * 1000) {
            // Stale lock, remove and retry
            fs.unlinkSync(this.lockPath);
            return this.tryLock();
          }
        } catch {
          // Ignore stat errors
        }
        return false;
      }
      throw err;
    }
  }

  /**
   * Release lock for this agent
   */
  releaseLock(): void {
    try {
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
      }
    } catch (err) {
      console.error(`[state] Failed to release lock for ${this.agentName}:`, err);
    }
  }

  /**
   * Check if agent is currently locked
   */
  isLocked(): boolean {
    if (!fs.existsSync(this.lockPath)) {
      return false;
    }
    // Check for stale lock
    try {
      const stat = fs.statSync(this.lockPath);
      const age = Date.now() - stat.mtimeMs;
      if (age > 5 * 60 * 1000) {
        // Stale, consider unlocked
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the inbox path for this agent
   */
  getInboxPath(): string {
    return path.join(this.config.dataDir, this.agentName, 'inbox.md');
  }

  /**
   * Get the state.json path for this agent
   */
  getStatePath(): string {
    return this.statePath;
  }

  /**
   * Get the lock path for this agent
   */
  getLockPath(): string {
    return this.lockPath;
  }

  /**
   * Build the initial prompt for a spawn including state context
   */
  buildSpawnPrompt(state: AgentState, inboxContent: string): string {
    let prompt = '';

    prompt += `You are ${state.name}, an AI agent collaborating with other CLI agents via agent-relay.\n`;
    prompt += `Your job: read new relay messages and respond using @relay:AgentName <message>.\n`;
    prompt += `\nCRITICAL: Do not wait for additional input. Process ALL messages and then exit.\n\n`;

    // Add summary if present
    if (state.summary) {
      prompt += `## Context\n${state.summary}\n\n`;
    }

    // Add key decisions (stable context)
    if (state.decisions.length > 0) {
      prompt += `## Key Decisions Made\n`;
      for (const decision of state.decisions.slice(-10)) {
        prompt += `- **${decision.what}**: ${decision.why}\n`;
      }
      prompt += '\n';
    }

    // Add open TODOs
    if (state.openTodos.length > 0) {
      prompt += `## Open TODOs\n`;
      for (const todo of state.openTodos) {
        const priority = todo.priority === 'high' ? '[HIGH]' : todo.priority === 'low' ? '[low]' : '';
        const owner = todo.owner ? ` (${todo.owner})` : '';
        prompt += `- ${priority} ${todo.task}${owner}\n`;
      }
      prompt += '\n';
    }

    // Add files modified (for context on what we've touched)
    if (state.filesModified.length > 0) {
      prompt += `## Files Modified This Session\n`;
      for (const file of state.filesModified.slice(-10)) {
        prompt += `- \`${file.path}\`: ${file.intent}\n`;
      }
      prompt += '\n';
    }

    // Add recent external command references
    if (state.externalRefs.length > 0) {
      prompt += `## Recent Commands/Outputs\n`;
      for (const ref of state.externalRefs.slice(-5)) {
        prompt += `- \`${ref.command}\`: ${ref.resultSummary}\n`;
      }
      prompt += '\n';
    }

    // Add recent exchanges
    if (state.recentMessages.length > 0) {
      prompt += `## Recent Conversation\n`;
      for (const exchange of state.recentMessages.slice(-10)) {
        const direction = exchange.direction === 'sent' ? '→' : '←';
        prompt += `[${exchange.timestamp}] ${direction} ${exchange.peer}: ${exchange.body}\n`;
      }
      prompt += '\n';
    }

    // Add inbox content
    prompt += `## New Messages To Process\n${inboxContent}\n\n`;

    // Add instructions
    prompt += `## Instructions\n`;
    prompt += `1. Read and understand each new message\n`;
    prompt += `2. Respond using: @relay:AgentName Your reply\n`;
    prompt += `3. When finished processing all messages, EXIT (do not wait)\n\n`;

    prompt += `## Context Preservation\n`;
    prompt += `After you respond, output an updated compact summary so future spawns keep context:\n`;
    prompt += `[[SUMMARY]]<~1-2k chars: current goals, key decisions, current state, next steps>[[/SUMMARY]]\n\n`;

    prompt += `Optional structured markers (only if helpful):\n`;
    prompt += `- [[DECISION]]{\"what\":\"...\",\"why\":\"...\"}[[/DECISION]]\n`;
    prompt += `- [[TODO]]{\"task\":\"...\",\"priority\":\"high|normal|low\",\"owner\":\"?\"}[[/TODO]]\n`;
    prompt += `- [[DONE]]task substring[[/DONE]]\n`;

    return prompt;
  }
}

/**
 * Global state registry for all agents
 */
export class StateRegistry {
  private config: SupervisorConfig;
  private managers: Map<string, StateManager> = new Map();

  constructor(config: SupervisorConfig) {
    this.config = config;
  }

  /**
   * Get or create state manager for an agent
   */
  getManager(agentName: string): StateManager {
    let manager = this.managers.get(agentName);
    if (!manager) {
      manager = new StateManager(agentName, this.config);
      this.managers.set(agentName, manager);
    }
    return manager;
  }

  /**
   * List all registered agents (from disk)
   */
  listAgents(): string[] {
    if (!fs.existsSync(this.config.dataDir)) {
      return [];
    }
    const entries = fs.readdirSync(this.config.dataDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .filter(e => fs.existsSync(path.join(this.config.dataDir, e.name, 'state.json')))
      .map(e => e.name);
  }
}
