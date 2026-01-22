# @agent-relay/mcp - Implementation Specification

> Comprehensive specification for the Agent Relay MCP Server package.
> This enables AI agents (Claude, Codex, Gemini, Cursor, etc.) to use Relay
> as a native tool for inter-agent communication.

## Overview

The MCP (Model Context Protocol) server provides AI agents with native tools to:
- Send messages to other agents, channels, or broadcast
- Spawn and release worker agents
- Check inbox for pending messages
- List online agents
- Query connection status

**Key Design Decisions:**
- Separate package: `@agent-relay/mcp` (not bundled with main agent-relay)
- Full protocol spec included in prompts (not abbreviated)
- Error if daemon not running (don't auto-start - user should know)
- Socket discovery with priority: env var → cwd → scan data dir
- Cloud: Pre-baked in Docker image for all CLI tools
- Local: Frictionless `npx` one-liner installation

---

## Package Structure

```
packages/mcp/
├── package.json
├── tsconfig.json
├── README.md
├── SPEC.md                    # This file
├── src/
│   ├── index.ts               # MCP server entry point
│   ├── bin.ts                 # CLI binary entry (npx @agent-relay/mcp)
│   ├── install-cli.ts         # Install command implementation
│   ├── install.ts             # Editor installation logic
│   ├── tools/
│   │   ├── index.ts           # Tool exports
│   │   ├── relay-send.ts      # Send message tool
│   │   ├── relay-spawn.ts     # Spawn agent tool
│   │   ├── relay-release.ts   # Release agent tool
│   │   ├── relay-inbox.ts     # Check inbox tool
│   │   ├── relay-who.ts       # List agents tool
│   │   └── relay-status.ts    # Connection status tool
│   ├── prompts/
│   │   ├── index.ts           # Prompt exports
│   │   └── protocol.ts        # Full protocol documentation
│   ├── resources/
│   │   ├── index.ts           # Resource exports
│   │   ├── agents.ts          # relay://agents resource
│   │   ├── inbox.ts           # relay://inbox resource
│   │   └── project.ts         # relay://project resource
│   ├── client.ts              # Relay daemon connection client
│   ├── discover.ts            # Socket/project discovery
│   └── errors.ts              # Error types and messages
└── tests/
    ├── tools.test.ts
    ├── discover.test.ts
    └── install.test.ts
```

---

## Package Configuration

### package.json

```json
{
  "name": "@agent-relay/mcp",
  "version": "0.1.0",
  "description": "MCP server for Agent Relay - gives AI agents native relay tools",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "agent-relay-mcp": "./dist/bin.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./install": {
      "types": "./dist/install.d.ts",
      "import": "./dist/install.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@agent-relay/protocol": "0.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.19.3",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  },
  "peerDependencies": {
    "agent-relay": ">=0.1.0"
  },
  "peerDependenciesMeta": {
    "agent-relay": {
      "optional": true
    }
  },
  "keywords": ["mcp", "agent-relay", "ai-agents", "claude", "cursor"],
  "publishConfig": {
    "access": "public"
  }
}
```

---

## MCP Tools

### 1. relay_send

Send a message to another agent, channel, or broadcast.

```typescript
// src/tools/relay-send.ts
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const relaySendSchema = z.object({
  to: z.string().describe(
    'Target: agent name, #channel, or * for broadcast'
  ),
  message: z.string().describe('Message content'),
  thread: z.string().optional().describe('Optional thread ID for threaded conversations'),
  await_response: z.boolean().optional().default(false).describe(
    'If true, wait for a response (blocks until reply or timeout)'
  ),
  timeout_ms: z.number().optional().default(30000).describe(
    'Timeout in milliseconds when await_response is true'
  ),
});

export type RelaySendInput = z.infer<typeof relaySendSchema>;

export const relaySendTool: Tool = {
  name: 'relay_send',
  description: `Send a message via Agent Relay.

Examples:
- Direct message: to="Alice", message="Hello"
- Channel: to="#general", message="Team update"
- Broadcast: to="*", message="System notice"
- Threaded: to="Bob", message="Follow up", thread="task-123"
- Await reply: to="Worker", message="Process this", await_response=true`,
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Target: agent name, #channel, or * for broadcast',
      },
      message: {
        type: 'string',
        description: 'Message content',
      },
      thread: {
        type: 'string',
        description: 'Optional thread ID for threaded conversations',
      },
      await_response: {
        type: 'boolean',
        description: 'If true, wait for a response',
        default: false,
      },
      timeout_ms: {
        type: 'number',
        description: 'Timeout in ms when await_response is true',
        default: 30000,
      },
    },
    required: ['to', 'message'],
  },
};

export async function handleRelaySend(
  client: RelayClient,
  input: RelaySendInput
): Promise<string> {
  const { to, message, thread, await_response, timeout_ms } = input;

  if (await_response) {
    const response = await client.sendAndWait(to, message, {
      thread,
      timeoutMs: timeout_ms,
    });
    return `Response from ${response.from}: ${response.content}`;
  }

  await client.send(to, message, { thread });
  return `Message sent to ${to}`;
}
```

### 2. relay_spawn

Spawn a worker agent to handle a subtask.

```typescript
// src/tools/relay-spawn.ts
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const relaySpawnSchema = z.object({
  name: z.string().describe('Unique name for the worker agent'),
  cli: z.enum(['claude', 'codex', 'gemini', 'droid', 'opencode']).describe(
    'CLI tool to use for the worker'
  ),
  task: z.string().describe('Task description/prompt for the worker'),
  model: z.string().optional().describe('Model override (e.g., "claude-3-5-sonnet")'),
  cwd: z.string().optional().describe('Working directory for the worker'),
});

export type RelaySpawnInput = z.infer<typeof relaySpawnSchema>;

export const relaySpawnTool: Tool = {
  name: 'relay_spawn',
  description: `Spawn a worker agent to handle a subtask.

The worker runs in a separate process with its own CLI instance.
You'll receive a confirmation when the worker is ready.

Example:
  name="TestRunner"
  cli="claude"
  task="Run the test suite and report failures"`,
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Unique name for the worker agent',
      },
      cli: {
        type: 'string',
        enum: ['claude', 'codex', 'gemini', 'droid', 'opencode'],
        description: 'CLI tool to use',
      },
      task: {
        type: 'string',
        description: 'Task description for the worker',
      },
      model: {
        type: 'string',
        description: 'Optional model override',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the worker',
      },
    },
    required: ['name', 'cli', 'task'],
  },
};

export async function handleRelaySpawn(
  client: RelayClient,
  input: RelaySpawnInput
): Promise<string> {
  const { name, cli, task, model, cwd } = input;

  const result = await client.spawn({
    name,
    cli,
    task,
    model,
    cwd,
  });

  if (result.success) {
    return `Worker "${name}" spawned successfully. It will message you when ready.`;
  } else {
    return `Failed to spawn worker: ${result.error}`;
  }
}
```

### 3. relay_release

Release (terminate) a worker agent.

```typescript
// src/tools/relay-release.ts
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const relayReleaseSchema = z.object({
  name: z.string().describe('Name of the worker to release'),
  reason: z.string().optional().describe('Optional reason for release'),
});

export type RelayReleaseInput = z.infer<typeof relayReleaseSchema>;

export const relayReleaseTool: Tool = {
  name: 'relay_release',
  description: `Release (terminate) a worker agent.

Use this when a worker has completed its task or is no longer needed.
The worker will be gracefully terminated.

Example:
  name="TestRunner"
  reason="Tests completed successfully"`,
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the worker to release',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for release',
      },
    },
    required: ['name'],
  },
};

export async function handleRelayRelease(
  client: RelayClient,
  input: RelayReleaseInput
): Promise<string> {
  const { name, reason } = input;

  const result = await client.release(name, reason);

  if (result.success) {
    return `Worker "${name}" released.`;
  } else {
    return `Failed to release worker: ${result.error}`;
  }
}
```

### 4. relay_inbox

Check for pending messages in your inbox.

```typescript
// src/tools/relay-inbox.ts
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const relayInboxSchema = z.object({
  limit: z.number().optional().default(10).describe('Max messages to return'),
  unread_only: z.boolean().optional().default(true).describe('Only return unread messages'),
  from: z.string().optional().describe('Filter by sender'),
  channel: z.string().optional().describe('Filter by channel'),
});

export type RelayInboxInput = z.infer<typeof relayInboxSchema>;

export const relayInboxTool: Tool = {
  name: 'relay_inbox',
  description: `Check your inbox for pending messages.

Returns messages sent to you by other agents or in channels you're subscribed to.

Examples:
- Get all unread: (no params)
- From specific agent: from="Alice"
- From channel: channel="#general"`,
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Max messages to return',
        default: 10,
      },
      unread_only: {
        type: 'boolean',
        description: 'Only return unread messages',
        default: true,
      },
      from: {
        type: 'string',
        description: 'Filter by sender',
      },
      channel: {
        type: 'string',
        description: 'Filter by channel',
      },
    },
    required: [],
  },
};

export async function handleRelayInbox(
  client: RelayClient,
  input: RelayInboxInput
): Promise<string> {
  const messages = await client.getInbox(input);

  if (messages.length === 0) {
    return 'No messages in inbox.';
  }

  const formatted = messages.map((m) => {
    const channel = m.channel ? ` [${m.channel}]` : '';
    const thread = m.thread ? ` (thread: ${m.thread})` : '';
    return `[${m.id}] From ${m.from}${channel}${thread}:\n${m.content}`;
  });

  return `${messages.length} message(s):\n\n${formatted.join('\n\n---\n\n')}`;
}
```

### 5. relay_who

List online agents and their status.

```typescript
// src/tools/relay-who.ts
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const relayWhoSchema = z.object({
  include_idle: z.boolean().optional().default(true).describe('Include idle agents'),
  project: z.string().optional().describe('Filter by project (for multi-project setups)'),
});

export type RelayWhoInput = z.infer<typeof relayWhoSchema>;

export const relayWhoTool: Tool = {
  name: 'relay_who',
  description: `List online agents in the relay network.

Shows agent names, their CLI type, and current status.

Example output:
- Alice (claude) - active
- Bob (codex) - idle
- TestRunner (claude) - active [worker of: Alice]`,
  inputSchema: {
    type: 'object',
    properties: {
      include_idle: {
        type: 'boolean',
        description: 'Include idle agents',
        default: true,
      },
      project: {
        type: 'string',
        description: 'Filter by project',
      },
    },
    required: [],
  },
};

export async function handleRelayWho(
  client: RelayClient,
  input: RelayWhoInput
): Promise<string> {
  const agents = await client.listAgents(input);

  if (agents.length === 0) {
    return 'No agents online.';
  }

  const formatted = agents.map((a) => {
    const status = a.idle ? 'idle' : 'active';
    const worker = a.parent ? ` [worker of: ${a.parent}]` : '';
    return `- ${a.name} (${a.cli}) - ${status}${worker}`;
  });

  return `${agents.length} agent(s) online:\n${formatted.join('\n')}`;
}
```

### 6. relay_status

Get connection status and diagnostics.

```typescript
// src/tools/relay-status.ts
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const relayStatusSchema = z.object({});

export type RelayStatusInput = z.infer<typeof relayStatusSchema>;

export const relayStatusTool: Tool = {
  name: 'relay_status',
  description: `Get relay connection status and diagnostics.

Returns:
- Connection state (connected/disconnected)
- Your agent name
- Project/socket info
- Daemon version`,
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export async function handleRelayStatus(
  client: RelayClient,
  _input: RelayStatusInput
): Promise<string> {
  const status = await client.getStatus();

  return `Relay Status:
- Connected: ${status.connected ? 'Yes' : 'No'}
- Agent Name: ${status.agentName || 'Not registered'}
- Project: ${status.project || 'Unknown'}
- Socket: ${status.socketPath}
- Daemon Version: ${status.daemonVersion || 'Unknown'}
- Uptime: ${status.uptime || 'N/A'}`;
}
```

---

## MCP Prompts

### Protocol Documentation Prompt

This prompt is included automatically when an agent connects. It provides the full protocol documentation.

```typescript
// src/prompts/protocol.ts
import type { Prompt } from '@modelcontextprotocol/sdk/types.js';

export const protocolPrompt: Prompt = {
  name: 'relay_protocol',
  description: 'Full Agent Relay protocol documentation',
  arguments: [],
};

export const PROTOCOL_DOCUMENTATION = `
# Agent Relay Protocol

You are connected to Agent Relay, a real-time messaging system for AI agent coordination.

## Communication Patterns

### Direct Messages
Send a message to a specific agent by name:
\`\`\`
relay_send(to="Alice", message="Can you review this PR?")
\`\`\`

### Channel Messages
Send to a channel (prefix with #):
\`\`\`
relay_send(to="#engineering", message="Build complete")
\`\`\`
Channel messages are visible to all agents subscribed to that channel.

### Broadcast
Send to all online agents:
\`\`\`
relay_send(to="*", message="System maintenance in 5 minutes")
\`\`\`
Use sparingly - broadcasts interrupt all agents.

### Threaded Conversations
For multi-turn conversations, use thread IDs:
\`\`\`
relay_send(to="Bob", message="Starting task", thread="task-123")
relay_send(to="Bob", message="Task update", thread="task-123")
\`\`\`

### Await Response
Block and wait for a reply:
\`\`\`
relay_send(to="Worker", message="Process this file", await_response=true, timeout_ms=60000)
\`\`\`

## Spawning Workers

Create worker agents to parallelize work:

\`\`\`
relay_spawn(
  name="TestRunner",
  cli="claude",
  task="Run the test suite in src/tests/ and report any failures"
)
\`\`\`

Workers:
- Run in separate processes
- Have their own CLI instance
- Can use relay to communicate back
- Should be released when done

### Worker Lifecycle
1. Spawn worker with task
2. Worker sends ACK when ready
3. Worker sends progress updates
4. Worker sends DONE when complete
5. Lead releases worker

### Release Workers
\`\`\`
relay_release(name="TestRunner", reason="Tests completed")
\`\`\`

## Message Protocol

When you receive messages, they follow this format:
\`\`\`
Relay message from Alice [msg-id-123]: Content here
\`\`\`

Channel messages include the channel:
\`\`\`
Relay message from Alice [msg-id-456] [#general]: Hello team!
\`\`\`

### ACK/DONE Protocol
When assigned a task:
1. Send ACK immediately: "ACK: Starting work on X"
2. Send progress updates as needed
3. Send DONE when complete: "DONE: Completed X with result Y"

Example:
\`\`\`
# When receiving a task
relay_send(to="Lead", message="ACK: Starting test suite run")

# ... do work ...

relay_send(to="Lead", message="DONE: All 42 tests passed")
\`\`\`

## Best Practices

### For Lead Agents
- Spawn workers for parallelizable tasks
- Keep track of spawned workers
- Release workers when done
- Use channels for team announcements

### For Worker Agents
- ACK immediately when receiving tasks
- Send progress updates for long tasks
- Send DONE with results when complete
- Ask clarifying questions if needed

### Message Etiquette
- Keep messages concise
- Include relevant context
- Use threads for related messages
- Don't spam broadcasts

## Checking Messages

Proactively check your inbox:
\`\`\`
relay_inbox()
relay_inbox(from="Lead")
relay_inbox(channel="#urgent")
\`\`\`

## Seeing Who's Online

\`\`\`
relay_who()
\`\`\`

## Error Handling

If relay returns an error:
- "Daemon not running" - The relay daemon needs to be started
- "Agent not found" - Target agent is offline
- "Channel not found" - Channel doesn't exist
- "Timeout" - No response within timeout period

## Multi-Project Communication

In multi-project setups, specify project:
\`\`\`
relay_send(to="frontend:Designer", message="Need UI mockup")
\`\`\`

Special targets:
- \`project:lead\` - Lead agent of that project
- \`project:*\` - Broadcast to project
- \`*:*\` - Broadcast to all projects
`;

export function getProtocolPrompt(): string {
  return PROTOCOL_DOCUMENTATION;
}
```

---

## MCP Resources

### relay://agents

Live list of online agents.

```typescript
// src/resources/agents.ts
import type { Resource } from '@modelcontextprotocol/sdk/types.js';

export const agentsResource: Resource = {
  uri: 'relay://agents',
  name: 'Online Agents',
  description: 'Live list of agents currently connected to relay',
  mimeType: 'application/json',
};

export async function getAgentsResource(client: RelayClient): Promise<string> {
  const agents = await client.listAgents({ include_idle: true });
  return JSON.stringify(agents, null, 2);
}
```

### relay://inbox

Current inbox contents.

```typescript
// src/resources/inbox.ts
import type { Resource } from '@modelcontextprotocol/sdk/types.js';

export const inboxResource: Resource = {
  uri: 'relay://inbox',
  name: 'Message Inbox',
  description: 'Your pending messages',
  mimeType: 'application/json',
};

export async function getInboxResource(client: RelayClient): Promise<string> {
  const messages = await client.getInbox({ unread_only: true, limit: 50 });
  return JSON.stringify(messages, null, 2);
}
```

### relay://project

Current project configuration.

```typescript
// src/resources/project.ts
import type { Resource } from '@modelcontextprotocol/sdk/types.js';

export const projectResource: Resource = {
  uri: 'relay://project',
  name: 'Project Info',
  description: 'Current relay project configuration',
  mimeType: 'application/json',
};

export async function getProjectResource(client: RelayClient): Promise<string> {
  const status = await client.getStatus();
  return JSON.stringify({
    project: status.project,
    socketPath: status.socketPath,
    daemonVersion: status.daemonVersion,
  }, null, 2);
}
```

---

## Socket Discovery

The MCP server must find the relay daemon socket. Priority order:

```typescript
// src/discover.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface DiscoveryResult {
  socketPath: string;
  project: string;
  source: 'env' | 'cwd' | 'scan';
}

