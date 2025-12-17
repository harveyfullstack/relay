/**
 * PTY Wrapper
 * Wraps an agent CLI command in a pseudo-terminal and intercepts
 * relay commands from output while injecting incoming messages.
 */

import * as pty from 'node-pty';
import { RelayClient } from './client.js';
import { OutputParser, formatIncomingMessage, type ParsedCommand } from './parser.js';
import type { SendPayload } from '../protocol/types.js';

export interface WrapperConfig {
  name: string;
  command: string;
  args?: string[];
  socketPath?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export class PtyWrapper {
  private config: WrapperConfig;
  private ptyProcess?: pty.IPty;
  private client: RelayClient;
  private parser: OutputParser;
  private running = false;

  constructor(config: WrapperConfig) {
    this.config = {
      cols: 120,
      rows: 40,
      ...config,
    };

    this.client = new RelayClient({
      agentName: config.name,
      socketPath: config.socketPath,
    });

    this.parser = new OutputParser();

    // Handle incoming messages
    this.client.onMessage = (from: string, payload: SendPayload) => {
      this.handleIncomingMessage(from, payload);
    };

    this.client.onStateChange = (state) => {
      console.log(`[wrapper:${this.config.name}] Relay state: ${state}`);
    };
  }

  /**
   * Start the wrapped agent process.
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Connect to relay daemon
    try {
      await this.client.connect();
    } catch (err) {
      console.error(`[wrapper:${this.config.name}] Failed to connect to relay:`, err);
      // Continue without relay - agent can still run standalone
    }

    // Parse command
    const [cmd, ...defaultArgs] = this.config.command.split(' ');
    const args = this.config.args ?? defaultArgs;

    // Spawn PTY
    this.ptyProcess = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols: this.config.cols!,
      rows: this.config.rows!,
      cwd: this.config.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...this.config.env,
        AGENT_RELAY_NAME: this.config.name,
        TERM: 'xterm-256color',
      },
    });

    this.running = true;

    // Handle PTY output
    this.ptyProcess.onData((data) => {
      this.handlePtyOutput(data);
    });

    // Handle PTY exit
    this.ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`[wrapper:${this.config.name}] Process exited (code: ${exitCode}, signal: ${signal})`);
      this.running = false;
      this.client.disconnect();
    });

    // Forward stdin to PTY
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data', (data) => {
      if (this.ptyProcess) {
        this.ptyProcess.write(data.toString());
      }
    });

    // Handle terminal resize
    process.stdout.on('resize', () => {
      if (this.ptyProcess) {
        this.ptyProcess.resize(process.stdout.columns, process.stdout.rows);
      }
    });

    console.log(`[wrapper:${this.config.name}] Started: ${this.config.command}`);
  }

  /**
   * Stop the wrapped process.
   */
  stop(): void {
    if (!this.running) return;

    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = undefined;
    }

    this.client.disconnect();
    this.running = false;
  }

  /**
   * Handle output from the PTY process.
   */
  private handlePtyOutput(data: string): void {
    // Parse for relay commands
    const { commands, output } = this.parser.parse(data);

    // Send any extracted commands to relay
    for (const cmd of commands) {
      this.sendRelayCommand(cmd);
    }

    // Output to terminal (with relay commands filtered)
    process.stdout.write(output);
  }

  /**
   * Send a parsed relay command to the daemon.
   */
  private sendRelayCommand(cmd: ParsedCommand): void {
    const success = this.client.sendMessage(cmd.to, cmd.body, cmd.kind, cmd.data);
    if (success) {
      console.log(`[relay → ${cmd.to}] ${cmd.body.substring(0, 50)}${cmd.body.length > 50 ? '...' : ''}`);
    } else {
      console.error(`[relay] Failed to send to ${cmd.to}`);
    }
  }

  /**
   * Handle incoming message from relay.
   */
  private handleIncomingMessage(from: string, payload: SendPayload): void {
    // Format message for display
    const formatted = formatIncomingMessage(from, payload.body, payload.kind);

    // Show in terminal
    console.log(`\n[relay ← ${from}] ${payload.body}`);

    // Inject into agent input if PTY is running
    if (this.ptyProcess && this.running) {
      // For AI agents, we inject a user message
      const injection = `\n[Message from ${from}]: ${payload.body}\n`;
      this.ptyProcess.write(injection);
    }
  }

  /**
   * Check if wrapper is running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Get agent name.
   */
  get name(): string {
    return this.config.name;
  }
}
