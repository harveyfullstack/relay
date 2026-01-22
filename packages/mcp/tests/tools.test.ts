import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleRelaySend,
  handleRelayInbox,
  handleRelayWho,
  handleRelaySpawn,
  handleRelayRelease,
  handleRelayStatus,
} from '../src/tools/index.js';

describe('relay_send', () => {
  const mockClient = {
    send: vi.fn(),
    sendAndWait: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a direct message', async () => {
    mockClient.send.mockResolvedValue(undefined);

    const result = await handleRelaySend(mockClient as any, {
      to: 'Alice',
      message: 'Hello',
    });

    expect(result).toBe('Message sent to Alice');
    expect(mockClient.send).toHaveBeenCalledWith('Alice', 'Hello', { thread: undefined });
  });

  it('sends to a channel', async () => {
    mockClient.send.mockResolvedValue(undefined);

    const result = await handleRelaySend(mockClient as any, {
      to: '#general',
      message: 'Team update',
    });

    expect(result).toBe('Message sent to #general');
    expect(mockClient.send).toHaveBeenCalledWith('#general', 'Team update', { thread: undefined });
  });

  it('awaits response when requested', async () => {
    mockClient.sendAndWait.mockResolvedValue({
      from: 'Worker',
      content: 'Done!',
    });

    const result = await handleRelaySend(mockClient as any, {
      to: 'Worker',
      message: 'Process this',
      await_response: true,
      timeout_ms: 5000,
      thread: 'task-123',
    });

    expect(result).toBe('Response from Worker: Done!');
    expect(mockClient.sendAndWait).toHaveBeenCalledWith('Worker', 'Process this', {
      thread: 'task-123',
      timeoutMs: 5000,
    });
  });
});

describe('relay_inbox', () => {
  const mockClient = {
    getInbox: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no messages message when inbox empty', async () => {
    mockClient.getInbox.mockResolvedValue([]);

    const result = await handleRelayInbox(mockClient as any, {});

    expect(result).toBe('No messages in inbox.');
    expect(mockClient.getInbox).toHaveBeenCalledWith({});
  });

  it('formats messages with channel and thread', async () => {
    mockClient.getInbox.mockResolvedValue([
      {
        id: '123',
        from: 'Lead',
        content: 'Update',
        channel: '#general',
        thread: 'thr-1',
      },
      {
        id: '124',
        from: 'Worker',
        content: 'Done',
      },
    ]);

    const result = await handleRelayInbox(mockClient as any, {
      limit: 5,
      unread_only: true,
      from: 'Lead',
    });

    expect(mockClient.getInbox).toHaveBeenCalledWith({
      limit: 5,
      unread_only: true,
      from: 'Lead',
    });
    expect(result).toContain('2 message(s):');
    expect(result).toContain('[123] From Lead [#general] (thread: thr-1):\nUpdate');
    expect(result).toContain('[124] From Worker:\nDone');
  });
});

describe('relay_who', () => {
  const mockClient = {
    listAgents: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns message when no agents online', async () => {
    mockClient.listAgents.mockResolvedValue([]);

    const result = await handleRelayWho(mockClient as any, {});

    expect(result).toBe('No agents online.');
    expect(mockClient.listAgents).toHaveBeenCalledWith({});
  });

  it('lists agents with status and parent info', async () => {
    mockClient.listAgents.mockResolvedValue([
      { name: 'Alice', cli: 'claude', idle: false },
      { name: 'Bob', cli: 'codex', idle: true },
      { name: 'Worker1', cli: 'claude', idle: false, parent: 'Alice' },
    ]);

    const result = await handleRelayWho(mockClient as any, { include_idle: true, project: 'proj' });

    expect(mockClient.listAgents).toHaveBeenCalledWith({ include_idle: true, project: 'proj' });
    expect(result).toContain('3 agent(s) online:');
    expect(result).toContain('- Alice (claude) - active');
    expect(result).toContain('- Bob (codex) - idle');
    expect(result).toContain('- Worker1 (claude) - active [worker of: Alice]');
  });
});

describe('relay_spawn', () => {
  const mockClient = {
    spawn: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success message when worker spawns', async () => {
    mockClient.spawn.mockResolvedValue({ success: true });

    const result = await handleRelaySpawn(mockClient as any, {
      name: 'TestRunner',
      cli: 'claude',
      task: 'Run tests',
      model: 'claude-3',
      cwd: '/tmp',
    });

    expect(result).toContain('spawned successfully');
    expect(mockClient.spawn).toHaveBeenCalledWith({
      name: 'TestRunner',
      cli: 'claude',
      task: 'Run tests',
      model: 'claude-3',
      cwd: '/tmp',
    });
  });

  it('returns failure message when spawn fails', async () => {
    mockClient.spawn.mockResolvedValue({ success: false, error: 'Busy' });

    const result = await handleRelaySpawn(mockClient as any, {
      name: 'Worker',
      cli: 'codex',
      task: 'Do thing',
    });

    expect(result).toContain('Failed to spawn worker');
    expect(result).toContain('Busy');
  });
});

describe('relay_release', () => {
  const mockClient = {
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success message when worker released', async () => {
    mockClient.release.mockResolvedValue({ success: true });

    const result = await handleRelayRelease(mockClient as any, {
      name: 'Worker1',
      reason: 'done',
    });

    expect(result).toBe('Worker "Worker1" released.');
    expect(mockClient.release).toHaveBeenCalledWith('Worker1', 'done');
  });

  it('returns failure message when release fails', async () => {
    mockClient.release.mockResolvedValue({ success: false, error: 'not found' });

    const result = await handleRelayRelease(mockClient as any, {
      name: 'Worker2',
    });

    expect(result).toBe('Failed to release worker: not found');
  });
});

describe('relay_status', () => {
  const mockClient = {
    getStatus: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats status output', async () => {
    mockClient.getStatus.mockResolvedValue({
      connected: true,
      agentName: 'AgentA',
      project: 'proj',
      socketPath: '/tmp/socket',
      daemonVersion: '0.1.0',
      uptime: '1h',
    });

    const result = await handleRelayStatus(mockClient as any, {});

    expect(result).toContain('Connected: Yes');
    expect(result).toContain('Agent Name: AgentA');
    expect(result).toContain('Project: proj');
    expect(result).toContain('Socket: /tmp/socket');
    expect(result).toContain('Daemon Version: 0.1.0');
    expect(result).toContain('Uptime: 1h');
  });
});
