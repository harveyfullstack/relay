/**
 * CLI Spawner
 *
 * Handles spawning fresh CLI instances for different agent types.
 * Supports Claude Code, Codex, Cursor, and custom commands.
 */

import { spawn } from 'node:child_process';
import type { CLIType, SpawnResult, ParsedRelayCommand, SupervisorConfig } from './types.js';

/** CLI command configurations */
type PromptMode = 'flag' | 'stdin';

const CLI_COMMANDS: Record<CLIType, { cmd: string; args: string[]; promptMode: PromptMode; promptFlag?: string }> = {
  claude: {
    cmd: 'claude',
    args: ['--dangerously-skip-permissions'],
    promptMode: 'flag',
    promptFlag: '-p',
  },
  codex: {
    cmd: 'codex',
    // Prefer stdin for robustness (some codex invocations are flaky with huge -p prompts).
    // Try --quiet first but retry without it if unsupported.
    args: ['--quiet'],
    promptMode: 'stdin',
  },
  cursor: {
    cmd: 'cursor',
    args: ['--cli'],
    promptMode: 'flag',
    promptFlag: '-p',
  },
  custom: {
    cmd: '',
    args: [],
    promptMode: 'stdin',
  },
};

/** Relay command patterns */
const INLINE_RELAY_PATTERN = /^(\s*)@relay:(\S+)\s+(.+)$/gm;
const BLOCK_RELAY_PATTERN = /\[\[RELAY\]\]([\s\S]*?)\[\[\/RELAY\]\]/g;

/** Structured state markers */
const DECISION_PATTERN = /\[\[DECISION\]\]([\s\S]*?)\[\[\/DECISION\]\]/g;
const TODO_PATTERN = /\[\[TODO\]\]([\s\S]*?)\[\[\/TODO\]\]/g;
const DONE_PATTERN = /\[\[DONE\]\]([\s\S]*?)\[\[\/DONE\]\]/g;
const SUMMARY_PATTERN = /\[\[SUMMARY\]\]([\s\S]*?)\[\[\/SUMMARY\]\]/g;

/** Parsed structured markers from output */
export interface ParsedDecision {
  what: string;
  why: string;
}

export interface ParsedTodo {
  task: string;
  priority: 'high' | 'normal' | 'low';
  owner?: string;
}

export interface ParsedDone {
  taskMatch: string;
}

export interface ParsedStateMarkers {
  decisions: ParsedDecision[];
  todos: ParsedTodo[];
  dones: ParsedDone[];
  summary?: string;
}

/**
 * Parse structured state markers from CLI output
 */
export function parseStateMarkers(output: string): ParsedStateMarkers {
  const decisions: ParsedDecision[] = [];
  const todos: ParsedTodo[] = [];
  const dones: ParsedDone[] = [];
  let summary: string | undefined;

  // Parse decisions
  let match;
  while ((match = DECISION_PATTERN.exec(output)) !== null) {
    try {
      const json = JSON.parse(match[1].trim());
      if (json.what) {
        decisions.push({
          what: json.what,
          why: json.why || '',
        });
      }
    } catch {
      // Not valid JSON, try simple text format
      const text = match[1].trim();
      if (text) {
        decisions.push({ what: text, why: '' });
      }
    }
  }

  // Parse TODOs
  while ((match = TODO_PATTERN.exec(output)) !== null) {
    try {
      const json = JSON.parse(match[1].trim());
      if (json.task) {
        todos.push({
          task: json.task,
          priority: json.priority || 'normal',
          owner: json.owner,
        });
      }
    } catch {
      // Not valid JSON, treat as simple task
      const text = match[1].trim();
      if (text) {
        todos.push({ task: text, priority: 'normal' });
      }
    }
  }

  // Parse DONEs (task completions)
  while ((match = DONE_PATTERN.exec(output)) !== null) {
    const text = match[1].trim();
    if (text) {
      dones.push({ taskMatch: text });
    }
  }

  // Parse SUMMARY (take last one)
  while ((match = SUMMARY_PATTERN.exec(output)) !== null) {
    const text = match[1].trim();
    if (text) summary = text;
  }

  return { decisions, todos, dones, summary };
}

/**
 * Parse relay commands from CLI output
 */
