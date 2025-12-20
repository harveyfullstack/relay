import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { type MessageQuery, type StorageAdapter, type StoredMessage } from './adapter.js';

export interface SqliteAdapterOptions {
  dbPath: string;
}

type SqliteDriverName = 'better-sqlite3' | 'node';

interface SqliteStatement {
  run: (...params: any[]) => unknown;
  all: (...params: any[]) => any[];
  get: (...params: any[]) => any;
}

interface SqliteDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
  pragma?: (value: string) => void;
}

export class SqliteStorageAdapter implements StorageAdapter {
  private dbPath: string;
  private db?: SqliteDatabase;
  private insertStmt?: SqliteStatement;
  private driver?: SqliteDriverName;

  constructor(options: SqliteAdapterOptions) {
    this.dbPath = options.dbPath;
  }

  private resolvePreferredDriver(): SqliteDriverName | undefined {
    const raw = process.env.AGENT_RELAY_SQLITE_DRIVER?.trim().toLowerCase();
    if (!raw) return undefined;
    if (raw === 'node' || raw === 'node:sqlite' || raw === 'nodesqlite') return 'node';
    if (raw === 'better-sqlite3' || raw === 'better' || raw === 'bss') return 'better-sqlite3';
    return undefined;
  }

  private async openDatabase(driver: SqliteDriverName): Promise<SqliteDatabase> {
    if (driver === 'node') {
      // Use require() to avoid toolchains that don't recognize node:sqlite yet (Vitest/Vite).
      const require = createRequire(import.meta.url);
      const mod: any = require('node:sqlite');
      const db: any = new mod.DatabaseSync(this.dbPath);
      db.exec('PRAGMA journal_mode = WAL;');
      return db as SqliteDatabase;
    }

    const mod = await import('better-sqlite3');
    const DatabaseCtor: any = (mod as any).default ?? mod;
    const db: any = new DatabaseCtor(this.dbPath);
    if (typeof db.pragma === 'function') {
      db.pragma('journal_mode = WAL');
    } else {
      db.exec('PRAGMA journal_mode = WAL;');
    }
    return db as SqliteDatabase;
  }

  async init(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const preferred = this.resolvePreferredDriver();
    const attempts: SqliteDriverName[] = preferred
      ? [preferred, preferred === 'better-sqlite3' ? 'node' : 'better-sqlite3']
      : ['better-sqlite3', 'node'];

    let lastError: unknown = null;
    for (const driver of attempts) {
      try {
        this.db = await this.openDatabase(driver);
        this.driver = driver;
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!this.db) {
      throw new Error(
        `Failed to initialize SQLite storage at ${this.dbPath}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      );
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        topic TEXT,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        data TEXT,
        thread TEXT,
        delivery_seq INTEGER,
        delivery_session_id TEXT,
        session_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender);
      CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient);
      CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages (topic);
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread);
    `);

    // Migration: add thread column if missing (for existing databases)
    const columns = this.db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    const hasThread = columns.some(c => c.name === 'thread');
    if (!hasThread) {
      this.db.exec('ALTER TABLE messages ADD COLUMN thread TEXT');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread)');
    }

    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages
      (id, ts, sender, recipient, topic, kind, body, data, thread, delivery_seq, delivery_session_id, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    if (!this.db || !this.insertStmt) {
      throw new Error('SqliteStorageAdapter not initialized');
    }

    this.insertStmt.run(
      message.id,
      message.ts,
      message.from,
      message.to,
      message.topic ?? null,
      message.kind,
      message.body,
      message.data ? JSON.stringify(message.data) : null,
      message.thread ?? null,
      message.deliverySeq ?? null,
      message.deliverySessionId ?? null,
      message.sessionId ?? null
    );
  }

  async getMessages(query: MessageQuery = {}): Promise<StoredMessage[]> {
    if (!this.db) {
      throw new Error('SqliteStorageAdapter not initialized');
    }

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.sinceTs) {
      clauses.push('ts >= ?');
      params.push(query.sinceTs);
    }
    if (query.from) {
      clauses.push('sender = ?');
      params.push(query.from);
    }
    if (query.to) {
      clauses.push('recipient = ?');
      params.push(query.to);
    }
    if (query.topic) {
      clauses.push('topic = ?');
      params.push(query.topic);
    }
    if (query.thread) {
      clauses.push('thread = ?');
      params.push(query.thread);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const limit = query.limit ?? 200;

    const stmt = this.db.prepare(`
      SELECT id, ts, sender, recipient, topic, kind, body, data, thread, delivery_seq, delivery_session_id, session_id
      FROM messages
      ${where}
      ORDER BY ts ${order}
      LIMIT ?
    `);

    const rows = stmt.all(...params, limit);
    return rows.map((row: any) => ({
      id: row.id,
      ts: row.ts,
      from: row.sender,
      to: row.recipient,
      topic: row.topic ?? undefined,
      kind: row.kind,
      body: row.body,
      data: row.data ? JSON.parse(row.data) : undefined,
      thread: row.thread ?? undefined,
      deliverySeq: row.delivery_seq ?? undefined,
      deliverySessionId: row.delivery_session_id ?? undefined,
      sessionId: row.session_id ?? undefined,
    }));
  }

  async getMessageById(id: string): Promise<StoredMessage | null> {
    if (!this.db) {
      throw new Error('SqliteStorageAdapter not initialized');
    }

    // Support both exact match and prefix match (for short IDs like "06eb33da")
    const stmt = this.db.prepare(`
      SELECT id, ts, sender, recipient, topic, kind, body, data, delivery_seq, delivery_session_id, session_id
      FROM messages
      WHERE id = ? OR id LIKE ?
      ORDER BY ts DESC
      LIMIT 1
    `);

    const row: any = stmt.get(id, `${id}%`);
    if (!row) return null;

    return {
      id: row.id,
      ts: row.ts,
      from: row.sender,
      to: row.recipient,
      topic: row.topic ?? undefined,
      kind: row.kind,
      body: row.body,
      data: row.data ? JSON.parse(row.data) : undefined,
      deliverySeq: row.delivery_seq ?? undefined,
      deliverySessionId: row.delivery_session_id ?? undefined,
      sessionId: row.session_id ?? undefined,
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
  }
}
