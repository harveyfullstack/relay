import React, { useEffect, useRef, useCallback } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { RelayClient } from '@agent-relay/sdk';
import type { SendPayload, SendMeta, AgentReadyPayload, ChannelMessagePayload, Envelope } from '@agent-relay/protocol';
import type { TuiStore } from '../store.js';
import type { StoreApi } from 'zustand';
import type { TuiMessage, TuiConfig } from '../types.js';
import { formatUptime } from '../utils/format.js';

/**
 * Connect a RelayClient to the daemon and wire events into the Zustand store.
 * Returns helpers for sending messages and spawning agents.
 *
 * Takes `storeApi` instead of a store snapshot so polling callbacks always
 * read the latest state via `storeApi.getState()` (avoids stale closures).
 */
export function useRelay(storeApi: StoreApi<TuiStore>, config: TuiConfig) {
  const clientRef = useRef<RelayClient | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const statusPollRef = useRef<NodeJS.Timeout | null>(null);
  const messagePollRef = useRef<NodeJS.Timeout | null>(null);
  const processingPollRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageTsRef = useRef<number>(0);

  useEffect(() => {
    const { displayName } = storeApi.getState().settings;

    const client = new RelayClient({
      socketPath: config.socketPath,
      agentName: displayName,
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
      const store = storeApi.getState();
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
          to: originalTo ?? displayName,
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
      const store = storeApi.getState();
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
      storeApi.getState().setConnected(state === 'READY');
    };

    client.onAgentReady = (_info: AgentReadyPayload) => {
      // Refresh agent list when a new agent connects
      refreshAgents(client, storeApi);
    };

    // Connect
    client.connect().catch(() => {
      // Reconnect will handle retries
    });

    // Poll connected agents every 2s
    pollRef.current = setInterval(() => {
      refreshAgents(client, storeApi);
    }, 2000);

    // Poll daemon status every 5s
    statusPollRef.current = setInterval(() => {
      refreshStatus(client, storeApi);
    }, 5000);

    // Poll ALL messages every 2s to catch agent-to-agent traffic
    // (onMessage only fires for messages addressed to TUI)
    messagePollRef.current = setInterval(() => {
      pollNewMessages(client, storeApi, lastMessageTsRef);
    }, 2000);

    // Poll processing state every 1s (reads daemon's processing-state.json)
    // When an agent stops processing, immediately poll messages so the reply
    // appears at the same moment the typing indicator vanishes.
    const processingStatePath = resolveProcessingStatePath(config);
    const prevProcessingRef = { current: new Set<string>() };
    if (processingStatePath) {
      processingPollRef.current = setInterval(() => {
        const cleared = pollProcessingState(processingStatePath, storeApi, prevProcessingRef);
        if (cleared && client.state === 'READY') {
          pollNewMessages(client, storeApi, lastMessageTsRef);
        }
      }, 1000);
    }

    // Load initial data once connected
    const readyCheck = setInterval(() => {
      if (client.state === 'READY') {
        clearInterval(readyCheck);
        loadInitialData(client, storeApi, lastMessageTsRef);
      }
    }, 200);

    return () => {
      clearInterval(readyCheck);
      if (pollRef.current) clearInterval(pollRef.current);
      if (statusPollRef.current) clearInterval(statusPollRef.current);
      if (messagePollRef.current) clearInterval(messagePollRef.current);
      if (processingPollRef.current) clearInterval(processingPollRef.current);
      client.destroy();
      clientRef.current = null;
    };
  }, [config.socketPath]);

  const sendMessage = useCallback((to: string, body: string, thread?: string) => {
    const client = clientRef.current;
    if (!client) return false;
    const store = storeApi.getState();
    const msgId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // Show message immediately with 'sending' status
    store.addMessage({
      id: msgId,
      from: 'You',
      to,
      body,
      timestamp: Date.now(),
      kind: 'message',
      thread,
      status: 'sending',
    });
    const sent = client.sendMessage(to, body, 'message', undefined, thread);
    store.updateMessageStatus(msgId, sent ? 'sent' : 'failed');
    return sent;
  }, [storeApi]);

  const sendChannelMessage = useCallback((channel: string, body: string, thread?: string) => {
    const client = clientRef.current;
    if (!client) return false;
    const store = storeApi.getState();
    const msgId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Parse @mentions from the message body
    const mentions = parseAtMentions(body);

    store.addMessage({
      id: msgId,
      from: 'You',
      to: `#${channel}`,
      body,
      timestamp: Date.now(),
      kind: 'message',
      channel,
      thread,
      status: 'sending',
    });
    const sent = client.sendChannelMessage(channel, body, {
      thread,
      mentions: mentions.length > 0 ? mentions : undefined,
    });
    store.updateMessageStatus(msgId, sent ? 'sent' : 'failed');
    return sent;
  }, [storeApi]);

  const joinChannel = useCallback((channel: string) => {
    const client = clientRef.current;
    if (!client) return false;
    const joined = client.joinChannel(channel);
    if (joined) {
      storeApi.getState().addChannel(channel);
    }
    return joined;
  }, [storeApi]);

  const leaveChannel = useCallback((channel: string) => {
    const client = clientRef.current;
    if (!client) return false;
    const left = client.leaveChannel(channel);
    if (left) {
      storeApi.getState().removeChannel(channel);
    }
    return left;
  }, [storeApi]);

  const spawnAgent = useCallback(async (name: string, cli: string, task?: string) => {
    const client = clientRef.current;
    if (!client) throw new Error('Not connected');
    return client.spawn({ name, cli, task, waitForReady: true });
  }, []);

  return { sendMessage, sendChannelMessage, joinChannel, leaveChannel, spawnAgent };
}

/** Extract @name mentions from message text. */
function parseAtMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = /@(\w+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

/** Map daemon-stored sender name back to 'You' for display. */
function normalizeSender(from: string, displayName: string): string {
  return from === displayName ? 'You' : from;
}

/** Convert a raw queryMessages result into a TuiMessage. */
function toTuiMessage(m: { id: string; from: string; body: string; timestamp: number; channel?: string; thread?: string }, displayName: string): TuiMessage {
  const raw = m as Record<string, unknown>;
  return {
    id: m.id,
    from: normalizeSender(m.from, displayName),
    to: m.channel ? `#${m.channel}` : ((raw.to as string) ?? ''),
    body: m.body,
    timestamp: m.timestamp,
    kind: 'message',
    channel: m.channel,
    thread: m.thread,
  };
}

/**
 * Derive the path to processing-state.json from TUI config.
 * The daemon writes this file to the same directory as the socket.
 */
function resolveProcessingStatePath(config: TuiConfig): string | null {
  if (config.dataDir) {
    return path.join(config.dataDir, 'team', 'processing-state.json');
  }
  if (config.socketPath) {
    return path.join(path.dirname(config.socketPath), 'team', 'processing-state.json');
  }
  return null;
}

/**
 * Read the daemon's processing-state.json and update the store.
 * Returns true if any agent transitioned from processing -> idle (reply likely available).
 */
function pollProcessingState(
  filePath: string,
  storeApi: StoreApi<TuiStore>,
  prevRef: { current: Set<string> },
): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as {
      processingAgents?: Record<string, unknown>;
    };
    const names = Object.keys(parsed.processingAgents ?? {}).sort();
    const nameSet = new Set(names);

    // Detect if any previously-processing agent has stopped
    let cleared = false;
    for (const prev of prevRef.current) {
      if (!nameSet.has(prev)) {
        cleared = true;
        break;
      }
    }
    prevRef.current = nameSet;

    storeApi.getState().setProcessingAgents(names);
    return cleared;
  } catch {
    // File may not exist yet or be mid-write — ignore
    return false;
  }
}

