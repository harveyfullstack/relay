import React, { useCallback } from 'react';
import { Box } from 'ink';
import { useStore } from 'zustand';
import { Header } from './Header.js';
import { StatusBar } from './StatusBar.js';
import { Sidebar } from './Sidebar.js';
import { ChatPane } from './ChatPane.js';
import { InputBar } from './InputBar.js';
import { AgentTermPane } from './AgentTermPane.js';
import { SpawnDialog } from './SpawnDialog.js';
import { HelpOverlay } from './HelpOverlay.js';
import { SettingsModal } from './SettingsModal.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { TeamInitDialog } from './TeamInitDialog.js';
import type { TuiStore } from '../store.js';
import type { StoreApi } from 'zustand';
import type { Dimensions } from '../hooks/use-dimensions.js';

interface LayoutProps {
  storeApi: StoreApi<TuiStore>;
  dimensions: Dimensions;
  onSendMessage: (text: string) => void;
  onSpawnAgent: (name: string, cli: string, task?: string) => void;
  onSpawnTeam: (members: { name: string; cli: string }[]) => void;
  onSaveSettings: (settings: import('../types.js').TuiSettings) => void;
}

export function Layout({ storeApi, dimensions, onSendMessage, onSpawnAgent, onSpawnTeam, onSaveSettings }: LayoutProps) {
  const { width, height } = dimensions;

  const {
    connected,
    daemonStatus,
    agents,
    messages,
    channels,
    focusedPane,
    selectedTarget,
    sidebarIndex,
    activeThread,
    modal,
    releaseTarget,
    terminalAgent,
    scrollOffset,
    processingAgents,
    readyAgents,
    settings,
    setModal,
  } = useStore(storeApi);

  const closeModal = useCallback(() => setModal(null), [setModal]);

  // Layout dimensions
  const sidebarWidth = Math.max(18, Math.floor(width * 0.2));
  const statusHeight = 1;
  const headerHeight = 1;
  const inputHeight = 3;
  const contentHeight = height - statusHeight - headerHeight;
  const chatHeight = contentHeight - inputHeight;

  const mainContentWidth = width - sidebarWidth;
  const chatWidth = mainContentWidth;

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {/* Header */}
      <Header
        projectRoot={undefined}
        agents={agents}
        connected={connected}
        width={width}
      />

      {/* Main content area */}
      <Box flexDirection="row" height={contentHeight}>
        {/* Sidebar */}
        <Sidebar
          agents={agents}
          channels={channels}
          selectedTarget={selectedTarget}
          sidebarIndex={sidebarIndex}
          focused={focusedPane === 'sidebar'}
          width={sidebarWidth}
          height={contentHeight}
          processingAgents={processingAgents}
          readyAgents={readyAgents}
        />

        {/* Chat + Input */}
        <Box flexDirection="column" width={chatWidth}>
          <ChatPane
            messages={messages}
            selectedTarget={selectedTarget}
            activeThread={activeThread}
            scrollOffset={scrollOffset}
            focused={focusedPane === 'chat'}
            width={chatWidth}
            height={chatHeight}
            processingAgents={processingAgents}
            displayName={settings.displayName}
          />
          <InputBar
            selectedTarget={selectedTarget}
            focused={focusedPane === 'chat'}
            onSubmit={onSendMessage}
            width={chatWidth}
          />
        </Box>

      </Box>

      {/* Status bar */}
      <StatusBar
        connected={connected}
        daemonStatus={daemonStatus}
        agents={agents}
        width={width}
      />

      {/* Modal overlays */}
      {modal === 'spawn' && (
        <Box position="absolute" marginLeft={Math.floor(width / 2) - 22} marginTop={Math.floor(height / 3)}>
          <SpawnDialog
            onSpawn={onSpawnAgent}
            onClose={closeModal}
          />
        </Box>
      )}
      {modal === 'help' && (
        <Box position="absolute" marginLeft={Math.floor(width / 2) - 25} marginTop={Math.floor(height / 4)}>
          <HelpOverlay onClose={closeModal} />
        </Box>
      )}
      {modal === 'settings' && (
        <Box position="absolute" marginLeft={Math.floor(width / 2) - 22} marginTop={Math.floor(height / 3)}>
          <SettingsModal
            settings={settings}
            onSave={onSaveSettings}
            onClose={closeModal}
          />
        </Box>
      )}
      {modal === 'terminal' && (
        <Box position="absolute" marginLeft={Math.floor(width * 0.1)} marginTop={2}>
          <AgentTermPane
            agentName={terminalAgent}
            width={Math.floor(width * 0.8)}
            height={height - 4}
          />
        </Box>
      )}
      {modal === 'confirm-release' && releaseTarget && (
        <Box position="absolute" marginLeft={Math.floor(width / 2) - 22} marginTop={Math.floor(height / 3)}>
          <ConfirmDialog
            message={`Release agent "${releaseTarget}"? This will kill the process.`}
          />
        </Box>
      )}
      {modal === 'team-init' && (
        <Box position="absolute" marginLeft={Math.floor(width / 2) - 26} marginTop={Math.floor(height / 4)}>
          <TeamInitDialog
            onSpawnTeam={(members) => {
              closeModal();
              onSpawnTeam(members);
            }}
            onSkip={closeModal}
          />
        </Box>
      )}
    </Box>
  );
}
