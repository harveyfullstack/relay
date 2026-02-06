import { useEffect, useRef, useCallback } from 'react';
import { RelayClient } from '@agent-relay/sdk';
import type { SendPayload, SendMeta, AgentReadyPayload, ChannelMessagePayload, Envelope } from '@agent-relay/protocol';
import type { TuiStore } from '../store.js';
import type { TuiMessage, TuiConfig } from '../types.js';

/**
 * Connect a RelayClient to the daemon and wire events into the Zustand store.
 * Returns helpers for sending messages and spawning agents.
 */
export function useRelay(store: TuiStore, config: TuiConfig) {
  const clientRef = useRef<RelayClient | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const statusPollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const client = new RelayClient({
      socketPath: config.socketPath,
      agentName: 'TUI',
      entityType: 'user',
      cli: 'tui',
      quiet: true,
      reconnect: true,
      maxReconnectAttempts: 100,
      reconnectDelayMs: 1000,
      reconnectMaxDelayMs: 10000,
      _isSystemComponent: true,
    });

    clientRef.current = client;

    // Wire event handlers
    client.onMessage = (from: string, payload: SendPayload, messageId: string, _meta?: SendMeta, originalTo?: string) => {
      // Check if this is a log-like message via structured data
      if (payload.data && (payload.data as Record<string, unknown>)._isLog) {
        store.addLog({
          timestamp: Date.now(),
          agent: from,
          data: payload.body,
        });
      } else {
        const msg: TuiMessage = {
          id: messageId,
          from,
          to: originalTo ?? 'TUI',
          body: payload.body,
          timestamp: Date.now(),
          kind: payload.kind ?? 'message',
          thread: payload.thread,
          data: payload.data,
        };
        store.addMessage(msg);
      }
    };

    client.onChannelMessage = (from: string, channel: string, body: string, envelope: Envelope<ChannelMessagePayload>) => {
      const msg: TuiMessage = {
        id: envelope.id,
        from,
        to: `#${channel}`,
        body,
        timestamp: envelope.ts,
        kind: 'message',
        channel,
        thread: envelope.payload.thread,
      };
      store.addMessage(msg);
    };

    client.onStateChange = (state) => {
      store.setConnected(state === 'READY');
    };

    client.onAgentReady = (_info: AgentReadyPayload) => {
      // Refresh agent list when a new agent connects
      refreshAgents(client, store);
    };

    // Connect
    client.connect().catch(() => {
      // Reconnect will handle retries
    });

    // Poll connected agents every 2s
    pollRef.current = setInterval(() => {
      refreshAgents(client, store);
    }, 2000);

    // Poll daemon status every 5s
    statusPollRef.current = setInterval(() => {
      refreshStatus(client, store);
    }, 5000);

    // Load initial data once connected
    const readyCheck = setInterval(() => {
      if (client.state === 'READY') {
        clearInterval(readyCheck);
        loadInitialData(client, store);
      }
    }, 200);

    return () => {
      clearInterval(readyCheck);
      if (pollRef.current) clearInterval(pollRef.current);
      if (statusPollRef.current) clearInterval(statusPollRef.current);
      client.destroy();
      clientRef.current = null;
    };
  }, [config.socketPath]);

  const sendMessage = useCallback((to: string, body: string, thread?: string) => {
    const client = clientRef.current;
    if (!client) return false;
    const sent = client.sendMessage(to, body, 'message', undefined, thread);
    if (sent) {
      // Add our own message to the store
      store.addMessage({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        from: 'You',
        to,
        body,
        timestamp: Date.now(),
        kind: 'message',
        thread,
      });
    }
    return sent;
  }, []);

  const sendChannelMessage = useCallback((channel: string, body: string, thread?: string) => {
    const client = clientRef.current;
    if (!client) return false;
    const sent = client.sendChannelMessage(channel, body, { thread });
    if (sent) {
      store.addMessage({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        from: 'You',
        to: `#${channel}`,
        body,
        timestamp: Date.now(),
        kind: 'message',
        channel,
        thread,
      });
    }
    return sent;
  }, []);

  const joinChannel = useCallback((channel: string) => {
    const client = clientRef.current;
    if (!client) return false;
    const joined = client.joinChannel(channel);
    if (joined) {
      store.addChannel(channel);
    }
    return joined;
  }, []);

  const leaveChannel = useCallback((channel: string) => {
    const client = clientRef.current;
    if (!client) return false;
    const left = client.leaveChannel(channel);
    if (left) {
      store.removeChannel(channel);
    }
    return left;
  }, []);

  const spawnAgent = useCallback(async (name: string, cli: string, task?: string) => {
    const client = clientRef.current;
    if (!client) throw new Error('Not connected');
    return client.spawn({ name, cli, task, waitForReady: true });
  }, []);

  return { sendMessage, sendChannelMessage, joinChannel, leaveChannel, spawnAgent };
}

async function refreshAgents(client: RelayClient, store: TuiStore) {
  try {
    if (client.state !== 'READY') return;
    const agents = await client.listConnectedAgents({});
    store.setAgents(agents.filter((a) => a.name !== 'TUI'));
  } catch {
    // Ignore polling errors
  }
}

async function refreshStatus(client: RelayClient, store: TuiStore) {
  try {
    if (client.state !== 'READY') return;
    const status = await client.getStatus();
    store.setDaemonStatus(status);
  } catch {
    // Ignore
  }
}

async function loadInitialData(client: RelayClient, store: TuiStore) {
  try {
    // Load connected agents
    const agents = await client.listConnectedAgents({});
    store.setAgents(agents.filter((a) => a.name !== 'TUI'));

    // Load daemon status
    const status = await client.getStatus();
    store.setDaemonStatus(status);

    // Load recent messages
    const result = await client.queryMessages({ limit: 100, order: 'asc' });
    const messages: TuiMessage[] = result.map((m) => ({
      id: m.id,
      from: m.from,
      to: m.channel ? `#${m.channel}` : 'TUI',
      body: m.body,
      timestamp: m.timestamp,
      kind: 'message',
      channel: m.channel,
      thread: m.thread,
    }));
    store.loadMessages(messages);
  } catch {
    // Will retry on next poll
  }
}
