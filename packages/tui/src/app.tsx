import React, { useCallback } from 'react';
import { useInput, useApp } from 'ink';
import { Layout } from './components/Layout.js';
import { useDimensions } from './hooks/use-dimensions.js';
import { useRelay } from './hooks/use-relay.js';
import { getSidebarInteractiveIndices, getSidebarTarget } from './components/Sidebar.js';
import type { TuiConfig, TuiSettings } from './types.js';
import type { TuiStore } from './store.js';
import type { StoreApi } from 'zustand';
import { saveSettings } from './settings.js';

interface AppProps {
  storeApi: StoreApi<TuiStore>;
  config: TuiConfig;
}

export function App({ storeApi, config }: AppProps) {
  const dimensions = useDimensions();
  const { exit } = useApp();

  const { sendMessage, sendChannelMessage, joinChannel, spawnAgent } = useRelay(storeApi, config);

  // Handle sending a message from the input bar
  const handleSendMessage = useCallback(
    (text: string) => {
      const store = storeApi.getState();
      const target = store.selectedTarget;
      if (!target) return;

      if (target.type === 'channel') {
        sendChannelMessage(target.name, text, store.activeThread ?? undefined);
      } else {
        sendMessage(target.name, text, store.activeThread ?? undefined);
      }

      // Auto-scroll to bottom on send
      store.setScrollOffset(0);
    },
    [storeApi, sendMessage, sendChannelMessage],
  );

  // Handle saving settings
  const handleSaveSettings = useCallback(
    (settings: TuiSettings) => {
      storeApi.getState().setSettings(settings);
      saveSettings(settings, config.dataDir);
    },
    [storeApi, config.dataDir],
  );

  // Handle spawning an agent
  const handleSpawnAgent = useCallback(
    (name: string, cli: string, task?: string) => {
      spawnAgent(name, cli, task).catch(() => {
        // TODO: show error in status bar
      });
    },
    [spawnAgent],
  );

  // Global keyboard handling — reads state imperatively at keypress time
  useInput((input, key) => {
    const store = storeApi.getState();
    const { focusedPane, modal } = store;

    // If a modal is open, let it handle input
    if (modal) {
      // Only handle escape at the top level as a fallback
      if (key.escape) {
        store.setModal(null);
      }
      return;
    }

    // Global shortcuts
    if (key.tab) {
      store.cycleFocus();
      return;
    }

    if (key.ctrl && input === 'l') {
      store.toggleLogs();
      return;
    }

    if (input === '?' && focusedPane !== 'chat') {
      store.setModal('help');
      return;
    }

    if (input === ',' && focusedPane !== 'chat') {
      store.setModal('settings');
      return;
    }

    // Pane-specific input
    if (focusedPane === 'sidebar') {
      handleSidebarInput(input, key, store);
    } else if (focusedPane === 'chat') {
      handleChatInput(input, key, store);
    } else if (focusedPane === 'logs') {
      // Logs pane doesn't have special input yet
    }
  });

  return (
    <Layout
      storeApi={storeApi}
      dimensions={dimensions}
      onSendMessage={handleSendMessage}
      onSpawnAgent={handleSpawnAgent}
      onSaveSettings={handleSaveSettings}
    />
  );
}

function handleSidebarInput(
  input: string,
  key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean },
  store: TuiStore,
) {
  const interactive = getSidebarInteractiveIndices(store.agents, store.channels);
  if (interactive.length === 0) return;

  // Snap to nearest interactive index if currently on a non-interactive item
  let current = store.sidebarIndex;
  if (!interactive.includes(current)) {
    const nearest = interactive.reduce((a, b) =>
      Math.abs(b - current) < Math.abs(a - current) ? b : a
    );
    store.setSidebarIndex(nearest);
    return;
  }

  const pos = interactive.indexOf(current);

  if (key.upArrow) {
    store.setSidebarIndex(interactive[Math.max(0, pos - 1)]);
  } else if (key.downArrow) {
    store.setSidebarIndex(interactive[Math.min(interactive.length - 1, pos + 1)]);
  } else if (key.return) {
    const target = getSidebarTarget(store.sidebarIndex, store.agents, store.channels);
    if (target.type === 'agent') {
      store.setSelectedTarget({ type: 'agent', name: target.name });
    } else if (target.type === 'channel') {
      store.setSelectedTarget({ type: 'channel', name: target.name });
    } else if (target.type === 'action') {
      store.setModal('spawn');
    }
  } else if (input === 's' || input === 'S') {
    store.setModal('spawn');
  }
}

function handleChatInput(
  input: string,
  key: { upArrow: boolean; downArrow: boolean; escape: boolean; pageDown?: boolean; pageUp?: boolean },
  store: TuiStore,
) {
  if (key.upArrow) {
    store.scrollUp(1);
  } else if (key.downArrow) {
    store.scrollDown(1);
  } else if (key.escape) {
    if (store.activeThread) {
      store.setActiveThread(null);
    }
  }
}
