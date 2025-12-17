/**
 * Frame encoding/decoding for the agent relay protocol.
 * Uses 4-byte big-endian length prefix + UTF-8 JSON.
 */

import type { Envelope } from './types.js';

export const MAX_FRAME_BYTES = 1024 * 1024; // 1 MiB default
export const HEADER_SIZE = 4;

/**
 * Encode a message envelope into a framed buffer.
 */
export function encodeFrame(envelope: Envelope): Buffer {
  const json = JSON.stringify(envelope);
  const data = Buffer.from(json, 'utf-8');

  if (data.length > MAX_FRAME_BYTES) {
    throw new Error(`Frame too large: ${data.length} > ${MAX_FRAME_BYTES}`);
  }

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(data.length, 0);

  return Buffer.concat([header, data]);
}

/**
 * Frame parser state machine for streaming data.
 */
export class FrameParser {
  private buffer: Buffer = Buffer.alloc(0);
  private maxFrameBytes: number;

  constructor(maxFrameBytes: number = MAX_FRAME_BYTES) {
    this.maxFrameBytes = maxFrameBytes;
  }

  /**
   * Push data into the parser and extract complete frames.
   */
  push(data: Buffer): Envelope[] {
    this.buffer = Buffer.concat([this.buffer, data]);
    const frames: Envelope[] = [];

    while (this.buffer.length >= HEADER_SIZE) {
      const frameLength = this.buffer.readUInt32BE(0);

      if (frameLength > this.maxFrameBytes) {
        throw new Error(`Frame too large: ${frameLength} > ${this.maxFrameBytes}`);
      }

      const totalLength = HEADER_SIZE + frameLength;
      if (this.buffer.length < totalLength) {
        // Need more data
        break;
      }

      // Extract frame
      const frameData = this.buffer.subarray(HEADER_SIZE, totalLength);
      this.buffer = this.buffer.subarray(totalLength);

      try {
        const envelope = JSON.parse(frameData.toString('utf-8')) as Envelope;
        frames.push(envelope);
      } catch (err) {
        throw new Error(`Invalid JSON in frame: ${err}`);
      }
    }

    return frames;
  }

  /**
   * Reset parser state (e.g., on connection reset).
   */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Get current buffer size (for debugging).
   */
  get pendingBytes(): number {
    return this.buffer.length;
  }
}
