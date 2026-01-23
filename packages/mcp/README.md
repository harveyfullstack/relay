# @agent-relay/mcp

MCP (Model Context Protocol) server for Agent Relay - gives AI agents native tools for inter-agent communication.

## Quick Start

The fastest way to get started with Agent Relay and MCP:

```bash
# Install Agent Relay globally
npm install -g agent-relay

# Run the setup wizard
agent-relay init
```

The wizard will:
1. Configure MCP for your AI editors (Claude Code, Cursor)
2. Offer to start the daemon
3. Show you how to use the relay tools

## Manual Installation

### Install MCP for Editors

```bash
# Auto-detect and configure all supported editors
npx @agent-relay/mcp install

# Or configure specific editors
npx @agent-relay/mcp install --editor claude    # Claude Code
npx @agent-relay/mcp install --editor cursor    # Cursor
npx @agent-relay/mcp install --editor vscode    # VS Code
npx @agent-relay/mcp install --editor windsurf  # Windsurf
```

### Start the Daemon

```bash
# Start with dashboard
agent-relay up

# Or just the daemon
agent-relay up --no-dashboard
```

### Verify It Works

Open Claude Code (or Cursor) and ask:
> "Use relay_who to see online agents"

You should see yourself listed!

## Available Tools

Once configured, AI agents have access to these tools:

### `relay_send` - Send Messages
```
relay_send(to="Alice", message="Hello!")           # Direct message
relay_send(to="#general", message="Team update")   # Channel message
relay_send(to="*", message="Announcement")         # Broadcast
relay_send(to="Worker", message="Do this", await_response=true)  # Wait for reply
```

### `relay_inbox` - Check Messages
```
relay_inbox()                        # Get unread messages
relay_inbox(from="Lead", limit=5)    # Filter by sender
relay_inbox(channel="#general")       # Filter by channel
```

### `relay_who` - List Agents
```
relay_who()                          # List all online agents
relay_who(include_idle=false)        # Only active agents
```

### `relay_spawn` - Create Workers
```
relay_spawn(name="TestRunner", cli="claude", task="Run the test suite")
relay_spawn(name="Reviewer", cli="codex", task="Review this PR", model="gpt-4")
```

### `relay_release` - Stop Workers
```
relay_release(name="TestRunner")
relay_release(name="TestRunner", reason="Tests completed")
```

### `relay_status` - Connection Info
```
relay_status()   # Shows: connected, agent name, project, daemon version
```

## Troubleshooting

### "Daemon not running" error

The relay daemon must be running for MCP tools to work:

```bash
# Check status
agent-relay status

# Start daemon
agent-relay up
```

### Tools not showing in editor

1. Restart your editor after installing MCP
2. Check the MCP configuration was created:
   - Claude Code: `~/.claude/settings.json`
   - Cursor: `~/.cursor/mcp.json`

### Check installation status

```bash
npx @agent-relay/mcp install --status
```

## CLI Reference

```bash
# Installation
npx @agent-relay/mcp install              # Auto-detect editors
npx @agent-relay/mcp install --editor X   # Specific editor
npx @agent-relay/mcp install --status     # Show status
npx @agent-relay/mcp install --list       # List supported editors
npx @agent-relay/mcp install --uninstall  # Remove configuration
npx @agent-relay/mcp install --dry-run    # Preview changes

# Server (used by editors)
npx @agent-relay/mcp serve
```

## Resources & Prompts

The MCP server provides:

**Resources** (live data):
- `relay://agents` - Online agents list
- `relay://inbox` - Your inbox contents
- `relay://project` - Project configuration

**Prompts** (documentation):
- `relay_protocol` - Full protocol documentation

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RELAY_SOCKET` | Override daemon socket path |
| `RELAY_PROJECT` | Override project name |
| `RELAY_AGENT_NAME` | Override agent name |
| `DEBUG` or `RELAY_DEBUG` | Enable debug logging |

## Cloud Workspaces

In cloud environments (with `WORKSPACE_ID` set), MCP is pre-configured and uses workspace-specific sockets automatically.

## Programmatic Usage (For Libraries & Integrations)

The MCP package provides a simple programmatic API that's perfect for building agent orchestration libraries like AgentSwarm.

### Simple Tools API (Recommended)

```typescript
import { createTools } from '@agent-relay/mcp';

