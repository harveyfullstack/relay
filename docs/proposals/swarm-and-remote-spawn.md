# Swarm Command & Remote Spawn Feature Specification

**Status:** Draft
**Created:** 2026-01-16
**Authors:** Brainstormer, _DashboardUI

## Overview

This specification defines two complementary features:
1. **Local Swarm Command** - Spin up N workers + a coordinator with a single command
2. **Remote Spawn (`--remote`)** - Spawn agents on cloud workspaces from local CLI

These features enable users to quickly assemble multi-agent teams locally or leverage cloud compute for distributed workloads.

---

## Existing Infrastructure

### What We Have

| Component | Status | Notes |
|-----------|--------|-------|
| `cloud link` | Exists | Creates `~/.local/share/agent-relay/cloud-config.json` with `apiKey`, `cloudUrl`, `machineId` |
| `spawn` | Exists | Local-only via `localhost:PORT/api/spawn` |
| `agents --remote` | Exists | Lists agents from cloud workspaces |
| `POST /api/workspaces/:id/agents` | Exists | Cloud API to spawn agent in workspace |
| `GET /api/workspaces/:id/agents` | Exists | Cloud API to list agents |
| `DELETE /api/workspaces/:id/agents/:name` | Exists | Cloud API to release agent |
| `GET /api/workspaces/primary` | Exists | Get user's default workspace |
| `GET /api/workspaces` | Exists | List all user workspaces |

### What's Missing

- `spawn --remote` flag for cloud spawning from CLI
- `swarm` command for multi-agent orchestration
- Workspace selection mechanism in local CLI
- Task distribution protocol for coordinator → worker communication

---

## Feature 1: Local Swarm Command

### User Story

> As a developer, I want to spin up a team of AI agents with a single command so I can tackle complex tasks without manually spawning and coordinating each agent.

### CLI Interface

```bash
# Basic usage
agent-relay swarm --workers 3 "Build a browser extension"

# With explicit coordinator
agent-relay swarm --workers 5 --coordinator Lead "Refactor the auth module"

# With preset (v2)
agent-relay swarm --preset frontend "Build a dashboard"
```

### Flags

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--workers` | number | Yes | - | Number of worker agents to spawn |
| `--coordinator` | string | No | `Coordinator` | Name of the coordinator agent |
| `--cli` | string | No | `claude` | CLI to use for agents |
| `--preset` | string | No | - | (v2) Preset team configuration |

### Behavior

1. **Spawn coordinator first**
   - Coordinator receives the main task
   - Coordinator waits for workers to register

2. **Spawn workers**
   - Workers are named `Worker1`, `Worker2`, etc. (or custom via preset)
   - Workers register with coordinator as their "lead"
   - Workers start idle, waiting for task assignment

3. **Health check**
   - Command waits until all agents are connected
   - Returns success with summary of spawned agents
   - Times out after 60s with error

4. **Task distribution (coordinator responsibility)**
   - Coordinator breaks down main task
   - Assigns subtasks via relay messages
   - Workers report completion back to coordinator

### Output

```
$ agent-relay swarm --workers 3 "Build auth module"

Spawning swarm for task: Build auth module
  Coordinator: Coordinator (claude)
  Workers: 3

[1/4] Spawning Coordinator... done (pid: 12345)
[2/4] Spawning Worker1... done (pid: 12346)
[3/4] Spawning Worker2... done (pid: 12347)
[4/4] Spawning Worker3... done (pid: 12348)

Swarm ready! All 4 agents connected.
Coordinator will distribute tasks. View progress:
  agent-relay agents
  agent-relay logs Coordinator
```

### Implementation Tasks

#### Task 1.1: `swarm` CLI command skeleton (0.5d)
**File:** `src/cli/index.ts`

```typescript
program
  .command('swarm')
  .description('Spawn a coordinated team of agents')
  .argument('<task>', 'Task for the swarm to complete')
  .option('--workers <n>', 'Number of worker agents', parseInt)
  .requiredOption('--workers <n>', 'Number of worker agents is required')
  .option('--coordinator <name>', 'Coordinator agent name', 'Coordinator')
  .option('--cli <cli>', 'CLI to use for agents', 'claude')
  .action(async (task, options) => {
    // Implementation
  });
```

**Acceptance Criteria:**
- [ ] Command parses all flags correctly
- [ ] `--workers` is required, errors without it
- [ ] Help text is clear and complete
- [ ] No actual spawning yet (skeleton only)

#### Task 1.2: Local multi-spawn orchestration (1d)
**File:** `src/cli/swarm.ts` (new)

Implement the spawn logic:
1. Spawn coordinator with task context
2. Spawn N workers with coordinator as lead
3. Wait for all agents to appear in `agents` list
4. Report success/failure

**Acceptance Criteria:**
- [ ] Coordinator spawns first with full task
- [ ] Workers spawn sequentially (avoid race conditions)
- [ ] Workers have `lead: <coordinator>` in spawn config
- [ ] Health check polls `/api/spawned` until all agents present
- [ ] Timeout after 60s with helpful error message

#### Task 1.3: Task distribution protocol (0.5d)
**File:** `src/protocol/types.ts`

Add new envelope types:
```typescript
export interface TaskAssignPayload {
  taskId: string;
  description: string;
  context?: string;  // Optional scoped context
  priority?: number;
}

