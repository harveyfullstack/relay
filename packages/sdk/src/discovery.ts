/**
 * Socket Discovery for Agent Relay SDK
 *
 * Discovers the daemon socket path for local development and cloud environments.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface DiscoveryResult {
  socketPath: string;
  projectId: string;
  source: 'env' | 'cloud' | 'project' | 'legacy';
}

/**
 * Find project root by looking for common markers.
 * Scans up from startDir until it finds a marker or hits the filesystem root.
 */
function findProjectRoot(startDir: string = process.cwd()): string | null {
  let current = startDir;
  const markers = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', '.agent-relay'];

  // Limit iterations to prevent infinite loops
  for (let i = 0; i < 100; i++) {
    for (const marker of markers) {
      if (existsSync(join(current, marker))) {
        return current;
      }
    }
    const parent = join(current, '..');
    if (parent === current) break; // Reached root
    current = parent;
  }

  return null;
}

/**
 * Discover the relay daemon socket path.
 *
 * Discovery order:
 * 1. RELAY_SOCKET environment variable (explicit override)
 * 2. Cloud workspace socket (if WORKSPACE_ID is set)
 * 3. Project-local socket ({projectRoot}/.agent-relay/relay.sock)
 * 4. Legacy fallback (/tmp/agent-relay.sock)
 *
 * @param cwd - Working directory to start search from (default: process.cwd())
 * @returns Discovery result with socket path and metadata
 */
export function discoverSocket(cwd?: string): DiscoveryResult {
  const startDir = cwd || process.cwd();

  // 1. Explicit socket path from environment
  const socketEnv = process.env.RELAY_SOCKET;
  if (socketEnv && existsSync(socketEnv)) {
    return {
      socketPath: socketEnv,
      projectId: process.env.RELAY_PROJECT || 'env',
      source: 'env',
    };
  }

  // 2. Cloud workspace socket (if WORKSPACE_ID is set)
  const workspaceId = process.env.WORKSPACE_ID;
  if (workspaceId) {
    const cloudSocket = `/tmp/relay/${workspaceId}/sockets/daemon.sock`;
    if (existsSync(cloudSocket)) {
      return {
        socketPath: cloudSocket,
        projectId: workspaceId,
        source: 'cloud',
      };
    }
  }

  // 3. Project-local socket
  // First try cwd, then scan up to find project root
  const projectRoot = findProjectRoot(startDir);
  const searchDirs = [startDir];
  if (projectRoot && projectRoot !== startDir) {
    searchDirs.push(projectRoot);
  }

  for (const dir of searchDirs) {
    const projectLocalSocket = join(dir, '.agent-relay', 'relay.sock');
    if (existsSync(projectLocalSocket)) {
      // Read project ID from marker file if available
      let projectId = 'local';
      const markerPath = join(dir, '.agent-relay', '.project');
      if (existsSync(markerPath)) {
        try {
          const marker = JSON.parse(readFileSync(markerPath, 'utf-8'));
          projectId = marker.projectId || 'local';
        } catch {
          // Ignore marker read errors
        }
      }
      return {
        socketPath: projectLocalSocket,
        projectId,
        source: 'project',
      };
    }
  }

  // 4. Legacy fallback
  const legacySocket = '/tmp/agent-relay.sock';
  if (existsSync(legacySocket)) {
    return {
      socketPath: legacySocket,
      projectId: 'legacy',
      source: 'legacy',
    };
  }

  // Also check ~/.agent-relay for legacy global installations
  const homeSocket = join(homedir(), '.agent-relay', 'relay.sock');
  if (existsSync(homeSocket)) {
    return {
      socketPath: homeSocket,
      projectId: 'home',
      source: 'legacy',
    };
  }

  // Return legacy path even if it doesn't exist (will fail on connect)
  return {
    socketPath: legacySocket,
    projectId: 'unknown',
    source: 'legacy',
  };
}

/**
 * Get the default socket path using discovery.
 * Convenience function that returns just the path.
 */
export function getDefaultSocketPath(cwd?: string): string {
  return discoverSocket(cwd).socketPath;
}