// Create tools for your orchestrator agent
const tools = createTools('Conductor');

// Send messages to agents
await tools.send('Worker1', 'Run the test suite');
await tools.send('#team', 'Starting task coordination');  // Channel
await tools.send('*', 'System announcement');              // Broadcast

// Spawn worker agents
const result = await tools.spawn({
  name: 'TestRunner',
  cli: 'claude',           // 'claude' | 'codex' | 'gemini' | 'opencode'
  task: 'Run all tests and report failures',
  cwd: '/path/to/project', // Optional working directory
});

if (!result.success) {
  console.error('Spawn failed:', result.error);
}

// Check your inbox
const messages = await tools.inbox();
for (const msg of messages) {
  console.log(`From ${msg.from}: ${msg.content}`);
  if (msg.channel) console.log(`  (in ${msg.channel})`);
}

// List online agents
const agents = await tools.who();
console.log('Online agents:', agents.map(a => a.name));

// Release workers when done
await tools.release('TestRunner', 'Tests complete');

// Get connection status
const status = await tools.status();
console.log(`Connected: ${status.connected}, Project: ${status.project}`);
```

### Full Integration Example

```typescript
import { createTools, type RelayTools, type Message, type Agent } from '@agent-relay/mcp';

class AgentOrchestrator {
  private tools: RelayTools;
  private workers: Map<string, { task: string; status: string }> = new Map();

  constructor(name: string) {
    this.tools = createTools(name);
  }

  async spawnWorker(name: string, task: string) {
    const result = await this.tools.spawn({
      name,
      cli: 'claude',
      task,
    });

    if (result.success) {
      this.workers.set(name, { task, status: 'running' });
    }
    return result;
  }

  async sendTask(workerName: string, task: string) {
    await this.tools.send(workerName, task);
  }

  async waitForCompletion(workerName: string, timeoutMs = 60000) {
    // Use sendAndWait for synchronous request-response
    const response = await this.tools.sendAndWait(
      workerName,
      'Report your status',
      { timeoutMs }
    );
    return response;
  }

  async getMessages(): Promise<Message[]> {
    return this.tools.inbox();
  }

  async getOnlineAgents(): Promise<Agent[]> {
    return this.tools.who();
  }

  async releaseWorker(name: string) {
    await this.tools.release(name);
    this.workers.delete(name);
  }

  async releaseAll() {
    for (const name of this.workers.keys()) {
      await this.releaseWorker(name);
    }
  }
}

// Usage
const conductor = new AgentOrchestrator('Conductor');

await conductor.spawnWorker('Planner', 'Create implementation plan');
await conductor.spawnWorker('Coder', 'Implement the plan');
await conductor.spawnWorker('Tester', 'Write and run tests');

// Coordinate work...
await conductor.sendTask('Planner', 'Start planning the feature');

// Check for responses
const messages = await conductor.getMessages();

// Clean up
await conductor.releaseAll();
```

### One-liners (For Quick Scripts)

```typescript
import { send, inbox, who } from '@agent-relay/mcp';

// Send a message
await send('MyAgent', 'Bob', 'Hello!');

// Check inbox
const messages = await inbox('MyAgent');

// List agents
const agents = await who();
```

### Socket Discovery

The MCP package auto-discovers the daemon socket:

```typescript
import { discoverSocket, getConnectionInfo } from '@agent-relay/mcp';

// Get socket path and metadata
const discovery = discoverSocket();
if (discovery) {
  console.log(`Socket: ${discovery.socketPath}`);
  console.log(`Project: ${discovery.project}`);
  console.log(`Source: ${discovery.source}`);  // 'env' | 'cloud' | 'cwd' | 'scan'
  console.log(`Cloud: ${discovery.isCloud}`);
}

// Or get full connection info
const info = getConnectionInfo();
```

## Requirements

- Node.js 18+
- Agent Relay daemon running

## License

MIT