/**
 * Discover relay daemon socket.
 *
 * Priority:
 * 1. RELAY_SOCKET environment variable (explicit path)
 * 2. RELAY_PROJECT environment variable (project name → data dir)
 * 3. Current working directory .relay/config.json
 * 4. Scan data directory for active sockets
 */
export function discoverSocket(): DiscoveryResult | null {
  // 1. Explicit socket path
  const socketEnv = process.env.RELAY_SOCKET;
  if (socketEnv && existsSync(socketEnv)) {
    return {
      socketPath: socketEnv,
      project: process.env.RELAY_PROJECT || 'unknown',
      source: 'env',
    };
  }

  // 2. Project name → data dir lookup
  const projectEnv = process.env.RELAY_PROJECT;
  if (projectEnv) {
    const dataDir = getDataDir();
    const projectSocket = join(dataDir, 'projects', projectEnv, 'daemon.sock');
    if (existsSync(projectSocket)) {
      return {
        socketPath: projectSocket,
        project: projectEnv,
        source: 'env',
      };
    }
  }

  // 3. Current working directory config
  const cwdConfig = join(process.cwd(), '.relay', 'config.json');
  if (existsSync(cwdConfig)) {
    try {
      const config = JSON.parse(readFileSync(cwdConfig, 'utf-8'));
      if (config.socketPath && existsSync(config.socketPath)) {
        return {
          socketPath: config.socketPath,
          project: config.project || 'local',
          source: 'cwd',
        };
      }
    } catch {
      // Invalid config, continue
    }
  }

  // 4. Scan data directory for active sockets
  const dataDir = getDataDir();
  const projectsDir = join(dataDir, 'projects');

  if (existsSync(projectsDir)) {
    const projects = readdirSync(projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const project of projects) {
      const socketPath = join(projectsDir, project, 'daemon.sock');
      if (existsSync(socketPath)) {
        return {
          socketPath,
          project,
          source: 'scan',
        };
      }
    }
  }

  return null;
}