export interface TaskCompletePayload {
  taskId: string;
  status: 'completed' | 'failed' | 'blocked';
  summary?: string;
  error?: string;
}
```

**Acceptance Criteria:**
- [ ] `TASK_ASSIGN` envelope type defined
- [ ] `TASK_COMPLETE` envelope type defined
- [ ] Types exported from protocol module
- [ ] Documentation in types file

#### Task 1.4: Worker fresh-start lifecycle (0.5d)
**File:** `src/wrapper/tmux-wrapper.ts`, `src/daemon/spawner.ts`

Workers should terminate after completing their task:
1. On `TASK_COMPLETE`, worker sends completion message
2. Coordinator can spawn replacement if more work exists
3. Clean tmux session shutdown

**Acceptance Criteria:**
- [ ] Worker can be configured for single-task mode
- [ ] Clean shutdown: tmux session killed, no zombies
- [ ] Coordinator receives notification of worker termination
- [ ] Replacement spawn works correctly

---

## Feature 2: Remote Spawn (`--remote`)

### User Story

> As a developer, I want to spawn agents on my cloud workspace from my local terminal so I can leverage cloud compute while working locally.

### CLI Interface

```bash
# Basic remote spawn (uses primary workspace)
agent-relay spawn --remote Worker1 claude "Implement login endpoint"

# Specific workspace
agent-relay spawn --remote --workspace ws_abc123 Worker1 claude "Implement login"

# Remote swarm (local coordinator, cloud workers)
agent-relay swarm --remote --workers 3 "Build auth module"

# List workspaces
agent-relay cloud workspaces
```

### Prerequisites

1. User has run `agent-relay cloud link` (has valid `cloud-config.json`)
2. User has at least one cloud workspace
3. Workspace is running (or will be woken up)

### Flags for `spawn`

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--remote` | boolean | No | false | Spawn on cloud workspace instead of local |
| `--workspace` | string | No | primary | Workspace ID to spawn in |

### Flags for `swarm`

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--remote` | boolean | No | false | Spawn workers on cloud (coordinator stays local) |
| `--workspace` | string | No | primary | Workspace ID for remote workers |

### Behavior

#### `spawn --remote`

1. Check `cloud-config.json` exists (error if not linked)
2. Get workspace (primary or specified)
3. POST to `${cloudUrl}/api/workspaces/${workspaceId}/agents`
4. Return spawn result

#### `swarm --remote`

1. Spawn coordinator locally (stays on user's machine)
2. Spawn workers via cloud API (run in cloud workspace)
3. Coordinator communicates with cloud workers via relay

### Cloud Auth Flow

```
Local CLI                          Cloud API
    |                                  |
    |-- GET /api/workspaces -----------|
    |   (Authorization: Bearer apiKey) |
    |<-- [workspace list] -------------|
    |                                  |
    |-- POST /api/workspaces/:id/agents|
    |   (Authorization: Bearer apiKey) |
    |   { name, cli, task }            |
    |<-- { success, pid } -------------|
```

Note: The `apiKey` from `cloud-config.json` is used. Cloud API currently uses session auth, so we need to add API key support for CLI-to-cloud calls.

### Implementation Tasks

#### Task 2.1: `--remote` flag for spawn (0.5d)
**File:** `src/cli/index.ts`

Add `--remote` and `--workspace` flags to spawn command:

```typescript
.option('--remote', 'Spawn on cloud workspace instead of local')
.option('--workspace <id>', 'Workspace ID (default: primary workspace)')
```

Implementation:
1. If `--remote`, load cloud config
2. Fetch workspace (primary or specified)
3. POST to cloud API instead of localhost

**Acceptance Criteria:**
- [ ] `--remote` flag works
- [ ] `--workspace` allows selecting specific workspace
- [ ] Error if not cloud-linked
- [ ] Error if workspace not found/running
- [ ] Success shows remote spawn details

#### Task 2.2: Workspace selection for multi-workspace users (0.5d)
**File:** `src/cli/index.ts`

Add `cloud workspaces` subcommand:

```typescript
cloudCommand
  .command('workspaces')
  .description('List cloud workspaces')
  .action(async () => {
    // List workspaces from cloud API
  });
