# Phase 6 Execution Plan: Daemon + CLI Extraction

## Summary
Extract remaining core modules to complete the npm package monorepo structure.

## Current State (Post-Phase 5)

### Already Extracted Packages
| Package | Status | Tests |
|---------|--------|-------|
| @relay/protocol | ✅ Complete | - |
| @relay/config | ✅ Complete | - |
| @relay/storage | ✅ Complete | - |
| @relay/bridge | ✅ Complete | - |
| @relay/continuity | ✅ Complete | - |
| @relay/trajectory | ✅ Complete | - |
| @relay/hooks | ✅ Complete | - |
| @relay/resiliency | ✅ Complete (Phase 5) | - |
| @relay/state | ✅ Complete (Phase 4) | 19 |
| @relay/policy | ✅ Complete (Phase 4) | 0 |
| @relay/memory | ✅ Complete (Phase 4) | 55 |
| @relay/utils | ✅ Complete (Phase 4) | 105 |
| @agent-relay/wrapper | ✅ Complete | - |
| @agent-relay/sdk | ✅ Complete | - |

### Remaining Extraction Targets
| Directory | Target Package | Complexity | Blockers |
|-----------|---------------|------------|----------|
| daemon/ | @relay/daemon | High | Circular with bridge via user-directory |
| cli/ | @relay/cli | Medium | Depends on daemon, bridge |
| cloud/ | @relay/cloud | Medium | Depends on daemon |
| dashboard-server/ | @relay/dashboard-server | Medium | Depends on daemon, bridge |

---

## Critical Issue: Circular Dependency

### The Cycle
```
daemon/orchestrator.ts ──────┐
daemon/spawn-manager.ts ─────┼──→ bridge/spawner.ts ──→ daemon/user-directory.ts
                             │
                      (creates cycle)
```

### Root Cause
- `bridge/spawner.ts` imports `getUserDirectoryService` from `daemon/user-directory.ts`
- `daemon/orchestrator.ts` and `daemon/spawn-manager.ts` import `AgentSpawner` from `bridge/spawner.ts`

### Solution: Extract user-directory First
`user-directory.ts` has minimal dependencies:
- Only imports: `@relay/resiliency/logger` (already extracted)
- No circular dependencies within the file itself

**Extract to**: `@relay/config/user-directory` (fits with config pattern)

---

## Phase 6 Execution Order

### Phase 6A: Break Circular Dependency
**Extract user-directory.ts to @relay/config**

1. Copy `src/daemon/user-directory.ts` to `packages/config/src/user-directory.ts`
2. Update import: `../resiliency/logger.js` → `@relay/resiliency/logger`
3. Add export to `packages/config/src/index.ts`
4. Add subpath export to `packages/config/package.json`
5. Create backward-compat shim in `src/daemon/user-directory.ts`
6. Update `bridge/spawner.ts` to import from `@relay/config/user-directory`
7. Build and test

**Estimated time**: 15-20 minutes

### Phase 6B: Extract Daemon Core
**Create @relay/daemon package**

Files to extract (non-test):
- server.ts (core daemon)
- router.ts (message routing)
- connection.ts (client connections)
- agent-registry.ts, registry.ts
- orchestrator.ts
- spawn-manager.ts
- agent-manager.ts
- workspace-manager.ts
- types.ts
- enhanced-features.ts
- agent-signing.ts
- consensus.ts, consensus-integration.ts
- delivery-tracker.ts
- sync-queue.ts
- cloud-sync.ts
- rate-limiter.ts
- cli-auth.ts
- auth.ts
- api.ts
- repo-manager.ts
- channel-membership-store.ts
- index.ts

Dependencies to update:
- `../bridge/*` → `@relay/bridge/*`
- `../utils/*` → `@relay/utils/*`
- `../config/*` → `@relay/config/*`
- `../policy/*` → `@relay/policy/*`
- `../wrapper/*` → `@agent-relay/wrapper/*`
- `../resiliency/*` → `@relay/resiliency/*`