function getDataDir(): string {
  // Platform-specific data directory
  const platform = process.platform;

  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'agent-relay');
  } else if (platform === 'win32') {
    return join(process.env.APPDATA || homedir(), 'agent-relay');
  } else {
    return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'agent-relay');
  }
}
```

---

## Relay Client

Connection to the daemon:

```typescript
// src/client.ts
import { connect, type Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import { FrameParser, encodeFrame } from '@agent-relay/protocol/framing';
import type { Envelope } from '@agent-relay/protocol/types';
import { discoverSocket, type DiscoveryResult } from './discover.js';
import { RelayError, DaemonNotRunningError } from './errors.js';

export interface RelayClientOptions {
  agentName?: string;
  autoConnect?: boolean;
}

export class RelayClient extends EventEmitter {
  private socket: Socket | null = null;
  private parser: FrameParser;
  private discovery: DiscoveryResult | null = null;
  private agentName: string;
  private connected = false;
  private messageHandlers = new Map<string, (response: any) => void>();

  constructor(options: RelayClientOptions = {}) {
    super();
    this.parser = new FrameParser();
    this.agentName = options.agentName || `mcp-${process.pid}`;

    if (options.autoConnect !== false) {
      this.connect();
    }
  }

  async connect(): Promise<void> {
    this.discovery = discoverSocket();

    if (!this.discovery) {
      throw new DaemonNotRunningError(
        'Relay daemon not running. Start with: agent-relay daemon start'
      );
    }

    return new Promise((resolve, reject) => {
      this.socket = connect(this.discovery!.socketPath);

      this.socket.on('connect', () => {
        this.connected = true;
        this.handshake();
        resolve();
      });

      this.socket.on('data', (data) => {
        this.parser.push(data);
        let frame;
        while ((frame = this.parser.read())) {
          this.handleFrame(frame);
        }
      });

      this.socket.on('error', (err) => {
        if (!this.connected) {
          reject(new DaemonNotRunningError(
            `Cannot connect to relay daemon: ${err.message}`
          ));
        } else {
          this.emit('error', err);
        }
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.emit('disconnect');
      });
    });
  }

  private handshake(): void {
    this.sendEnvelope({
      v: 1,
      type: 'HELLO',
      id: crypto.randomUUID(),
      ts: Date.now(),
      payload: {
        name: this.agentName,
        capabilities: ['mcp'],
      },
    });
  }

  private handleFrame(envelope: Envelope): void {
    switch (envelope.type) {
      case 'WELCOME':
        this.emit('ready');
        break;
      case 'DELIVER':
        this.emit('message', envelope.payload);
        break;
      case 'ACK':
        const handler = this.messageHandlers.get(envelope.payload.id);
        if (handler) {
          handler(envelope.payload);
          this.messageHandlers.delete(envelope.payload.id);
        }
        break;
      case 'ERROR':
        this.emit('error', new RelayError(envelope.payload.message));
        break;
    }
  }

  private sendEnvelope(envelope: Envelope): void {
    if (!this.socket || !this.connected) {
      throw new RelayError('Not connected to relay daemon');
    }
    this.socket.write(encodeFrame(envelope));
  }

  async send(
    to: string,
    message: string,
    options: { thread?: string } = {}
  ): Promise<void> {
    const id = crypto.randomUUID();

    this.sendEnvelope({
      v: 1,
      type: 'SEND',
      id,
      ts: Date.now(),
      payload: {
        to,
        content: message,
        thread: options.thread,
      },
    });
  }

  async sendAndWait(
    to: string,
    message: string,
    options: { thread?: string; timeoutMs?: number } = {}
  ): Promise<{ from: string; content: string }> {
    const timeoutMs = options.timeoutMs || 30000;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new RelayError(`Timeout waiting for response from ${to}`));
      }, timeoutMs);

      const handler = (msg: any) => {
        if (msg.from === to || msg.thread === options.thread) {
          clearTimeout(timeout);
          this.off('message', handler);
          resolve(msg);
        }
      };

      this.on('message', handler);
      this.send(to, message, options);
    });
  }

  async spawn(options: {
    name: string;
    cli: string;
    task: string;
    model?: string;
    cwd?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const id = crypto.randomUUID();

    this.sendEnvelope({
      v: 1,
      type: 'SPAWN',
      id,
      ts: Date.now(),
      payload: options,
    });

    // Wait for ACK
    return new Promise((resolve) => {
      this.messageHandlers.set(id, (response) => {
        resolve({ success: response.success, error: response.error });
      });
    });
  }

  async release(
    name: string,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> {
    const id = crypto.randomUUID();

    this.sendEnvelope({
      v: 1,
      type: 'RELEASE',
      id,
      ts: Date.now(),
      payload: { name, reason },
    });

    return new Promise((resolve) => {
      this.messageHandlers.set(id, (response) => {
        resolve({ success: response.success, error: response.error });
      });
    });
  }

  async getInbox(options: {
    limit?: number;
    unread_only?: boolean;
    from?: string;
    channel?: string;
  } = {}): Promise<any[]> {
    const id = crypto.randomUUID();

    this.sendEnvelope({
      v: 1,
      type: 'INBOX',
      id,
      ts: Date.now(),
      payload: options,
    });

    return new Promise((resolve) => {
      this.messageHandlers.set(id, (response) => {
        resolve(response.messages || []);
      });
    });
  }

  async listAgents(options: {
    include_idle?: boolean;
    project?: string;
  } = {}): Promise<any[]> {
    const id = crypto.randomUUID();

    this.sendEnvelope({
      v: 1,
      type: 'WHO',
      id,
      ts: Date.now(),
      payload: options,
    });

    return new Promise((resolve) => {
      this.messageHandlers.set(id, (response) => {
        resolve(response.agents || []);
      });
    });
  }

  async getStatus(): Promise<{
    connected: boolean;
    agentName: string;
    project: string;
    socketPath: string;
    daemonVersion?: string;
    uptime?: string;
  }> {
    return {
      connected: this.connected,
      agentName: this.agentName,
      project: this.discovery?.project || 'unknown',
      socketPath: this.discovery?.socketPath || 'unknown',
      daemonVersion: '0.1.0', // TODO: Get from daemon
    };
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    this.connected = false;
  }
}
```

---

## Error Handling

```typescript
// src/errors.ts

export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayError';
  }
}

