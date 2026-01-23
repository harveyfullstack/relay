# Dashboard Extraction Plan

Extract the dashboard into a separate optional npm package so that CLI-only users don't need to install dashboard dependencies.

## Current State

### Package Structure

| Component | Location | Description |
|-----------|----------|-------------|
| CLI Core | `agent-relay` (npm) | Main package with daemon, wrapper, protocol |
| Dashboard Server | `packages/dashboard-server` | Express/WebSocket server (`@agent-relay/dashboard-server`) |
| Dashboard UI | `src/dashboard` | Next.js frontend (`@agent-relay/dashboard-v2`, private) |
| Built UI | `dist/dashboard/out` | Static export served by dashboard-server |

### Current Integration

1. **CLI `up` command** (src/cli/index.ts:433-456):
   - Dashboard is disabled by default (`--dashboard` flag enables it)
   - Uses dynamic import: `await import('@agent-relay/dashboard-server')`
   - Passes callbacks for daemon integration (`onMarkSpawning`, `onClearSpawning`)

2. **Dashboard Server** (packages/dashboard-server):
   - Depends on 10+ internal packages (protocol, config, storage, bridge, etc.)
   - Serves static Next.js export from `dist/dashboard/out`
   - Provides WebSocket endpoints for real-time updates
   - Handles spawn/release API

