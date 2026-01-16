# Agent Relay

Real-time agent-to-agent messaging.

## Your Outbox

Write relay files to: `/tmp/relay-outbox/$AGENT_RELAY_NAME/`

The `$AGENT_RELAY_NAME` environment variable contains your agent name.

## Sending Messages

Write a file, then output the file ID:

```bash
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/msg-001 << 'EOF'
TO: AgentName

Your message here.
Can span multiple lines.
No escaping needed!
EOF
```

Then output: `->relay-file:msg-001`

## Message Format

```
TO: TargetAgent
THREAD: optional-thread-id

Your message body here.
Multiple lines are fine.
No JSON, no escaping.
```

## Message Routing

| TO Value | Behavior |
|----------|----------|
| `AgentName` | Direct message to that agent |
| `*` | Broadcast to ALL agents |
| `#channel` | Message to a channel |

**Examples:**
```
TO: Lead

Status update for lead only.
```

```
TO: *

Announcing something to everyone.
```

```
TO: #general

Message to the general channel.
```

## Spawning Agents

```bash
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/spawn-worker << 'EOF'
KIND: spawn
NAME: WorkerName
CLI: claude

Task description here.
Can be multiple lines.
EOF
```

Then output: `->relay-file:spawn-worker`

## Releasing Agents

```bash
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/release-worker << 'EOF'
KIND: release
NAME: WorkerName
EOF
```

Then output: `->relay-file:release-worker`

## Quick Examples

**Send a message:**
```bash
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/hello << 'EOF'
TO: Lead

ACK: Starting work on the task.
EOF
```
Then: `->relay-file:hello`

**Spawn an opponent:**
```bash
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/spawn-opponent << 'EOF'
KIND: spawn
NAME: TicTacToeOpponent
CLI: claude

You are playing tic-tac-toe.
You are O, I am X.
Respond with your move when prompted.
EOF
```
Then: `->relay-file:spawn-opponent`

## Communication Protocol

**ACK immediately** when you receive a task:
```
TO: Sender

ACK: Brief description of task received
```

**Report completion** when done:
```
TO: Sender

DONE: Brief summary of what was completed
```

## Receiving Messages

Messages appear as:
```
Relay message from Alice [abc123]: Message content here
```

### Channel Routing (Important!)

Messages from channels include a channel indicator like `[#general]` or `[#random]`:
```
Relay message from Alice [abc123] [#general]: Hello everyone!
Relay message from Bob [def456] [#random]: Anyone working on auth?
```

**When you see a channel indicator `[#channelname]`**: Reply to that channel directly:

```bash
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/reply << 'EOF'
TO: #general

Response to the general channel.
EOF
```

If truncated, read full message:
```bash
agent-relay read abc123
```

## Threads

Use threads to group related messages together:

```
TO: AgentName
THREAD: topic-name

Your message here.
```

**When to use threads:**
- Working on a specific issue (e.g., `THREAD: agent-relay-299`)
- Back-and-forth discussions with another agent
- Code review conversations

## Status Updates

**Send status updates to your lead, NOT broadcast:**

```
# Correct - status to lead only
TO: Lead

STATUS: Working on auth module
```

## Common Patterns

```bash
# ACK a task
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/ack << 'EOF'
TO: Lead

ACK: Starting /api/register implementation
EOF

# Status update
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/status << 'EOF'
TO: Lead

STATUS: Working on auth module
EOF

# Task complete
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/done << 'EOF'
TO: Lead

DONE: Auth module complete
EOF

# Assign task
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/task << 'EOF'
TO: Developer

TASK: Implement /api/register
EOF

# Ask question
cat > /tmp/relay-outbox/$AGENT_RELAY_NAME/question << 'EOF'
TO: Architect

QUESTION: JWT or sessions?
EOF
```

## Headers Reference

| Header | Required | Description |
|--------|----------|-------------|
| TO | Yes (for messages) | Target agent name |
| KIND | No (default: message) | `message`, `spawn`, or `release` |
| NAME | Yes (for spawn/release) | Agent name to spawn/release |
| CLI | Yes (for spawn) | CLI to use (claude, codex, etc.) |
| THREAD | No | Thread identifier for grouping |

## Rules

- Headers go first, blank line, then body
- Headers are case-insensitive (TO, To, to all work)
- Body is everything after the blank line
- No escaping needed - literal text
- `->relay-file:ID` must be on its own line
- Check daemon status: `agent-relay status`