export class DaemonNotRunningError extends RelayError {
  constructor(message?: string) {
    super(message || 'Relay daemon is not running. Start with: agent-relay daemon start');
    this.name = 'DaemonNotRunningError';
  }
}

export class AgentNotFoundError extends RelayError {
  constructor(agentName: string) {
    super(`Agent not found: ${agentName}`);
    this.name = 'AgentNotFoundError';
  }
}

export class TimeoutError extends RelayError {
  constructor(operation: string, timeoutMs: number) {
    super(`Timeout after ${timeoutMs}ms: ${operation}`);
    this.name = 'TimeoutError';
  }
}

export class ConnectionError extends RelayError {
  constructor(message: string) {
    super(`Connection error: ${message}`);
    this.name = 'ConnectionError';
  }
}
```

---

## MCP Server Entry Point

```typescript
// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { RelayClient } from './client.js';
import { DaemonNotRunningError } from './errors.js';

// Tools
import {
  relaySendTool,
  handleRelaySend,
  relaySpawnTool,
  handleRelaySpawn,
  relayReleaseTool,
  handleRelayRelease,
  relayInboxTool,
  handleRelayInbox,
  relayWhoTool,
  handleRelayWho,
  relayStatusTool,
  handleRelayStatus,
} from './tools/index.js';

