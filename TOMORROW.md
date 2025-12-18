# Agent Relay - Session Notes

## Goal
Enable real-time, autonomous agent-to-agent communication without MCP, API keys, or user intervention.

## The Core Problem
Claude Code's TUI doesn't reliably accept programmatic Enter via stdin after a few interaction rounds. All stdin injection approaches eventually fail.

---

## Approaches Tried (All Failed for Injection)

### 1. Direct PTY Write
- Write message + `\r` to pty stdin
- **Result**: Works for 2-3 rounds, then Enter stops submitting

### 2. Character-by-Character Typing
- Simulate human typing with 5ms delays between characters
- **Result**: Same issue - fails after a few rounds

### 3. Idle Detection
- Wait for 2 seconds of no output before injecting
- **Result**: Works initially, fails later

### 4. ESC + Ctrl+U Before Injection
- Clear any TUI mode/input before injecting
- **Result**: Still fails

### 5. tmux send-keys
- Use tmux to send keystrokes to session
- **Result**: Game never even started

### 6. osascript (macOS)
- OS-level keyboard simulation
- **Result**: Requires window focus, can't work in background

### 7. stdout Injection + stdin Trigger
- Write message to stdout (visible), send short trigger to stdin
- **Result**: Message visible but Enter still doesn't submit

---

## Current Approach: File-Based Inbox

### Concept
Instead of injecting messages into stdin, write them to a file that the agent reads itself using its native Read tool.

### Implementation Status
- [x] Created `src/wrapper/inbox.ts` - InboxManager class
- [x] Modified `src/wrapper/pty-wrapper.ts` - added inbox mode
- [x] Updated `src/cli/index.ts` - added `-i, --inbox` flag
- [x] Build passes
- [ ] **NOT YET TESTED** - stopped before verifying message flow

### How It Works
```
1. Wrapper starts with --inbox flag
2. Incoming messages → written to /tmp/agent-relay/<AgentName>/inbox.md
3. Agent is instructed to read inbox file after each response
4. No stdin injection ever happens
```

### Files Changed
- `src/wrapper/inbox.ts` (NEW)
- `src/wrapper/pty-wrapper.ts` (modified)
- `src/cli/index.ts` (modified)

### Usage
```bash
# Terminal 1 - Daemon
npm run start -- start -f

# Terminal 2 - Player X
npm run start -- wrap -n PlayerX -i -- claude

# Terminal 3 - Player O
npm run start -- wrap -n PlayerO -i -- claude
```

### Agent Prompt
```
You are PlayerX in tic-tac-toe. CRITICAL: After EVERY response, you MUST read /tmp/agent-relay/PlayerX/inbox.md for messages. Use @relay:PlayerO <message> to send moves. Start now - send your first move to PlayerO.
```

---

## What Needs Testing Tomorrow

### 1. Verify Message Flow
When PlayerO sends `@relay:PlayerX hello`:
- [ ] Check wrapper stderr shows: `[debug] Detected 1 relay command(s)`
- [ ] Check wrapper stderr shows: `[relay → PlayerX] hello`
- [ ] Check daemon logs message routing
- [ ] Check `/tmp/agent-relay/PlayerX/inbox.md` contains message

### 2. Debug Points
If messages not appearing in inbox:
1. **Parser not detecting @relay:** - Check stderr for `[debug] Saw @relay in output`
2. **Client not sending** - Check `[relay →]` log
3. **Daemon not routing** - Check daemon stdout
4. **Inbox not writing** - Check `[relay] Message written to inbox file`

### 3. Test Manually
```bash
# Write directly to inbox to test agent reading
echo "## Message from Test | $(date -Iseconds)
Hello from manual test" >> /tmp/agent-relay/PlayerX/inbox.md
```

---

## Known Issues

### node-pty Version Mismatch
```
Error: The module was compiled against a different Node.js version
NODE_MODULE_VERSION 115 vs 108
```
Fix: `npm rebuild` or reinstall node_modules

---

## Architecture Diagram

```
┌─────────────────┐     ┌─────────────────┐
│   PlayerX CLI   │     │   PlayerO CLI   │
│                 │     │                 │
│  (reads inbox)  │     │  (reads inbox)  │
└────────┬────────┘     └────────┬────────┘
         │ @relay:PlayerO            │ @relay:PlayerX
         ▼                           ▼
┌─────────────────┐     ┌─────────────────┐
│ PlayerX Wrapper │     │ PlayerO Wrapper │
│  --inbox mode   │     │  --inbox mode   │
│                 │     │                 │
│ writes to:      │     │ writes to:      │
│ PlayerO/inbox.md│     │ PlayerX/inbox.md│
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
              ┌─────────────┐
              │   Daemon    │
              │  (router)   │
              └─────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/wrapper/inbox.ts` | File-based inbox manager |
| `src/wrapper/pty-wrapper.ts` | PTY wrapper with inbox mode |
| `src/wrapper/parser.ts` | Parses @relay: commands from output |
| `src/wrapper/client.ts` | Relay client (connects to daemon) |
| `src/daemon/server.ts` | Relay daemon |
| `src/cli/index.ts` | CLI entry point |

---

## Pros/Cons of File-Based Approach

### Pros
- No injection = no TUI compatibility issues
- Persistent session = full context preserved
- Low latency (no spawn overhead)
- Simple architecture
- Uses native CLI capabilities (Read tool)

### Cons
- Agents may not check inbox reliably (the big unknown)
- No push/interrupt capability
- Timing uncertainty
- Instructions may be forgotten in long conversations

---

## Alternative If File-Based Fails

### Spawn-per-Message
Instead of persistent sessions, spawn fresh CLI for each message:
```
while true:
  messages = poll_daemon()
  if messages:
    spawn_cli_with_context(messages)
    capture_output()
    parse_relay_commands()
  sleep(interval)
```

