/**
 * Agent Relay Protocol Types
 *
 * @deprecated Import from '@agent-relay/sdk/protocol' instead.
 * This module re-exports from the SDK for backwards compatibility.
 *
 * @example
 * // New way (preferred):
 * import { Envelope, SendPayload } from '@agent-relay/sdk/protocol';
 *
 * // Old way (still works):
 * import { Envelope, SendPayload } from './protocol/types.js';
 */

// Re-export everything from SDK protocol types (except channel types which are in channels.ts)
export {
  PROTOCOL_VERSION,
  type MessageType,
  type PayloadKind,
  type Envelope,
  type EntityType,
  // Handshake
  type HelloPayload,
  type WelcomePayload,
  // Messaging
  type SendPayload,
  type SendMeta,
  type SyncMeta,
  type DeliveryInfo,
  // ACK/NACK
  type AckPayload,
  type NackPayload,
  // Control
  type BusyPayload,
  type PingPayload,
  type PongPayload,
  type ErrorCode,
  type ErrorPayload,
  type LogPayload,
  // Sync/Resume
  type SyncStream,
  type SyncPayload,
  // Shadow agents
  type SpeakOnTrigger,
  type ShadowConfig,
  type ShadowBindPayload,
  type ShadowUnbindPayload,
  // Spawn/release
  type SpawnPayload,
  type SpawnPolicyDecision,
  type SpawnResultPayload,
  type ReleasePayload,
  type ReleaseResultPayload,
  // Typed envelopes (non-channel)
  type HelloEnvelope,
  type WelcomeEnvelope,
  type SendEnvelope,
  type DeliverEnvelope,
  type AckEnvelope,
  type NackEnvelope,
  type PingEnvelope,
  type PongEnvelope,
  type ErrorEnvelope,
  type BusyEnvelope,
  type LogEnvelope,
  type SyncEnvelope,
  type ShadowBindEnvelope,
  type ShadowUnbindEnvelope,
  type SpawnEnvelope,
  type SpawnResultEnvelope,
  type ReleaseEnvelope,
  type ReleaseResultEnvelope,
} from '@agent-relay/sdk/protocol';
