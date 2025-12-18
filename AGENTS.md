# Agent Instructions for agent-relay

> **Copy this file to your project** to enable AI agents to communicate with each other using agent-relay.

## Overview

This project uses [agent-relay](https://github.com/khaliqgant/agent-relay) for real-time agent-to-agent messaging. There are two communication modes:

1. **PTY Wrapper Mode** - Real-time messaging via Unix sockets (sub-5ms latency)
2. **File-Based Inbox Mode** - Asynchronous messaging via file system (simpler, more reliable)

---

## IMPORTANT: Team Communication (Current Session)

If you have an INSTRUCTIONS.md file in `/tmp/agent-relay-team/{YourName}/`, use these commands:

```bash
# Check your inbox (non-blocking)
node /Users/khaliqgant/Projects/prpm/agent-relay/dist/cli/index.js team-check -n YourName -d /tmp/agent-relay-team --no-wait

# Send message to teammate
node /Users/khaliqgant/Projects/prpm/agent-relay/dist/cli/index.js team-send -n YourName -t RecipientName -m "Your message" -d /tmp/agent-relay-team

# Broadcast to all
node /Users/khaliqgant/Projects/prpm/agent-relay/dist/cli/index.js team-send -n YourName -t "*" -m "Your message" -d /tmp/agent-relay-team

# Team status
node /Users/khaliqgant/Projects/prpm/agent-relay/dist/cli/index.js team-status -d /tmp/agent-relay-team
```

**Check your inbox periodically and broadcast status updates!**

---

## Quick Reference

### Sending Messages

**Inline format** (simple messages):
```
@relay:AgentName Your message here
@relay:* Broadcast to all agents
```

**Block format** (structured data):
```
[[RELAY]]{"to":"AgentName","type":"message","body":"Your message"}[[/RELAY]]
```

### Receiving Messages

Messages appear in your terminal as:
```
[relay <- SenderName] Message content here
```

Or in your inbox file as:
```markdown
## Message from SenderName | 2024-01-15T10:30:00Z
Message content here
```

---

## Mode 1: PTY Wrapper (Real-Time)

Use this when you're wrapped with `agent-relay wrap`.

### Sending

Simply output these patterns and they'll be intercepted and sent:

```
@relay:BlueLake I've finished the API refactor. Ready for your review.
@relay:* Starting work on the authentication module.
```

For structured data:
```
[[RELAY]]
{"to": "BlueLake", "type": "action", "body": "Task completed", "data": {"files": ["auth.ts"]}}
[[/RELAY]]
```

### Receiving

Messages from other agents appear inline:
```
[relay <- BlueLake] Looks good! I'll start on the database migrations.
```

### Escaping

To output literal `@relay:` without triggering the parser:
```
\@relay: This won't be sent as a message
```

---

## Mode 2: File-Based Inbox (Asynchronous)

Use this for scripts, automation, or when PTY wrapping isn't available.

### Setup

Your inbox is at: `{DATA_DIR}/{YourAgentName}/inbox.md`

Default data directory: `/tmp/agent-relay`

### Sending Messages

```bash
# Send to one agent
agent-relay inbox-write -t RecipientName -f YourName -m "Your message" -d /tmp/agent-relay

# Send to multiple agents
agent-relay inbox-write -t "Agent1,Agent2" -f YourName -m "Your message" -d /tmp/agent-relay

# Broadcast to all agents
agent-relay inbox-write -t "*" -f YourName -m "Broadcast message" -d /tmp/agent-relay
```

### Reading Messages

```bash
# Read inbox (non-blocking)
agent-relay inbox-read -n YourName -d /tmp/agent-relay

# Read and clear inbox
agent-relay inbox-read -n YourName -d /tmp/agent-relay --clear

# Wait for messages (blocking) - useful for agent loops
agent-relay inbox-poll -n YourName -d /tmp/agent-relay --clear

# Wait with timeout (30 seconds)
agent-relay inbox-poll -n YourName -d /tmp/agent-relay -t 30 --clear
```

### Listing Agents

```bash
agent-relay inbox-agents -d /tmp/agent-relay
```

### Message Format in Inbox

Messages in your inbox file look like:
```markdown
## Message from SenderName | 2024-01-15T10:30:00Z
The actual message content here.

## Message from AnotherAgent | 2024-01-15T10:31:00Z
Another message.
```

---

## Message Types

| Type | Use Case |
|------|----------|
| `message` | General communication (default) |
| `action` | Commands, task assignments |
| `state` | Status updates, progress reports |
| `thinking` | Share reasoning (for transparency) |

---

## Coordination Patterns

### Task Handoff

```
@relay:Developer TASK: Implement user registration endpoint
Requirements:
- POST /api/register
- Validate email format
- Hash password with bcrypt
- Return JWT token
```

### Status Updates

```
@relay:* STATUS: Starting work on authentication module
@relay:* DONE: Authentication module complete, ready for review
@relay:Reviewer REVIEW: Please review src/auth/*.ts
```

### Requesting Help

```
@relay:Architect QUESTION: Should we use JWT or session-based auth?
@relay:* BLOCKED: Need database credentials to proceed
```

### Code Review Flow

```
# Developer requests review
@relay:Reviewer REVIEW: src/api/users.ts - Added pagination support

# Reviewer provides feedback
@relay:Developer FEEDBACK: Line 45 - Consider using cursor-based pagination for better performance

# Developer confirms fix
@relay:Reviewer FIXED: Updated to cursor-based pagination, please re-review
```

---

## Agent Naming

Agent names follow the AdjectiveNoun format:
- `BlueLake`, `GreenCastle`, `RedMountain`, `SwiftFalcon`

Names are auto-generated if not specified, or you can set your own with `-n`:
```bash
agent-relay wrap -n MyCustomName "claude"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Messages not sending | Check daemon: `agent-relay status` |
| Inbox empty | Verify agent name and data directory |
| Socket not found | Start daemon: `agent-relay start -f` |
| Permission denied | Check data directory permissions |

### Check Daemon Status
```bash
agent-relay status
```

### Restart Daemon
```bash
agent-relay stop && agent-relay start -f
```

---

## Example: Agent Communication Loop

```bash
# Check for messages, process them, then respond
while true; do
  # Wait for a message
  MSG=$(agent-relay inbox-poll -n MyAgent -d /tmp/relay --clear -t 60)

  if [ -n "$MSG" ]; then
    # Process message and respond
    agent-relay inbox-write -t SenderAgent -f MyAgent -m "Acknowledged: $MSG" -d /tmp/relay
  fi
done
```

---

## More Information

- [Full Documentation](https://github.com/khaliqgant/agent-relay)
- [Protocol Specification](https://github.com/khaliqgant/agent-relay/blob/main/PROTOCOL.md)
- [Examples](https://github.com/khaliqgant/agent-relay/tree/main/examples)
