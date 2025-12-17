import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'node:net';
import { Connection } from './connection.js';
import { encodeFrame } from '../protocol/framing.js';
import { PROTOCOL_VERSION, type Envelope, type HelloPayload } from '../protocol/types.js';

class MockSocket {
  private handlers: Map<string, Array<(...args: any[]) => void>> = new Map();
  public written: Buffer[] = [];
  public destroyed = false;

  on(event: string, handler: (...args: any[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  write(data: Buffer): boolean {
    this.written.push(data);
    return true;
  }

  end(): void {
    this.emit('close');
  }

  destroy(): void {
    this.destroyed = true;
  }

  emit(event: string, ...args: any[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

function makeHello(agent: string): Envelope<HelloPayload> {
  return {
    v: PROTOCOL_VERSION,
    type: 'HELLO',
    id: 'hello-1',
    ts: Date.now(),
    payload: {
      agent,
      capabilities: {
        ack: true,
        resume: false,
        max_inflight: 256,
        supports_topics: true,
      },
    },
  };
}

describe('Connection', () => {
  it('transitions to ACTIVE after HELLO and fires onActive', () => {
    const socket = new MockSocket();
    const connection = new Connection(socket as unknown as Socket, { heartbeatMs: 50 });
    const onActive = vi.fn();
    connection.onActive = onActive;

    socket.emit('data', encodeFrame(makeHello('agent-a')));

    expect(connection.state).toBe('ACTIVE');
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(socket.written.length).toBeGreaterThan(0);
  });

  it('drops a client that never PONGs after heartbeat timeout', async () => {
    const socket = new MockSocket();
    const connection = new Connection(socket as unknown as Socket, { heartbeatMs: 10 });
    const onError = vi.fn();
    connection.onError = onError;

    socket.emit('data', encodeFrame(makeHello('agent-a')));
    expect(connection.state).toBe('ACTIVE');

    await new Promise((r) => setTimeout(r, 100));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(socket.destroyed).toBe(true);
  });
});