// Prompts
import { protocolPrompt, getProtocolPrompt } from './prompts/protocol.js';

// Resources
import {
  agentsResource,
  getAgentsResource,
  inboxResource,
  getInboxResource,
  projectResource,
  getProjectResource,
} from './resources/index.js';

const TOOLS = [
  relaySendTool,
  relaySpawnTool,
  relayReleaseTool,
  relayInboxTool,
  relayWhoTool,
  relayStatusTool,
];

const PROMPTS = [protocolPrompt];

const RESOURCES = [agentsResource, inboxResource, projectResource];

export async function createServer(): Promise<Server> {
  // Connect to relay daemon
  let client: RelayClient;
  try {
    client = new RelayClient();
    await client.connect();
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      console.error('ERROR: ' + err.message);
      console.error('');
      console.error('To start the daemon:');
      console.error('  agent-relay daemon start');
      console.error('');
      console.error('Or for cloud workspaces, ensure the daemon is running.');
      process.exit(1);
    }
    throw err;
  }

  const server = new Server(
    {
      name: 'agent-relay-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'relay_send':
          return { content: [{ type: 'text', text: await handleRelaySend(client, args) }] };
        case 'relay_spawn':
          return { content: [{ type: 'text', text: await handleRelaySpawn(client, args) }] };
        case 'relay_release':
          return { content: [{ type: 'text', text: await handleRelayRelease(client, args) }] };
        case 'relay_inbox':
          return { content: [{ type: 'text', text: await handleRelayInbox(client, args) }] };
        case 'relay_who':
          return { content: [{ type: 'text', text: await handleRelayWho(client, args) }] };
        case 'relay_status':
          return { content: [{ type: 'text', text: await handleRelayStatus(client, args) }] };
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  // List prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS,
  }));

  // Get prompt
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;

    if (name === 'relay_protocol') {
      return {
        description: 'Agent Relay protocol documentation',
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: getProtocolPrompt() },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  // List resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES,
  }));

  // Read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    switch (uri) {
      case 'relay://agents':
        return {
          contents: [{ uri, mimeType: 'application/json', text: await getAgentsResource(client) }],
        };
      case 'relay://inbox':
        return {
          contents: [{ uri, mimeType: 'application/json', text: await getInboxResource(client) }],
        };
      case 'relay://project':
        return {
          contents: [{ uri, mimeType: 'application/json', text: await getProjectResource(client) }],
        };
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });

  return server;
}

