---
name: using-agent-relay
description: Use when coordinating multiple AI agents in real-time - provides inter-agent messaging via PTY wrapper or file-based inbox system with sub-5ms latency
---

# Using agent-relay

## Overview

agent-relay enables real-time communication between AI agents running in separate terminals. Two modes: **PTY wrapper** (real-time, sub-5ms) and **file-based inbox** (async, simpler).

## When to Use

**Use agent-relay when:**
- Multiple agents need to coordinate on a shared codebase
- Turn-based interactions (games, code review, task handoff)
- Parallel task distribution across agents
- Real-time collaboration between Claude, Codex, Gemini agents

**Don't use when:**
- Single agent workflow
- Cross-host networking needed (local IPC only)
- Guaranteed message delivery required (best-effort today)

## Quick Reference

### Sending Messages

| Pattern | Description |
|---------|-------------|
| `->relay:AgentName message` | Direct message |
| `->relay:* message` | Broadcast to all |
| `[[RELAY]]{"to":"Name","body":"msg"}[[/RELAY]]` | Structured data |
| `\->relay:` | Escape (no send) |

### Receiving Messages

```
[relay <- SenderName] Message content here
```

### File-Based Inbox Commands

```bash
# Send message
agent-relay inbox-write -t Recipient -f Sender -m "Message" -d /tmp/relay

# Read inbox (non-blocking)
agent-relay inbox-read -n AgentName -d /tmp/relay --clear

# Wait for messages (blocking)
agent-relay inbox-poll -n AgentName -d /tmp/relay --clear

# List agents
agent-relay inbox-agents -d /tmp/relay
```

## Implementation

### Mode 1: PTY Wrapper (Real-Time)

When wrapped with `agent-relay wrap`, simply output messages:

```
->relay:BlueLake I've finished the API refactor. Ready for review.
->relay:* STATUS: Starting work on authentication module.
```

For structured data:
```
[[RELAY]]
{"to": "BlueLake", "type": "action", "body": "Task done", "data": {"files": ["auth.ts"]}}
[[/RELAY]]
```

### Mode 2: File-Based Inbox (Async)

Inbox location: `{DATA_DIR}/{AgentName}/inbox.md`

**Send:**
```bash
agent-relay inbox-write -t RecipientName -f YourName -m "Your message" -d /tmp/agent-relay
agent-relay inbox-write -t "*" -f YourName -m "Broadcast" -d /tmp/agent-relay
```

**Read:**
```bash
# Non-blocking
agent-relay inbox-read -n YourName -d /tmp/agent-relay --clear

# Blocking (for agent loops)
agent-relay inbox-poll -n YourName -d /tmp/agent-relay -t 60 --clear
```

**Inbox message format:**
```markdown
## Message from SenderName | 2024-01-15T10:30:00Z
Message content here
```

## Coordination Patterns

### Task Handoff
```
->relay:Developer TASK: Implement user registration
Requirements:
- POST /api/register
- Validate email, hash password
- Return JWT
```

### Status Updates
```
->relay:* STATUS: Starting auth module
->relay:* DONE: Auth complete, ready for review
->relay:Reviewer REVIEW: Please review src/auth/*.ts
```

### Code Review Flow
```
# Developer requests review
->relay:Reviewer REVIEW: src/api/users.ts - Added pagination

# Reviewer responds
->relay:Developer FEEDBACK: Line 45 - Use cursor-based pagination

# Developer confirms
->relay:Reviewer FIXED: Updated, please re-review
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Messages not sending | Check daemon: `agent-relay status` |
| Inbox empty | Verify agent name and data directory match |
| Socket not found | Start daemon: `agent-relay start -f` |
| Permission denied | Check data directory permissions |
| Forgetting to clear inbox | Use `--clear` flag to avoid re-reading |

## Agent Naming

Names follow AdjectiveNoun format: `BlueLake`, `GreenCastle`, `RedMountain`

Auto-generated if not specified, or set with `-n`:
```bash
agent-relay wrap -n MyAgent "claude"
```

## Troubleshooting

```bash
# Check daemon status
agent-relay status

# Restart daemon
agent-relay stop && agent-relay start -f

# Check socket exists
ls -la /tmp/agent-relay.sock
```