**Downsides**: No context preservation, high latency, token inefficient

---

## Tomorrow's TODO

1. `npm rebuild` to fix node-pty
2. Start daemon, two wrappers with --inbox
3. Watch stderr for debug output
4. Verify message flow end-to-end
5. If agents don't check reliably, try stronger prompt language
6. If still fails, consider spawn-per-message fallback

## Beads / Backlog

- Migrate per-agent `state.json` storage to SQLite (or a full database) once the supervisor/state approach is stable.

---

# December 18, 2025 - Team Messaging & Autonomous Response

## Summary of Work

### 1. Team Management Commands
Added comprehensive CLI commands for managing agent teams:
- `team-init` - Initialize team workspace
- `team-add` - Add agent to team
- `team-setup` - One-shot setup from JSON config
- `team-status` - Show team overview with inbox counts
- `team-send` - Send messages between agents
- `team-check` - Check inbox (blocking or non-blocking)
- `team-start` - **One command to start everything** (setup, dashboard, spawn, listen)
- `team-listen` - Daemon that watches inboxes and spawns agents on new messages

### 2. Claude Code Hook for Automatic Inbox Checking
Created `agent-relay-inbox` hook that shows messages after every tool call:
- Located: `.claude/hooks/agent-relay-inbox/dist/hook.cjs`
- Configured in: `.claude/settings.json`
- Requires `AGENT_RELAY_NAME` env var to be set

### 3. Agent State Persistence
Created `src/state/agent-state.ts` for preserving context across spawns:
- Saves current task, completed tasks, decisions, context
- Loaded when agent is spawned by listener
- Agents can output `[[STATE]]{...}[[/STATE]]` to save state

### 4. Start Scripts for Each Agent
Generated `/tmp/agent-relay-team/{AgentName}/start.sh` scripts that:
- Export `AGENT_RELAY_NAME` and `AGENT_RELAY_DIR`
- Start the correct CLI with startup prompt
- Enable hooks to work properly

### 5. Dashboard (Built by Dan/Gemini)
Web dashboard at http://localhost:3888 showing:
- Agent status cards
- Message activity log
- Real-time updates via file watching

## Key Files Changed/Created

| File | Purpose |
|------|---------|
| `src/cli/index.ts` | Added team-* commands, team-start, team-listen |
| `src/state/agent-state.ts` | Agent state persistence for spawn-per-message |
| `src/webhook/spawner.ts` | Webhook spawner (not fully integrated) |
| `.claude/settings.json` | Hook configuration for Claude agents |
| `.claude/hooks/agent-relay-inbox/` | Hook that checks inbox after tool calls |
| `examples/team-config.json` | Sample team configuration |

## The Autonomous Response Problem

**Issue**: Agents don't automatically see/respond to messages.

**Root Cause**:
- Claude needs the hook installed AND `AGENT_RELAY_NAME` env var set
- Codex/Gemini have no hook system, rely on spawn-on-message

**Solutions Implemented**:
1. **Claude**: PostToolUse hook that displays inbox after every tool call
2. **Codex/Gemini**: `team-listen` daemon that spawns agent when inbox changes

---

## Testing Instructions

### Quick Start (One Terminal)
```bash
cd /Users/khaliqgant/Projects/prpm/agent-relay

# Start everything
node dist/cli/index.js team-start -f examples/team-config.json --dashboard
```

### Start Claude Agent (DocWriter) with Hook
```bash
# Use the start script (sets env vars)
/tmp/agent-relay-team/DocWriter/start.sh

# OR manually:
export AGENT_RELAY_NAME=DocWriter
export AGENT_RELAY_DIR=/tmp/agent-relay-team
cd /Users/khaliqgant/Projects/prpm/agent-relay
claude -p "Read /tmp/agent-relay-team/DocWriter/INSTRUCTIONS.md and start"
```

### Test Message Flow
```bash
# Send message to DocWriter
node dist/cli/index.js team-send -n Coordinator -t DocWriter -m "Status update please" -d /tmp/agent-relay-team

# Check if DocWriter has messages
node dist/cli/index.js team-check -n DocWriter -d /tmp/agent-relay-team --no-wait

# Check team status
node dist/cli/index.js team-status -d /tmp/agent-relay-team
```

### Verify Hook Works
```bash
# Test hook directly
AGENT_RELAY_NAME=DocWriter AGENT_RELAY_DIR=/tmp/agent-relay-team node .claude/hooks/agent-relay-inbox/dist/hook.cjs < /dev/null
```

Should output:
```
==================================================
AGENT RELAY: X new message(s)
==================================================
...
```

### Start Codex/Gemini Agent
```bash
# For Codex (no hook - relies on listener to spawn)
/tmp/agent-relay-team/DevOps/start.sh

# Or with listener running, just send a message:
node dist/cli/index.js team-send -n Coordinator -t DevOps -m "Start working" -d /tmp/agent-relay-team
# Listener will spawn DevOps automatically
```

### Dashboard
Open http://localhost:3888 to see:
- Agent status cards
- Message activity log

---

## Known Issues

1. **Hook only works for Claude** - Codex/Gemini need spawn-on-message via listener
2. **AGENT_RELAY_NAME must be set** - Use start.sh scripts or export manually
3. **Agents may still not respond** - Hook shows messages but agent must act on them
4. **Cooldown on spawns** - Listener waits 60s between spawns per agent

## Next Steps

1. Test hook with live Claude agent - verify messages appear after tool calls
2. Test listener spawning for Codex/Gemini
3. Improve agent instructions to emphasize responding to messages
4. Consider adding sound/desktop notification for urgent messages
5. Add retry logic if agent doesn't respond within timeout
