import type { PayloadKind } from '../protocol/types.js';

export interface StoredMessage {
  id: string;
  ts: number;
  from: string;
  to: string;
  topic?: string;
  kind: PayloadKind;
  body: string;
  data?: Record<string, unknown>;
  deliverySeq?: number;
  deliverySessionId?: string;
  sessionId?: string;
}

export interface MessageQuery {
  limit?: number;
  sinceTs?: number;
  from?: string;
  to?: string;
  topic?: string;
  order?: 'asc' | 'desc';
}

export interface StorageAdapter {
  init(): Promise<void>;
  saveMessage(message: StoredMessage): Promise<void>;
  getMessages(query?: MessageQuery): Promise<StoredMessage[]>;
  getMessageById?(id: string): Promise<StoredMessage | null>;
  close?(): Promise<void>;
}

/**
 * Create a storage adapter based on the provided path.
 * Currently only SQLite is supported, but this can be extended.
 */
export async function createStorageAdapter(dbPath: string): Promise<StorageAdapter> {
  // For now, always use SQLite. In the future, could detect from path/config.
  const { SqliteStorageAdapter } = await import('./sqlite-adapter.js');
  const adapter = new SqliteStorageAdapter({ dbPath });
  await adapter.init();
  return adapter;
}