async function refreshAgents(client: RelayClient, storeApi: StoreApi<TuiStore>) {
  try {
    if (client.state !== 'READY') return;
    const agents = await client.listConnectedAgents({});
    const { displayName } = storeApi.getState().settings;
    const filtered = agents.filter((a) => a.name !== displayName);
    const store = storeApi.getState();
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

async function refreshStatus(client: RelayClient, storeApi: StoreApi<TuiStore>) {
  try {
    if (client.state !== 'READY') return;
    const status = await client.getStatus();
    const store = storeApi.getState();
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
  storeApi: StoreApi<TuiStore>,
  lastTsRef: React.MutableRefObject<number>,
) {
  try {
    const store = storeApi.getState();
    // Load connected agents
    const agents = await client.listConnectedAgents({});
    const { displayName } = store.settings;
    store.setAgents(agents.filter((a) => a.name !== displayName));

    // Load daemon status
    const status = await client.getStatus();
    store.setDaemonStatus(status);

    // Join the default 'all' channel (daemon auto-joins everyone)
    client.joinChannel('all');
    store.addChannel('all');

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
  storeApi: StoreApi<TuiStore>,
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

    const store = storeApi.getState();
    const { displayName } = store.settings;
    for (const m of result) {
      // Skip our own messages — they're already in the store from the local add on send
      if (m.from === displayName) continue;
      store.addMessage(toTuiMessage(m, displayName));
    }

    if (result.length > 0) {
      lastTsRef.current = result[result.length - 1].timestamp;
    }
  } catch {
    // Ignore polling errors
  }
}
