import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { createTuiStore } from './store.js';
import { loadSettings } from './settings.js';
import type { TuiConfig } from './types.js';

export type { TuiConfig } from './types.js';

/**
 * Start the Agent Relay TUI.
 * This takes over the terminal with a full-screen chat interface.
 * Returns a promise that resolves when the user quits (Ctrl+C).
 */
export async function startTui(config: TuiConfig = {}): Promise<void> {
  const storeApi = createTuiStore();

  // Load persisted settings from disk
  const settings = loadSettings(config.dataDir);
  storeApi.getState().setSettings(settings);

  const { waitUntilExit, unmount } = render(
    React.createElement(App, { storeApi, config }),
    {
      exitOnCtrlC: true,
    },
  );

  // Handle clean shutdown
  const cleanup = () => {
    unmount();
  };

  process.on('SIGTERM', cleanup);

  try {
    await waitUntilExit();
  } finally {
    process.off('SIGTERM', cleanup);
  }
}
