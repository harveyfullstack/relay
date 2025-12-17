import { describe, it, expect } from 'vitest';
import { encodeFrame, FrameParser, HEADER_SIZE, MAX_FRAME_BYTES } from './framing.js';
import type { Envelope } from './types.js';

describe('protocol framing', () => {
  it('roundtrips an envelope with correct length prefix', () => {
    const envelope: Envelope = {
      v: 1,
      type: 'PING',
      id: 'test-1',
      ts: 1,
      payload: { nonce: 'abc' },
    };

    const frame = encodeFrame(envelope);
    const declaredLength = frame.readUInt32BE(0);
    const jsonBytes = frame.subarray(HEADER_SIZE);
    expect(declaredLength).toBe(jsonBytes.length);

    const parser = new FrameParser();
    const [parsed] = parser.push(frame);
    expect(parsed).toEqual(envelope);
  });

  it('rejects oversized frames', () => {
    const oversize = 'x'.repeat(MAX_FRAME_BYTES + 1);
    const envelope: Envelope = {
      v: 1,
      type: 'PING',
      id: 'test-oversize',
      ts: 1,
      payload: { nonce: oversize },
    };

    expect(() => encodeFrame(envelope)).toThrow(/Frame too large/);
  });
});