// Main entry point
async function main() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

---

## CLI Binary

```typescript
// src/bin.ts
#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runInstall } from './install-cli.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    editor: { type: 'string', short: 'e' },
    global: { type: 'boolean', short: 'g' },
  },
});

const command = positionals[0];

if (values.help || !command) {
  console.log(`
@agent-relay/mcp - MCP Server for Agent Relay

Usage:
  npx @agent-relay/mcp <command> [options]

Commands:
  install     Install MCP server for your editor
  serve       Run the MCP server (used by editors)

Install Options:
  -e, --editor <name>   Editor to configure (claude, cursor, vscode, auto)
  -g, --global          Install globally (not project-specific)

Examples:
  npx @agent-relay/mcp install                    # Auto-detect editor
  npx @agent-relay/mcp install --editor claude    # Claude Code only
  npx @agent-relay/mcp install --editor cursor    # Cursor only
  npx @agent-relay/mcp serve                      # Run server (for editors)
`);
  process.exit(0);
}

if (values.version) {
  console.log('0.1.0');
  process.exit(0);
}

switch (command) {
  case 'install':
    runInstall({
      editor: values.editor as string | undefined,
      global: values.global as boolean | undefined,
    });
    break;

  case 'serve':
    // Import and run the server
    import('./index.js');
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run with --help for usage');
    process.exit(1);
}
```

---

## Installation System

