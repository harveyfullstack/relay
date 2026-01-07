# OpenCode Server Integration Specification

## Executive Summary

This spec defines how Agent Relay integrates with [OpenCode Server](https://opencode.ai/docs/server/) to provide an alternative agent backend that offers:

1. **HTTP API-based agent control** instead of PTY-based terminal emulation
2. **Session forking** for context inheritance between parent/child agents
3. **Structured event streaming** via SSE instead of terminal output parsing
4. **mDNS discovery** for multi-host coordination without cloud infrastructure
5. **Seamless cloud production** - connect OpenCode provider and agents just work

---

## Cloud Production Architecture

### User Experience Goal

When a user connects an OpenCode provider in the dashboard, the following should happen automatically:

1. User clicks "Connect OpenCode" in provider settings
2. OAuth flow completes (OpenCode Zen or bring-your-own keys)
3. Agents can now be spawned using OpenCode backend
4. Communication protocol works identically to local agents
5. User sees no difference in workflow

### Cloud Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              User's Browser                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                        Agent Relay Dashboard                          │    │
│  │   [Connect OpenCode] [Spawn Agent] [Send Message]                    │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Agent Relay Cloud                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐   │
│  │  Auth Service   │  │ Provider        │  │ OpenCode Orchestrator       │   │
│  │  (OAuth flows)  │  │ Credentials     │  │                             │   │
│  │                 │  │ (encrypted)     │  │  • Provision instances      │   │
│  │  - OpenCode Zen │  │                 │  │  • Route requests           │   │
│  │  - Anthropic    │  │  opencode: {...}│  │  • Handle session lifecycle │   │
│  │  - OpenAI       │  │  anthropic:{...}│  │  • Sync with local daemon   │   │
│  │  - Google       │  │  openai: {...}  │  │                             │   │
│  └─────────────────┘  └─────────────────┘  └──────────────┬──────────────┘   │
│                                                           │                   │
└───────────────────────────────────────────────────────────│───────────────────┘
                                                            │
                              ┌──────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Cloud OpenCode Instance (per workspace)                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         OpenCode Server                                │  │
│  │                                                                        │  │
│  │   POST /session      - Create agent session                           │  │
│  │   POST /session/:id/message - Send task/message                       │  │
│  │   GET /event         - SSE stream for agent output                    │  │
│  │   POST /session/:id/abort - Stop agent                                │  │
│  │                                                                        │  │
│  │   [Workspace files mounted or synced]                                 │  │
│  │   [Provider credentials injected]                                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              │ SSE Events / HTTP Responses
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Local Agent Relay Daemon                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ CloudSyncService│  │ OpenCodeWrapper │  │ RelayClient                 │  │
│  │                 │◀─│ (cloud mode)    │  │                             │  │
│  │ - Heartbeat     │  │                 │  │ - Routes messages           │  │
│  │ - Credential    │  │ - HTTP to cloud │  │ - Handles spawns            │  │
│  │   sync          │  │ - SSE streaming │  │ - Protocol unchanged        │  │
│  │ - Cross-machine │  │ - Session mgmt  │  │                             │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Provider Integration

#### Adding OpenCode as Provider Type

```typescript
// src/daemon/types.ts

// Add 'opencode' to existing provider types
export type ProviderType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'generic';

// OpenCode-specific provider config
export interface OpenCodeProviderConfig {
  /** OpenCode Zen subscription (managed by opencode.ai) */
  zenEnabled?: boolean;
  /** Or bring-your-own provider credentials */
  providers?: {
    anthropic?: { accessToken: string; refreshToken?: string };
    openai?: { accessToken: string; refreshToken?: string };
    google?: { apiKey: string };
  };
  /** Preferred model for this workspace */
  preferredModel?: string;
}
```

#### Credential Flow

```typescript
// src/daemon/opencode-provider.ts

export class OpenCodeProvider {
  /**
   * Connect OpenCode provider via OAuth or API key
   * Called when user clicks "Connect OpenCode" in dashboard
   */
  async connect(method: 'zen' | 'anthropic' | 'openai' | 'google'): Promise<AuthSession> {
    if (method === 'zen') {
      // OpenCode Zen - managed subscription
      return startCLIAuth('opencode', { useDeviceFlow: true });
    }

    // Bring-your-own provider
    return startCLIAuth(method);
  }

  /**
   * Check if OpenCode is configured and ready
   */
  async isReady(): Promise<boolean> {
    // Check for any valid credentials
    const creds = await this.getCredentials();
    return creds !== null;
  }

  /**
   * Get credentials for cloud OpenCode instance
   * These are synced to the cloud and injected into OpenCode server
   */
  async getCredentials(): Promise<OpenCodeCredentials | null> {
    // Try OpenCode Zen first
    const zenCreds = await extractOpenCodeCredentials('opencode');
    if (zenCreds) return { type: 'zen', ...zenCreds };

    // Try individual providers
    for (const provider of ['anthropic', 'openai', 'google']) {
      const creds = await extractOpenCodeCredentials(provider);
      if (creds) return { type: provider, ...creds };
    }

    return null;
  }
}
```

### Cloud OpenCode Orchestrator

The cloud component that manages OpenCode instances:

```typescript
// Agent Relay Cloud: src/services/opencode-orchestrator.ts

export class OpenCodeOrchestrator {
  private instances: Map<string, OpenCodeInstance> = new Map();

  /**
   * Provision or get OpenCode instance for a workspace
   * Called when spawning an agent with OpenCode provider
   */
  async getOrCreateInstance(workspaceId: string): Promise<OpenCodeInstance> {
    let instance = this.instances.get(workspaceId);

    if (!instance || !instance.isHealthy()) {
      instance = await this.provisionInstance(workspaceId);
      this.instances.set(workspaceId, instance);
    }

    return instance;
  }

  /**
   * Provision new OpenCode server instance
   */
  private async provisionInstance(workspaceId: string): Promise<OpenCodeInstance> {
    // 1. Get workspace config and credentials
    const workspace = await this.getWorkspace(workspaceId);
    const credentials = await this.getCredentials(workspace.userId);

    // 2. Start OpenCode server (container or serverless)
    const instance = await this.startOpenCodeServer({
      workspaceId,
      projectPath: workspace.path,
      credentials,
      // OpenCode server config
      config: {
        model: workspace.preferredModel,
        providers: this.buildProviderConfig(credentials),
      },
    });

    // 3. Wait for health check
    await instance.waitForReady();

    return instance;
  }

  /**
   * Forward spawn request to OpenCode instance
   */
  async spawnAgent(
    workspaceId: string,
    request: SpawnRequest
  ): Promise<SpawnResult> {
    const instance = await this.getOrCreateInstance(workspaceId);

    // Create session on OpenCode server
    const session = await instance.createSession({
      directory: request.cwd,
    });

    // Send initial task
    if (request.task) {
      await instance.sendMessage(session.id, request.task);
    }

    // Return session info for local daemon to track
    return {
      success: true,
      name: request.name,
      sessionId: session.id,
      instanceUrl: instance.url,
    };
  }

  /**
   * Proxy message to OpenCode session
   */
  async sendMessage(
    workspaceId: string,
    sessionId: string,
    content: string
  ): Promise<void> {
    const instance = await this.getOrCreateInstance(workspaceId);
    await instance.sendMessage(sessionId, content);
  }

  /**
   * Stream events from OpenCode to local daemon
   */
  createEventStream(
    workspaceId: string,
    sessionId: string
  ): ReadableStream<OpenCodeEvent> {
    const instance = this.instances.get(workspaceId);
    if (!instance) throw new Error('No instance for workspace');

    return instance.createEventStream(sessionId);
  }
}
```

### Local Daemon Cloud Integration

```typescript
// src/wrapper/opencode-cloud-wrapper.ts

/**
 * OpenCodeWrapper variant that connects to cloud-hosted OpenCode
 * Used when RELAY_CLOUD_ENABLED=true and OpenCode provider is configured
 */
export class OpenCodeCloudWrapper extends BaseWrapper {
  private cloudUrl: string;
  private workspaceId: string;
  private sessionId?: string;
  private eventSource?: EventSource;

  constructor(config: OpenCodeCloudWrapperConfig) {
    super(config);
    this.cloudUrl = config.cloudUrl ?? process.env.AGENT_RELAY_CLOUD_URL!;
    this.workspaceId = config.workspaceId;
  }

  async start(): Promise<void> {
    // 1. Request cloud to spawn agent
    const response = await fetch(`${this.cloudUrl}/api/opencode/spawn`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.cloudToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: this.workspaceId,
        name: this.config.name,
        task: this.config.task,
        cwd: this.config.cwd,
        inheritFromSession: this.config.forkFromSession,
      }),
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error);
    }

    this.sessionId = result.sessionId;
    this.running = true;

    // 2. Connect to relay daemon (same as local)
    await this.client.connect();

    // 3. Start SSE stream from cloud
    this.startCloudEventStream(result.instanceUrl);
  }

  private startCloudEventStream(instanceUrl: string): void {
    const url = `${instanceUrl}/event?session=${this.sessionId}`;
    this.eventSource = new EventSource(url, {
      headers: {
        'Authorization': `Bearer ${this.config.cloudToken}`,
      },
    });

    this.eventSource.onmessage = (event) => {
      this.handleServerEvent(JSON.parse(event.data));
    };

    this.eventSource.onerror = () => {
      this.handleStreamError();
    };
  }

  protected async performInjection(content: string): Promise<void> {
    // Send message via cloud API
    await fetch(`${this.cloudUrl}/api/opencode/message`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.cloudToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: this.workspaceId,
        sessionId: this.sessionId,
        content,
      }),
    });
  }
}
```

### Seamless Provider Selection

```typescript
// src/wrapper/factory.ts - Extended for cloud

export class WrapperFactory {
  /**
   * Select wrapper based on provider config and cloud availability
   */
  async createWrapper(config: WrapperConfig): Promise<BaseWrapper> {
    const provider = await this.detectProvider(config);

    // Cloud mode: use cloud wrapper if provider is OpenCode and cloud enabled
    if (this.isCloudEnabled() && provider === 'opencode') {
      return new OpenCodeCloudWrapper({
        ...config,
        cloudUrl: this.cloudUrl,
        cloudToken: await this.getCloudToken(),
        workspaceId: this.workspaceId,
      });
    }

    // Local OpenCode server available
    if (provider === 'opencode' && await this.isLocalOpenCodeAvailable()) {
      return new OpenCodeWrapper({
        ...config,
        serverUrl: this.localOpenCodeUrl,
      });
    }

    // Fallback to PTY wrapper
    return new PtyWrapper(config);
  }

  /**
   * Detect which provider to use based on workspace config
   */
  private async detectProvider(config: WrapperConfig): Promise<ProviderType> {
    // Explicit CLI request
    if (config.command === 'opencode') return 'opencode';

    // Check workspace provider setting
    const workspace = await this.getWorkspace();
    if (workspace?.provider === 'opencode') return 'opencode';

    // Check if OpenCode credentials are available
    const opencodeCreds = await this.checkOpenCodeCredentials();
    if (opencodeCreds && this.preferOpenCode) return 'opencode';

    // Default based on CLI
    return this.detectProviderFromCli(config.command);
  }
}
```

### Credential Sync with Cloud

```typescript
// src/daemon/cloud-sync.ts - Extended

export class CloudSyncService {
  /**
   * Sync OpenCode credentials to cloud
   * Called after successful OAuth or when credentials change
   */
  async syncOpenCodeCredentials(): Promise<void> {
    const provider = new OpenCodeProvider();
    const creds = await provider.getCredentials();

    if (!creds) return;

    await fetch(`${this.config.cloudUrl}/api/providers/opencode`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: creds.type,
        accessToken: creds.accessToken,
        refreshToken: creds.refreshToken,
        expiresAt: creds.expiresAt,
      }),
    });
  }

  /**
   * Pull OpenCode credentials from cloud (on startup)
   */
  async pullOpenCodeCredentials(): Promise<OpenCodeCredentials | null> {
    const response = await fetch(`${this.config.cloudUrl}/api/providers/opencode`, {
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.credentials;
  }
}
```

### Dashboard Integration

```typescript
// Dashboard: src/components/ProviderSettings.tsx

export function ProviderSettings() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);

  // Connect OpenCode provider
  const connectOpenCode = async (method: 'zen' | 'anthropic' | 'openai') => {
    // 1. Start OAuth flow
    const session = await api.startAuth('opencode', { method });

    // 2. Open OAuth popup
    window.open(session.authUrl, 'oauth', 'width=600,height=700');

    // 3. Poll for completion
    const result = await pollAuthCompletion(session.id);

    if (result.success) {
      // 4. Sync credentials to cloud
      await api.syncCredentials('opencode');

      // 5. Update UI
      toast.success('OpenCode connected! You can now spawn agents.');
      refreshProviders();
    }
  };

  return (
    <div>
      <h2>AI Providers</h2>

      {/* OpenCode - Featured */}
      <ProviderCard
        name="OpenCode"
        description="Multi-provider agent runtime. Use OpenCode Zen or bring your own keys."
        connected={providers.find(p => p.type === 'opencode')?.connected}
        onConnect={() => setShowOpenCodeModal(true)}
      />

      {/* OpenCode connection modal */}
      <OpenCodeConnectModal
        open={showOpenCodeModal}
        onConnect={connectOpenCode}
        onClose={() => setShowOpenCodeModal(false)}
      />

      {/* Other providers */}
      <ProviderCard name="Claude" ... />
      <ProviderCard name="Codex" ... />
    </div>
  );
}
```

### Message Flow in Cloud Mode

```
User spawns agent "Backend" with task "Implement auth"
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ Local Daemon                                                     │
│   WrapperFactory.createWrapper()                                │
│     → Detects OpenCode provider + cloud enabled                 │
│     → Creates OpenCodeCloudWrapper                              │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼ POST /api/opencode/spawn
┌─────────────────────────────────────────────────────────────────┐
│ Agent Relay Cloud                                                │
│   OpenCodeOrchestrator.spawnAgent()                             │
│     → Gets/creates OpenCode instance for workspace              │
│     → Creates session: POST /session                            │
│     → Sends task: POST /session/:id/message                     │
│     → Returns { sessionId, instanceUrl }                        │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼ SSE: /event?session=xxx
┌─────────────────────────────────────────────────────────────────┐
│ Local Daemon (OpenCodeCloudWrapper)                             │
│   Receives SSE events from cloud OpenCode instance              │
│     → Parses ->relay: patterns                                  │
│     → Routes via RelayClient (same as PTY)                      │
│     → Dashboard sees agent output                               │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼ ->relay:Frontend <<<message>>>
┌─────────────────────────────────────────────────────────────────┐
│ RelayClient routes to Frontend agent                            │
│   (Protocol unchanged - works exactly like local agents)        │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration

```bash
# Enable cloud mode
RELAY_CLOUD_ENABLED=true
AGENT_RELAY_API_KEY=ar_xxx

# OpenCode will use cloud instances automatically
# No additional configuration needed

# Override: force local OpenCode server
OPENCODE_SERVER_URL=http://localhost:4096
RELAY_OPENCODE_PREFER_LOCAL=true
```

### Security Considerations

1. **Credential Storage**: Provider credentials encrypted at rest in cloud
2. **Token Refresh**: Cloud handles OAuth token refresh automatically
3. **Workspace Isolation**: Each workspace gets isolated OpenCode instance
4. **Network Security**: All cloud traffic over HTTPS
5. **Session Cleanup**: Idle sessions terminated after 30 minutes

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Agent Relay Daemon                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────┐     ┌────────────────┐     ┌────────────────┐           │
│  │  AgentSpawner  │────▶│ WrapperFactory │────▶│ PtyWrapper     │           │
│  │                │     │                │     │ (existing)     │           │
│  │ spawn()        │     │ createWrapper()│     ├────────────────┤           │
│  │ release()      │     │                │────▶│ OpenCodeWrapper│ ◀── NEW   │
│  └────────────────┘     └────────────────┘     │ (new)          │           │
│         │                                       └───────┬────────┘           │
│         │                                               │                    │
│         ▼                                               ▼                    │
│  ┌────────────────┐                          ┌─────────────────────┐        │
│  │ RelayClient    │◀─────────────────────────│ OpenCode SDK        │        │
│  │ (Unix socket)  │                          │ @opencode-ai/sdk    │        │
│  └────────────────┘                          └──────────┬──────────┘        │
│                                                         │                    │
└─────────────────────────────────────────────────────────│────────────────────┘
                                                          │
                                                          ▼
                                              ┌─────────────────────┐
                                              │  OpenCode Server    │
                                              │  (localhost:4096)   │
                                              │                     │
                                              │  POST /session      │
                                              │  POST /session/:id/ │
                                              │       message       │
                                              │  GET /event (SSE)   │
                                              └─────────────────────┘
```

## Component Specifications

### 1. OpenCodeWrapper

**File:** `src/wrapper/opencode-wrapper.ts`

A new wrapper class that extends `BaseWrapper` and uses OpenCode's HTTP API instead of node-pty.

```typescript
import { BaseWrapper, BaseWrapperConfig } from './base-wrapper.js';
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk';

export interface OpenCodeWrapperConfig extends BaseWrapperConfig {
  /** OpenCode server base URL (default: http://localhost:4096) */
  serverUrl?: string;
  /** Session ID to fork from (for child agents) */
  forkFromSession?: string;
  /** Model override (if supported by OpenCode server) */
  model?: string;
  /** Project directory (required by OpenCode) */
  projectDir: string;
}

export interface OpenCodeWrapperEvents {
  output: (data: string) => void;
  exit: (code: number) => void;
  error: (error: Error) => void;
  'session-created': (sessionId: string) => void;
  'message-sent': (messageId: string) => void;
}

export class OpenCodeWrapper extends BaseWrapper {
  private client: OpencodeClient;
  private sessionId?: string;
  private eventSource?: EventSource;
  private outputBuffer: string[] = [];

  constructor(config: OpenCodeWrapperConfig) {
    super(config);
    this.client = createOpencodeClient({
      baseUrl: config.serverUrl ?? 'http://localhost:4096'
    });
  }

  // =========================================================================
  // Abstract method implementations (required by BaseWrapper)
  // =========================================================================

  async start(): Promise<void> {
    // 1. Create or fork session
    if (this.config.forkFromSession) {
      // Fork from parent session (inherits context)
      this.sessionId = await this.forkSession(this.config.forkFromSession);
    } else {
      // Create new session
      this.sessionId = await this.createSession();
    }

    this.emit('session-created', this.sessionId);
    this.running = true;

    // 2. Connect to relay daemon
    await this.client.connect();

    // 3. Start event streaming
    this.startEventStream();

    // 4. Send initial task if provided
    if (this.config.task) {
      await this.sendTask(this.config.task);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopEventStream();

    // Graceful session close (agent can save state)
    if (this.sessionId) {
      await this.client.session.abort(this.sessionId);
    }

    this.destroyClient();
  }

  protected async performInjection(content: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    // Send message via OpenCode API
    await this.client.message.send(this.sessionId, {
      content,
      directory: this.config.projectDir,
    });
  }

  protected getCleanOutput(): string {
    return this.outputBuffer.join('\n');
  }

  // =========================================================================
  // OpenCode-specific methods
  // =========================================================================

  private async createSession(): Promise<string> {
    const session = await this.client.session.create({
      directory: this.config.projectDir,
    });
    return session.id;
  }

  private async forkSession(parentId: string): Promise<string> {
    // OpenCode's session sharing/fork API
    const forked = await this.client.session.fork(parentId);
    return forked.id;
  }

  private startEventStream(): void {
    const url = `${this.config.serverUrl ?? 'http://localhost:4096'}/event`;
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (event) => {
      this.handleServerEvent(JSON.parse(event.data));
    };

    this.eventSource.onerror = (error) => {
      this.emit('error', new Error('Event stream error'));
    };
  }

  private stopEventStream(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
  }

  private handleServerEvent(event: OpenCodeEvent): void {
    switch (event.type) {
      case 'message':
        // Agent output - emit and buffer
        this.outputBuffer.push(event.content);
        this.emit('output', event.content);

        // Parse for relay commands (->relay: patterns)
        this.parseRelayCommands();
        break;

      case 'session.end':
        this.running = false;
        this.emit('exit', 0);
        break;

      case 'error':
        this.emit('error', new Error(event.message));
        break;
    }
  }

  private async sendTask(task: string): Promise<void> {
    if (!this.sessionId) return;

    await this.client.message.send(this.sessionId, {
      content: task,
      directory: this.config.projectDir,
    });
  }

  // =========================================================================
  // Public API extensions
  // =========================================================================

  /** Get the OpenCode session ID */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /** Fork this agent's session for a child agent */
  async forkForChild(): Promise<string> {
    if (!this.sessionId) {
      throw new Error('No active session to fork');
    }
    return this.forkSession(this.sessionId);
  }
}
```

### 2. WrapperFactory

**File:** `src/wrapper/factory.ts`

A factory that selects the appropriate wrapper based on CLI type and configuration.

```typescript
import { BaseWrapper, BaseWrapperConfig } from './base-wrapper.js';
import { PtyWrapper, PtyWrapperConfig } from './pty-wrapper.js';
import { OpenCodeWrapper, OpenCodeWrapperConfig } from './opencode-wrapper.js';

export type WrapperType = 'pty' | 'opencode' | 'auto';

export interface WrapperFactoryConfig {
  /** Preferred wrapper type (default: 'auto') */
  preferredType?: WrapperType;
  /** OpenCode server URL (for opencode wrapper) */
  opencodeServerUrl?: string;
  /** Whether to probe for OpenCode server availability */
  probeOpenCode?: boolean;
}

export class WrapperFactory {
  private config: WrapperFactoryConfig;
  private opencodeAvailable?: boolean;

  constructor(config: WrapperFactoryConfig = {}) {
    this.config = config;
  }

  /**
   * Create appropriate wrapper for the given agent configuration
   */
  async createWrapper(
    agentConfig: BaseWrapperConfig & Partial<OpenCodeWrapperConfig>
  ): Promise<BaseWrapper> {
    const wrapperType = await this.selectWrapperType(agentConfig);

    switch (wrapperType) {
      case 'opencode':
        return new OpenCodeWrapper({
          ...agentConfig,
          serverUrl: this.config.opencodeServerUrl,
          projectDir: agentConfig.cwd ?? process.cwd(),
        } as OpenCodeWrapperConfig);

      case 'pty':
      default:
        return new PtyWrapper(agentConfig as PtyWrapperConfig);
    }
  }

  /**
   * Select wrapper type based on config, CLI type, and server availability
   */
  private async selectWrapperType(
    agentConfig: BaseWrapperConfig
  ): Promise<WrapperType> {
    // Explicit preference
    if (this.config.preferredType === 'pty') return 'pty';
    if (this.config.preferredType === 'opencode') return 'opencode';

    // Auto-select based on CLI
    const cli = agentConfig.command.toLowerCase();

    // OpenCode native CLIs use OpenCode wrapper when server available
    if (cli === 'opencode') {
      if (await this.isOpenCodeAvailable()) {
        return 'opencode';
      }
    }

    // Default to PTY for all other cases
    return 'pty';
  }

  /**
   * Check if OpenCode server is available (cached)
   */
  private async isOpenCodeAvailable(): Promise<boolean> {
    if (this.opencodeAvailable !== undefined) {
      return this.opencodeAvailable;
    }

    if (!this.config.probeOpenCode) {
      this.opencodeAvailable = false;
      return false;
    }

    try {
      const url = this.config.opencodeServerUrl ?? 'http://localhost:4096';
      const response = await fetch(`${url}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      this.opencodeAvailable = response.ok;
    } catch {
      this.opencodeAvailable = false;
    }

    return this.opencodeAvailable;
  }
}
```

### 3. OpenCodeSpawner

**File:** `src/bridge/opencode-spawner.ts`

Extended spawner that supports OpenCode sessions with context inheritance.

```typescript
import { AgentSpawner, SpawnRequest, SpawnResult } from './spawner.js';
import { WrapperFactory, WrapperType } from '../wrapper/factory.js';
import { OpenCodeWrapper } from '../wrapper/opencode-wrapper.js';