```

**Acceptance Criteria:**
- [ ] Lists all accessible workspaces
- [ ] Shows workspace ID, name, status
- [ ] Indicates primary workspace
- [ ] Error if not cloud-linked

#### Task 2.3: Remote worker status in local CLI (0.5d)
**Files:** `src/cli/index.ts`

Enhance `agents --remote` to show:
- Local vs cloud indicator
- Workspace name for cloud agents
- Task status if available

**Acceptance Criteria:**
- [ ] Clear distinction between local and remote agents
- [ ] Workspace name shown for remote agents
- [ ] Status polling works correctly

#### Task 2.4: Swarm with `--remote` (0.5d)
**File:** `src/cli/swarm.ts`

Add remote support to swarm:
1. Coordinator spawns locally
2. Workers spawn via cloud API
3. Same health check logic, but polls cloud

**Acceptance Criteria:**
- [ ] Local coordinator + cloud workers works
- [ ] Health check polls cloud workspace
- [ ] Coordinator can message cloud workers
- [ ] Status shows hybrid topology

#### Task 2.5: Detach/reattach for hybrid swarms (1d)
**Files:** `src/cli/index.ts`, `src/daemon/swarm-state.ts` (new)

Add commands:
```bash
agent-relay detach       # Disconnect local coordinator
agent-relay attach <id>  # Reconnect to running swarm
```

State persistence:
- Swarm state saved to cloud workspace
- Includes: swarm ID, coordinator config, worker list, task progress

**Acceptance Criteria:**
- [ ] `detach` cleanly disconnects local coordinator
- [ ] Cloud workers continue running
- [ ] `attach` reconnects and resumes
- [ ] State survives coordinator restart

#### Task 2.6: API key auth for CLI-to-cloud (0.5d)
**File:** `src/cloud/api/workspaces.ts`

The cloud API currently uses session auth. Add API key support:

```typescript
// Middleware to accept API key from cloud-linked CLI
function apiKeyOrSession(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ar_live_')) {
    // Validate API key, set req.session.userId
  } else {
    // Fall through to session auth
  }
  next();
}
```

**Acceptance Criteria:**
- [ ] API key auth works for spawn endpoint
- [ ] API key auth works for agents endpoint
- [ ] Session auth still works for dashboard
- [ ] Invalid API key returns 401

---

## Feature 3: Continuity Integration (Future Enhancement)

### Task 3.1: Auto-briefing for swarm workers (1d)

When coordinator spawns workers, include relevant context from continuity:

```typescript
// In coordinator's spawn logic
const relevantContext = await continuity.search(task);
const briefing = formatBriefing(relevantContext);

spawn({
  name: 'Worker1',
  task: subtask,
  context: briefing,  // Scoped context from continuity
});
```

**Acceptance Criteria:**
- [ ] Coordinator queries continuity for relevant past decisions
- [ ] Workers receive curated context briefing
- [ ] Briefing is task-scoped, not full dump
- [ ] Workers can query continuity for more if needed

---

## Testing Strategy

### Unit Tests
- CLI flag parsing
- Cloud config loading
- Spawn request building

### Integration Tests
- Local swarm spawn flow
- Remote spawn (mock cloud API)
- Hybrid swarm topology

### E2E Tests
- Full swarm execution with real agents
- Detach/attach flow
- Cross-machine messaging

---

## Timeline

| Task | Estimate | Dependencies |
|------|----------|--------------|
| 1.1 Swarm CLI skeleton | 0.5d | - |
| 1.2 Multi-spawn orchestration | 1d | 1.1 |
| 2.1 `--remote` for spawn | 0.5d | - |
| 2.6 API key auth | 0.5d | - |
| 2.2 Workspace selection | 0.5d | 2.1 |
| 2.3 Remote status | 0.5d | 2.1 |
| 1.3 Task protocol | 0.5d | 1.2 |
| 2.4 Swarm --remote | 0.5d | 1.2, 2.1 |
| 1.4 Worker lifecycle | 0.5d | 1.3 |
| 2.5 Detach/attach | 1d | 2.4 |
| 3.1 Continuity briefing | 1d | 1.3 |

**Total: ~7 days**

**Critical Path:** 1.1 → 1.2 → 2.4 → 2.5

---

## Open Questions

1. **Worker naming in swarm**: Should workers be `Worker1, Worker2` or allow custom names via config?

2. **Coordinator protocol**: Should coordinators follow a standardized task-assignment protocol, or is free-form relay messaging sufficient?

3. **Resource limits**: Should we detect system resources and warn/limit worker count on local swarms?

4. **Workspace auto-wake**: If workspace is stopped, should `--remote` auto-wake it? (Could add latency)

5. **Billing visibility**: Should CLI show estimated cost for cloud spawns?

---

## References

- Cursor Scaling Agents Analysis (context from Lead)
- Existing `spawn` command: `src/cli/index.ts:1769`
- Cloud spawn API: `src/cloud/api/workspaces.ts:1836`
- Cloud config: `~/.local/share/agent-relay/cloud-config.json`
