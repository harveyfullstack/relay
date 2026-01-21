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

## Implemented Improvements

> **Status:** Implemented in PR #197 (commit 9022ea2, merged Jan 16 2026)

### 1. Escalating Retry with Visibility ✅

**Problem:** Message is injected but agent doesn't acknowledge or respond.

**Solution:** Escalating retry logic with increasing urgency markers.

```rust
// relay-pty/src/protocol.rs
match self.retries {
    0 => base_msg,                                           // "Relay message from..."
    1 => format!("[RETRY] {}", base_msg),                    // "[RETRY] Relay message..."
    _ => format!("[URGENT - PLEASE ACKNOWLEDGE] {}", base_msg), // "[URGENT...]"
}
```

**Implementation:** `relay-pty/src/protocol.rs` - `QueuedMessage::format_for_injection()`

---

### 2. Unread Message Indicator in Output ✅

**Problem:** During long tasks, agent may process tool outputs without noticing pending messages.

**Solution:** Wrapper appends unread message count when messages are pending.

```typescript
// relay-pty-orchestrator.ts - formatUnreadIndicator()
// Output: ───────────────────────────
//         📬 2 unread messages (from: Alice, Bob)
// 5-second cooldown to avoid spamming
```

**Implementation:** `src/wrapper/relay-pty-orchestrator.ts` - `formatUnreadIndicator()`

---

## Design Principles

1. **Push, don't pull** - Never rely on agent to remember to check
2. **Retry with backoff** - Assume first attempt might fail
3. **Escalate visibility** - Get louder until acknowledged
4. **Human fallback** - Alert operator if critical messages not ACK'd

## Code Cleanup

### Dead Code Analysis (2026-01-16)

Analyzed `src/wrapper/parser.ts` for dead code:

| Function | Lines | Decision | Status |
|----------|-------|----------|--------|
| `formatIncomingMessage` | 1262-1265 | **Remove** | ✅ Removed in PR #197 |
| `parseRelayMetadataFromOutput` | 1301-1316 | Keep | `importance` field aligns with escalating retry |
| `MetadataParseResult` | 1280-1285 | Keep | Used by above |
| `parseSummaryFromOutput` | 1352-1355 | Keep | Simple API wrapper, minimal cost |

**Completed:** `agent-relay-482` - formatIncomingMessage removed in PR #197

---

## References

- `relay-pty/src/inject.rs` - Injection logic
- `relay-pty/src/queue.rs` - Message queue with retry
- `src/wrapper/relay-pty-orchestrator.ts` - TypeScript orchestrator
- `docs/RUST_WRAPPER_DESIGN.md` - Original design doc
