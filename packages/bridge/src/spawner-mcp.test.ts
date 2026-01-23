/**
 * Unit tests for MCP socket detection in AgentSpawner
 *
 * Tests verify that MCP tools reference is only included when BOTH conditions are met:
 * 1. .mcp.json config exists in project root
 * 2. Relay daemon socket is accessible (daemon must be running)
 *
 * This ensures agents don't see MCP context when the tools wouldn't actually work.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Mock fs module
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      statSync: vi.fn(),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    statSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

/**
 * This is a standalone test of the MCP detection logic extracted from spawner.ts
 * The actual implementation lives in spawner.ts lines 698-714.
 *
 * Logic being tested:
 * ```
 * const mcpConfigPath = path.join(this.projectRoot, '.mcp.json');
 * const relaySocket = process.env.RELAY_SOCKET || '/tmp/agent-relay.sock';
 * let hasMcp = false;
 * if (fs.existsSync(mcpConfigPath)) {
 *   try {
 *     hasMcp = fs.statSync(relaySocket).isSocket();
 *   } catch {
 *     hasMcp = false;
 *   }
 * }
 * ```
 */
function checkMcpAvailability(projectRoot: string): boolean {
  const mcpConfigPath = path.join(projectRoot, '.mcp.json');
  const relaySocket = process.env.RELAY_SOCKET || '/tmp/agent-relay.sock';
  let hasMcp = false;

  if (fs.existsSync(mcpConfigPath)) {
    try {
      hasMcp = fs.statSync(relaySocket).isSocket();
    } catch {
      // Socket doesn't exist or isn't accessible - daemon not running
      hasMcp = false;
    }
  }

  return hasMcp;
}

