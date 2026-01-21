/**
 * @agent-relay/sdk
 *
 * Lightweight SDK for agent-to-agent communication via Agent Relay.
 */

// Main client
export {
  RelayClient,
  type ClientState,
  type ClientConfig,
  type SyncOptions,
} from './client.js';

// Protocol types (re-export for convenience)
export {
  PROTOCOL_VERSION,
  type MessageType,
  type PayloadKind,
  type Envelope,
  type EntityType,
  type SendPayload,
  type SendMeta,
  type SyncMeta,
  type DeliveryInfo,
  type AckPayload,
  type ErrorCode,
  type ErrorPayload,
  type SpeakOnTrigger,
  type ShadowConfig,
  // Spawn/release types
  type SpawnPayload,
  type SpawnResultPayload,
  type ReleasePayload,
  type ReleaseResultPayload,
} from './protocol/index.js';

// Framing utilities
export {
  encodeFrame,
  encodeFrameLegacy,
  FrameParser,
  MAX_FRAME_BYTES,
} from './protocol/index.js';
