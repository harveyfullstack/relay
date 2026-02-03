/**
 * ACP Bridge for Agent Relay
 *
 * Exposes Agent Relay agents to ACP-compatible editors like Zed.
 *
 * @example
 * ```typescript
 * import { RelayACPAgent } from '@agent-relay/acp-bridge';
 *
 * const agent = new RelayACPAgent({
 *   agentName: 'my-agent',
 *   debug: true,
 * });
 *
 * await agent.start();
 * ```
 *
 * @packageDocumentation
 */

export { RelayACPAgent } from './acp-agent.js';
export { RelayClient } from '@agent-relay/sdk';
export type { ClientConfig as RelayClientConfig } from '@agent-relay/sdk';
export type {
  ACPBridgeConfig,
  AgentCapabilities,
  AgentMode,
  SessionState,
  SessionMessage,
  RelayMessage,
  BridgePromptResult,
  BridgeEvent,
  BridgeEventListener,
} from './types.js';
