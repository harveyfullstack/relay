# agent-relay

Real-time agent-to-agent communication system. Enables AI agents (Claude, Codex, Gemini, etc.) running in separate terminals to communicate with sub-millisecond latency.

## Installation

### One-Line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/khaliqgant/agent-relay/main/install.sh | bash
```

This installs to `~/.agent-relay` and adds `agent-relay` to your PATH.

### Install Options

```bash
# Custom install directory
AGENT_RELAY_DIR=/opt/agent-relay curl -fsSL https://...install.sh | bash

# Install and start daemon immediately
AGENT_RELAY_START=true curl -fsSL https://...install.sh | bash

# Quiet mode (for agents/scripts)
AGENT_RELAY_QUIET=true curl -fsSL https://...install.sh | bash
```

### Manual Install

```bash
git clone https://github.com/khaliqgant/agent-relay.git
cd agent-relay
npm install
npm run build
```

### Requirements

- Node.js >= 18 (20+ recommended)
- macOS or Linux (Unix domain sockets)

## Why We Built This

As AI agents become more capable, there's a growing need for them to collaborate in real-time. Imagine multiple agents working together on a codebase, coordinating tasks, or even playing games against each other—all without human intervention.

**The problem:** How do you get agents running in separate terminal sessions to talk to each other seamlessly?

## For Humans: When You’d Use agent-relay

Use agent-relay when you want **fast, local, real-time coordination** between multiple CLI-based agents without adopting a larger framework.

Common scenarios:
- **Multi-terminal agent swarms** where each agent runs in its own terminal and needs to exchange messages quickly.
- **Turn-based / tight-loop coordination** (games, schedulers, orchestrators) where polling latency becomes noticeable.
- **“Wrap anything” workflows** where you don’t control the agent implementation but you can run it as a CLI process.

Tradeoffs to know up front:
- Local IPC only (Unix domain sockets); no cross-host networking.
- Best-effort delivery today (no persistence/guaranteed retries yet).

### Existing Solutions (and why they're great)

We built agent-relay with deep respect for existing solutions that inspired this work:

#### [mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail)
A thoughtful MCP-based agent communication system. Great features like auto-generated agent names (AdjectiveNoun format), file reservations, and Git-backed message persistence. If you're already in the MCP ecosystem, this is an excellent choice.

**Why choose agent-relay over mcp_agent_mail:** When you specifically want **low-latency, real-time, local IPC** and a **PTY wrapper** that can intercept output from *any* CLI agent without requiring MCP integration.

**Why choose mcp_agent_mail instead:** When you want **message persistence/auditability**, **file reservations**, and a workflow already built around MCP-style tooling.

#### [swarm-tools/swarm-mail](https://github.com/joelhooks/swarm-tools/tree/main/packages/swarm-mail)
Part of the swarm-tools ecosystem, providing inter-agent messaging. Well-designed for swarm coordination patterns.

**Why choose agent-relay over swarm-mail:** When you want **push-style delivery** and sub-second responsiveness; file-based polling can be great for robustness, but it’s not ideal for tight coordination loops.

**Why choose swarm-mail instead:** When you prefer **filesystem-backed messaging** (easy inspection, simple operations) and millisecond-level latency isn’t a requirement.

### Our Approach

agent-relay takes a different path:
- **Unix domain sockets** for sub-5ms latency
- **PTY wrapper** that works with any CLI (Claude, Codex, Gemini, etc.)
- **No protocol dependencies** - just wrap your command and go
- **Pattern detection** in terminal output (`@relay:` syntax)
- **Built-in game support** as a proof-of-concept for real-time coordination

## Features

- **Real-time messaging** via Unix domain sockets (<5ms latency)
- **PTY wrapper** for any CLI agent (Claude Code, Codex CLI, Gemini CLI)
- **Auto-generated agent names** (AdjectiveNoun format, like mcp_agent_mail)
- **Best-effort delivery** with per-stream ordering (ACK protocol defined, reliability optional)
- **Topic-based pub/sub** for game coordination and channels
- **Hearts game engine** as proof-of-concept for multi-agent interaction (see `src/games/hearts.ts`)

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Start the daemon
npx agent-relay start -f

# In another terminal, wrap an agent (name auto-generated)
npx agent-relay wrap "claude"
# Output: Agent name: SilverMountain

# In another terminal, wrap another agent
npx agent-relay wrap "codex"
# Output: Agent name: BlueFox

# Or specify a name explicitly
npx agent-relay wrap -n my-agent "claude"
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude Agent   │     │  Codex Agent    │     │  Gemini Agent   │
│  (Terminal 1)   │     │  (Terminal 2)   │     │  (Terminal 3)   │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
    ┌────┴────┐             ┌────┴────┐             ┌────┴────┐
    │ Wrapper │             │ Wrapper │             │ Wrapper │
    └────┬────┘             └────┬────┘             └────┬────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    Unix Domain Socket
                                 │
                    ┌────────────┴────────────┐
                    │     agent-relay daemon   │
                    │   - Message Router       │
                    │   - Topic Subscriptions  │
                    │   - Game Coordinator     │
                    └─────────────────────────┘
```

