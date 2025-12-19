import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStorageAdapter } from './sqlite-adapter.js';
import type { StoredMessage } from './adapter.js';

const makeMessage = (overrides: Partial<StoredMessage> = {}): StoredMessage => ({
  id: overrides.id ?? 'msg-1',
  ts: overrides.ts ?? Date.now(),
  from: overrides.from ?? 'AgentA',
  to: overrides.to ?? 'AgentB',
  topic: overrides.topic,
  kind: overrides.kind ?? 'message',
  body: overrides.body ?? 'hello',
  data: overrides.data,
  deliverySeq: overrides.deliverySeq,
  deliverySessionId: overrides.deliverySessionId,
  sessionId: overrides.sessionId,
});

describe('SqliteStorageAdapter', () => {
  let dbPath: string;
  let adapter: SqliteStorageAdapter;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sqlite-'));
    dbPath = path.join(tmpDir, 'messages.sqlite');
    adapter = new SqliteStorageAdapter({ dbPath });
    await adapter.init();
  });

  afterEach(async () => {
    await adapter.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('saves and retrieves messages', async () => {
    const msg = makeMessage({ id: 'abc', topic: 't1', body: 'hi' });
    await adapter.saveMessage(msg);

    const rows = await adapter.getMessages();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'abc',
      from: 'AgentA',
      to: 'AgentB',
      topic: 't1',
      body: 'hi',
    });
  });

  it('applies filters and ordering', async () => {
    const now = Date.now();
    await adapter.saveMessage(makeMessage({ id: 'm1', ts: now - 2000, from: 'A', to: 'B', topic: 'x' }));
    await adapter.saveMessage(makeMessage({ id: 'm2', ts: now - 1000, from: 'A', to: 'C', topic: 'y' }));
    await adapter.saveMessage(makeMessage({ id: 'm3', ts: now, from: 'B', to: 'A', topic: 'x' }));

    const filtered = await adapter.getMessages({ from: 'A', order: 'asc' });
    expect(filtered.map(r => r.id)).toEqual(['m1', 'm2']);

    const since = await adapter.getMessages({ sinceTs: now - 1500, order: 'asc' });
    expect(since.map(r => r.id)).toEqual(['m2', 'm3']);

    const limited = await adapter.getMessages({ limit: 1 });
    expect(limited).toHaveLength(1);
  });
});
