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
  close?(): Promise<void>;
}