export interface OpenCodeSpawnRequest extends SpawnRequest {
  /** Inherit context from parent session */
  inheritFromSession?: string;
  /** Wrapper type preference */
  wrapperType?: WrapperType;
}

export class OpenCodeSpawner extends AgentSpawner {
  private wrapperFactory: WrapperFactory;
  private sessionRegistry: Map<string, string> = new Map(); // agentName -> sessionId

  constructor(
    projectRoot: string,
    tmuxSession?: string,
    dashboardPort?: number,
    opencodeConfig?: { serverUrl?: string; probeOpenCode?: boolean }
  ) {
    super(projectRoot, tmuxSession, dashboardPort);

    this.wrapperFactory = new WrapperFactory({
      opencodeServerUrl: opencodeConfig?.serverUrl,
      probeOpenCode: opencodeConfig?.probeOpenCode ?? true,
    });
  }

  /**
   * Spawn agent with optional session inheritance
   */
  async spawnWithContext(request: OpenCodeSpawnRequest): Promise<SpawnResult> {
    // If inheriting from parent, get the parent's session ID
    let forkFromSession: string | undefined;

    if (request.inheritFromSession) {
      forkFromSession = this.sessionRegistry.get(request.inheritFromSession);
      if (!forkFromSession) {
        console.warn(
          `[opencode-spawner] Parent session not found for ${request.inheritFromSession}`
        );
      }
    }

    // Create wrapper via factory
    const wrapper = await this.wrapperFactory.createWrapper({
      name: request.name,
      command: request.cli,
      task: request.task,
      cwd: request.cwd ?? this.projectRoot,
      socketPath: this.socketPath,
      forkFromSession,
    });

    // Track OpenCode session IDs
    if (wrapper instanceof OpenCodeWrapper) {
      wrapper.on('session-created', (sessionId) => {
        this.sessionRegistry.set(request.name, sessionId);
        console.log(
          `[opencode-spawner] Registered session ${sessionId} for ${request.name}`
        );
      });
    }

    // Use base class spawn logic for lifecycle management
    return this.spawn(request);
  }

