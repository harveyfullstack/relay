# Cursor Analysis Tasks

**Source:** `docs/proposals/cursor-bottom-line-gaps.md`
**Date:** January 16, 2026

---

## Overview

These tasks implement insights from Cursor's scaling agents blog. See full analysis in:
- `docs/proposals/cursor-scaling-agents-analysis.md` (982 lines)
- `docs/proposals/cursor-analysis-existing-features-audit.md` (422 lines)
- `docs/proposals/cursor-bottom-line-gaps.md` (348 lines)

**Total Effort:** 4.5-5.5 days to match Cursor's capabilities

---

## 🚨 P0: Quick Wins (2.5-3.5 days)

Start here - highest impact, lowest complexity:

### agent-relay-510: Model selection hookup (P0)

**Priority:** P0 (Blocking for cost optimization)
**Effort:** 0.5 day (5 hours)
**Depends on:** None

**Description:**
Wire up existing `model:` field from agent profiles to spawner. Protocol already has field, profiles already have frontmatter - just need parsing logic.

**Files to modify:**
- `src/bridge/spawner.ts` - Read `model:` from profile frontmatter
- `src/utils/model-mapping.ts` - NEW - Map model to CLI command variant
- `.claude/agents/*.md` - Update 18 profiles with model defaults

**Acceptance criteria:**
- [ ] Spawner reads `model:` from profile frontmatter
- [ ] Model maps to CLI variant (`claude:sonnet`, `claude:opus`, `codex`)
- [ ] Fallback to `claude:sonnet` if not specified
- [ ] All 18 agent profiles have `model:` field
- [ ] Cost tracking in spawner logs (which model used)

**Example:**
```yaml
---
name: Lead
role: planner
model: claude-sonnet-4
canSpawnChildren: true
---
```

Maps to: `claude:sonnet` command

---

### agent-relay-511: Documentation sprint (P0)

**Priority:** P0 (Unlock existing value)
**Effort:** 1 day (8 hours)
**Depends on:** None

**Description:**
Document existing features that are functional but undiscoverable: StatelessLeadCoordinator, Consensus, Continuity.

**Files to modify:**
- `docs/INTEGRATION-GUIDE.md` - Add 3 new sections
- `docs/agent-relay-protocol.md` - Document `->continuity:` patterns
- `docs/EXAMPLES.md` - NEW - Practical examples

**Acceptance criteria:**
- [ ] INTEGRATION-GUIDE.md covers StatelessLeadCoordinator usage
- [ ] Consensus section with `->relay:_consensus` examples
- [ ] Continuity section with `->continuity:save/load/search` examples
- [ ] EXAMPLES.md with 3 end-to-end scenarios:
  - [ ] Hierarchical planning (Lead spawns workers)
  - [ ] Consensus code review (2+ agents approve)
  - [ ] Long-running task with continuity

---

### agent-relay-512: Role-specific prompts (P0)

**Priority:** P0 (Biggest impact per Cursor)
**Effort:** 2-3 days (16-24 hours)
**Depends on:** None (can work in parallel with 510/511)

**Description:**
Build prompt module system with role-specific strategies. Cursor found "a surprising amount of behavior comes down to how we prompt the agents."

**Phase 1: Prompt structure (4 hours)**
- Create `.claude/prompts/roles/` directory
- Write `planner-strategy.md` (how planners decompose tasks)
- Write `worker-focus.md` (keep workers on-task, avoid scope creep)
- Write `reviewer-criteria.md` (what reviewers check)

**Phase 2: Prompt composer (4 hours)**
- Create `src/wrapper/prompt-composer.ts`
- Build `composeForAgent(profile, context)`
- Integrate with `RelayPtyOrchestrator`

**Phase 3: Testing (8-12 hours)**
- Spawn hierarchical team with role prompts
- Measure coordination improvement (qualitative)
- Refine prompts based on observed behavior
- A/B test: prompts vs. no prompts

**Files to modify:**
- `.claude/prompts/roles/planner-strategy.md` - NEW
- `.claude/prompts/roles/worker-focus.md` - NEW
- `.claude/prompts/roles/reviewer-criteria.md` - NEW
- `src/wrapper/prompt-composer.ts` - NEW
- `src/wrapper/relay-pty-orchestrator.ts` - Integrate composer
- `docs/agent-relay-protocol.md` - Document prompt system

**Acceptance criteria:**
- [ ] 3 role prompts written with clear principles
- [ ] PromptComposer dynamically injects based on role
- [ ] Spawner passes role to orchestrator
- [ ] Testing shows improved coordination
- [ ] Documentation explains when to use each role

