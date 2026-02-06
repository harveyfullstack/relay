import fs from 'node:fs';
import path from 'node:path';
import type { TuiSettings } from './types.js';

const SETTINGS_FILENAME = 'tui-settings.json';

export const DEFAULT_SETTINGS: TuiSettings = {
  displayName: 'Boss',
};

/**
 * Resolve the path to the settings file.
 * Uses the relay data directory (e.g., ~/.agent-relay/tui-settings.json).
 */
function resolveSettingsPath(dataDir?: string): string | null {
  if (dataDir) {
    return path.join(dataDir, SETTINGS_FILENAME);
  }
  // Fall back to .agent-relay in cwd
  const relayDir = path.join(process.cwd(), '.agent-relay');
  if (fs.existsSync(relayDir)) {
    return path.join(relayDir, SETTINGS_FILENAME);
  }
  return null;
}

/**
 * Load settings from disk, returning defaults for any missing fields.
 */
export function loadSettings(dataDir?: string): TuiSettings {
  const filePath = resolveSettingsPath(dataDir);
  if (!filePath) return { ...DEFAULT_SETTINGS };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<TuiSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    // File doesn't exist or is invalid — use defaults
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to disk.
 */
export function saveSettings(settings: TuiSettings, dataDir?: string): boolean {
  const filePath = resolveSettingsPath(dataDir);
  if (!filePath) return false;

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}