describe('MCP Socket Detection', () => {
  const mockProjectRoot = '/test/project';
  const mockMcpConfigPath = '/test/project/.mcp.json';
  const defaultSocket = '/tmp/agent-relay.sock';
  const customSocket = '/custom/path/relay.sock';

  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up environment
    delete process.env.RELAY_SOCKET;
  });

  afterEach(() => {
    // Restore environment
    delete process.env.RELAY_SOCKET;
  });

  describe('Happy path - both conditions met', () => {
    it('should return true when both .mcp.json AND socket exist', () => {
      // Arrange: .mcp.json exists
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockMcpConfigPath) return true;
        return false;
      });

      // Arrange: socket exists and is a socket
      vi.mocked(fs.statSync).mockReturnValue({
        isSocket: () => true,
      } as fs.Stats);

      // Act
      const result = checkMcpAvailability(mockProjectRoot);

      // Assert
      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(mockMcpConfigPath);
      expect(fs.statSync).toHaveBeenCalledWith(defaultSocket);
    });
  });

  describe('Sad path - .mcp.json missing', () => {
    it('should return false when .mcp.json does not exist', () => {
      // Arrange: .mcp.json does NOT exist
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      const result = checkMcpAvailability(mockProjectRoot);

      // Assert
      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(mockMcpConfigPath);
      // statSync should NOT be called when .mcp.json is missing
      expect(fs.statSync).not.toHaveBeenCalled();
    });
  });

  describe('Sad path - socket missing', () => {
    it('should return false when .mcp.json exists but socket does not exist', () => {
      // Arrange: .mcp.json exists
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockMcpConfigPath) return true;
        return false;
      });

      // Arrange: statSync throws (socket doesn't exist)
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      // Act
      const result = checkMcpAvailability(mockProjectRoot);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when socket exists but is not a socket file', () => {
      // Arrange: .mcp.json exists
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockMcpConfigPath) return true;
        return false;
      });

      // Arrange: statSync returns but isSocket() is false (it's a regular file)
      vi.mocked(fs.statSync).mockReturnValue({
        isSocket: () => false,
      } as fs.Stats);

      // Act
      const result = checkMcpAvailability(mockProjectRoot);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when socket access is denied (EACCES)', () => {
      // Arrange: .mcp.json exists
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockMcpConfigPath) return true;
        return false;
      });

      // Arrange: statSync throws access denied
      vi.mocked(fs.statSync).mockImplementation(() => {
        const error = new Error('EACCES: permission denied');
        (error as any).code = 'EACCES';
        throw error;
      });

      // Act
      const result = checkMcpAvailability(mockProjectRoot);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('Environment variable handling', () => {
    it('should use RELAY_SOCKET env var when set', () => {
      // Arrange: Set custom socket path
      process.env.RELAY_SOCKET = customSocket;

      // Arrange: .mcp.json exists
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockMcpConfigPath) return true;
        return false;
      });

      // Arrange: socket exists
      vi.mocked(fs.statSync).mockReturnValue({
        isSocket: () => true,
      } as fs.Stats);

      // Act
      const result = checkMcpAvailability(mockProjectRoot);

      // Assert
      expect(result).toBe(true);
      expect(fs.statSync).toHaveBeenCalledWith(customSocket);
    });

    it('should default to /tmp/agent-relay.sock when RELAY_SOCKET not set', () => {
      // Ensure RELAY_SOCKET is NOT set
      delete process.env.RELAY_SOCKET;

      // Arrange: .mcp.json exists
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockMcpConfigPath) return true;
        return false;
      });

      // Arrange: socket exists
      vi.mocked(fs.statSync).mockReturnValue({
        isSocket: () => true,
      } as fs.Stats);

      // Act
      checkMcpAvailability(mockProjectRoot);

      // Assert
      expect(fs.statSync).toHaveBeenCalledWith(defaultSocket);
    });

    it('should respect empty RELAY_SOCKET env var (use default)', () => {
      // Empty string should fallback to default
      process.env.RELAY_SOCKET = '';

      // Arrange: .mcp.json exists
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockMcpConfigPath) return true;
        return false;
      });

      // Arrange: socket exists
      vi.mocked(fs.statSync).mockReturnValue({
        isSocket: () => true,
      } as fs.Stats);

      // Act
      checkMcpAvailability(mockProjectRoot);

      // Assert: Empty string is falsy, so it uses default
      expect(fs.statSync).toHaveBeenCalledWith(defaultSocket);
    });
  });

  describe('Edge cases', () => {
    it('should handle both conditions false', () => {
      // Arrange: neither .mcp.json nor socket exist
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      const result = checkMcpAvailability(mockProjectRoot);

      // Assert
      expect(result).toBe(false);
      expect(fs.statSync).not.toHaveBeenCalled();
    });

    it('should correctly combine path for .mcp.json', () => {
      // Test with different project root paths
      const testRoot = '/some/other/path';
      const expectedMcpPath = '/some/other/path/.mcp.json';

      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      checkMcpAvailability(testRoot);

      // Assert
      expect(fs.existsSync).toHaveBeenCalledWith(expectedMcpPath);
    });
  });
});

/**
 * Integration note:
 * The full integration of this logic can be tested by observing the spawn result:
 * - When hasMcp=true: relayInstructions includes getMcpToolsReference()
 * - When hasMcp=false: relayInstructions does NOT include MCP tools section
 *
 * This is verified in spawner.ts line 717:
 *   let relayInstructions = getRelayInstructions(name, hasMcp);
 *
 * And in getRelayInstructions() which conditionally adds:
 *   if (hasMcp) { parts.push(getMcpToolsReference()); }
 */

/**
 * Tests for ensureMcpPermissions function
 *
 * This function pre-configures MCP permissions for Claude Code to prevent
 * approval prompts from blocking agent initialization.
 *
 * It creates/updates .claude/settings.local.json with:
 * - enableAllProjectMcpServers: true
 * - permissions.allow: ["mcp__agent-relay"]
 */
function ensureMcpPermissions(projectRoot: string, debug = false): void {
  const settingsDir = path.join(projectRoot, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.local.json');

  try {
    // Ensure .claude directory exists
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }

    // Read existing settings or start fresh
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        settings = JSON.parse(content);
      } catch {
        // Invalid JSON, start fresh
        settings = {};
      }
    }

    // Set enableAllProjectMcpServers to auto-approve MCP servers in .mcp.json
    if (settings.enableAllProjectMcpServers !== true) {
      settings.enableAllProjectMcpServers = true;
    }

    // Ensure permissions.allow includes agent-relay MCP
    if (!settings.permissions || typeof settings.permissions !== 'object') {
      settings.permissions = {};
    }
    const permissions = settings.permissions as Record<string, unknown>;
    if (!Array.isArray(permissions.allow)) {
      permissions.allow = [];
    }
    const allowList = permissions.allow as string[];

    // Add agent-relay MCP permission if not already present
    const agentRelayPermission = 'mcp__agent-relay';
    if (!allowList.includes(agentRelayPermission)) {
      allowList.push(agentRelayPermission);
    }

    // Write updated settings
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  } catch {
    // Log but don't fail - this is a best-effort optimization
  }
}

