/**
 * Tests for CLI inbox commands: inbox-poll, inbox-read, inbox-write, inbox-agents
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';

/** Create a temporary test directory */
function makeTempDir(): string {
  const base = path.join(process.cwd(), '.tmp-cli-inbox-tests');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'inbox-'));
  return dir;
}

function runCli(args: string[], options: Parameters<typeof execFileSync>[2] = {}): string {
  const cliPath = path.join(process.cwd(), 'dist', 'cli', 'index.js');
  return execFileSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf-8',
    ...options,
  }) as string;
}

/** Clean up a temp directory */
function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('CLI inbox commands', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('inbox-write', () => {
    it('writes a message to a single recipient inbox', () => {
      const recipient = 'TestAgent';
      const sender = 'SenderAgent';
      const message = 'Hello, TestAgent!';

      // Run inbox-write command
      runCli(['inbox-write', '-t', recipient, '-f', sender, '-m', message, '-d', tempDir]);

      // Verify the inbox file was created and has correct content
      const inboxPath = path.join(tempDir, recipient, 'inbox.md');
      expect(fs.existsSync(inboxPath)).toBe(true);

      const content = fs.readFileSync(inboxPath, 'utf-8');
      expect(content).toContain(`## Message from ${sender}`);
      expect(content).toContain(message);
    });

    it('writes to multiple comma-separated recipients', () => {
      const recipients = ['AgentA', 'AgentB', 'AgentC'];
      const sender = 'Sender';
      const message = 'Hello everyone';

      runCli(['inbox-write', '-t', recipients.join(','), '-f', sender, '-m', message, '-d', tempDir]);

      // Verify all recipients received the message
      for (const recipient of recipients) {
        const inboxPath = path.join(tempDir, recipient, 'inbox.md');
        expect(fs.existsSync(inboxPath)).toBe(true);

        const content = fs.readFileSync(inboxPath, 'utf-8');
        expect(content).toContain(`## Message from ${sender}`);
        expect(content).toContain(message);
      }
    });

    it('broadcasts to all agents except sender using *', () => {
      // Create some existing agent directories
      const agents = ['Agent1', 'Agent2', 'Sender'];
      for (const agent of agents) {
        fs.mkdirSync(path.join(tempDir, agent), { recursive: true });
      }

      runCli(['inbox-write', '-t', '*', '-f', 'Sender', '-m', 'Broadcast message', '-d', tempDir]);

      // Sender should NOT receive the broadcast
      const senderInbox = path.join(tempDir, 'Sender', 'inbox.md');
      expect(fs.existsSync(senderInbox)).toBe(false);

      // Other agents should receive it
      for (const agent of ['Agent1', 'Agent2']) {
        const inboxPath = path.join(tempDir, agent, 'inbox.md');
        expect(fs.existsSync(inboxPath)).toBe(true);
        const content = fs.readFileSync(inboxPath, 'utf-8');
        expect(content).toContain('Broadcast message');
      }
    });

    it('appends to existing inbox content', () => {
      const recipient = 'TestAgent';
      const inboxDir = path.join(tempDir, recipient);
      const inboxPath = path.join(inboxDir, 'inbox.md');

      // Create existing content
      fs.mkdirSync(inboxDir, { recursive: true });
      fs.writeFileSync(inboxPath, '## Message from OldSender | 2025-01-01T00:00:00.000Z\nOld message\n');

      // Write new message
      runCli(['inbox-write', '-t', recipient, '-f', 'NewSender', '-m', 'New message', '-d', tempDir]);

      const content = fs.readFileSync(inboxPath, 'utf-8');
      expect(content).toContain('Old message');
      expect(content).toContain('New message');
      expect(content).toContain('OldSender');
      expect(content).toContain('NewSender');
    });

    it('handles empty broadcast gracefully', () => {
      // Empty data directory - no agents
      const result = runCli(['inbox-write', '-t', '*', '-f', 'Sender', '-m', 'Hello', '-d', tempDir]);

      expect(result).toContain('No other agents found');
    });
  });

  describe('inbox-read', () => {
    it('reads inbox content', () => {
      const agent = 'TestAgent';
      const inboxDir = path.join(tempDir, agent);
      const inboxPath = path.join(inboxDir, 'inbox.md');

      fs.mkdirSync(inboxDir, { recursive: true });
      fs.writeFileSync(inboxPath, '## Message from Sender | 2025-01-01T00:00:00.000Z\nTest message\n');

      const result = runCli(['inbox-read', '-n', agent, '-d', tempDir]);

      expect(result).toContain('Test message');
      expect(result).toContain('Sender');
    });

    it('returns empty message for non-existent inbox', () => {
      const result = runCli(['inbox-read', '-n', 'NonExistent', '-d', tempDir]);

      expect(result).toContain('(inbox empty)');
    });

    it('clears inbox when --clear flag is set', () => {
      const agent = 'TestAgent';
      const inboxDir = path.join(tempDir, agent);
      const inboxPath = path.join(inboxDir, 'inbox.md');

      fs.mkdirSync(inboxDir, { recursive: true });
      fs.writeFileSync(inboxPath, '## Message from Sender | 2025-01-01T00:00:00.000Z\nTest message\n');

      // Read with clear
      runCli(['inbox-read', '-n', agent, '-d', tempDir, '--clear']);

      // Inbox should now be empty
      const content = fs.readFileSync(inboxPath, 'utf-8');
      expect(content).toBe('');
    });

    it('returns empty for inbox with only whitespace', () => {
      const agent = 'TestAgent';
      const inboxDir = path.join(tempDir, agent);
      const inboxPath = path.join(inboxDir, 'inbox.md');

      fs.mkdirSync(inboxDir, { recursive: true });
      fs.writeFileSync(inboxPath, '   \n  \n  ');

      const result = runCli(['inbox-read', '-n', agent, '-d', tempDir]);

      expect(result).toContain('(inbox empty)');
    });
  });

  describe('inbox-agents', () => {
    it('lists agents with directories', () => {
      // Create agent directories
      fs.mkdirSync(path.join(tempDir, 'AgentA'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'AgentB'), { recursive: true });

      const result = runCli(['inbox-agents', '-d', tempDir]);

      expect(result).toContain('AgentA');
      expect(result).toContain('AgentB');
    });

    it('shows (has messages) for agents with non-empty inbox', () => {
      const agentDir = path.join(tempDir, 'AgentWithMessages');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'inbox.md'), 'Some message content');

      const result = runCli(['inbox-agents', '-d', tempDir]);

      expect(result).toContain('AgentWithMessages');
      expect(result).toContain('(has messages)');
    });

    it('handles empty data directory', () => {
      const result = runCli(['inbox-agents', '-d', tempDir]);

      expect(result).toContain('No agents found');
    });

    it('handles non-existent data directory', () => {
      const nonExistentDir = path.join(tempDir, 'does-not-exist');

      const result = runCli(['inbox-agents', '-d', nonExistentDir]);

      expect(result).toContain('No agents found');
    });
  });

  describe('inbox-poll', () => {
    it('returns immediately when inbox has matching content', async () => {
      const agent = 'TestAgent';
      const inboxDir = path.join(tempDir, agent);
      const inboxPath = path.join(inboxDir, 'inbox.md');

      fs.mkdirSync(inboxDir, { recursive: true });
      fs.writeFileSync(inboxPath, '## Message from Sender | 2025-01-01T00:00:00.000Z\nTest message\n');

      const result = runCli(['inbox-poll', '-n', agent, '-d', tempDir, '-t', '5']);

      expect(result).toContain('Test message');
    });

    it('times out when no matching content arrives', async () => {
      const agent = 'TestAgent';
      const inboxDir = path.join(tempDir, agent);

      fs.mkdirSync(inboxDir, { recursive: true });
      // Empty inbox - will timeout

      try {
        runCli(['inbox-poll', '-n', agent, '-d', tempDir, '-t', '1', '-i', '100'], { timeout: 5000 });
        // Should not reach here
        expect.fail('Should have thrown due to timeout exit');
      } catch (err: unknown) {
        const error = err as { status?: number; stderr?: Buffer };
        // Process exits with code 1 on timeout
        expect(error.status).toBe(1);
      }
    });

    it('clears inbox after reading when --clear flag is set', () => {
      const agent = 'TestAgent';
      const inboxDir = path.join(tempDir, agent);
      const inboxPath = path.join(inboxDir, 'inbox.md');

      fs.mkdirSync(inboxDir, { recursive: true });
      fs.writeFileSync(inboxPath, '## Message from Sender | 2025-01-01T00:00:00.000Z\nTest message\n');

      runCli(['inbox-poll', '-n', agent, '-d', tempDir, '-t', '5', '--clear']);

      // Inbox should be empty after reading with --clear
      const content = fs.readFileSync(inboxPath, 'utf-8');
      expect(content).toBe('');
    });

    it('respects custom pattern matching', () => {
      const agent = 'TestAgent';
      const inboxDir = path.join(tempDir, agent);
      const inboxPath = path.join(inboxDir, 'inbox.md');

      fs.mkdirSync(inboxDir, { recursive: true });
      fs.writeFileSync(inboxPath, 'This does not match the default pattern');

      try {
        runCli(['inbox-poll', '-n', agent, '-d', tempDir, '-t', '1', '-i', '100'], { timeout: 5000 });
        expect.fail('Should have timed out');
      } catch (err: unknown) {
        const error = err as { status?: number };
        expect(error.status).toBe(1);
      }

      // Now test with matching pattern
      fs.writeFileSync(inboxPath, '## Message from SomeAgent | timestamp\nContent');
      const result = runCli(['inbox-poll', '-n', agent, '-d', tempDir, '-t', '5', '--pattern', '## Message from']);

      expect(result).toContain('SomeAgent');
    });

    it('creates inbox directory and file if not exists', () => {
      const agent = 'NewAgent';
      const inboxDir = path.join(tempDir, agent);
      const inboxPath = path.join(inboxDir, 'inbox.md');

      // Verify directory doesn't exist initially
      expect(fs.existsSync(inboxDir)).toBe(false);

      // Run inbox-poll with a short timeout (it will timeout, but should create the directory)
      try {
        runCli(['inbox-poll', '-n', agent, '-d', tempDir, '-t', '1', '-i', '100'], { timeout: 5000 });
      } catch {
        // Expected - poll times out
      }

      // Directory and empty inbox file should have been created
      expect(fs.existsSync(inboxDir)).toBe(true);
      expect(fs.existsSync(inboxPath)).toBe(true);
    });
  });

  describe('input validation', () => {
    it('rejects invalid agent names with path separators', () => {
      try {
        runCli(['inbox-read', '-n', '../../etc/passwd', '-d', tempDir], { stdio: 'pipe' });
        expect.fail('Should have rejected invalid name');
      } catch (err: unknown) {
        const error = err as { stderr?: string; status?: number };
        expect(error.status).not.toBe(0);
      }
    });

    it('rejects empty message in inbox-write', () => {
      try {
        runCli(['inbox-write', '-t', 'TestAgent', '-f', 'Sender', '-m', '   ', '-d', tempDir], { stdio: 'pipe' });
        expect.fail('Should have rejected empty message');
      } catch (err: unknown) {
        const error = err as { stderr?: string; status?: number };
        expect(error.status).not.toBe(0);
      }
    });

    it('rejects invalid poll interval', () => {
      try {
        runCli(['inbox-poll', '-n', 'TestAgent', '-d', tempDir, '-i', '50', '-t', '1'], { stdio: 'pipe' });
        expect.fail('Should have rejected low poll interval');
      } catch (err: unknown) {
        const error = err as { stderr?: string; status?: number };
        expect(error.status).not.toBe(0);
      }
    });

    it('rejects invalid regex pattern', () => {
      try {
        runCli(['inbox-poll', '-n', 'TestAgent', '-d', tempDir, '--pattern', '[invalid', '-t', '1'], { stdio: 'pipe' });
        expect.fail('Should have rejected invalid regex');
      } catch (err: unknown) {
        const error = err as { stderr?: string; status?: number };
        expect(error.status).not.toBe(0);
      }
    });
  });

  describe('message format', () => {
    it('formats messages with correct header structure', () => {
      const recipient = 'TestAgent';
      const sender = 'SenderAgent';
      const message = 'Test message body';

      runCli(['inbox-write', '-t', recipient, '-f', sender, '-m', message, '-d', tempDir]);

      const inboxPath = path.join(tempDir, recipient, 'inbox.md');
      const content = fs.readFileSync(inboxPath, 'utf-8');

      // Check format: ## Message from <sender> | <timestamp>
      const headerMatch = content.match(/## Message from (\w+) \| (.+)/);
      expect(headerMatch).not.toBeNull();
      expect(headerMatch![1]).toBe(sender);
      // Timestamp should be ISO format
      expect(headerMatch![2]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