  /**
   * Get session ID for an agent (for forking)
   */
  getSessionId(agentName: string): string | undefined {
    return this.sessionRegistry.get(agentName);
  }

  /**
   * Release agent and clean up session registry
   */
  async release(name: string): Promise<boolean> {
    this.sessionRegistry.delete(name);
    return super.release(name);
  }
}
```

### 4. OpenCode Discovery Service

**File:** `src/discovery/opencode-discovery.ts`

mDNS-based discovery for OpenCode servers on the network.

```typescript
import { createMdnsBrowser, type MdnsService } from 'mdns-js'; // or similar

export interface DiscoveredServer {
  id: string;
  name: string;
  host: string;
  port: number;
  projectPath?: string;
  lastSeen: number;
}

export interface DiscoveryEvents {
  'server-found': (server: DiscoveredServer) => void;
  'server-lost': (serverId: string) => void;
}

export class OpenCodeDiscovery extends EventEmitter {
  private browser?: any;
  private servers: Map<string, DiscoveredServer> = new Map();
  private cleanupInterval?: NodeJS.Timer;

  /**
   * Start discovering OpenCode servers on the network
   */
  start(): void {
    // OpenCode advertises via mDNS when started with --mdns flag
    this.browser = createMdnsBrowser('_opencode._tcp');

    this.browser.on('serviceUp', (service: MdnsService) => {
      const server: DiscoveredServer = {
        id: service.fullname,
        name: service.name,
        host: service.addresses[0],
        port: service.port,
        projectPath: service.txt?.projectPath,
        lastSeen: Date.now(),
      };

      this.servers.set(server.id, server);
      this.emit('server-found', server);
    });

    this.browser.on('serviceDown', (service: MdnsService) => {
      this.servers.delete(service.fullname);
      this.emit('server-lost', service.fullname);
    });

    this.browser.start();

    // Cleanup stale servers every 30s
    this.cleanupInterval = setInterval(() => this.cleanupStale(), 30000);
  }

