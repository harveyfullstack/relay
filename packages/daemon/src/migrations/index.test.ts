import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ensureMigrationsTable,
  getAppliedMigrations,
  isMigrationApplied,
  recordMigration,
  calculateChecksum,
  runMigrations,
  getPendingMigrations,
  verifyMigrations,
  loadMigrationFiles,
} from './index.js';

describe('Migration Runner', () => {
  let testDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    // Create temp test directory
    testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'relay-migrations-test-'));
    db = new Database(path.join(testDir, 'test.sqlite'));
    db.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('ensureMigrationsTable', () => {
    it('should create __migrations table if not exists', () => {
      ensureMigrationsTable(db);

      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='__migrations'
      `).all();

      expect(tables).toHaveLength(1);
    });

    it('should be idempotent', () => {
      ensureMigrationsTable(db);
      ensureMigrationsTable(db);

      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='__migrations'
      `).all();

      expect(tables).toHaveLength(1);
    });
  });

  describe('calculateChecksum', () => {
    it('should return consistent checksums for same input', () => {
      const sql = 'CREATE TABLE test (id INTEGER);';
      const hash1 = calculateChecksum(sql);
      const hash2 = calculateChecksum(sql);

      expect(hash1).toBe(hash2);
    });

    it('should return different checksums for different input', () => {
      const hash1 = calculateChecksum('CREATE TABLE test1 (id INTEGER);');
      const hash2 = calculateChecksum('CREATE TABLE test2 (id INTEGER);');

      expect(hash1).not.toBe(hash2);
    });

    it('should return 8-character hex string', () => {
      const hash = calculateChecksum('some sql');
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('recordMigration / getAppliedMigrations', () => {
    it('should record and retrieve migrations', () => {
      ensureMigrationsTable(db);

      recordMigration(db, '0001_initial', 'abc12345');
      recordMigration(db, '0002_add_column', 'def67890');

      const applied = getAppliedMigrations(db);

      expect(applied).toHaveLength(2);
      expect(applied[0].name).toBe('0001_initial');
      expect(applied[0].checksum).toBe('abc12345');
      expect(applied[1].name).toBe('0002_add_column');
    });
  });

  describe('isMigrationApplied', () => {
    it('should return true for applied migrations', () => {
      ensureMigrationsTable(db);
      recordMigration(db, '0001_initial', 'abc12345');

      expect(isMigrationApplied(db, '0001_initial')).toBe(true);
    });

    it('should return false for unapplied migrations', () => {
      ensureMigrationsTable(db);

      expect(isMigrationApplied(db, '0001_initial')).toBe(false);
    });
  });

  describe('loadMigrationFiles', () => {
    it('should load embedded migrations', () => {
      const migrations = loadMigrationFiles();

      expect(migrations.length).toBeGreaterThanOrEqual(1);
      expect(migrations[0].name).toBe('0001_initial');
      expect(migrations[0].sql).toContain('CREATE TABLE');
      expect(migrations[0].checksum).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('runMigrations', () => {
    it('should run initial migration successfully', () => {
      const result = runMigrations(db);

      // Should have applied the initial migration
      expect(result.applied.length).toBeGreaterThanOrEqual(1);
      expect(result.errors).toHaveLength(0);

      // Tables should exist
      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name IN ('relay_files', 'agents', '__migrations')
      `).all() as Array<{ name: string }>;

      expect(tables.map(t => t.name)).toContain('relay_files');
      expect(tables.map(t => t.name)).toContain('agents');
    });

    it('should skip already applied migrations', () => {
      // Run migrations first time
      const result1 = runMigrations(db);
      const appliedCount = result1.applied.length;

      // Run again
      const result2 = runMigrations(db);

      // Should skip all previously applied
      expect(result2.skipped.length).toBe(appliedCount);
      expect(result2.applied).toHaveLength(0);
    });

    it('should be idempotent', () => {
      runMigrations(db);
      runMigrations(db);
      runMigrations(db);

      // Should still have valid schema
      const result = db.prepare(`SELECT COUNT(*) as count FROM relay_files`).get() as { count: number };
      expect(result.count).toBe(0);
    });
  });

  describe('getPendingMigrations', () => {
    it('should return all migrations for fresh database', () => {
      // Don't run migrations, just check pending
      ensureMigrationsTable(db);
      const pending = getPendingMigrations(db);

      expect(pending.length).toBeGreaterThanOrEqual(1);
      expect(pending[0].name).toBe('0001_initial');
    });

    it('should return empty array after all migrations applied', () => {
      runMigrations(db);
      const pending = getPendingMigrations(db);

      expect(pending).toHaveLength(0);
    });
  });

  describe('verifyMigrations', () => {
    it('should return empty array when checksums match', () => {
      runMigrations(db);
      const mismatches = verifyMigrations(db);

      expect(mismatches).toHaveLength(0);
    });

    // Note: Testing checksum mismatch would require modifying embedded migrations
    // which is not practical in unit tests
  });
});