## Agent Communication Syntax

Agents communicate using two formats embedded in their terminal output:

### Inline Format (single line)
```
@relay:BlueFox Your turn to play the 7 of hearts
@relay:* Broadcasting to all agents
@thinking:* I'm considering playing the Queen...
```

### Block Format (structured JSON)
```
[[RELAY]]
{
  "to": "BlueFox",
  "type": "action",
  "body": "Playing my card",
  "data": { "card": "7♥", "action": "play_card" }
}
[[/RELAY]]
```

### Escaping
To output literal `@relay:` without triggering the parser:
```
\@relay: This won't be parsed as a command
```

## CLI Commands

```bash
# Start the relay daemon (foreground)
npx agent-relay start -f

# Start daemon with custom socket path
npx agent-relay start -s /tmp/my-relay.sock

# Stop the daemon
npx agent-relay stop

# Wrap an agent (name auto-generated)
npx agent-relay wrap "claude"

# Wrap an agent with explicit name
npx agent-relay wrap -n my-agent "claude"

# Check status
npx agent-relay status

# Send a test message
npx agent-relay send -t recipient -m "Hello"
```

## Playing Hearts

> **Note:** The Hearts game engine (`src/games/hearts.ts`) is implemented but not yet wired to the CLI. The code below shows the intended usage pattern once CLI integration is complete.

```bash
# Terminal 1: Start daemon
npx agent-relay start -f

# Terminal 2-5: Start four agent players (names auto-generated)
npx agent-relay wrap "claude"      # -> GoldenEagle
npx agent-relay wrap "codex"       # -> SilverWolf
npx agent-relay wrap "gemini-cli"  # -> CrystalLake
npx agent-relay wrap "claude"      # -> BronzeBear

# Game coordinator integration coming soon
```

Each agent receives game state and prompts:
```json
{
  "kind": "your_turn",
  "hand": ["2♣", "7♥", "K♠", ...],
  "valid_plays": ["2♣"],
  "current_trick": [],
  "hearts_broken": false
}
```

Agents respond with:
```
[[RELAY]]
{"to": "hearts-coordinator", "type": "action", "data": {"action": "play_card", "card": {"suit": "clubs", "rank": "2"}}}
[[/RELAY]]
```

---

# For Agents

> **This section is specifically for AI agents setting up agent-relay autonomously.**

## Autonomous Setup Instructions

If you are an AI agent and need to set up agent-relay for inter-agent communication, follow these steps:

### Quick Setup (One Command)

```bash
# Install and start daemon in one command
AGENT_RELAY_START=true AGENT_RELAY_QUIET=true \
  curl -fsSL https://raw.githubusercontent.com/khaliqgant/agent-relay/main/install.sh | bash
```

The installer outputs machine-readable variables:
```
AGENT_RELAY_STATUS=SUCCESS
AGENT_RELAY_INSTALL_DIR=/home/user/.agent-relay
AGENT_RELAY_BIN_PATH=/home/user/.local/bin/agent-relay
AGENT_RELAY_DAEMON_PID=12345
```

### Manual Setup (Step by Step)

#### 1. Check Prerequisites

```bash
# Verify Node.js >= 18 (>= 20 recommended)
node --version

# Verify npm
npm --version
```

#### 2. Clone and Install

```bash
# If not already in the project directory
cd /path/to/agent-to-agent-communication

# Install dependencies
npm install

# Build the project
npm run build
```

#### 3. Start the Daemon

```bash
# Start in background (recommended for automation)
nohup npx agent-relay start -f > /tmp/agent-relay.log 2>&1 &

# Or start in foreground if you want to monitor
npx agent-relay start -f
```

#### 4. Verify Daemon is Running

```bash
# Check status
npx agent-relay status

# Should output: Status: RUNNING
```

### 5. Connect as an Agent

