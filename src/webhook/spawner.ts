/**
 * Webhook Spawner - Spawns agent CLIs when messages arrive
 *
 * Supports: claude, codex, gemini, cursor
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';

export interface AgentConfig {
  name: string;
  cli: 'claude' | 'codex' | 'gemini' | 'cursor' | string;
  projectDir: string;
  dataDir: string;
  enabled?: boolean;
}

export interface SpawnResult {
  agent: string;
  pid?: number;
  success: boolean;
  error?: string;
}

/**
 * Get the spawn command for a CLI type
 */
function getSpawnCommand(cli: string): { cmd: string; args: string[] } {
  switch (cli.toLowerCase()) {
    case 'claude':
      return { cmd: 'claude', args: ['--dangerously-skip-permissions'] };
    case 'codex':
      return { cmd: 'codex', args: [] };
    case 'gemini':
      return { cmd: 'gemini', args: [] };
    case 'cursor':
      return { cmd: 'cursor', args: ['--cli'] };
    default:
      return { cmd: cli, args: [] };
  }
}

/**
 * Spawn an agent CLI to check their inbox
 */
export function spawnAgent(config: AgentConfig): SpawnResult {
  const { cmd, args } = getSpawnCommand(config.cli);
  const instructionsPath = path.join(config.dataDir, config.name, 'INSTRUCTIONS.md');

  // Create a prompt that tells the agent to check inbox
  const prompt = `You have new messages! Read ${instructionsPath} and check your inbox immediately using the team-check command. Respond to any messages, then continue your work loop.`;

  try {
    const child = spawn(cmd, [...args, '-p', prompt], {
      cwd: config.projectDir,
      stdio: 'inherit',
      detached: true,
    });

    child.unref();

    return {
      agent: config.name,
      pid: child.pid,
      success: true,
    };
  } catch (error) {
    return {
      agent: config.name,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Spawn agent in background and capture output
 */
export function spawnAgentBackground(
  config: AgentConfig,
  onOutput?: (data: string) => void,
  onExit?: (code: number | null) => void
): ChildProcess | null {
  const { cmd, args } = getSpawnCommand(config.cli);
  const instructionsPath = path.join(config.dataDir, config.name, 'INSTRUCTIONS.md');

  const prompt = `You have new messages! Read ${instructionsPath} and check your inbox using team-check --no-wait. Respond to messages, do one task step, broadcast status, then exit.`;

  try {
    const child = spawn(cmd, [...args, '-p', prompt], {
      cwd: config.projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (onOutput) {
      child.stdout?.on('data', (data) => onOutput(data.toString()));
      child.stderr?.on('data', (data) => onOutput(data.toString()));
    }

    if (onExit) {
      child.on('exit', onExit);
    }

    return child;
  } catch (error) {
    console.error(`Failed to spawn ${config.name}:`, error);
    return null;
  }
}

/**
 * Watch for inbox changes and spawn agents
 */
export class InboxWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private agents: Map<string, AgentConfig> = new Map();
  private activeAgents: Map<string, ChildProcess> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private dataDir: string;
  private debounceMs: number;

  constructor(dataDir: string, debounceMs = 2000) {
    this.dataDir = dataDir;
    this.debounceMs = debounceMs;
  }

  /**
   * Register an agent to watch
   */
  registerAgent(config: AgentConfig): void {
    this.agents.set(config.name, { ...config, enabled: config.enabled ?? true });
  }

  /**
   * Load agents from team.json
   */
  loadFromTeamConfig(): void {
    const configPath = path.join(this.dataDir, 'team.json');
    if (!fs.existsSync(configPath)) {
      throw new Error(`Team config not found: ${configPath}`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    for (const agent of config.agents) {
      this.registerAgent({
        name: agent.name,
        cli: agent.cli,
        projectDir: config.projectDir,
        dataDir: this.dataDir,
        enabled: agent.webhook !== false, // enabled by default
      });
    }
  }

  /**
   * Start watching for inbox changes
   */
  start(onSpawn?: (result: SpawnResult) => void): void {
    const inboxPattern = path.join(this.dataDir, '*/inbox.md');

    this.watcher = chokidar.watch(inboxPattern, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', (filePath) => {
      const agentName = path.basename(path.dirname(filePath));
      this.handleInboxChange(agentName, onSpawn);
    });

    this.watcher.on('add', (filePath) => {
      const agentName = path.basename(path.dirname(filePath));
      // Only trigger if file has content
      const stats = fs.statSync(filePath);
      if (stats.size > 0) {
        this.handleInboxChange(agentName, onSpawn);
      }
    });

    console.log(`Watching for inbox changes in ${this.dataDir}`);
  }

  /**
   * Handle inbox change with debouncing
   */
  private handleInboxChange(
    agentName: string,
    onSpawn?: (result: SpawnResult) => void
  ): void {
    const agent = this.agents.get(agentName);

    if (!agent || !agent.enabled) {
      return;
    }

    // Check if agent is already active
    if (this.activeAgents.has(agentName)) {
      console.log(`${agentName} already active, skipping spawn`);
      return;
    }

    // Check if inbox actually has content
    const inboxPath = path.join(this.dataDir, agentName, 'inbox.md');
    if (!fs.existsSync(inboxPath) || fs.statSync(inboxPath).size === 0) {
      return;
    }

    // Debounce rapid changes
    const existingTimer = this.debounceTimers.get(agentName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(agentName);
      this.spawnForAgent(agentName, onSpawn);
    }, this.debounceMs);

    this.debounceTimers.set(agentName, timer);
  }

  /**
   * Spawn agent and track it
   */
  private spawnForAgent(
    agentName: string,
    onSpawn?: (result: SpawnResult) => void
  ): void {
    const agent = this.agents.get(agentName);
    if (!agent) return;

    console.log(`Spawning ${agentName} (${agent.cli})...`);

    const child = spawnAgentBackground(
      agent,
      (output) => {
        process.stdout.write(`[${agentName}] ${output}`);
      },
      (code) => {
        console.log(`${agentName} exited with code ${code}`);
        this.activeAgents.delete(agentName);
      }
    );

    if (child) {
      this.activeAgents.set(agentName, child);
      onSpawn?.({
        agent: agentName,
        pid: child.pid,
        success: true,
      });
    } else {
      onSpawn?.({
        agent: agentName,
        success: false,
        error: 'Failed to spawn',
      });
    }
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.watcher?.close();
    this.watcher = null;

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Kill active agents
    for (const [name, child] of this.activeAgents) {
      console.log(`Stopping ${name}...`);
      child.kill();
    }
    this.activeAgents.clear();
  }

  /**
   * Get status of all agents
   */
  getStatus(): { name: string; enabled: boolean; active: boolean }[] {
    return Array.from(this.agents.values()).map((agent) => ({
      name: agent.name,
      enabled: agent.enabled ?? true,
      active: this.activeAgents.has(agent.name),
    }));
  }
}

/**
 * Trigger webhook for a specific agent (called after team-send)
 */
export async function triggerWebhook(
  agentName: string,
  dataDir: string,
  options?: {
    spawn?: boolean;
    http?: string;
  }
): Promise<SpawnResult> {
  const configPath = path.join(dataDir, 'team.json');

  if (!fs.existsSync(configPath)) {
    return { agent: agentName, success: false, error: 'Team config not found' };
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const agent = config.agents.find((a: { name: string }) => a.name === agentName);

  if (!agent) {
    return { agent: agentName, success: false, error: 'Agent not found' };
  }

  // HTTP webhook if configured
  if (options?.http || agent.webhookUrl) {
    const url = options?.http || agent.webhookUrl;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: agentName,
          event: 'new_message',
          timestamp: new Date().toISOString(),
          inboxPath: path.join(dataDir, agentName, 'inbox.md'),
        }),
      });

      return {
        agent: agentName,
        success: response.ok,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        agent: agentName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Spawn CLI if requested
  if (options?.spawn !== false) {
    return spawnAgent({
      name: agentName,
      cli: agent.cli,
      projectDir: config.projectDir,
      dataDir,
    });
  }

  return { agent: agentName, success: true };
}