```typescript
// src/install-cli.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface InstallOptions {
  editor?: string;
  global?: boolean;
}

interface EditorConfig {
  name: string;
  configPath: string;
  configKey: string;
  format: 'json' | 'jsonc';
}

const EDITORS: Record<string, EditorConfig> = {
  claude: {
    name: 'Claude Code',
    configPath: join(homedir(), '.claude', 'settings.json'),
    configKey: 'mcpServers',
    format: 'json',
  },
  cursor: {
    name: 'Cursor',
    configPath: join(homedir(), '.cursor', 'mcp.json'),
    configKey: 'mcpServers',
    format: 'json',
  },
  vscode: {
    name: 'VS Code',
    configPath: join(homedir(), '.vscode', 'mcp.json'),
    configKey: 'mcpServers',
    format: 'jsonc',
  },
};

const MCP_SERVER_CONFIG = {
  command: 'npx',
  args: ['@agent-relay/mcp', 'serve'],
};

export function runInstall(options: InstallOptions): void {
  const editors = options.editor
    ? [options.editor]
    : detectInstalledEditors();

  if (editors.length === 0) {
    console.log('No supported editors detected.');
    console.log('Supported editors: claude, cursor, vscode');
    console.log('');
    console.log('Specify manually with: npx @agent-relay/mcp install --editor <name>');
    process.exit(1);
  }

  console.log('Installing Agent Relay MCP server...');
  console.log('');

  for (const editorKey of editors) {
    const editor = EDITORS[editorKey];
    if (!editor) {
      console.log(`Unknown editor: ${editorKey}`);
      continue;
    }

    try {
      installForEditor(editor, options.global);
      console.log(`  ✓ ${editor.name} configured`);
    } catch (err) {
      console.log(`  ✗ ${editor.name}: ${err.message}`);
    }
  }

  console.log('');
  console.log('Installation complete!');
  console.log('');
  console.log('The relay tools will be available when you start your editor.');
  console.log('Make sure the relay daemon is running: agent-relay daemon start');
}

function detectInstalledEditors(): string[] {
  const detected: string[] = [];

  for (const [key, editor] of Object.entries(EDITORS)) {
    // Check if config directory exists
    const configDir = join(editor.configPath, '..');
    if (existsSync(configDir)) {
      detected.push(key);
    }
  }

  return detected;
}

function installForEditor(editor: EditorConfig, global?: boolean): void {
  // Ensure directory exists
  const configDir = join(editor.configPath, '..');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Read existing config or create new
  let config: Record<string, any> = {};
  if (existsSync(editor.configPath)) {
    const content = readFileSync(editor.configPath, 'utf-8');
    // Handle JSONC (comments) by stripping them
    const jsonContent = editor.format === 'jsonc'
      ? content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      : content;
    try {
      config = JSON.parse(jsonContent);
    } catch {
      // Start fresh if invalid
      config = {};
    }
  }

  // Add MCP server config
  if (!config[editor.configKey]) {
    config[editor.configKey] = {};
  }

  config[editor.configKey]['agent-relay'] = MCP_SERVER_CONFIG;

  // Write config
  writeFileSync(editor.configPath, JSON.stringify(config, null, 2));
}
```

---

## Cloud Dockerfile Integration

Add to `deploy/workspace/Dockerfile`:

```dockerfile
# === MCP Server for Agent Relay ===
# Pre-install the MCP server so all CLIs have relay tools available

# Install the MCP package globally
RUN npm install -g @agent-relay/mcp

# Configure for Claude Code (workspace user)
RUN mkdir -p /home/workspace/.claude && \
    echo '{"mcpServers":{"agent-relay":{"command":"npx","args":["@agent-relay/mcp","serve"]}}}' \
    > /home/workspace/.claude/settings.json && \
    chown -R workspace:workspace /home/workspace/.claude

# Configure for Cursor
RUN mkdir -p /home/workspace/.cursor && \
    echo '{"mcpServers":{"agent-relay":{"command":"npx","args":["@agent-relay/mcp","serve"]}}}' \
    > /home/workspace/.cursor/mcp.json && \
    chown -R workspace:workspace /home/workspace/.cursor

# Set environment for socket discovery
ENV RELAY_PROJECT=${WORKSPACE_NAME:-default}
```

---

## CLI Integration

Add to main `agent-relay` CLI in `packages/cli/src/commands/mcp.ts`:

```typescript
// packages/cli/src/commands/mcp.ts
import { Command } from 'commander';

export const mcpCommand = new Command('mcp')
  .description('MCP server management')
  .addCommand(
    new Command('install')
      .description('Install MCP server for editors')
      .option('-e, --editor <name>', 'Editor to configure')
      .option('-g, --global', 'Install globally')
      .action(async (options) => {
        // Dynamic import to avoid bundling mcp package
        const { runInstall } = await import('@agent-relay/mcp/install');
        runInstall(options);
      })
  )
  .addCommand(
    new Command('serve')
      .description('Run MCP server')
      .action(async () => {
        await import('@agent-relay/mcp');
      })
  );
```

Add to `agent-relay setup` command:

```typescript
// In setup command
async function setupWorkspace(): Promise<void> {
  // ... existing setup ...

  // Offer MCP installation
  const { installMcp } = await prompt({
    type: 'confirm',
    name: 'installMcp',
    message: 'Install MCP server for AI editors? (Claude Code, Cursor)',
    default: true,
  });

  if (installMcp) {
    const { runInstall } = await import('@agent-relay/mcp/install');
    runInstall({ editor: 'auto' });
  }
}
```

