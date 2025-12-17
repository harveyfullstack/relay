#!/usr/bin/env node
/**
 * Agent Relay CLI
 * Command-line interface for agent-relay.
 */

import { Command } from 'commander';
import { Daemon, DEFAULT_SOCKET_PATH } from '../daemon/server.js';
import { PtyWrapper } from '../wrapper/pty-wrapper.js';
import { RelayClient } from '../wrapper/client.js';
import { generateAgentName } from '../utils/name-generator.js';
import fs from 'node:fs';

const program = new Command();

function pidFilePathForSocket(socketPath: string): string {
  return `${socketPath}.pid`;
}

program
  .name('agent-relay')
  .description('Real-time agent-to-agent communication system')
  .version('0.1.0');

// Start daemon
program
  .command('start')
  .description('Start the relay daemon')
  .option('-s, --socket <path>', 'Socket path', DEFAULT_SOCKET_PATH)
  .option('-f, --foreground', 'Run in foreground', false)
  .action(async (options) => {
    const socketPath = options.socket as string;
    const pidFilePath = pidFilePathForSocket(socketPath);
    const daemon = new Daemon({ socketPath, pidFilePath });

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await daemon.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await daemon.stop();
      process.exit(0);
    });

    try {
      await daemon.start();
      console.log('Daemon started. Press Ctrl+C to stop.');

      // Keep process alive
      if (options.foreground) {
        await new Promise(() => {}); // Never resolves
      }
    } catch (err) {
      console.error('Failed to start daemon:', err);
      process.exit(1);
    }
  });

// Stop daemon
program
  .command('stop')
  .description('Stop the relay daemon')
  .option('-s, --socket <path>', 'Socket path', DEFAULT_SOCKET_PATH)
  .action(async (options) => {
    const socketPath = options.socket as string;
    const pidFilePath = pidFilePathForSocket(socketPath);

    if (!fs.existsSync(pidFilePath)) {
      console.log('Daemon not running (pid file not found)');
      return;
    }

    const pidRaw = fs.readFileSync(pidFilePath, 'utf-8').trim();
    const pid = Number(pidRaw);
    if (!Number.isFinite(pid) || pid <= 0) {
      console.error(`Invalid pid file: ${pidFilePath}`);
      return;
    }

    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      // Stale pid file
      console.warn(
        `Failed to signal pid ${pid} (${(err as Error).message}); cleaning up pid file`
      );
      fs.unlinkSync(pidFilePath);
    }

    // Wait briefly for socket/pid file cleanup
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const socketExists = fs.existsSync(socketPath);
      const pidExists = fs.existsSync(pidFilePath);
      if (!socketExists && !pidExists) {
        console.log('Daemon stopped');
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    console.warn('Stop requested, but daemon did not exit within 2s');
    console.warn(`Socket: ${socketPath}`);
    console.warn(`PID file: ${pidFilePath}`);
  });

// Wrap an agent
program
  .command('wrap')
  .description('Wrap an agent CLI command')
  .option('-n, --name <name>', 'Agent name (auto-generated if not provided)')
  .option('-s, --socket <path>', 'Socket path', DEFAULT_SOCKET_PATH)
  .argument('<command...>', 'Command to wrap')
  .action(async (commandParts, options) => {
    const command = commandParts.join(' ');

    // Auto-generate name if not provided
    const agentName = options.name ?? generateAgentName();
    console.log(`Agent name: ${agentName}`);

    const wrapper = new PtyWrapper({
      name: agentName,
      command,
      socketPath: options.socket,
    });

    // Handle shutdown
    process.on('SIGINT', () => {
      wrapper.stop();
      process.exit(0);
    });

    try {
      await wrapper.start();
    } catch (err) {
      console.error('Failed to start wrapper:', err);
      process.exit(1);
    }
  });

// Status
program
  .command('status')
  .description('Show relay daemon status')
  .option('-s, --socket <path>', 'Socket path', DEFAULT_SOCKET_PATH)
  .action(async (options) => {
    if (!fs.existsSync(options.socket)) {
      console.log('Status: STOPPED (socket not found)');
      return;
    }

    // Try to connect
    const client = new RelayClient({
      agentName: '__status_check__',
      socketPath: options.socket,
      reconnect: false,
    });

    try {
      await client.connect();
      console.log('Status: RUNNING');
      console.log(`Socket: ${options.socket}`);
      client.disconnect();
    } catch {
      console.log('Status: STOPPED (connection failed)');
    }
  });

// Send a message (for testing)
program
  .command('send')
  .description('Send a message to an agent')
  .option('-f, --from <name>', 'Sender agent name (auto-generated if not provided)')
  .requiredOption('-t, --to <name>', 'Recipient agent name (or * for broadcast)')
  .requiredOption('-m, --message <text>', 'Message body')
  .option('-s, --socket <path>', 'Socket path', DEFAULT_SOCKET_PATH)
  .action(async (options) => {
    const senderName = options.from ?? generateAgentName();
    const client = new RelayClient({
      agentName: senderName,
      socketPath: options.socket,
    });

    try {
      await client.connect();
      const success = client.sendMessage(options.to, options.message);
      if (success) {
        console.log(`Sent: ${options.message}`);
      } else {
        console.error('Failed to send message');
      }
      // Wait a bit for delivery
      await new Promise((r) => setTimeout(r, 500));
      client.disconnect();
    } catch (err) {
      console.error('Error:', err);
      process.exit(1);
    }
  });

// List connected agents
program
  .command('agents')
  .description('List connected agents')
  .option('-s, --socket <path>', 'Socket path', DEFAULT_SOCKET_PATH)
  .action(async (options) => {
    console.log('Note: Agent listing requires daemon introspection (not yet implemented)');
    console.log('Use the status command to check if daemon is running.');
  });

program.parse();
