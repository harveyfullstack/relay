import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RelayLedger, type RelayFileRecord } from './relay-ledger.js';

describe('RelayLedger', () => {
  let testDir: string;
  let ledger: RelayLedger;

  beforeEach(async () => {
    // Create temp test directory
    testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'relay-ledger-test-'));
    const dbPath = path.join(testDir, 'test-ledger.sqlite');

    ledger = new RelayLedger({
      dbPath,
      maxRetries: 3,
      archiveRetentionMs: 7 * 24 * 60 * 60 * 1000,
    });
  });

  afterEach(async () => {
    ledger.close();
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('generateFileId', () => {
    it('should generate 12-character hex string', () => {
      const id = ledger.generateFileId();
      expect(id).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(ledger.generateFileId());
      }
      expect(ids.size).toBe(1000);
    });
  });

  describe('isReservedAgentName', () => {
    it('should return true for reserved names', () => {
      expect(ledger.isReservedAgentName('Lead')).toBe(true);
      expect(ledger.isReservedAgentName('System')).toBe(true);
      expect(ledger.isReservedAgentName('Broadcast')).toBe(true);
      expect(ledger.isReservedAgentName('*')).toBe(true);
    });

    it('should return false for non-reserved names', () => {
      expect(ledger.isReservedAgentName('Worker1')).toBe(false);
      expect(ledger.isReservedAgentName('MyAgent')).toBe(false);
    });
  });

  describe('registerFile', () => {
    it('should register a new file', () => {
      const fileId = ledger.registerFile(
        '/tmp/test/outbox/Agent1/msg',
        'Agent1',
        'msg',
        256
      );

      expect(fileId).toMatch(/^[a-f0-9]{12}$/);

      const record = ledger.getById(fileId);
      expect(record).not.toBeNull();
      expect(record!.sourcePath).toBe('/tmp/test/outbox/Agent1/msg');
      expect(record!.agentName).toBe('Agent1');
      expect(record!.messageType).toBe('msg');
      expect(record!.status).toBe('pending');
      expect(record!.fileSize).toBe(256);
    });

    it('should not duplicate files with same ID', () => {
      const fileId1 = ledger.registerFile('/path1', 'Agent1', 'msg', 100);
      // Try to register same path again - should be ignored (ON CONFLICT DO NOTHING)
      const stats = ledger.getStats();
      expect(stats.pending).toBe(1);
    });

    it('should store content hash', () => {
      const fileId = ledger.registerFile('/path', 'Agent1', 'msg', 100, 'abc123hash');
      const record = ledger.getById(fileId);
      expect(record!.contentHash).toBe('abc123hash');
    });
  });

  describe('isFileRegistered', () => {
    it('should return true for registered files', () => {
      ledger.registerFile('/test/path', 'Agent1', 'msg', 100);
      expect(ledger.isFileRegistered('/test/path')).toBe(true);
    });

    it('should return false for unregistered files', () => {
      expect(ledger.isFileRegistered('/unknown/path')).toBe(false);
    });
  });

  describe('claimFile', () => {
    it('should successfully claim a pending file', () => {
      const fileId = ledger.registerFile('/path', 'Agent1', 'msg', 100);

      const result = ledger.claimFile(fileId);

      expect(result.success).toBe(true);
      expect(result.record).toBeDefined();
      expect(result.record!.status).toBe('processing');
      expect(result.record!.retries).toBe(1);
    });

    it('should fail to claim non-existent file', () => {
      const result = ledger.claimFile('nonexistent');

      expect(result.success).toBe(false);
      expect(result.reason).toBe('File not found');
    });

    it('should fail to claim already processing file', () => {
      const fileId = ledger.registerFile('/path', 'Agent1', 'msg', 100);
      ledger.claimFile(fileId); // First claim succeeds

      const result = ledger.claimFile(fileId); // Second claim fails

      expect(result.success).toBe(false);
      expect(result.reason).toContain('processing');
    });

    it('should fail to claim file at max retries', () => {
      const fileId = ledger.registerFile('/path', 'Agent1', 'msg', 100);

      // Claim and fail 3 times (max retries)
      for (let i = 0; i < 3; i++) {
        const claim = ledger.claimFile(fileId);
        if (claim.success) {
          ledger.markFailed(fileId, 'test error');
        }
      }

      // Next claim should fail due to max retries
      const result = ledger.claimFile(fileId);
      expect(result.success).toBe(false);
    });
  });

  describe('markDelivered', () => {
    it('should mark file as delivered', () => {
      const fileId = ledger.registerFile('/path', 'Agent1', 'msg', 100);
      ledger.claimFile(fileId);

      ledger.markDelivered(fileId);

      const record = ledger.getById(fileId);
      expect(record!.status).toBe('delivered');
      expect(record!.processedAt).not.toBeNull();
    });
  });

  describe('markFailed', () => {
    it('should reset to pending if under max retries', () => {
      const fileId = ledger.registerFile('/path', 'Agent1', 'msg', 100);
      ledger.claimFile(fileId);

      ledger.markFailed(fileId, 'test error');

      const record = ledger.getById(fileId);
      expect(record!.status).toBe('pending');
      expect(record!.retries).toBe(1);
    });

    it('should mark as failed at max retries', () => {
      const fileId = ledger.registerFile('/path', 'Agent1', 'msg', 100);

      // Exhaust all retries
      for (let i = 0; i < 3; i++) {
        ledger.claimFile(fileId);
        ledger.markFailed(fileId, 'test error');
      }

      // Claim again to reach max
      ledger.claimFile(fileId);
      ledger.markFailed(fileId, 'final error');

      const record = ledger.getById(fileId);
      expect(record!.status).toBe('failed');
      expect(record!.error).toBe('final error');
    });
  });

  describe('markArchived', () => {
    it('should mark file as archived with path', () => {
      const fileId = ledger.registerFile('/original/path', 'Agent1', 'msg', 100);
      ledger.claimFile(fileId);
      ledger.markDelivered(fileId);

      ledger.markArchived(fileId, '/archive/path');

      const record = ledger.getById(fileId);
      expect(record!.status).toBe('archived');
      expect(record!.archivePath).toBe('/archive/path');
      expect(record!.archivedAt).not.toBeNull();
    });
  });

  describe('getPendingFiles', () => {
    it('should return pending files in order', () => {
      ledger.registerFile('/path1', 'Agent1', 'msg1', 100);
      ledger.registerFile('/path2', 'Agent2', 'msg2', 200);
      ledger.registerFile('/path3', 'Agent1', 'msg3', 300);

      const pending = ledger.getPendingFiles();

      expect(pending).toHaveLength(3);
      // Ordered by id (insertion order)
      expect(pending[0].sourcePath).toBe('/path1');
      expect(pending[1].sourcePath).toBe('/path2');
      expect(pending[2].sourcePath).toBe('/path3');
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        ledger.registerFile(`/path${i}`, 'Agent', `msg${i}`, 100);
      }

      const pending = ledger.getPendingFiles(5);

      expect(pending).toHaveLength(5);
    });

    it('should not return processing or delivered files', () => {
      const id1 = ledger.registerFile('/path1', 'Agent', 'msg1', 100);
      const id2 = ledger.registerFile('/path2', 'Agent', 'msg2', 100);
      ledger.registerFile('/path3', 'Agent', 'msg3', 100);

      ledger.claimFile(id1); // Now processing
      ledger.claimFile(id2);
      ledger.markDelivered(id2); // Now delivered

      const pending = ledger.getPendingFiles();

      expect(pending).toHaveLength(1);
      expect(pending[0].sourcePath).toBe('/path3');
    });
  });

  describe('resetProcessingFiles', () => {
    it('should reset all processing files to pending', () => {
      const id1 = ledger.registerFile('/path1', 'Agent', 'msg1', 100);
      const id2 = ledger.registerFile('/path2', 'Agent', 'msg2', 100);
      ledger.registerFile('/path3', 'Agent', 'msg3', 100);

      ledger.claimFile(id1);
      ledger.claimFile(id2);

      const resetCount = ledger.resetProcessingFiles();

      expect(resetCount).toBe(2);

      const pending = ledger.getPendingFiles();
      expect(pending).toHaveLength(3);
    });
  });

  describe('reconcileWithFilesystem', () => {
    it('should mark missing files as failed', async () => {
      // Create a real file
      const realFile = path.join(testDir, 'real-file');
      await fs.promises.writeFile(realFile, 'content');

      const id1 = ledger.registerFile(realFile, 'Agent', 'msg1', 7);
      const id2 = ledger.registerFile('/nonexistent/path', 'Agent', 'msg2', 100);

      ledger.claimFile(id1);
      ledger.claimFile(id2);

      const result = ledger.reconcileWithFilesystem();

      expect(result.reset).toBe(1); // real file reset to pending
      expect(result.failed).toBe(1); // missing file marked failed

      const record1 = ledger.getById(id1);
      const record2 = ledger.getById(id2);
      expect(record1!.status).toBe('pending');
      expect(record2!.status).toBe('failed');
    });
  });

  describe('cleanupArchivedRecords', () => {
    it('should delete old archived records', async () => {
      const fileId = ledger.registerFile('/path', 'Agent', 'msg', 100);
      ledger.claimFile(fileId);
      ledger.markDelivered(fileId);
      ledger.markArchived(fileId, '/archive/path');

      // Using a ledger with 1ms retention for test
      const shortRetentionLedger = new RelayLedger({
        dbPath: path.join(testDir, 'short-retention.sqlite'),
        archiveRetentionMs: 1, // 1ms retention
      });

      const id = shortRetentionLedger.registerFile('/path2', 'Agent', 'msg', 100);
      shortRetentionLedger.claimFile(id);
      shortRetentionLedger.markDelivered(id);
      shortRetentionLedger.markArchived(id, '/archive');

      // Wait a bit to ensure archived_at is in the past relative to retention
      await new Promise(resolve => setTimeout(resolve, 10));

      const deleted = shortRetentionLedger.cleanupArchivedRecords();
      expect(deleted).toBe(1);

      shortRetentionLedger.close();
    });
  });

  describe('getStats', () => {
    it('should return correct counts per status', () => {
      ledger.registerFile('/path1', 'Agent', 'msg1', 100);
      ledger.registerFile('/path2', 'Agent', 'msg2', 100);
      const id3 = ledger.registerFile('/path3', 'Agent', 'msg3', 100);
      const id4 = ledger.registerFile('/path4', 'Agent', 'msg4', 100);

      ledger.claimFile(id3);
      ledger.claimFile(id4);
      ledger.markDelivered(id4);

      const stats = ledger.getStats();

      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(1);
      expect(stats.delivered).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.archived).toBe(0);
    });
  });

  describe('getByPath', () => {
    it('should return record by source path', () => {
      ledger.registerFile('/unique/path', 'Agent1', 'msg', 256);

      const record = ledger.getByPath('/unique/path');

      expect(record).not.toBeNull();
      expect(record!.agentName).toBe('Agent1');
    });

    it('should return null for unknown path', () => {
      const record = ledger.getByPath('/unknown');
      expect(record).toBeNull();
    });
  });
});