**Example planner prompt principles:**
- Break down, don't build up (smallest possible tasks)
- Parallelize aggressively (independent tasks run concurrently)
- Avoid doing work yourself (your job is planning, not execution)
- Spawn sub-planners for complex areas

**Example worker prompt principles:**
- Grind on task until done (don't switch contexts)
- Stay focused (ignore tempting refactors outside scope)
- Trust your planner (they decomposed for a reason)
- When stuck, ask for help (don't spin)

---

## 🧪 P1: Validation Testing (1 day)

Test before building proposals 2 & 3:

### agent-relay-513: Scale testing (P1)

**Priority:** P1 (Validate assumptions)
**Effort:** 0.5 day (4 hours)
**Depends on:** agent-relay-510, agent-relay-512

**Description:**
Test if we have coordination bottlenecks that require optimistic concurrency. Cursor saw "20 agents → 2-3 effective throughput" - do we?

**Test plan:**
1. Spawn 20 concurrent agents with coordination tasks
2. Measure message latency (avg, p50, p99)
3. Check for lock contention in daemon logs
4. Monitor CPU/memory usage
5. Measure effective throughput

**Acceptance criteria:**
- [ ] 20+ agents spawned successfully
- [ ] Message latency measured (<100ms target)
- [ ] Lock contention analysis (file-based state access)
- [ ] Test report documenting results
- [ ] GO/NO-GO decision on agent-relay-515 (optimistic concurrency)

**Files to create:**
- `tests/scale/spawn-20-agents.ts` - Scale test script
- `docs/testing/SCALE_TEST_RESULTS.md` - Report

---

### agent-relay-514: Drift testing (P1)

**Priority:** P1 (Validate assumptions)
**Effort:** 0.5 day (4 hours)
**Depends on:** agent-relay-510, agent-relay-512

**Description:**
Test if long-running agents degrade over time, requiring automatic fresh starts. Cursor uses periodic restarts - do we need them?

**Test plan:**
1. Spawn 3 agents with 2+ hour tasks
2. Capture output quality metrics every 15 minutes
3. Check for repetitive patterns (drift detector heuristics)
4. Monitor context window usage
5. Compare quality: 0-30min vs 90-120min

**Acceptance criteria:**
- [ ] 3 agents run for 2+ hours each
- [ ] Output quality tracked over time
- [ ] Repetitive pattern analysis
- [ ] Context usage estimated
- [ ] Test report documenting results
- [ ] GO/NO-GO decision on agent-relay-516 (auto fresh starts)

**Files to create:**
- `tests/drift/long-running-agents.ts` - Drift test script
- `docs/testing/DRIFT_TEST_RESULTS.md` - Report

---

## 🔬 P2: Advanced Features (Conditional on Testing)

Only implement if agent-relay-513/514 show need:

### agent-relay-515: Optimistic concurrency (P2)

**Priority:** P2 (Only if agent-relay-513 shows bottleneck)
**Effort:** 1 week (40 hours)
**Depends on:** agent-relay-513 (GO decision)

**Description:**
Replace file-based state with versioned state store using optimistic concurrency control. Only implement if scale testing shows lock contention.

**Phase 1: Protocol (8 hours)**
- Add STATE_READ, STATE_WRITE, STATE_CONFLICT messages
- StateWritePayload with expectedVersion
- StateConflictPayload with version info

**Phase 2: Versioned store (16 hours)**
- Create `src/storage/versioned-state.ts`
- Implement read/write with version checking
- Redis adapter for cloud deployment
- Migration from file-based state

**Phase 3: Agent patterns (16 hours)**
- Wrapper helper methods
- Read-modify-write with retry
- Exponential backoff
- Integration tests

**Files to modify:**
- `src/protocol/types.ts` - New message types
- `src/storage/versioned-state.ts` - NEW
- `src/daemon/server.ts` - State operations
- `src/wrapper/base-wrapper.ts` - Client helpers
- `docs/PROTOCOL.md` - Document STATE_* messages

**Acceptance criteria:**
- [ ] Protocol messages defined
- [ ] VersionedStateStore with conflict detection
- [ ] Redis adapter for cloud
- [ ] Client retry patterns
- [ ] Scale test shows improvement (20 agents = 20 effective)

---

### agent-relay-516: Automatic fresh starts (P2)

**Priority:** P2 (Only if agent-relay-514 shows drift)
**Effort:** 2 days (16 hours)
**Depends on:** agent-relay-514 (GO decision)

**Description:**
Add drift detection and automatic restart with continuity handoff. Only implement if drift testing shows degradation.

**Phase 1: Drift detector (4 hours)**
- Create `src/wrapper/drift-detector.ts`
- Repetitive pattern detection
- Context usage estimation
- Configurable thresholds

**Phase 2: Auto-restart (8 hours)**
- Graceful restart logic in BaseWrapper
- Continuity handoff before restart
- Spawn fresh instance with same name
- Config options (maxContextUsagePercent, maxSessionDurationMs)

**Phase 3: Testing (4 hours)**
- Long-running agent tests
- Restart quality validation
- False positive rate

**Files to modify:**
- `src/wrapper/drift-detector.ts` - NEW
- `src/wrapper/base-wrapper.ts` - Auto-restart logic
- `src/continuity/manager.ts` - Graceful handoff
- `docs/agent-relay-protocol.md` - Document auto-restart

**Acceptance criteria:**
- [ ] Drift detector with 3 heuristics (repetition, context, time)
- [ ] Auto-restart with continuity handoff
- [ ] Configurable thresholds
- [ ] Tests show improved long-running quality
- [ ] False positive rate <5%

---

## ✅ P3: Formalize Existing Features (Low Priority)

Nice-to-have formalizations:

### agent-relay-517: Hierarchical roles in protocol (P3)

**Priority:** P3 (Formalization, not new feature)
**Effort:** 1-2 days (8-16 hours)
**Depends on:** agent-relay-510, agent-relay-512

**Description:**
Add role fields to protocol to formalize existing StatelessLeadCoordinator patterns. Low priority because it works without protocol changes.

**Files to modify:**
- `src/protocol/types.ts` - Add `role`, `parentAgent`, `canSpawnChildren` to HelloPayload
- `src/daemon/server.ts` - Validate spawn permissions based on role
- `.claude/agents/*.md` - Add `role:` to all profiles
- `src/dashboard/` - Hierarchy visualization

**Acceptance criteria:**
- [ ] HelloPayload has role fields
- [ ] Daemon enforces canSpawnChildren
- [ ] All 18 profiles have role
- [ ] Dashboard shows hierarchy tree view

---

## Dependency Graph

```
P0 Quick Wins (parallel):
┌─────────────────────────────────────────┐
│  agent-relay-510 (model selection)      │
│  agent-relay-511 (documentation)        │
│  agent-relay-512 (role prompts)         │
└─────────────────┬───────────────────────┘
                  │
                  ▼
         P1 Validation Testing:
┌─────────────────────────────────────────┐
│  agent-relay-513 (scale test)           │
│  agent-relay-514 (drift test)           │
└─────────────┬───────────┬───────────────┘
              │           │
         GO? ─┘           └─ GO?
              │               │
              ▼               ▼
    agent-relay-515     agent-relay-516
    (optimistic)        (fresh starts)
```

---

## Beads Commands

```bash
# Start P0 quick wins (all parallel)
bd update agent-relay-510 --status=in_progress
bd update agent-relay-511 --status=in_progress
bd update agent-relay-512 --status=in_progress

# After P0 complete, run tests
bd update agent-relay-513 --status=in_progress
bd update agent-relay-514 --status=in_progress

# Conditional on test results
# Only if agent-relay-513 shows bottleneck:
bd update agent-relay-515 --status=in_progress

# Only if agent-relay-514 shows drift:
bd update agent-relay-516 --status=in_progress

# Optional formalization:
bd update agent-relay-517 --status=in_progress
```

---

## Success Metrics

**After P0 (Week 1-2):**
- [ ] Model selection reduces costs by 20%+ (measure baseline first)
- [ ] 5+ hierarchical agent sessions use role prompts
- [ ] Existing features documented with 3 examples
- [ ] User feedback: "I didn't know we had consensus!"

**After P1 (Week 2):**
- [ ] 20+ agent scale test completed
- [ ] Long-running drift test completed
- [ ] Evidence-based decisions on P2 features
- [ ] Test reports published

**After P2 (If needed):**
- [ ] Optimistic concurrency: 20 agents = 20 effective throughput
- [ ] Auto fresh starts: No quality degradation after 2+ hours
- [ ] Formal metrics tracked

---

## References

- `docs/proposals/cursor-scaling-agents-analysis.md` - Full analysis
- `docs/proposals/cursor-analysis-existing-features-audit.md` - What we already have
- `docs/proposals/cursor-bottom-line-gaps.md` - Real gaps vs. theory
- `docs/TASKS_2026_01_16.md` - PTY/cloud tasks (different scope)

---

*Tasks generated by: Lead agent*
*Date: January 16, 2026*
