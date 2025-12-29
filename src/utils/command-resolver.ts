/**
 * Command Path Resolver
 *
 * Resolves full paths for CLI commands to avoid posix_spawnp failures
 * when PATH isn't properly inherited in spawned processes.
 */

import { execSync } from 'node:child_process';

/**
 * Resolve the full path of a command using 'which'
 * Returns the full path if found, or the original command if not found
 * (letting the spawn fail with a clearer error)
 */
export function resolveCommand(command: string): string {
  try {
    const output = execSync(`which ${command}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const resolvedPath = output.trim();
    if (resolvedPath) {
      return resolvedPath;
    }
  } catch {
    // Command not found in PATH
  }

  // Return original command - spawn will fail with a clearer error
  return command;
}

/**
 * Check if a command exists in PATH
 */
export function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