3. **Cloud Workspaces** (deploy/workspace/):
   - `entrypoint.sh` runs: `node /app/dist/cli/index.js up --dashboard --port 3888`
   - Dockerfile includes full build but skips dashboard UI build (line 29)
   - Health check depends on dashboard endpoint

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLI-only Installation                       │
│                                                                   │
│  npm install -g agent-relay                                       │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │   daemon    │  │   wrapper   │  │  protocol   │               │
│  └─────────────┘  └─────────────┘  └─────────────┘               │
│                                                                   │
│  Commands: up, down, create-agent, agents, who, send, etc.       │
│  NOTE: --dashboard flag shows error with install instructions     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Dashboard Installation                          │
│                                                                   │
│  npm install -g @agent-relay/dashboard                            │
│                                                                   │
│  ┌─────────────────────────────────────────────────┐             │
│  │              @agent-relay/dashboard             │             │
│  │  ┌─────────────────────┐  ┌─────────────────┐  │             │
│  │  │  dashboard-server   │  │   dashboard-ui  │  │             │
│  │  │  (Express + WS)     │  │   (Next.js)     │  │             │
│  │  └─────────────────────┘  └─────────────────┘  │             │
│  └─────────────────────────────────────────────────┘             │
│                                                                   │
│  Peer dependency: agent-relay                                     │
│  Auto-detected when --dashboard flag is used                      │
└─────────────────────────────────────────────────────────────────┘
```

## Package Design

### New Package: `@agent-relay/dashboard`

```json
{
  "name": "@agent-relay/dashboard",
  "version": "1.0.0",
  "description": "Web dashboard for Agent Relay",
  "main": "dist/index.js",
  "bin": {
    "agent-relay-dashboard": "dist/cli.js"
  },
  "peerDependencies": {
    "agent-relay": ">=1.6.0"
  },
  "dependencies": {
    "express": "^5.2.1",
    "ws": "^8.18.3"
  }
}
```

### Package Contents

```
@agent-relay/dashboard/
├── dist/
│   ├── index.js          # Main export (startDashboard)
│   ├── cli.js            # Standalone CLI entry
│   ├── server/           # Express server code
│   └── ui/               # Built Next.js static files
├── package.json
└── README.md
```

### Files to Move

#### To `@agent-relay/dashboard`:

| Current Location | New Location | Notes |
|------------------|--------------|-------|
| `packages/dashboard-server/src/*` | `src/server/` | Server code |
| `src/dashboard/*` | `src/ui/` | Next.js source |
| `src/dashboard/out/*` | `dist/ui/` | Built static files |

#### Stay in `agent-relay`:

- `packages/daemon/` - Core daemon
- `packages/protocol/` - Wire protocol
- `packages/wrapper/` - CLI wrapper
- `packages/config/` - Configuration
- `packages/storage/` - SQLite adapter
- `packages/bridge/` - Multi-project (but may need split)
- All other core packages

## CLI Detection Mechanism

### Option A: Dynamic Import Detection (Recommended)

```typescript
// src/cli/index.ts - up command

if (options.dashboard === true) {
  try {
    const { startDashboard } = await import('@agent-relay/dashboard');
    dashboardPort = await startDashboard({ ... });
    console.log(`Dashboard: http://localhost:${dashboardPort}`);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(`
Dashboard package not installed.

To use the web dashboard, install it:
  npm install -g @agent-relay/dashboard

Or run without dashboard:
  agent-relay up
`);
      process.exit(1);
    }
    throw err;
  }
}
```

### Option B: require.resolve Check

```typescript
// Check if dashboard is available before import
function isDashboardInstalled(): boolean {
  try {
    require.resolve('@agent-relay/dashboard');
    return true;
  } catch {
    return false;
  }
}
```

**Recommendation**: Option A is cleaner and handles the error at the point of use.

## Daemon-Dashboard Communication

The dashboard server connects to the daemon via Unix socket. This interface should be formalized:

### Current Interface (Implicit)

1. **Socket Connection**: Dashboard creates `RelayClient` connecting to daemon socket
2. **HTTP API**: Dashboard exposes `/api/*` endpoints consumed by UI
3. **WebSocket**: Dashboard provides `/ws` for real-time updates
4. **Global Callback**: `global.__broadcastLogOutput` for log streaming

### Proposed Interface (Explicit)

```typescript
// @agent-relay/dashboard exports
export interface DashboardConfig {
  port: number;
  dataDir: string;
  teamDir: string;
  dbPath: string;
  socketPath?: string;          // Path to daemon socket
  projectRoot?: string;
  enableSpawner?: boolean;

  // Callbacks for daemon integration
  onMarkSpawning?: (name: string) => void;
  onClearSpawning?: (name: string) => void;
}

export function startDashboard(config: DashboardConfig): Promise<number>;

// Daemon exposes log streaming via event
export interface DaemonInterface {
  onLogOutput?: (agentName: string, data: string, timestamp: number) => void;
}
```

## Cloud Workspace Compatibility

### Current Setup

```dockerfile
# deploy/workspace/Dockerfile
# Skips dashboard build - no UI in workspace
RUN npx tsc  # Only builds TypeScript, not dashboard

# entrypoint.sh runs with --dashboard flag
exec node /app/dist/cli/index.js up --dashboard --port 3888
```

### With Extraction

Two options:

#### Option 1: Include dashboard in workspace image

```dockerfile
# deploy/workspace/Dockerfile
FROM node:20-slim AS builder
# ... build steps ...
RUN npm ci
RUN npm run build:cli  # New script for CLI-only build

FROM node:20-slim AS runner
COPY --from=builder /app/dist ./dist
# Install dashboard separately in workspace
RUN npm install -g @agent-relay/dashboard@${VERSION}
```

#### Option 2: Bundle dashboard in workspace package (Recommended)

```dockerfile
# deploy/workspace/Dockerfile
# Workspace image includes everything needed for cloud
# No change to build process - dashboard is bundled for cloud

# entrypoint.sh unchanged - --dashboard still works
```

**Recommendation**: Option 2 - keep workspace images self-contained. The extraction only affects npm package distribution, not cloud deployments.

### Dockerfile Changes

```dockerfile
# deploy/workspace/Dockerfile
FROM node:20-slim AS builder
WORKDIR /app

# Install ALL dependencies including dashboard
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build CLI + dashboard for workspace
RUN npm run build

# Runtime stage
FROM node:20-slim
# ... rest unchanged ...
```

## Migration Path

### For CLI-only Users

1. **Current**: `npm install -g agent-relay` (includes dashboard code, unused)
2. **After**: `npm install -g agent-relay` (smaller, no dashboard)

No action required - dashboard was already disabled by default.

### For Dashboard Users

1. **Current**: `npm install -g agent-relay && agent-relay up --dashboard`
2. **After**: `npm install -g agent-relay @agent-relay/dashboard && agent-relay up --dashboard`

**Migration message** (shown once when `--dashboard` fails):

```
The dashboard has moved to a separate package.

Install it once:
  npm install -g @agent-relay/dashboard

Then try again:
  agent-relay up --dashboard
```

### For Cloud Workspaces

No changes required - workspace images bundle everything.

## Bundle Size Impact

### Current npm Package

```
Package: agent-relay@1.6.0
Total size: ~10.5MB
- relay-pty binaries: ~9MB (3 platforms)
- dashboard-server: ~280KB
- dashboard-ui: ~2.5MB (not published - in .npmignore)
```

### After Extraction

```
Package: agent-relay@2.0.0
Total size: ~9.5MB
- relay-pty binaries: ~9MB
- Core packages only

Package: @agent-relay/dashboard@1.0.0
Total size: ~3MB
- dashboard-server: ~300KB
- dashboard-ui: ~2.5MB
```

**Net impact**: CLI-only users save ~1MB (dashboard-server deps).

## Implementation Steps

### Phase 1: Create Dashboard Package Structure

1. Create `packages/dashboard/` directory
2. Move `packages/dashboard-server/` contents to `packages/dashboard/src/server/`
3. Move `src/dashboard/` to `packages/dashboard/src/ui/`
4. Update build scripts for new structure
5. Configure package.json with peer dependencies

### Phase 2: Update CLI Detection

1. Change dynamic import path from `@agent-relay/dashboard-server` to `@agent-relay/dashboard`
2. Add error handling with install instructions
3. Update help text to mention optional dashboard

### Phase 3: Update Build System

1. Add `build:cli-only` script that skips dashboard
2. Update `.npmignore` to exclude dashboard code from main package
3. Add separate publish workflow for dashboard package
4. Update version management (keep versions in sync)

### Phase 4: Update Documentation

1. Update README with new installation instructions
2. Update ARCHITECTURE.md with package split
3. Add migration guide for existing users

### Phase 5: Cloud Workspace Updates

1. Update workspace Dockerfile to include dashboard
2. Test cloud workspace deployments
3. Verify health checks still work

## Alternatives Considered

### 1. Optional Dependency

```json
{
  "optionalDependencies": {
    "@agent-relay/dashboard-server": "*"
  }
}
```

**Rejected**: npm always tries to install optional deps, just doesn't fail on error. Users would still download dashboard code.

### 2. Monorepo with Separate Packages

Keep everything in monorepo but publish separately.

**Considered**: This is the recommended approach. The "extraction" is really about npm publishing, not code location.

### 3. Plugin Architecture

```typescript
// Register dashboard as plugin
relay.use('@agent-relay/dashboard');
```

**Rejected**: Over-engineered for this use case. Simple optional package is sufficient.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Version mismatch between CLI and dashboard | Use peer dependencies with version range |
| Breaking existing cloud deployments | No change to cloud - dashboard bundled |
| Confusing installation process | Clear error messages with copy-paste commands |
| Maintaining two packages | Keep in monorepo, automated versioning |

## Success Criteria

1. `npm install -g agent-relay` installs without dashboard code
2. `agent-relay up` works without dashboard
3. `agent-relay up --dashboard` shows helpful error if not installed
4. `npm install -g @agent-relay/dashboard` enables dashboard
5. Cloud workspaces work unchanged
6. Package size reduced for CLI-only users

## Timeline Estimate

- Phase 1: Package restructure - 1-2 days
- Phase 2: CLI detection - 0.5 days
- Phase 3: Build system - 1 day
- Phase 4: Documentation - 0.5 days
- Phase 5: Cloud testing - 0.5 days

**Total**: 3-5 days
