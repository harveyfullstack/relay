/**
 * Agent Relay Supervisor
 *
 * Main supervisor loop that:
 * 1. Watches registered agents for inbox messages
 * 2. Spawns fresh CLI runs when messages arrive
 * 3. Captures output and routes relay commands
 * 4. Updates agent state for context preservation
 */

import fs from 'node:fs';
import path from 'node:path';
import { RelayClient } from '../wrapper/client.js';
import { StateRegistry } from './state.js';
import { CLISpawner } from './spawner.js';
import { claimInbox, finalizeClaim } from './inbox.js';
import type {
  SupervisorConfig,
  AgentRegistration,
  AgentState,
} from './types.js';

export class Supervisor {
  private config: SupervisorConfig;
  private registry: StateRegistry;
  private spawner: CLISpawner;
  private client: RelayClient;
  private running = false;
  private pollTimer?: NodeJS.Timeout;

  constructor(config: Partial<SupervisorConfig> = {}) {
    this.config = {
      dataDir: '/tmp/agent-relay',
      pollIntervalMs: 2000,
      maxRecentMessages: 20,
      maxSummaryLength: 2000,
      socketPath: '/tmp/agent-relay.sock',
      verbose: false,
      ...config,
    };

    this.registry = new StateRegistry(this.config);
    this.spawner = new CLISpawner(this.config);
    this.client = new RelayClient({
      agentName: '__supervisor__',
      socketPath: this.config.socketPath,
    });
  }

  /**
   * Start the supervisor
   */
  async start(): Promise<void> {
    if (this.running) return;

    console.log('[supervisor] Starting...');

    // Connect to daemon
    try {
      await this.client.connect();
      console.log('[supervisor] Connected to daemon');
    } catch (err) {
      console.error('[supervisor] Failed to connect to daemon:', err);
      console.error('[supervisor] Running in standalone mode (no message routing)');
    }

    this.running = true;
    this.schedulePoll();

    console.log('[supervisor] Started, polling every', this.config.pollIntervalMs, 'ms');
  }

  /**
   * Stop the supervisor
   */
  stop(): void {
    if (!this.running) return;

    console.log('[supervisor] Stopping...');

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }

    this.client.disconnect();
    this.running = false;