  /**
   * Stop discovery
   */
  stop(): void {
    if (this.browser) {
      this.browser.stop();
      this.browser = undefined;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Get all discovered servers
   */
  getServers(): DiscoveredServer[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get server by project path
   */
  findByProject(projectPath: string): DiscoveredServer | undefined {
    for (const server of this.servers.values()) {
      if (server.projectPath === projectPath) {
        return server;
      }
    }
    return undefined;
  }

  private cleanupStale(): void {
    const staleThreshold = Date.now() - 60000; // 60s
    for (const [id, server] of this.servers) {
      if (server.lastSeen < staleThreshold) {
        this.servers.delete(id);
        this.emit('server-lost', id);
      }
    }
  }
}
```

### 5. Dashboard API Extensions

**File:** `src/dashboard-server/routes/opencode.ts`

New API routes for OpenCode-specific functionality.

```typescript
import { Router } from 'express';
import { OpenCodeSpawner } from '../../bridge/opencode-spawner.js';
import { OpenCodeDiscovery } from '../../discovery/opencode-discovery.js';

export function createOpenCodeRoutes(
  spawner: OpenCodeSpawner,
  discovery: OpenCodeDiscovery
): Router {
  const router = Router();

  /**
   * GET /api/opencode/servers
   * List discovered OpenCode servers on the network
   */
  router.get('/servers', (_req, res) => {
    const servers = discovery.getServers();
    res.json({ servers });
  });

  /**
   * POST /api/opencode/spawn
   * Spawn agent with OpenCode backend and optional context inheritance
   */
  router.post('/spawn', async (req, res) => {
    const { name, cli, task, inheritFrom, wrapperType } = req.body;

    try {
      const result = await spawner.spawnWithContext({
        name,
        cli: cli ?? 'opencode',
        task,
        inheritFromSession: inheritFrom,
        wrapperType,
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/opencode/sessions/:name
   * Get OpenCode session info for an agent
   */
  router.get('/sessions/:name', (req, res) => {
    const sessionId = spawner.getSessionId(req.params.name);
    if (!sessionId) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ sessionId, agentName: req.params.name });
  });

  /**
   * POST /api/opencode/fork/:name
   * Fork an agent's session for a child agent
   */
  router.post('/fork/:name', async (req, res) => {
    const { childName, task } = req.body;
    const parentSession = spawner.getSessionId(req.params.name);

    if (!parentSession) {
      return res.status(404).json({ error: 'Parent session not found' });
    }

    try {
      const result = await spawner.spawnWithContext({
        name: childName,
        cli: 'opencode',
        task,
        inheritFromSession: req.params.name,
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
```

## Integration Points

### 1. Spawner Integration

Modify `AgentSpawner` to optionally use `WrapperFactory`:

```typescript
// src/bridge/spawner.ts

export class AgentSpawner {
  private wrapperFactory?: WrapperFactory;

  // Option to enable OpenCode integration
  enableOpenCode(config?: { serverUrl?: string }): void {
    this.wrapperFactory = new WrapperFactory({
      opencodeServerUrl: config?.serverUrl,
      probeOpenCode: true,
    });
  }

  async spawn(request: SpawnRequest): Promise<SpawnResult> {
    // ... existing validation ...

    // Use factory if available, otherwise default to PtyWrapper
    let wrapper: BaseWrapper;
    if (this.wrapperFactory) {
      wrapper = await this.wrapperFactory.createWrapper({
        name: request.name,
        command: request.cli,
        // ... rest of config
      });
    } else {
      wrapper = new PtyWrapper(/* ... */);
    }

    // ... rest of spawn logic ...
  }
}
```

### 2. CLI Integration

Add `--opencode` flag to agent-relay CLI:

```typescript
// src/cli/index.ts

program
  .option('--opencode [url]', 'Enable OpenCode server integration')
  .option('--opencode-discover', 'Enable mDNS discovery for OpenCode servers');

// In daemon startup:
if (options.opencode) {
  const serverUrl = typeof options.opencode === 'string'
    ? options.opencode
    : 'http://localhost:4096';
  spawner.enableOpenCode({ serverUrl });
}

if (options.opencodeDiscover) {
  const discovery = new OpenCodeDiscovery();
  discovery.start();
  // Register routes...
}
```

### 3. Relay Protocol Extensions

Add new message types for OpenCode-specific features:

```typescript
// src/protocol/types.ts

// New payload types
export interface SessionForkPayload {
  parentSession: string;
  childAgent: string;
  task?: string;
}

export interface SessionInfoPayload {
  sessionId: string;
  agentName: string;
  wrapperType: 'pty' | 'opencode';
  serverUrl?: string;
}

// Extended HELLO payload
export interface HelloPayload {
  // ... existing fields ...

  /** OpenCode session ID (if using OpenCode wrapper) */
  opencodeSession?: string;
  /** Wrapper type being used */
  wrapperType?: 'pty' | 'opencode';
}
```

## Data Flow

### Session Creation Flow

```
1. User/Agent requests spawn with inheritFrom=ParentAgent
       │
       ▼
2. OpenCodeSpawner.spawnWithContext()
       │
       ├──▶ Look up parent's sessionId from registry
       │
       ▼
3. WrapperFactory.createWrapper()
       │
       ├──▶ Select wrapper type (opencode if server available)
       │
       ▼
4. OpenCodeWrapper.start()
       │
       ├──▶ POST /session/fork with parent sessionId
       │    (inherits conversation context)
       │
       ├──▶ Connect to relay daemon (RelayClient)
       │
       ├──▶ Start SSE event stream (/event)
       │
       ▼
5. Agent ready with inherited context
```

### Message Flow

```
Agent Output (via SSE)             Relay Message (via Unix socket)
        │                                    │
        ▼                                    ▼
  handleServerEvent()              handleIncomingMessage()
        │                                    │
        ├──▶ Buffer output                   ├──▶ Queue message
        │                                    │
        ├──▶ Parse relay commands            ├──▶ Wait for stability
        │    (->relay:Target message)        │
        │                                    ▼
        ▼                             performInjection()
  sendRelayCommand()                         │
        │                                    ▼
        ▼                           POST /session/:id/message
  RelayClient.sendMessage()
        │
        ▼
  Daemon routes to target
```

## Configuration

### Environment Variables

```bash
# OpenCode server URL (default: http://localhost:4096)
OPENCODE_SERVER_URL=http://localhost:4096

# Enable OpenCode integration by default
RELAY_OPENCODE_ENABLED=true

# Enable mDNS discovery
RELAY_OPENCODE_DISCOVER=true

# Prefer OpenCode wrapper when available
RELAY_WRAPPER_PREFERENCE=opencode  # or 'pty' or 'auto'
```

### Configuration File

```json
// .agent-relay/config.json
{
  "opencode": {
    "enabled": true,
    "serverUrl": "http://localhost:4096",
    "discover": true,
    "preferWrapper": "auto"
  }
}
```

## Implementation Phases

### Phase 1: Core Local Wrapper (Week 1)
- [ ] Create `OpenCodeWrapper` class extending `BaseWrapper`
- [ ] Implement session creation/management via OpenCode SDK
- [ ] Implement SSE event streaming
- [ ] Implement message injection via HTTP API
- [ ] Add relay pattern parsing from SSE events
- [ ] Add basic tests

### Phase 2: Factory & Provider (Week 2)
- [ ] Add `'opencode'` to `ProviderType`
- [ ] Create `WrapperFactory` with auto-selection logic
- [ ] Create `OpenCodeProvider` class for credential management
- [ ] Update `AgentSpawner` to use factory optionally
- [ ] Add OpenCode credential extraction to `cli-auth.ts`
- [ ] Add integration tests

### Phase 3: Cloud Integration (Week 3)
- [ ] Create `OpenCodeCloudWrapper` for cloud-hosted instances
- [ ] Extend `CloudSyncService` with OpenCode credential sync
- [ ] Add cloud API endpoints for OpenCode:
  - `POST /api/opencode/spawn`
  - `POST /api/opencode/message`
  - `GET /api/opencode/sessions/:name`
- [ ] Implement `OpenCodeOrchestrator` in cloud service
- [ ] Add workspace-to-instance mapping

### Phase 4: Dashboard & UX (Week 4)
- [ ] Add OpenCode provider card to dashboard
- [ ] Implement OpenCode connection modal (Zen vs BYOK)
- [ ] Add session info to agent cards
- [ ] Update agent spawn UI with wrapper type indicator
- [ ] Add OpenCode-specific error handling

### Phase 5: Discovery & Polish (Week 5)
- [ ] Implement `OpenCodeDiscovery` with mDNS
- [ ] Add CLI flags (`--opencode`, `--opencode-discover`)
- [ ] Configuration file support
- [ ] Performance testing
- [ ] Documentation

## Dependencies

```json
{
  "dependencies": {
    "@opencode-ai/sdk": "^1.0.0",
    "mdns-js": "^1.0.0"  // or alternative mDNS library
  }
}
```

## Testing Strategy

### Unit Tests
- `OpenCodeWrapper` session management
- `WrapperFactory` selection logic
- Event parsing and handling

### Integration Tests
- Full spawn/release cycle with OpenCode backend
- Session forking and context inheritance
- Relay message routing with OpenCode agents

### E2E Tests
- Multi-agent scenario with mixed wrappers
- mDNS discovery across hosts
- Failover from OpenCode to PTY

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OpenCode server unavailable | Agent spawn fails | Fall back to PTY wrapper |
| SSE connection drops | Missed events | Reconnect with backoff; poll for catch-up |
| Session fork not supported | Context inheritance fails | Document as optional feature |
| mDNS not available | Discovery fails | Support manual server registration |
| OpenCode API changes | Integration breaks | Pin SDK version; add version check |

## Success Metrics

1. **Functional**: Can spawn, communicate with, and release OpenCode-backed agents
2. **Performance**: Message latency within 10% of PTY-based agents
3. **Reliability**: 99%+ message delivery rate
4. **Adoption**: CLI flag documented and usable

## Cloud API Specification

### Authentication

All cloud API requests require Bearer token authentication:

```
Authorization: Bearer ar_xxx
```

### Endpoints

#### POST /api/opencode/spawn

Spawn an agent using cloud-hosted OpenCode.

**Request:**
```json
{
  "workspaceId": "ws_xxx",
  "name": "Backend",
  "task": "Implement user authentication",
  "cwd": "/workspace/src",
  "inheritFromSession": "session_parent_xxx"  // optional
}
```

**Response:**
```json
{
  "success": true,
  "name": "Backend",
  "sessionId": "session_xxx",
  "instanceUrl": "https://opencode-ws123.agent-relay.com"
}
```

#### POST /api/opencode/message

Send message to an agent session.

**Request:**
```json
{
  "workspaceId": "ws_xxx",
  "sessionId": "session_xxx",
  "content": "Please also add password validation"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "msg_xxx"
}
```

#### GET /api/opencode/sessions/:name

Get session info for an agent.

**Response:**
```json
{
  "sessionId": "session_xxx",
  "agentName": "Backend",
  "status": "active",
  "instanceUrl": "https://opencode-ws123.agent-relay.com",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

#### DELETE /api/opencode/sessions/:name

Stop agent and clean up session.

**Response:**
```json
{
  "success": true
}
```

#### PUT /api/providers/opencode

Sync OpenCode credentials to cloud.

**Request:**
```json
{
  "type": "zen",  // or "anthropic", "openai", "google"
  "accessToken": "xxx",
  "refreshToken": "xxx",
  "expiresAt": "2024-02-15T10:30:00Z"
}
```

#### GET /api/providers/opencode

Get stored OpenCode credentials.

**Response:**
```json
{
  "credentials": {
    "type": "zen",
    "accessToken": "xxx",
    "refreshToken": "xxx",
    "expiresAt": "2024-02-15T10:30:00Z"
  }
}
```

### SSE Event Stream

The cloud proxies SSE events from OpenCode instances:

```
GET /api/opencode/events?workspaceId=ws_xxx&sessionId=session_xxx

Event: message
Data: {"type": "message", "content": "I'll implement the auth module..."}

Event: tool_use
Data: {"type": "tool_use", "tool": "write_file", "path": "src/auth.ts"}

Event: session_end
Data: {"type": "session_end", "reason": "complete"}
```

## Open Questions

1. **Model selection**: OpenCode doesn't currently support per-session model selection. Should we wait for this feature or work around it?
   - **Recommendation**: Use workspace-level model preference, apply at instance provisioning time

2. **Session persistence**: Should we persist session IDs for resume across daemon restarts?
   - **Recommendation**: Yes, store in CloudSyncService for session continuity

3. **File sync**: How do we sync workspace files to cloud OpenCode instances?
   - **Option A**: Git clone on provision (simplest)
   - **Option B**: Real-time file sync (complex but better UX)
   - **Recommendation**: Start with Git clone, add real-time sync later

4. **Rate limiting**: Does OpenCode have API rate limits we need to respect?
   - **Mitigation**: Implement exponential backoff in wrappers

5. **Cost management**: How do we handle cloud compute costs for OpenCode instances?
   - **Recommendation**: Idle timeout (30 min), usage-based billing, workspace quotas

6. **Multi-region**: Should cloud instances be provisioned close to the user?
   - **Recommendation**: Start single-region, add multi-region based on latency metrics

7. **Fallback behavior**: What happens when cloud is unavailable?
   - **Recommendation**: Automatic fallback to local PTY if OpenCode installed locally

## References

- [OpenCode Server Documentation](https://opencode.ai/docs/server/)
- [OpenCode SDK Documentation](https://opencode.ai/docs/sdk/)
- [OpenCode GitHub](https://github.com/opencode-ai/opencode)
- [Agent Relay Architecture](../architecture.md)