---

## Testing

### Unit Tests

```typescript
// tests/tools.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRelaySend, handleRelaySpawn, handleRelayWho } from '../src/tools/index.js';

describe('relay_send', () => {
  const mockClient = {
    send: vi.fn(),
    sendAndWait: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends direct message', async () => {
    mockClient.send.mockResolvedValue(undefined);

    const result = await handleRelaySend(mockClient, {
      to: 'Alice',
      message: 'Hello',
    });

    expect(result).toBe('Message sent to Alice');
    expect(mockClient.send).toHaveBeenCalledWith('Alice', 'Hello', {});
  });

  it('sends to channel', async () => {
    mockClient.send.mockResolvedValue(undefined);

    const result = await handleRelaySend(mockClient, {
      to: '#general',
      message: 'Team update',
    });

    expect(result).toBe('Message sent to #general');
  });

  it('awaits response when requested', async () => {
    mockClient.sendAndWait.mockResolvedValue({
      from: 'Worker',
      content: 'Done!',
    });

    const result = await handleRelaySend(mockClient, {
      to: 'Worker',
      message: 'Process this',
      await_response: true,
    });

    expect(result).toBe('Response from Worker: Done!');
  });
});

describe('relay_spawn', () => {
  const mockClient = {
    spawn: vi.fn(),
  };

  it('spawns worker successfully', async () => {
    mockClient.spawn.mockResolvedValue({ success: true });

    const result = await handleRelaySpawn(mockClient, {
      name: 'TestRunner',
      cli: 'claude',
      task: 'Run tests',
    });

    expect(result).toContain('spawned successfully');
  });

  it('handles spawn failure', async () => {
    mockClient.spawn.mockResolvedValue({ success: false, error: 'Out of resources' });

    const result = await handleRelaySpawn(mockClient, {
      name: 'TestRunner',
      cli: 'claude',
      task: 'Run tests',
    });

    expect(result).toContain('Failed to spawn');
    expect(result).toContain('Out of resources');
  });
});
```

### Discovery Tests

```typescript
// tests/discover.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverSocket } from '../src/discover.js';
import { existsSync } from 'node:fs';

vi.mock('node:fs');

describe('discoverSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RELAY_SOCKET;
    delete process.env.RELAY_PROJECT;
  });

  it('uses RELAY_SOCKET env var first', () => {
    process.env.RELAY_SOCKET = '/tmp/test.sock';
    vi.mocked(existsSync).mockReturnValue(true);

    const result = discoverSocket();

    expect(result?.socketPath).toBe('/tmp/test.sock');
    expect(result?.source).toBe('env');
  });

  it('uses RELAY_PROJECT env var second', () => {
    process.env.RELAY_PROJECT = 'myproject';
    vi.mocked(existsSync).mockImplementation((path) => {
      return String(path).includes('myproject');
    });

    const result = discoverSocket();

    expect(result?.project).toBe('myproject');
    expect(result?.source).toBe('env');
  });

  it('returns null when no socket found', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = discoverSocket();

    expect(result).toBeNull();
  });
});
```

### Integration Tests

```typescript
// tests/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/index.js';
import { spawn } from 'node:child_process';

describe('MCP Server Integration', () => {
  let daemonProcess: any;

  beforeAll(async () => {
    // Start a test daemon
    daemonProcess = spawn('agent-relay', ['daemon', 'start', '--test']);
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(() => {
    daemonProcess?.kill();
  });

  it('connects to daemon and lists tools', async () => {
    const server = await createServer();
    // Test would interact with server here
  });
});
```

---

## Implementation Order

### Phase 1: Core Infrastructure
1. Create package structure (`packages/mcp/`)
2. Implement socket discovery (`discover.ts`)
3. Implement relay client (`client.ts`)
4. Implement error types (`errors.ts`)

### Phase 2: MCP Tools
1. Implement `relay_send` tool
2. Implement `relay_inbox` tool
3. Implement `relay_who` tool
4. Implement `relay_status` tool
5. Implement `relay_spawn` tool
6. Implement `relay_release` tool

### Phase 3: MCP Server
1. Implement MCP server entry point (`index.ts`)
2. Add protocol prompt (`prompts/protocol.ts`)
3. Add resources (`resources/*.ts`)
4. Implement CLI binary (`bin.ts`)

### Phase 4: Installation
1. Implement editor installation (`install.ts`, `install-cli.ts`)
2. Add to main CLI (`agent-relay mcp install`)
3. Add to setup command

### Phase 5: Cloud Integration
1. Update workspace Dockerfile
2. Add environment variables
3. Test with all CLI tools (Claude, Codex, Gemini, Droid, OpenCode)

---

## Success Criteria

1. **Local Install**: `npx @agent-relay/mcp install` works and configures Claude Code
2. **Cloud Install**: Workspaces have MCP pre-configured for all CLI tools
3. **All Tools Work**: All 6 tools function correctly
4. **Protocol Doc**: Full protocol documentation available via prompts
5. **Error Messages**: Clear errors when daemon not running
6. **Multi-Project**: Socket discovery works across projects

---

## Dependencies

- `@modelcontextprotocol/sdk` - MCP SDK
- `@agent-relay/protocol` - Protocol types and framing
- `zod` - Schema validation (already in protocol)

No new external dependencies required beyond MCP SDK.
