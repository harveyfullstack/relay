# Enterprise Features Roadmap

This document describes features that are **implemented but not yet integrated** into the main codebase. These features are designed for multi-tenancy, enterprise deployments, and advanced reliability requirements.

## Status Legend

| Status | Meaning |
|--------|---------|
| Implemented | Code exists and is tested |
| Not Integrated | Not wired into the main daemon/router |
| Integrated | Fully wired and available for use |

---

## Agent Signing (Cryptographic Authentication)

**Status:** Implemented, Not Integrated

**Location:** `packages/daemon/src/agent-signing.ts`

**Purpose:** Provides cryptographic proof of message origin beyond Unix UID/GID-based auth.

### Features
- HMAC-SHA256 for shared-secret signing (simpler deployment)
- Ed25519 for asymmetric signing (zero-trust mode)
- Key rotation support
- Message signature verification
- Per-agent keys or shared secret mode

### Use Cases
- Multi-tenant environments where agents from different users share infrastructure
- Zero-trust deployments requiring cryptographic proof of message origin
- Audit/compliance requirements for provable message authenticity
- Defense-in-depth for cloud workspaces

### Why Not Enabled
- Local single-user deployments already have Unix socket UID/GID auth
- Adds performance overhead (signing/verification on every message)
- Requires key management infrastructure
- Breaking change if `requireSignatures: true` (all existing code would fail)

### Integration Work Required
1. Add signing config option to `DaemonConfig`
2. Call `signEnvelope()` in router before sending messages
3. Call `verifyEnvelope()` in router when receiving messages
4. Update wrappers to handle `_sig` field in protocol
5. Add key provisioning during agent spawn
6. Create `~/.agent-relay/signing.json` config file support

### Configuration Example
```json
{
  "enabled": true,
  "algorithm": "hmac-sha256",
  "requireSignatures": false,
  "sharedSecret": "your-secret-here",
  "keyRotationHours": 24
}
```

---

## Context Compaction (Memory Management)

**Status:** Implemented, Not Integrated

**Location:** `packages/memory/src/context-compaction.ts`

**Purpose:** Automatically compacts agent conversation context when it exceeds token limits, preserving important information while reducing size.

### Features
- Token estimation for messages
- Configurable compaction thresholds
- Preserves recent messages and important context
- Summarization of older messages
- Multiple compaction strategies

### Use Cases
- Long-running agent sessions that exceed context limits
- Cost optimization by reducing token usage
- Enterprise deployments with many concurrent agents
- Agents working on large codebases with extensive context

### Why Not Enabled
- Current agent sessions are typically short enough not to need compaction
- Requires integration with wrapper output handling
- Summarization quality depends on model used
- Adds complexity to message flow

### Integration Work Required
1. Track message history in wrapper or daemon
2. Call `needsCompaction()` periodically
3. Run `compact()` when threshold exceeded
4. Inject compacted context back into agent
5. Handle edge cases (mid-task compaction)

---

## Dead Letter Queue (Message Reliability)

**Status:** Implemented, Not Integrated

**Location:** `packages/storage/src/dlq-adapter.ts`

**Purpose:** Stores undeliverable messages for later retry or manual inspection, preventing message loss.

### Features
- SQLite, PostgreSQL, and in-memory storage backends
- Configurable retry policies
- Message expiration (TTL)
- Statistics and monitoring
- Manual replay capability

### Use Cases
- Enterprise deployments requiring guaranteed delivery
- Debugging message routing issues
- Compliance requirements for message audit trails
- Handling transient agent failures gracefully

### Why Not Enabled
- Current deployments are typically local with reliable delivery
- Adds storage overhead
- Requires monitoring/alerting setup to be useful
- Most failures are better handled by agent restart

### Integration Work Required
1. Initialize DLQ adapter in daemon startup
2. Call `handleDeliveryFailure()` when router can't deliver
3. Add API endpoints for DLQ inspection/replay
4. Add dashboard UI for DLQ management
5. Configure retention policies

---

## Enhanced Features Bundle

**Status:** Implemented, Not Integrated

**Location:** `packages/daemon/src/enhanced-features.ts`

**Purpose:** Unified initialization for all enterprise features (signing, DLQ, compaction, patterns).

### Features
- Single `initEnhancedFeatures()` call to set up everything
- Helper functions for router integration
- Coordinated cleanup on shutdown

### Why Not Enabled
The individual features it bundles aren't enabled, so the bundle isn't used either.

### Integration Work Required
1. Call `initEnhancedFeatures()` in daemon startup
2. Pass returned objects to router
3. Use helper functions (`signEnvelope`, `verifyEnvelope`, `handleDeliveryFailure`, etc.)

---

## Features That ARE Integrated

For reference, these enterprise-grade features ARE currently active:

### Consensus Mechanism
**Status:** Integrated

**Location:** `packages/daemon/src/consensus-integration.ts`

Multi-agent decision making with voting. Enabled via `consensus: true` in daemon config.

### Agent Registry
**Status:** Integrated

**Location:** `packages/daemon/src/agent-registry.ts`

Discovers and manages agent configurations from `.claude/agents/` directory.

### Cloud Persistence
**Status:** Integrated (Cloud only)

**Location:** `packages/cloud/src/`

Full cloud infrastructure with workspaces, teams, billing, and persistent storage.

---

## Recommended Enablement Order

When moving toward enterprise/multi-tenant deployment:

1. **Dead Letter Queue** - Low risk, improves reliability
2. **Context Compaction** - Helps with long sessions, isolated impact
3. **Agent Signing** - Higher complexity, save for true multi-tenant needs

---

## Contributing

To enable one of these features:

1. Read the integration work required section
2. Create a feature branch
3. Wire the feature into the daemon with a config flag (disabled by default)
4. Add tests for the integration points
5. Update this document with the new status
6. Submit PR with clear documentation of breaking changes (if any)