    console.log('[supervisor] Stopped');
  }

  /**
   * Register a new agent
   */
  registerAgent(registration: AgentRegistration): AgentState {
    const manager = this.registry.getManager(registration.name);

    // Check if already exists
    let state = manager.load();
    if (state) {
      console.log(`[supervisor] Agent ${registration.name} already registered, updating`);
      state = {
        ...state,
        cli: registration.cli,
        cwd: registration.cwd,
        customCommand: registration.customCommand,
        lastActiveTs: new Date().toISOString(),
      };
      manager.save(state);
    } else {
      state = manager.create(
        registration.cli,
        registration.cwd,
        registration.customCommand
      );
      console.log(`[supervisor] Registered new agent: ${registration.name}`);
    }

    return state;
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(name: string): void {
    const agentDir = path.join(this.config.dataDir, name);
    if (fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true });
      console.log(`[supervisor] Unregistered agent: ${name}`);
    }
  }

  /**
   * Schedule next poll
   */
  private schedulePoll(): void {
    if (!this.running) return;

    this.pollTimer = setTimeout(async () => {
      await this.poll();
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  /**
   * Poll all agents for new messages
   */
  private async poll(): Promise<void> {
    const agents = this.registry.listAgents();

    for (const agentName of agents) {
      try {
        await this.processAgent(agentName);
      } catch (err) {
        console.error(`[supervisor] Error processing agent ${agentName}:`, err);
      }
    }
  }

  /**
   * Process a single agent's inbox
   */
  private async processAgent(agentName: string): Promise<void> {
    const manager = this.registry.getManager(agentName);

    // Check if locked
    if (manager.isLocked()) {
      if (this.config.verbose) {
        console.log(`[supervisor] Agent ${agentName} is locked, skipping`);
      }
      return;
    }

    // Check inbox (claim atomically to avoid dropping new messages)
    const inboxPath = manager.getInboxPath();
    const claim = claimInbox(inboxPath);
    if (!claim) return;
    const inboxContent = claim.content;
    if (!inboxContent.includes('## Message from')) {
      finalizeClaim(claim, true);
      return;
    }

    // Load state
    const state = manager.load();
    if (!state) {
      console.error(`[supervisor] No state for agent ${agentName}`);
      finalizeClaim(claim, false);
      return;
    }

    // Try to acquire lock
    if (!manager.tryLock()) {
      console.log(`[supervisor] Failed to acquire lock for ${agentName}`);
      finalizeClaim(claim, false);
      return;
    }

    let success = false;
    try {
      console.log(`[supervisor] Processing inbox for ${agentName}`);

      // Record received messages into state for continuity
      let currentState = manager.recordInboxReceived(state, inboxContent);

      // Mark running (best-effort)
      currentState = manager.setStatus(currentState, 'running');

      // Build prompt with context
      const prompt = manager.buildSpawnPrompt(currentState, inboxContent);

      // Spawn CLI
      const result = await this.spawner.spawn(
        currentState.cli,
        prompt,
        currentState.cwd,
        currentState.customCommand
      );

      console.log(`[supervisor] ${agentName} exited with code ${result.exitCode}, ${result.relayCommands.length} relay commands`);

      // Apply state markers from output
      // Add decisions
      for (const decision of result.stateMarkers.decisions) {
        currentState = manager.addDecision(currentState, decision.what, decision.why);
        console.log(`[supervisor] ${agentName} recorded decision: ${decision.what}`);
      }

      // Add TODOs
      for (const todo of result.stateMarkers.todos) {
        currentState = manager.addTodo(currentState, todo.task, todo.priority, todo.owner);
        console.log(`[supervisor] ${agentName} added TODO: ${todo.task}`);
      }

      // Complete TODOs
      for (const done of result.stateMarkers.dones) {
        currentState = manager.completeTodo(currentState, done.taskMatch);
        console.log(`[supervisor] ${agentName} completed TODO matching: ${done.taskMatch}`);
      }

      // Update summary if provided
      if (result.stateMarkers.summary) {
        currentState = manager.updateSummary(currentState, result.stateMarkers.summary);
        if (this.config.verbose) {
          console.log(`[supervisor] ${agentName} updated summary (${result.stateMarkers.summary.length} chars)`);
        }
      }

      // Process relay commands
      for (const cmd of result.relayCommands) {
        // Add to state as sent message
        currentState = manager.addExchange(currentState, {
          direction: 'sent',
          peer: cmd.to,
          body: cmd.body,
          timestamp: new Date().toISOString(),
        });

        // Route through daemon
        this.client.sendMessage(cmd.to, cmd.body, cmd.kind);
        console.log(`[supervisor] Routed: ${agentName} -> ${cmd.to}`);
      }

      // Mark idle and record checkpoint
      currentState = manager.setStatus(currentState, 'idle');
      manager.markInboxProcessed(currentState);

      // Done with claimed inbox
      success = true;

    } finally {
      manager.releaseLock();
      finalizeClaim(claim, success);
    }
  }

  /**
   * Get list of registered agents
   */
  getAgents(): string[] {
    return this.registry.listAgents();
  }

  /**
   * Get agent state
   */
  getAgentState(name: string): AgentState | null {
    return this.registry.getManager(name).load();
  }

  /**
   * Get lightweight diagnostics for CLI display.
   */
  getAgentDiagnostics(name: string): {
    state: AgentState | null;
    locked: boolean;
    inboxPath: string;
    statePath: string;
    lockPath: string;
    hasUnreadInbox: boolean;
  } {
    const manager = this.registry.getManager(name);
    const state = manager.load();
    const inboxPath = manager.getInboxPath();
    const statePath = manager.getStatePath();
    const lockPath = manager.getLockPath();
    const locked = manager.isLocked();
    let hasUnreadInbox = false;
    try {
      if (fs.existsSync(inboxPath)) {
        const content = fs.readFileSync(inboxPath, 'utf-8');
        hasUnreadInbox = content.includes('## Message from');
      }
    } catch {
      hasUnreadInbox = false;
    }

    return { state, locked, inboxPath, statePath, lockPath, hasUnreadInbox };
  }
}
