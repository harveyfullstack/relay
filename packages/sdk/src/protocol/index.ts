/**
 * Protocol exports for @agent-relay/sdk
 */

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
  // Typed envelopes
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
  type ShadowBindEnvelope,
  type ShadowUnbindEnvelope,
  type SpawnEnvelope,
  type SpawnResultEnvelope,
  type ReleaseEnvelope,
  type ReleaseResultEnvelope,
} from './types.js';

export {
  MAX_FRAME_BYTES,
  HEADER_SIZE,
  LEGACY_HEADER_SIZE,
  type WireFormat,
  initMessagePack,
  hasMessagePack,
  encodeFrame,
  encodeFrameLegacy,
  FrameParser,
} from './framing.js';
