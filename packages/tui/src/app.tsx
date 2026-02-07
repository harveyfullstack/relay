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

  const { sendMessage, sendChannelMessage, joinChannel, spawnAgent, releaseAgent } = useRelay(storeApi, config);

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

  // Handle releasing (killing) an agent
  const handleReleaseAgent = useCallback(
    (name: string) => {
      releaseAgent(name).catch(() => {
        // TODO: show error in status bar
      });
    },
    [releaseAgent],
  );

  // Global keyboard handling — reads state imperatively at keypress time
  useInput((input, key) => {
    const store = storeApi.getState();
    const { focusedPane, modal } = store;

    // If a modal is open, handle dismiss keys
    if (modal) {
      if (modal === 'confirm-release') {
        if (input === 'y' || input === 'Y') {
          const target = store.releaseTarget;
          if (target) {
            handleReleaseAgent(target);
            // If we were viewing this agent, clear selection
            if (store.selectedTarget?.type === 'agent' && store.selectedTarget.name === target) {
              store.setSelectedTarget({ type: 'channel', name: 'all' });
            }
          }
          store.setReleaseTarget(null);
          store.setModal(null);
        } else if (key.escape || input === 'n' || input === 'N') {
          store.setReleaseTarget(null);
          store.setModal(null);
        }
        return;
      }
      if (key.escape) {
        store.setModal(null);
      }
      // Allow period to toggle terminal modal off
      if (input === '.' && modal === 'terminal') {
        store.setModal(null);
      }
      return;
    }

    // Global shortcuts
    if (key.tab) {
      store.cycleFocus();
      // If we just switched to sidebar, snap to nearest interactive item
      if (storeApi.getState().focusedPane === 'sidebar') {
        const interactive = getSidebarInteractiveIndices(store.agents, store.channels);
        if (interactive.length > 0 && !interactive.includes(store.sidebarIndex)) {
          const nearest = interactive.reduce((a, b) =>
            Math.abs(b - store.sidebarIndex) < Math.abs(a - store.sidebarIndex) ? b : a
          );
          store.setSidebarIndex(nearest);
        }
      }
      return;
    }

    if (input === '.' && focusedPane !== 'chat') {
      // Determine which agent to show: selected target, or sidebar highlight
      let agentName: string | null = null;
      if (store.selectedTarget?.type === 'agent') {
        agentName = store.selectedTarget.name;
      } else {
        const target = getSidebarTarget(store.sidebarIndex, store.agents, store.channels);
        if (target.type === 'agent') {
          agentName = target.name;
        } else if (store.agents.length > 0) {
          agentName = store.agents[0].name;
        }
      }
      store.setTerminalAgent(agentName);
      store.setModal(store.modal === 'terminal' ? null : 'terminal');
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

  const selectIndex = (idx: number) => {
    store.setSidebarIndex(idx);
    const target = getSidebarTarget(idx, store.agents, store.channels);
    if (target.type === 'agent') {
      store.setSelectedTarget({ type: 'agent', name: target.name });
    } else if (target.type === 'channel') {
      store.setSelectedTarget({ type: 'channel', name: target.name });
    }
  };

  if (key.upArrow) {
    selectIndex(interactive[Math.max(0, pos - 1)]);
  } else if (key.downArrow) {
    selectIndex(interactive[Math.min(interactive.length - 1, pos + 1)]);
  } else if (key.return) {
    const target = getSidebarTarget(store.sidebarIndex, store.agents, store.channels);
    if (target.type === 'agent' || target.type === 'channel') {
      store.setFocusedPane('chat');
    } else if (target.type === 'action') {
      store.setModal('spawn');
    }
  } else if (input === 'x' || input === 'X') {
    // Prompt to release the currently highlighted agent
    const target = getSidebarTarget(store.sidebarIndex, store.agents, store.channels);
    if (target.type === 'agent') {
      store.setReleaseTarget(target.name);
      store.setModal('confirm-release');
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
