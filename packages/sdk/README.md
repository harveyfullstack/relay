# @agent-relay/sdk

Dead simple agent-to-agent communication for AI agent systems.

## Install

```bash
npm install @agent-relay/sdk
```

## Quick Start

### Standalone (In-Process Daemon)

```typescript
import { createRelay } from '@agent-relay/sdk';

// Start a relay (in-process daemon - no setup required)
const relay = await createRelay();

// Create agents
const alice = await relay.client('Alice');
const bob = await relay.client('Bob');

// Bob listens for messages
bob.onMessage = (from, { body }) => {
  console.log(`${from}: ${body}`);
};

// Alice sends a message
alice.sendMessage('Bob', 'Hello!');

// When done
await relay.stop();
```

### Two-Agent Shortcut

```typescript
import { createPair } from '@agent-relay/sdk';

const { alice, bob, stop } = await createPair('alice', 'bob');

bob.onMessage = (from, { body }) => console.log(`${from}: ${body}`);
alice.sendMessage('bob', 'Hey!');

await stop();
```

### With External Daemon

If you're running `agent-relay up` separately:

```typescript
import { RelayClient } from '@agent-relay/sdk';

// Socket path is auto-discovered from your project's .agent-relay/relay.sock
const client = new RelayClient({ agentName: 'MyAgent' });

await client.connect();
client.sendMessage('OtherAgent', 'Hello!');
```

## Socket Discovery

The SDK automatically discovers the daemon socket in this order:

1. `RELAY_SOCKET` environment variable
2. Cloud workspace socket (if `WORKSPACE_ID` is set)
3. **Project-local socket** (`{projectRoot}/.agent-relay/relay.sock`)
4. Legacy fallback (`/tmp/agent-relay.sock`)

You can also use the discovery API directly:

```typescript
import { discoverSocket, getDefaultSocketPath } from '@agent-relay/sdk';

// Get detailed discovery info
const { socketPath, projectId, source } = discoverSocket();
console.log(`Using socket: ${socketPath} (source: ${source})`);

// Or just get the path
const socketPath = getDefaultSocketPath();
```

## Integration Guide (for Libraries like AgentSwarm)

If you're building a library that integrates with Agent Relay:

### Option 1: Use the SDK Client (Recommended)

```typescript
import { RelayClient, discoverSocket } from '@agent-relay/sdk';

class MyAgentOrchestrator {
  private client: RelayClient;

  async connect(agentName: string) {
    // Auto-discovers socket path
    this.client = new RelayClient({
      agentName,
      reconnect: true, // Auto-reconnect on disconnect
    });

    await this.client.connect();
  }

  async sendTask(to: string, task: string) {
    return this.client.sendMessage(to, task);
  }

  async waitForResponse(to: string, message: string, timeoutMs = 30000) {
    return this.client.sendAndWait(to, message, { timeoutMs });
  }

  onMessage(handler: (from: string, body: string) => void) {
    this.client.onMessage = (from, payload) => {
      handler(from, payload.body);
    };
  }
}
```

### Option 2: Use MCP Simple API (If Using MCP)

If your agents use MCP, the `@agent-relay/mcp` package has an even simpler API:

```typescript
import { createTools } from '@agent-relay/mcp';

const tools = createTools('Orchestrator');

// Send messages
await tools.send('Worker1', 'Run the test suite');

// Spawn workers
await tools.spawn({
  name: 'Worker1',
  cli: 'claude',
  task: 'Run tests and report results',
});

// Check messages
const messages = await tools.inbox();

// List online agents
const agents = await tools.who();

// Release workers
await tools.release('Worker1');
```

### Option 3: HTTP API (For Non-Node Environments)

If the daemon is running with dashboard, use the HTTP API:

```bash
# Spawn an agent
curl -X POST http://localhost:3888/api/spawn \
  -H 'Content-Type: application/json' \
  -d '{"name": "Worker1", "cli": "claude", "task": "Run tests"}'

# List agents
curl http://localhost:3888/api/spawned

# Release an agent
curl -X DELETE http://localhost:3888/api/spawned/Worker1
```

## Features

| Feature | Description |
|---------|-------------|
| **Auto-discovery** | Finds daemon socket automatically |
| **Auto-reconnect** | Handles disconnections automatically |
| **Message deduplication** | No duplicate deliveries |
| **Sync messaging** | Wait for acknowledgment |
| **Broadcast** | Send to all agents with `*` |
| **Channels** | Group messaging with `#channel` |

## API Reference

### RelayClient

```typescript
import { RelayClient } from '@agent-relay/sdk';

const client = new RelayClient({
  agentName: 'MyAgent',      // Required: your agent's name
  socketPath: '/custom/path', // Optional: override auto-discovery
  reconnect: true,            // Optional: auto-reconnect (default: true)
  quiet: false,               // Optional: suppress logs (default: false)
});

// Connect to daemon
await client.connect();

// Send messages
client.sendMessage('OtherAgent', 'Hello!');
client.sendMessage('#general', 'Channel message');
client.sendMessage('*', 'Broadcast to everyone');

// Wait for acknowledgment
const ack = await client.sendAndWait('OtherAgent', 'Important message', {
  timeoutMs: 30000,
});

// Receive messages
client.onMessage = (from, payload, messageId, meta, originalTo) => {
  console.log(`${from}: ${payload.body}`);

  // Check if broadcast
  if (originalTo === '*') {
    console.log('This was a broadcast');
  }
};

// Connection state changes
client.onStateChange = (state) => {
  // 'DISCONNECTED' | 'CONNECTING' | 'HANDSHAKING' | 'READY' | 'BACKOFF'
};

// Disconnect
client.disconnect();
```

### Socket Discovery

```typescript
import { discoverSocket, getDefaultSocketPath } from '@agent-relay/sdk';

// Get full discovery result
const result = discoverSocket();
// { socketPath: string, projectId: string, source: 'env' | 'cloud' | 'project' | 'legacy' }

// Get just the path
const socketPath = getDefaultSocketPath();
```

### Channels

```typescript
// Join a channel
client.joinChannel('#general');

// Send to channel
client.sendChannelMessage('#general', 'Hello team!');

// Receive channel messages
client.onChannelMessage = (from, channel, body, envelope) => {
  console.log(`[${channel}] ${from}: ${body}`);
};

// Leave channel
client.leaveChannel('#general');
```

### Shadow Agents

Monitor another agent's communication:

```typescript
// Bind as shadow to see all messages to/from PrimaryAgent
client.bindAsShadow('PrimaryAgent', {
  receiveIncoming: true,
  receiveOutgoing: true,
});

// Unbind
client.unbindAsShadow('PrimaryAgent');
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RELAY_SOCKET` | Override daemon socket path |
| `RELAY_PROJECT` | Override project name |
| `WORKSPACE_ID` | Cloud workspace ID (auto-detects cloud socket) |

## Requirements

- Node.js 18+
- Agent Relay daemon running (`agent-relay up`)

## License

MIT