**Estimated time**: 45-60 minutes

### Phase 6C: Extract CLI
**Create @relay/cli package**

Files to extract:
- index.ts (main CLI)

Dependencies to update:
- `../daemon/*` → `@relay/daemon/*`
- `../bridge/*` → `@relay/bridge/*`
- `../utils/*` → `@relay/utils/*`
- `../wrapper/*` → `@agent-relay/wrapper/*`
- `../dashboard-server/*` → local/deferred

**Estimated time**: 30-45 minutes

### Phase 6D: Extract Cloud + Dashboard-Server
**Create @relay/cloud and @relay/dashboard-server**

Can be done in parallel or sequentially based on available resources.

**Estimated time**: 45-60 minutes each

---

## Dependency Graph (Post-Phase 6)

```
@relay/cli
    ├── @relay/daemon
    │   ├── @relay/protocol
    │   ├── @relay/config (includes user-directory)
    │   ├── @relay/storage
    │   ├── @relay/bridge
    │   ├── @relay/utils
    │   ├── @relay/policy
    │   └── @relay/resiliency
    ├── @relay/bridge
    │   ├── @relay/config (includes user-directory)
    │   └── @agent-relay/wrapper
    └── @agent-relay/wrapper

@relay/cloud
    ├── @relay/daemon
    └── @relay/storage

@relay/dashboard-server
    ├── @relay/daemon
    ├── @relay/bridge
    └── @relay/storage
```

---

## Execution Checklist

### Pre-Flight
- [ ] Verify all Phase 5 packages build successfully
- [ ] Run full test suite to establish baseline
- [ ] Git status clean on feature branch

### Phase 6A: user-directory
- [ ] Copy user-directory.ts to packages/config/src/
- [ ] Update resiliency import
- [ ] Add to config package exports
- [ ] Create daemon/user-directory.ts shim
- [ ] Update bridge/spawner.ts import
- [ ] Build and test config package
- [ ] Verify no circular dependency warnings

### Phase 6B: daemon
- [ ] Create packages/daemon/ structure
- [ ] Copy all non-test .ts files
- [ ] Update all relative imports to package imports
- [ ] Add dependencies to package.json
- [ ] Create src/daemon/*.ts shims
- [ ] Build and verify
- [ ] Run daemon tests

### Phase 6C: cli
- [ ] Create packages/cli/ structure
- [ ] Copy index.ts
- [ ] Update daemon/bridge/utils imports
- [ ] Handle dashboard-server dynamic import
- [ ] Create src/cli/index.ts shim
- [ ] Build and verify
- [ ] Test CLI commands

### Phase 6D: cloud + dashboard-server
- [ ] Extract cloud/ to @relay/cloud
- [ ] Extract dashboard-server/ to @relay/dashboard-server
- [ ] Update cross-package imports
- [ ] Build and verify
- [ ] Integration test

### Post-Flight
- [ ] Full test suite passes (2300+ tests)
- [ ] Build completes successfully
- [ ] Git commit and push
- [ ] Signal Phase 6 completion

---

## Risk Mitigation

### High Risk: Large daemon/ extraction
- Mitigation: Extract user-directory first to simplify
- Mitigation: Use grep to identify all imports before moving
- Mitigation: Build incrementally after each file group

### Medium Risk: CLI depends on dynamic imports
- Mitigation: Keep dashboard-server import dynamic initially
- Mitigation: Can defer dashboard-server extraction if blocking

### Low Risk: Test failures
- Mitigation: Tests already passing baseline
- Mitigation: Package-level tests remain with package

---

## Notes

- wrapper/ already extracted as @agent-relay/wrapper
- shared/ already a shim to @relay/config
- dashboard/ and landing/ stay in src/ (Next.js apps)
- utils/ has remaining files (tmux-resolver, id-generator) that stay local
