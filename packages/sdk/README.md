# @agent-relay/sdk

Lightweight SDK for agent-to-agent communication via [Agent Relay](https://github.com/AgentWorkforce/relay).

## Installation

```bash
npm install @agent-relay/sdk
```

## Quick Start

```typescript
import { RelayClient } from '@agent-relay/sdk';

const client = new RelayClient({
  agentName: 'MyAgent',
  socketPath: '/tmp/agent-relay.sock',
});

// Connect to daemon
await client.connect();

// Send a message
client.sendMessage('OtherAgent', 'Hello!');

// Handle incoming messages
client.onMessage = (from, payload, messageId, meta, originalTo) => {
  console.log(`Message from ${from}: ${payload.body}`);

  // Check if this was a broadcast
  if (originalTo === '*') {
    console.log('This was a broadcast message');
  }
};

// Disconnect when done
client.disconnect();
```

## API Reference

### RelayClient

The main client for connecting to the Agent Relay daemon.

#### Constructor

```typescript
const client = new RelayClient({
  agentName: string;              // Your agent's name (required)
  socketPath?: string;            // Daemon socket (default: /tmp/agent-relay.sock)
  entityType?: 'agent' | 'user';  // Entity type (default: 'agent')
  cli?: string;                   // CLI identifier (claude, codex, etc.)
  program?: string;               // Program identifier
  model?: string;                 // Model identifier
  task?: string;                  // Task description
  workingDirectory?: string;      // Working directory
  quiet?: boolean;                // Suppress console logging
  reconnect?: boolean;            // Auto-reconnect (default: true)
  maxReconnectAttempts?: number;  // Max attempts (default: 10)
  reconnectDelayMs?: number;      // Initial delay (default: 100)
  reconnectMaxDelayMs?: number;   // Max delay (default: 30000)
});
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `state` | `ClientState` | Current connection state |
| `agentName` | `string` | Agent name |
| `currentSessionId` | `string \| undefined` | Session ID from server |

#### Lifecycle Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `connect()` | `Promise<void>` | Connect to the daemon |
| `disconnect()` | `void` | Gracefully disconnect |
| `destroy()` | `void` | Permanently destroy (no reconnect) |

#### Messaging Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `sendMessage(to, body, kind?, data?, thread?, meta?)` | `boolean` | Send a message |
| `sendAndWait(to, body, options?)` | `Promise<AckPayload>` | Send and wait for ACK |
| `broadcast(body, kind?, data?)` | `boolean` | Broadcast to all agents |
| `sendAck(payload)` | `boolean` | Send explicit ACK |
| `sendLog(data)` | `boolean` | Send log output to dashboard |

#### Subscription Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `subscribe(topic)` | `boolean` | Subscribe to a topic |
| `unsubscribe(topic)` | `boolean` | Unsubscribe from a topic |

#### Shadow Agent Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `bindAsShadow(primaryAgent, options?)` | `boolean` | Bind as shadow to primary |
| `unbindAsShadow(primaryAgent)` | `boolean` | Stop shadowing |

#### Event Callbacks

```typescript
// Called when a message is received
client.onMessage = (from, payload, messageId, meta, originalTo) => {
  // from: sender name
  // payload: { kind, body, data?, thread? }
  // messageId: unique ID
  // meta: optional metadata
  // originalTo: original recipient ('*' for broadcasts)
};

// Called when connection state changes
client.onStateChange = (state) => {
  // state: 'DISCONNECTED' | 'CONNECTING' | 'HANDSHAKING' | 'READY' | 'BACKOFF'
};

// Called on errors
client.onError = (error) => {
  console.error('Client error:', error);
};
```

### Protocol Types

Import protocol types for type-safe message handling:

```typescript
import {
  PROTOCOL_VERSION,
  type Envelope,
  type SendPayload,
  type AckPayload,
  type MessageType,
  type PayloadKind,
} from '@agent-relay/sdk/protocol';
```

### Framing Utilities

For low-level protocol work:

```typescript
import {
  encodeFrame,
  encodeFrameLegacy,
  FrameParser,
  MAX_FRAME_BYTES,
} from '@agent-relay/sdk/protocol';

// Encode an envelope
const frame = encodeFrameLegacy(envelope);

// Parse incoming data
const parser = new FrameParser();
parser.setLegacyMode(true);
const envelopes = parser.push(data);
```

### Optional MessagePack Support

For faster serialization, install MessagePack:

```bash
npm install @msgpack/msgpack
```

Then initialize:

```typescript
import { initMessagePack, encodeFrame } from '@agent-relay/sdk/protocol';

await initMessagePack();
const frame = encodeFrame(envelope, 'msgpack');
```

## Connection States

| State | Description |
|-------|-------------|
| `DISCONNECTED` | Not connected |
| `CONNECTING` | TCP connection in progress |
| `HANDSHAKING` | HELLO/WELCOME exchange |
| `READY` | Connected and ready |
| `BACKOFF` | Waiting to reconnect |

## Message Types

| Kind | Description |
|------|-------------|
| `message` | Standard message |
| `action` | Action request |
| `state` | State update |
| `thinking` | Thinking/reasoning output |

## Error Handling

The client automatically handles:
- Connection drops with exponential backoff reconnection
- Message deduplication
- Heartbeat (PING/PONG)

For explicit error handling:

```typescript
client.onError = (error) => {
  if (error.message.includes('Connection refused')) {
    console.log('Daemon not running');
  }
};
```

## Protocol

The SDK uses a length-prefixed JSON protocol over Unix domain sockets. See the [protocol documentation](https://github.com/AgentWorkforce/relay/blob/main/docs/PROTOCOL.md) for details.

## License

MIT
