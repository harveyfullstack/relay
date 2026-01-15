# Rust PTY Wrapper for Reliable Agent Injection

## Problem Statement

The current tmux-based injection mechanism is brittle:

1. **Shell escaping complexity** - Multiple layers of escaping required for `tmux send-keys`
2. **Timing heuristics** - Idle detection relies on cursor position checks and output stability
3. **Race conditions** - Between injection, verification, and retry attempts
4. **Verification failures** - 2s timeout may not catch slow agent echo
5. **No flow control** - Can't pause injection if agent is busy

## Solution: `relay-pty` Rust Binary

A PTY wrapper that provides a side channel for reliable message injection.

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Terminal                             │
└─────────────────────────────────────────────────────────────────┘
                              │ stdin/stdout
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        relay-pty                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ User I/O     │    │ Message      │    │ Agent PTY        │  │
│  │ Handler      │◄──►│ Queue        │◄──►│ (claude/codex)   │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│         │                   ▲                                    │
│         │                   │                                    │
│         ▼                   │                                    │
│  ┌──────────────┐    ┌──────────────┐                           │
│  │ Output       │    │ Injection    │◄── Unix Socket            │
│  │ Parser       │    │ Socket       │    /tmp/relay-pty-{id}.sock│
│  └──────────────┘    └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

### Core Components

1. **PTY Manager**
   - Creates pseudo-terminal for agent process (claude, codex, etc.)
   - Handles terminal size (SIGWINCH)
   - Manages process lifecycle

2. **User I/O Handler**
   - Reads from stdin (user input)
   - Writes to stdout (agent output)
   - Raw mode for seamless terminal passthrough

3. **Injection Socket**
   - Unix domain socket at `/tmp/relay-pty-{id}.sock`
   - Accepts JSON-framed messages
   - Non-blocking, queued delivery

4. **Message Queue**
   - Priority queue for pending injections
   - Wait for "injection window" before sending
   - Configurable backpressure

5. **Output Parser**
   - Scans agent output for `->relay:` patterns
   - Emits parsed commands to stdout as JSON (for daemon)
   - Handles ANSI escape sequences

## Message Protocol

### Injection Request (to socket)

```json
{
  "type": "inject",
  "id": "msg-abc123",
  "from": "Alice",
  "body": "Hello from Alice!",
  "priority": 0
}
```

### Injection Response (from socket)

```json
{
  "type": "inject_result",
  "id": "msg-abc123",
  "status": "delivered",
  "timestamp": 1705350000000
}
```

### Parsed Output (to stderr as JSON-lines)

```json
{"type":"relay_command","from":"agent","to":"Bob","body":"Hello Bob!","raw":"->relay:Bob <<<Hello Bob!>>>"}
```

### Status Query

```json
{"type": "status"}
```

Response:
```json
{
  "type": "status",
  "agent_idle": true,
  "queue_length": 2,
  "cursor_position": [0, 24],
  "last_output_ms": 1500
}
```

## Injection Window Detection

Instead of complex heuristics, use explicit signals:

### Primary: Wait for Input Request

Agent CLIs typically show a prompt when ready:
- Claude: `> ` or right-aligned `.`
- Codex: `codex> `
- Gemini: `>>> `

The wrapper detects prompt patterns and marks "ready for injection".

### Secondary: Output Silence

If no output for N milliseconds (configurable, default 500ms), assume ready.

### Tertiary: Explicit Signal

Agent can output `->pty:ready` to signal injection readiness.

## Flow Control

### Backpressure Protocol

If queue exceeds threshold:

```json
{"type": "backpressure", "queue_length": 10, "accept": false}
```

Daemon should pause sending until:

```json
{"type": "backpressure", "queue_length": 3, "accept": true}
```

### Message Acknowledgment

Every injection is acknowledged:

1. **queued** - Message added to queue
2. **injecting** - Starting injection
3. **delivered** - Confirmed in output
4. **failed** - Injection failed after retries

## CLI Interface

```bash
# Start wrapper with agent command
relay-pty --name myagent --socket /tmp/relay-pty-myagent.sock -- claude

# With options
relay-pty \
  --name myagent \
  --socket /tmp/relay-pty-myagent.sock \
  --prompt-pattern '^> $' \
  --idle-timeout 500 \
  --queue-max 20 \
  -- claude --model opus
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--name` | Agent identifier | required |
| `--socket` | Unix socket path | `/tmp/relay-pty-{name}.sock` |
| `--prompt-pattern` | Regex for prompt detection | `^[>$%#] $` |
| `--idle-timeout` | Ms of silence before ready | 500 |
| `--queue-max` | Max queued messages | 50 |
| `--json-output` | Output parsed commands as JSON | false |

## Implementation Plan

### Phase 1: Core PTY Wrapper

1. Create PTY with `openpty()` / `forkpty()`
2. Spawn agent process in PTY
3. Forward stdin/stdout bidirectionally
4. Handle SIGWINCH for resize

### Phase 2: Injection Socket

1. Create Unix domain socket
2. Accept connections (async, tokio)
3. Parse JSON messages
4. Queue for injection

### Phase 3: Injection Logic

1. Detect injection window (prompt/silence)
2. Inject message with proper framing
3. Verify injection (look for echo)
4. Send acknowledgment

### Phase 4: Output Parsing

1. Scan output for `->relay:` patterns
2. Parse fenced messages
3. Emit JSON to stderr for daemon consumption

### Phase 5: Integration

1. Update TypeScript daemon to use socket instead of tmux send-keys
2. Fallback to tmux for compatibility
3. Performance testing

## Rust Dependencies

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
nix = { version = "0.27", features = ["term", "process", "signal"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive"] }
regex = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
```

## Benefits Over Current Approach

| Aspect | Current (tmux send-keys) | New (relay-pty) |
|--------|-------------------------|-----------------|
| **Injection** | Shell command with escaping | Direct PTY write |
| **Verification** | Poll capture-pane | Immediate echo check |
| **Flow control** | None | Backpressure protocol |
| **User interaction** | tmux attach | Native terminal |
| **Latency** | ~200ms (poll interval) | <10ms |
| **Memory** | Unbounded hash set | Bounded queue |
| **Cross-platform** | tmux required | Native PTY |

## Security Considerations

1. **Socket permissions** - Create with 0600, only owner can connect
2. **Message validation** - Validate JSON schema before processing
3. **No shell escaping** - Direct PTY write eliminates injection risk
4. **Process isolation** - Wrapper runs as separate process

## Migration Path

1. Ship `relay-pty` as optional binary
2. Daemon auto-detects availability
3. Use relay-pty when available, fall back to tmux
4. Eventually deprecate tmux approach

## File Structure

```
relay-pty/
├── Cargo.toml
├── src/
│   ├── main.rs           # CLI entry point
│   ├── pty.rs            # PTY management
│   ├── socket.rs         # Unix socket server
│   ├── queue.rs          # Message queue
│   ├── parser.rs         # Output parsing
│   ├── inject.rs         # Injection logic
│   └── protocol.rs       # JSON message types
└── README.md
```
