/**
 * Frame encoding/decoding for the agent relay protocol.
 *
 * @deprecated Import from '@agent-relay/sdk/protocol' instead.
 * This module re-exports from the SDK for backwards compatibility.
 *
 * @example
 * // New way (preferred):
 * import { encodeFrame, FrameParser } from '@agent-relay/sdk/protocol';
 *
 * // Old way (still works):
 * import { encodeFrame, FrameParser } from './protocol/framing.js';
 */

// Re-export everything from SDK protocol framing
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
} from '@agent-relay/sdk/protocol';
