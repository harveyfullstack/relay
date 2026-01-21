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
client.onMessage = (from, payload) => {
  console.log(`Message from ${from}: ${payload.body}`);
};

// Disconnect when done
client.disconnect();
```

## API

### RelayClient

The main client for connecting to the Agent Relay daemon.

```typescript
const client = new RelayClient({
  agentName: string;        // Your agent's name
  socketPath?: string;      // Daemon socket path (default: /tmp/agent-relay.sock)
  reconnect?: boolean;      // Auto-reconnect on disconnect (default: true)
});
```

#### Methods

- `connect(): Promise<void>` - Connect to the daemon
- `disconnect(): void` - Disconnect from the daemon
- `sendMessage(to, body, kind?, data?, thread?)` - Send a message
- `broadcast(body, kind?, data?)` - Broadcast to all agents
- `subscribe(topic)` - Subscribe to a topic
- `unsubscribe(topic)` - Unsubscribe from a topic

#### Events

- `onMessage` - Called when a message is received
- `onStateChange` - Called when connection state changes
- `onError` - Called on errors

### Protocol Types

```typescript
import {
  PROTOCOL_VERSION,
  type Envelope,
  type SendPayload,
  type MessageType,
} from '@agent-relay/sdk/protocol';
```

## Protocol

The SDK uses a length-prefixed JSON protocol over Unix domain sockets. See the [protocol documentation](https://github.com/AgentWorkforce/relay/blob/main/docs/PROTOCOL.md) for details.

## License

MIT
