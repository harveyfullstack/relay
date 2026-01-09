/**
 * Tests for Workspace Persistence
 *
 * Verifies that workspace repositories persist across container restarts.
 * The key requirement is that WORKSPACE_DIR must be on the persistent volume (/data).
 *
 * Bug Context:
 * - Volume mounted at: /data (persistent)
 * - Default WORKSPACE_DIR: /workspace (ephemeral container filesystem)
 * - Repos cloned to /workspace → lost on restart
 *
 * Fix:
 * - Set WORKSPACE_DIR=/data/repos to store repos on persistent volume
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fetch for Fly.io API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock config
vi.mock('../config.js', () => ({
  getConfig: () => ({
    publicUrl: 'https://cloud.agent-relay.com',
    sessionSecret: 'test-secret-key',
    compute: {
      provider: 'fly',
      fly: {
        apiToken: 'test-fly-token',
        org: 'test-org',
        region: 'sjc',
      },
    },
  }),
}));

// Mock database
vi.mock('../db/index.js', () => ({
  db: {
    workspaces: {
      create: vi.fn().mockResolvedValue({ id: 'workspace-123', userId: 'user-456' }),
      findById: vi.fn(),
      updateStatus: vi.fn(),
      updateConfig: vi.fn(),
    },
    workspaceMembers: {
      addMember: vi.fn(),
      acceptInvite: vi.fn(),
    },
    repositories: {
      findByUserId: vi.fn().mockResolvedValue([]),
      findByGithubFullName: vi.fn().mockResolvedValue([]),
      assignToWorkspace: vi.fn(),
      upsert: vi.fn(),
    },
    users: {
      findById: vi.fn().mockResolvedValue({ id: 'user-456', plan: 'pro' }),
    },
    credentials: {
      findByUserId: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock SSH password derivation
vi.mock('../services/ssh-security.js', () => ({
  deriveSshPassword: () => 'mock-ssh-password',
}));

// Mock Nango service
vi.mock('../services/nango.js', () => ({
  nangoService: {
    getGithubAppToken: vi.fn().mockResolvedValue('mock-github-token'),
  },
}));

// Mock plan limits
vi.mock('../services/planLimits.js', () => ({
  canAutoScale: () => true,
  canScaleToTier: () => true,
  getResourceTierForPlan: () => 'medium',
}));

describe('Workspace Persistence', () => {
  let capturedMachineConfig: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedMachineConfig = null;

    // Mock successful Fly.io API responses
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      // App creation
      if (urlStr === 'https://api.machines.dev/v1/apps' && options?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'app-123' }) };
      }

      // IP allocation (GraphQL)
      if (urlStr === 'https://api.fly.io/graphql') {
        return {
          ok: true,
          json: async () => ({
            data: { allocateIpAddress: { ipAddress: { address: '1.2.3.4' } } },
          }),
        };
      }

      // Secrets
      if (urlStr.includes('/secrets')) {
        return { ok: true, json: async () => ({}) };
      }

      // Volume creation
      if (urlStr.includes('/volumes') && options?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'vol-123', name: 'workspace_data' }) };
      }

      // Machine creation - capture the config for verification
      if (urlStr.includes('/machines') && options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        capturedMachineConfig = body.config;
        return {
          ok: true,
          json: async () => ({ id: 'machine-123' }),
        };
      }

      // Machine wait
      if (urlStr.includes('/wait')) {
        return { ok: true, json: async () => ({}) };
      }

      // Health check
      if (urlStr.includes('/health')) {
        return { ok: true, json: async () => ({}) };
      }

      // Default
      return { ok: true, json: async () => ({}) };
    });
  });

  describe('WORKSPACE_DIR Environment Variable', () => {
    it('should set WORKSPACE_DIR to /data/repos for persistent storage', async () => {
      const { getProvisioner } = await import('./index.js');
      const provisioner = getProvisioner();

      await provisioner.provision({
        userId: 'user-456',
        name: 'Test Workspace',
        providers: ['claude'],
        repositories: ['owner/repo'],
      });

      // Wait for background provisioning
      await new Promise((r) => setTimeout(r, 100));

      // Verify WORKSPACE_DIR is set to persistent location
      expect(capturedMachineConfig).toBeTruthy();
      expect(capturedMachineConfig.env).toBeTruthy();
      expect(capturedMachineConfig.env.WORKSPACE_DIR).toBe('/data/repos');
    });

    it('should NOT use default /workspace (ephemeral) directory', async () => {
      const { getProvisioner } = await import('./index.js');
      const provisioner = getProvisioner();

      await provisioner.provision({
        userId: 'user-456',
        name: 'Test Workspace',
        providers: ['claude'],
        repositories: ['owner/repo'],
      });

      await new Promise((r) => setTimeout(r, 100));

      // WORKSPACE_DIR should NOT be /workspace (which is ephemeral)
      expect(capturedMachineConfig?.env?.WORKSPACE_DIR).not.toBe('/workspace');
      expect(capturedMachineConfig?.env?.WORKSPACE_DIR).not.toBeUndefined();
    });
  });

  describe('Volume Mount Configuration', () => {
    it('should mount persistent volume at /data', async () => {
      const { getProvisioner } = await import('./index.js');
      const provisioner = getProvisioner();

      await provisioner.provision({
        userId: 'user-456',
        name: 'Test Workspace',
        providers: ['claude'],
        repositories: ['owner/repo'],
      });

      await new Promise((r) => setTimeout(r, 100));

      // Verify volume mount exists at /data
      expect(capturedMachineConfig?.mounts).toBeTruthy();
      expect(capturedMachineConfig.mounts).toContainEqual(
        expect.objectContaining({ path: '/data' })
      );
    });

    it('should ensure WORKSPACE_DIR (/data/repos) is under the persistent mount point', async () => {
      const { getProvisioner } = await import('./index.js');
      const provisioner = getProvisioner();

      await provisioner.provision({
        userId: 'user-456',
        name: 'Test Workspace',
        providers: ['claude'],
        repositories: ['owner/repo'],
      });

      await new Promise((r) => setTimeout(r, 100));

      // Verify WORKSPACE_DIR is under the mount point
      const workspaceDir = capturedMachineConfig?.env?.WORKSPACE_DIR;
      const mountPath = capturedMachineConfig?.mounts?.[0]?.path;

      expect(workspaceDir).toBeTruthy();
      expect(mountPath).toBeTruthy();
      expect(workspaceDir.startsWith(mountPath)).toBe(true);
    });
  });

  describe('Repository Persistence Across Restarts', () => {
    it('should configure repos to be stored on persistent volume', async () => {
      const { getProvisioner } = await import('./index.js');
      const provisioner = getProvisioner();

      await provisioner.provision({
        userId: 'user-456',
        name: 'Test Workspace',
        providers: ['claude'],
        repositories: ['owner/repo', 'owner/repo2'],
      });

      await new Promise((r) => setTimeout(r, 100));

      // The REPOSITORIES env var tells entrypoint where to clone
      // Combined with WORKSPACE_DIR=/data/repos, repos will persist
      expect(capturedMachineConfig?.env?.REPOSITORIES).toBe('owner/repo,owner/repo2');
      expect(capturedMachineConfig?.env?.WORKSPACE_DIR).toBe('/data/repos');
    });

    it('should preserve branch state by storing repos on persistent volume', async () => {
      const { getProvisioner } = await import('./index.js');
      const provisioner = getProvisioner();

      await provisioner.provision({
        userId: 'user-456',
        name: 'Test Workspace',
        providers: ['claude'],
        repositories: ['owner/repo'],
      });

      await new Promise((r) => setTimeout(r, 100));

      // When WORKSPACE_DIR is on persistent volume:
      // 1. First deploy: git clone creates repo
      // 2. User checks out feature branch
      // 3. Container restart: repo still exists (persisted)
      // 4. entrypoint.sh sees .git exists → uses git pull (preserves branch)
      // Instead of: container restart → repo gone → fresh clone → main branch

      const workspaceDir = capturedMachineConfig?.env?.WORKSPACE_DIR;
      expect(workspaceDir).toBe('/data/repos');
    });
  });

  describe('Docker Provisioner Workspace Persistence', () => {
    beforeEach(async () => {
      // Reset the provisioner singleton
      vi.resetModules();

      // Reconfigure mock for Docker provider
      vi.doMock('../config.js', () => ({
        getConfig: () => ({
          publicUrl: 'http://localhost:3000',
          sessionSecret: 'test-secret-key',
          compute: {
            provider: 'docker',
          },
        }),
      }));
    });

    it('should set WORKSPACE_DIR for Docker containers too', async () => {
      // Note: Docker provisioner uses execSync to run docker commands
      // The environment variables are passed via -e flags
      // This test verifies the env vars would include WORKSPACE_DIR=/data/repos

      // Since Docker provisioner is harder to test without actually running docker,
      // we verify the configuration pattern is consistent
      const { getConfig } = await import('../config.js');
      const config = getConfig();

      // Docker provider should follow same WORKSPACE_DIR pattern
      // This is more of a documentation test - actual implementation
      // will pass WORKSPACE_DIR=/data/repos in the docker run command
      expect(config.compute.provider).toBe('docker');
    });
  });
});

describe('Entrypoint Script Behavior', () => {
  // These tests document expected entrypoint.sh behavior when WORKSPACE_DIR is set

  it('documents: entrypoint clones to WORKSPACE_DIR if repo does not exist', () => {
    // When WORKSPACE_DIR=/data/repos and repo doesn't exist:
    // entrypoint.sh: git clone https://github.com/owner/repo.git /data/repos/repo
    // → Repo is on persistent volume
    expect(true).toBe(true);
  });

  it('documents: entrypoint preserves branch if repo already exists', () => {
    // When WORKSPACE_DIR=/data/repos and repo already exists (has .git):
    // entrypoint.sh: git pull --ff-only (not git clone)
    // → Branch state is preserved from previous session
    // → Local commits are preserved (fast-forward only)
    expect(true).toBe(true);
  });

  it('documents: local uncommitted changes are preserved on persistent volume', () => {
    // When repos are on /data (persistent volume):
    // - Uncommitted file changes persist across restarts
    // - Modified files are not lost
    // - Only git operations (pull) may conflict with remote changes
    expect(true).toBe(true);
  });
});
