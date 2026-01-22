// Client interface
export type { RelayClient } from './client.js';

// Server
export { createMCPServer, runMCPServer, type MCPServerConfig } from './server.js';

// Tools (for direct usage or custom server implementations)
export {
  relaySendTool,
  relaySendSchema,
  handleRelaySend,
  type RelaySendInput,
  relayInboxTool,
  relayInboxSchema,
  handleRelayInbox,
  type RelayInboxInput,
  relayWhoTool,
  relayWhoSchema,
  handleRelayWho,
  type RelayWhoInput,
  relaySpawnTool,
  relaySpawnSchema,
  handleRelaySpawn,
  type RelaySpawnInput,
  relayReleaseTool,
  relayReleaseSchema,
  handleRelayRelease,
  type RelayReleaseInput,
  relayStatusTool,
  relayStatusSchema,
  handleRelayStatus,
  type RelayStatusInput,
} from './tools/index.js';
