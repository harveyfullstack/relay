import React, { useEffect, useRef, useCallback } from 'react';
import { RelayClient } from '@agent-relay/sdk';
import type { SendPayload, SendMeta, AgentReadyPayload, ChannelMessagePayload, Envelope } from '@agent-relay/protocol';
import type { TuiStore } from '../store.js';
import type { TuiMessage, TuiConfig } from '../types.js';
import { formatUptime } from '../utils/format.js';

/**
 * Connect a RelayClient to the daemon and wire events into the Zustand store.
 * Returns helpers for sending messages and spawning agents.
 */
export function useRelay(store: TuiStore, config: TuiConfig) {
  const clientRef = useRef<RelayClient | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const statusPollRef = useRef<NodeJS.Timeout | null>(null);
  const messagePollRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageTsRef = useRef<number>(0);

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

    // Poll ALL messages every 2s to catch agent-to-agent traffic
    // (onMessage only fires for messages addressed to TUI)
    messagePollRef.current = setInterval(() => {
      pollNewMessages(client, store, lastMessageTsRef);
    }, 2000);

    // Load initial data once connected
    const readyCheck = setInterval(() => {
      if (client.state === 'READY') {
        clearInterval(readyCheck);
        loadInitialData(client, store, lastMessageTsRef);
      }
    }, 200);

    return () => {
      clearInterval(readyCheck);
      if (pollRef.current) clearInterval(pollRef.current);
      if (statusPollRef.current) clearInterval(statusPollRef.current);
      if (messagePollRef.current) clearInterval(messagePollRef.current);
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

/** Map daemon-stored 'TUI' sender back to 'You' for display. */
function normalizeSender(from: string): string {
  return from === 'TUI' ? 'You' : from;
}

/** Convert a raw queryMessages result into a TuiMessage. */
function toTuiMessage(m: { id: string; from: string; body: string; timestamp: number; channel?: string; thread?: string }): TuiMessage {
  const raw = m as Record<string, unknown>;
  return {
    id: m.id,
    from: normalizeSender(m.from),
    to: (raw.to as string) ?? (m.channel ? `#${m.channel}` : ''),
    body: m.body,
    timestamp: m.timestamp,
    kind: 'message',
    channel: m.channel,
    thread: m.thread,
  };
}

async function refreshAgents(client: RelayClient, store: TuiStore) {
  try {
    if (client.state !== 'READY') return;
    const agents = await client.listConnectedAgents({});
    const filtered = agents.filter((a) => a.name !== 'TUI');
    // Skip update if agent list hasn't changed (prevents unnecessary re-renders)
    const current = store.agents;
    if (
      filtered.length === current.length &&
      filtered.every((a, i) => a.name === current[i]?.name)
    ) {
      return;
    }
    store.setAgents(filtered);
  } catch {
    // Ignore polling errors
  }
}

async function refreshStatus(client: RelayClient, store: TuiStore) {
  try {
    if (client.state !== 'READY') return;
    const status = await client.getStatus();
    // Skip update if nothing visible has changed (prevents layout shifts)
    const current = store.daemonStatus;
    if (current) {
      const sameUptime = formatUptime(status.uptime ?? 0) === formatUptime(current.uptime ?? 0);
      const sameAgentCount = status.agentCount === current.agentCount;
      const sameCloud = status.cloudConnected === current.cloudConnected;
      if (sameUptime && sameAgentCount && sameCloud) return;
    }
    store.setDaemonStatus(status);
  } catch {
    // Ignore
  }
}

async function loadInitialData(
  client: RelayClient,
  store: TuiStore,
  lastTsRef: React.MutableRefObject<number>,
) {
  try {
    // Load connected agents
    const agents = await client.listConnectedAgents({});
    store.setAgents(agents.filter((a) => a.name !== 'TUI'));

    // Load daemon status
    const status = await client.getStatus();
    store.setDaemonStatus(status);

    // Start fresh — only show messages that arrive during this session.
    // Set timestamp to now so polling only picks up new traffic.
    lastTsRef.current = Date.now();
  } catch {
    // Will retry on next poll
  }
}

/**
 * Poll for new messages since last known timestamp.
 * This catches agent-to-agent messages that onMessage doesn't deliver to TUI.
 */
async function pollNewMessages(
  client: RelayClient,
  store: TuiStore,
  lastTsRef: React.MutableRefObject<number>,
) {
  try {
    if (client.state !== 'READY') return;
    const sinceTs = lastTsRef.current > 0 ? lastTsRef.current + 1 : undefined;
    const result = await client.queryMessages({
      limit: 50,
      order: 'asc',
      sinceTs,
    });

    for (const m of result) {
      // Skip our own messages — they're already in the store from the local add on send
      if (m.from === 'TUI') continue;
      store.addMessage(toTuiMessage(m));
    }

    if (result.length > 0) {
      lastTsRef.current = result[result.length - 1].timestamp;
    }
  } catch {
    // Ignore polling errors
  }
}
