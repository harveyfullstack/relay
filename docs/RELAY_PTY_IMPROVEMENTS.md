# Relay-PTY Injection Reliability Improvements

This document tracks planned improvements to make message injection even more reliable.

## Background

The Rust `relay-pty` implementation uses direct PTY writes for message injection, which is significantly more reliable than tmux `send-keys`:

| Approach | Latency | Reliability | Agent Memory Required |
|----------|---------|-------------|----------------------|
| tmux send-keys | ~1700ms | Low (shell escaping, races) | No |
| Rust PTY direct | ~550ms | High (direct syscall) | No |
| File polling | N/A | Medium | Yes (agent forgets) |
| MCP tools | N/A | Medium | Yes (agent forgets) |

**Key insight:** Push-based (PTY injection) beats pull-based (file/MCP) because agents forget to poll.

The remaining failure mode with PTY injection is **timing** - injecting while the agent is mid-thought or in a state where input isn't processed correctly.

## Planned Improvements

### 1. Escalating Retry with Visibility

**Problem:** Message is injected but agent doesn't acknowledge or respond.

**Solution:** Implement escalating retry logic with increasing urgency markers.

```
Attempt 1 (t=0):     "Relay message from Alice: ..."
Attempt 2 (t=60s):   "[RETRY] Relay message from Alice: ..."
Attempt 3 (t=120s):  "[URGENT - PLEASE ACKNOWLEDGE] Relay message from Alice: ..."
Attempt 4 (t=180s):  Alert human operator
```

**Implementation location:** `relay-pty/src/inject.rs` and `relay-pty/src/queue.rs`

**Tracking:** `agent-relay-pty-escalating-retry`

---

### 2. Unread Message Indicator in Output

**Problem:** During long tasks, agent may process tool outputs without noticing pending messages.

**Solution:** The wrapper intercepts output and appends unread message count when messages are pending.

```
[Normal tool output here]
───────────────────────────
📬 2 unread messages (from: Alice, Bob)
```

This ensures the agent sees a reminder in every tool response while messages are pending.

**Implementation location:** `src/wrapper/relay-pty-orchestrator.ts` output handling

**Tracking:** `agent-relay-pty-unread-indicator`

---

## Design Principles

1. **Push, don't pull** - Never rely on agent to remember to check
2. **Retry with backoff** - Assume first attempt might fail
3. **Escalate visibility** - Get louder until acknowledged
4. **Human fallback** - Alert operator if critical messages not ACK'd

## Code Cleanup

### Dead Code Analysis (2026-01-16)

Analyzed `src/wrapper/parser.ts` for dead code:

| Function | Lines | Decision | Reason |
|----------|-------|----------|--------|
| `formatIncomingMessage` | 1262-1265 | **Remove** | Replaced by `buildInjectionString` in shared.ts |
| `parseRelayMetadataFromOutput` | 1301-1316 | Keep | `importance` field aligns with escalating retry feature |
| `MetadataParseResult` | 1280-1285 | Keep | Used by above |
| `parseSummaryFromOutput` | 1352-1355 | Keep | Simple API wrapper, minimal cost |

**Tracking:** `agent-relay-482` - Remove dead formatIncomingMessage function

---

## References

- `relay-pty/src/inject.rs` - Injection logic
- `relay-pty/src/queue.rs` - Message queue with retry
- `src/wrapper/relay-pty-orchestrator.ts` - TypeScript orchestrator
- `docs/RUST_WRAPPER_DESIGN.md` - Original design doc