export function parseRelayCommands(output: string): ParsedRelayCommand[] {
  const commands: ParsedRelayCommand[] = [];

  // Parse inline commands
  let match;
  while ((match = INLINE_RELAY_PATTERN.exec(output)) !== null) {
    commands.push({
      to: match[2],
      body: match[3],
      kind: 'message',
    });
  }

  // Parse block commands
  while ((match = BLOCK_RELAY_PATTERN.exec(output)) !== null) {
    try {
      const json = JSON.parse(match[1].trim());
      if (json.to && json.type) {
        commands.push({
          to: json.to,
          body: json.body || json.text || '',
          kind: json.type as 'message' | 'thinking' | 'state',
        });
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return commands;
}

/**
 * CLI Spawner class
 */
export class CLISpawner {
  private config: SupervisorConfig;

  constructor(config: SupervisorConfig) {
    this.config = config;
  }

  /**
   * Spawn a CLI with the given prompt
   */
  async spawn(
    cli: CLIType,
    prompt: string,
    cwd: string,
    customCommand?: string
  ): Promise<SpawnResult> {
    const { cmd, args, promptMode, promptFlag } = cli === 'custom' && customCommand
      ? this.parseCustomCommand(customCommand)
      : CLI_COMMANDS[cli];

    if (!cmd) {
      throw new Error(`Invalid CLI type: ${cli}`);
    }

    const attempt = async (attemptArgs: string[]): Promise<SpawnResult> => {
      const fullArgs = [...attemptArgs];
      if (promptMode === 'flag' && promptFlag) {
        fullArgs.push(promptFlag, prompt);
      }

      if (this.config.verbose) {
        console.error(`[spawner] Running: ${cmd} ${fullArgs.join(' ')}`);
      }

      return new Promise((resolve) => {
        const proc = spawn(cmd, fullArgs, {
          cwd,
          env: {
            ...process.env,
            AGENT_RELAY_SUPERVISED: '1',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          if (this.config.verbose) {
            process.stdout.write(chunk);
          }
        });

        proc.stderr?.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          if (this.config.verbose) {
            process.stderr.write(chunk);
          }
        });

        // For CLIs that read prompt from stdin instead of flag
        if (promptMode === 'stdin') {
          proc.stdin?.write(prompt);
          proc.stdin?.end();
        }

        proc.on('close', (code) => {
          // Some CLIs emit user-visible output on stderr; parse both for commands/markers.
          const combined = `${stdout}\n${stderr}`;
          const relayCommands = parseRelayCommands(combined);
          const stateMarkers = parseStateMarkers(combined);

          if (this.config.verbose) {
            console.error(
              `[spawner] Exited with code ${code}, found ${relayCommands.length} relay commands, ${stateMarkers.decisions.length} decisions, ${stateMarkers.todos.length} todos, ${stateMarkers.dones.length} dones`
            );
          }

          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr,
            relayCommands,
            stateMarkers,
          });
        });

        proc.on('error', (err) => {
          console.error(`[spawner] Spawn error:`, err);
          resolve({
            exitCode: 1,
            stdout,
            stderr: stderr + `\nSpawn error: ${err.message}`,
            relayCommands: [],
            stateMarkers: { decisions: [], todos: [], dones: [] },
          });
        });

        // Timeout after 5 minutes
        setTimeout(() => {
          if (!proc.killed) {
            console.error(`[spawner] Timeout, killing process`);
            proc.kill('SIGTERM');
          }
        }, 5 * 60 * 1000);
      });
    };

    // First attempt
    const first = await attempt(args);

    // Codex-specific retry: if --quiet is unsupported, retry without it.
    if (
      cli === 'codex' &&
      args.includes('--quiet') &&
      first.exitCode !== 0 &&
      /unknown option|unrecognized option|invalid option|unexpected option|unknown flag/i.test(first.stderr)
    ) {
      if (this.config.verbose) {
        console.error('[spawner] codex --quiet unsupported; retrying without --quiet');
      }
      return attempt(args.filter((a) => a !== '--quiet'));
    }

    return first;
  }

  /**
   * Parse a custom command string into cmd, args, promptFlag
   */
  private parseCustomCommand(command: string): { cmd: string; args: string[]; promptMode: PromptMode; promptFlag?: string } {
    const parts = command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    // Try to detect prompt flag
    let promptFlag: string | undefined;
    let promptMode: PromptMode = 'stdin';
    const pFlagIdx = args.indexOf('-p');
    const promptFlagIdx = args.indexOf('--prompt');

    if (pFlagIdx !== -1) {
      promptFlag = '-p';
      args.splice(pFlagIdx, 1);
      promptMode = 'flag';
    } else if (promptFlagIdx !== -1) {
      promptFlag = '--prompt';
      args.splice(promptFlagIdx, 1);
      promptMode = 'flag';
    }

    return { cmd, args, promptMode, promptFlag };
  }

  /**
   * Check if a CLI is available
   */
  async isAvailable(cli: CLIType, customCommand?: string): Promise<boolean> {
    const cmd = cli === 'custom' && customCommand
      ? customCommand.split(' ')[0]
      : CLI_COMMANDS[cli].cmd;

    if (!cmd) return false;

    return new Promise((resolve) => {
      const proc = spawn('which', [cmd], { stdio: 'ignore' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}