If you're wrapping another agent (name auto-generated):
```bash
npx agent-relay wrap "claude"
# Your agent name will be displayed, e.g., "Agent name: SwiftFalcon"
```

Or specify your own name:
```bash
npx agent-relay wrap -n MyAgent "claude"
```

If you're connecting programmatically:
```typescript
import { RelayClient, generateAgentName } from 'agent-relay';

// Auto-generate a name
const agentName = generateAgentName(); // e.g., "BraveOtter"

const client = new RelayClient({
  agentName,
  socketPath: '/tmp/agent-relay.sock',
});

await client.connect();

// Send messages
client.sendMessage('other-agent', 'Hello!', 'message');

// Listen for messages
client.onMessage = (from, payload) => {
  console.log(`Message from ${from}: ${payload.body}`);
};
```

## Communication Protocol for Agents

### Sending Messages

Use these patterns in your terminal output:

**Direct message to another agent:**
```
@relay:SwiftFalcon Your message here
```

**Broadcast to all agents:**
```
@relay:* Message for everyone
```

**Structured action (for games/coordination):**
```
[[RELAY]]
{"to": "*", "type": "action", "body": "description", "data": {"key": "value"}}
[[/RELAY]]
```

### Message Types

| Type | Use Case |
|------|----------|
| `message` | General communication |
| `action` | Game moves, commands |
| `state` | State updates, game state |
| `thinking` | Share reasoning (optional) |

### Receiving Messages

Messages from other agents appear in your terminal as:
```
[MSG] from SwiftFalcon: Their message
```

Or for thinking:
```
[THINKING] from SwiftFalcon: Their reasoning
```

## Coordination Patterns

### Turn-Based Games

1. Subscribe to game topic: `client.subscribe('hearts')`
2. Wait for `your_turn` state message
3. Respond with action: `@relay:coordinator {"action": "play_card", ...}`
4. Wait for next state update

### Collaborative Tasks

1. Broadcast availability: `@relay:* Ready to collaborate`
2. Direct message coordinator: `@relay:coordinator Taking task X`
3. Share progress: `@relay:* Completed task X`

### Error Handling

If connection fails:
1. Check daemon is running: `npx agent-relay status`
2. Check socket exists: `ls -la /tmp/agent-relay.sock`
3. Restart daemon if needed: `npx agent-relay stop && npx agent-relay start -f`

## Example: Agent Self-Registration

```typescript
import { RelayClient, generateAgentName } from 'agent-relay';

async function setupAgent() {
  const name = generateAgentName();
  const client = new RelayClient({ agentName: name });

  try {
    await client.connect();
    console.log(`Connected as ${name}`);

    // Announce presence
    client.broadcast(`${name} is online`, 'message');

    // Handle incoming messages
    client.onMessage = (from, payload) => {
      if (payload.body.includes('ping')) {
        client.sendMessage(from, 'pong', 'message');
      }
    };

    return client;
  } catch (err) {
    console.error('Failed to connect:', err);
    throw err;
  }
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Socket not found" | Start daemon: `npx agent-relay start -f` |
| "Connection refused" | Check daemon logs: `cat /tmp/agent-relay.log` |
| Messages not received | Verify agent name matches |
| High latency | Check system load, restart daemon |

## Socket Path

Default: `/tmp/agent-relay.sock`

Custom: Use `-s` flag or `socketPath` config option.

---

## Protocol Specification

See [PROTOCOL.md](./PROTOCOL.md) for the complete wire protocol specification including:
- Frame format (4-byte length prefix + JSON)
- Message types (HELLO, SEND, DELIVER, ACK, etc.)
- Handshake flow
- Reconnection and state sync (spec defined, implementation pending)
- Backpressure handling (spec defined, implementation pending)

**Current implementation status:** The daemon provides best-effort message delivery with per-stream ordering. The protocol supports ACKs, retries, and RESUME/SYNC for reconnection, but these reliability features are optional and not yet fully wired in the current implementation.

## Acknowledgments

This project stands on the shoulders of giants:

- **[mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail)** by Jeff Emanuel - Pioneered many patterns we adopted, including auto-generated AdjectiveNoun names, and demonstrated the power of persistent agent communication.
- **[swarm-tools](https://github.com/joelhooks/swarm-tools)** by Joel Hooks - Showed how swarm coordination patterns can enable powerful multi-agent workflows.

If MCP integration or file-based persistence fits your use case better, we highly recommend checking out these projects.

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

## License

MIT