describe('MCP Permissions Pre-configuration', () => {
  const mockProjectRoot = '/test/project';
  const mockSettingsDir = '/test/project/.claude';
  const mockSettingsPath = '/test/project/.claude/settings.local.json';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Creating new settings file', () => {
    it('should create .claude directory if it does not exist', () => {
      // Arrange: neither directory nor file exists
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      ensureMcpPermissions(mockProjectRoot);

      // Assert
      expect(fs.mkdirSync).toHaveBeenCalledWith(mockSettingsDir, { recursive: true });
    });

    it('should create settings.local.json with correct defaults', () => {
      // Arrange: nothing exists
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      ensureMcpPermissions(mockProjectRoot);

      // Assert
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(writeCall[0]).toBe(mockSettingsPath);

      const writtenContent = JSON.parse((writeCall[1] as string).trim());
      expect(writtenContent.enableAllProjectMcpServers).toBe(true);
      expect(writtenContent.permissions.allow).toContain('mcp__agent-relay');
    });
  });

  describe('Merging with existing settings', () => {
    it('should preserve existing permissions while adding mcp__agent-relay', () => {
      // Arrange: file exists with existing permissions
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockSettingsDir) return true;
        if (p === mockSettingsPath) return true;
        return false;
      });

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        permissions: {
          allow: ['Bash', 'Edit']
        },
        someOtherSetting: 'value'
      }));

      // Act
      ensureMcpPermissions(mockProjectRoot);

      // Assert
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenContent = JSON.parse((writeCall[1] as string).trim());

      // Should preserve existing permissions
      expect(writtenContent.permissions.allow).toContain('Bash');
      expect(writtenContent.permissions.allow).toContain('Edit');
      // Should add new permission
      expect(writtenContent.permissions.allow).toContain('mcp__agent-relay');
      // Should preserve other settings
      expect(writtenContent.someOtherSetting).toBe('value');
      // Should add enableAllProjectMcpServers
      expect(writtenContent.enableAllProjectMcpServers).toBe(true);
    });

    it('should not duplicate mcp__agent-relay if already present', () => {
      // Arrange: file already has the permission
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockSettingsDir) return true;
        if (p === mockSettingsPath) return true;
        return false;
      });

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        permissions: {
          allow: ['mcp__agent-relay', 'Bash']
        },
        enableAllProjectMcpServers: true
      }));

      // Act
      ensureMcpPermissions(mockProjectRoot);

      // Assert
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenContent = JSON.parse((writeCall[1] as string).trim());

      // Should only have one instance of mcp__agent-relay
      const count = writtenContent.permissions.allow.filter(
        (p: string) => p === 'mcp__agent-relay'
      ).length;
      expect(count).toBe(1);
    });

    it('should handle corrupted JSON gracefully', () => {
      // Arrange: file exists but contains invalid JSON
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockSettingsDir) return true;
        if (p === mockSettingsPath) return true;
        return false;
      });

      vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }}}');

      // Act - should not throw
      expect(() => ensureMcpPermissions(mockProjectRoot)).not.toThrow();

      // Assert - should create fresh settings
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenContent = JSON.parse((writeCall[1] as string).trim());
      expect(writtenContent.enableAllProjectMcpServers).toBe(true);
      expect(writtenContent.permissions.allow).toContain('mcp__agent-relay');
    });
  });

  describe('Error handling', () => {
    it('should not throw when directory creation fails', () => {
      // Arrange: existsSync returns false, mkdirSync throws
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      // Act - should not throw
      expect(() => ensureMcpPermissions(mockProjectRoot)).not.toThrow();
    });

    it('should not throw when write fails', () => {
      // Arrange: everything works until writeFileSync
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      // Act - should not throw
      expect(() => ensureMcpPermissions(mockProjectRoot)).not.toThrow();
    });
  });
});
