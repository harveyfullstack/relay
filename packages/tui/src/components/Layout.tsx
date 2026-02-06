import React from 'react';
import { Box } from 'ink';
import { Header } from './Header.js';
import { StatusBar } from './StatusBar.js';
import { Sidebar } from './Sidebar.js';
import { ChatPane } from './ChatPane.js';
import { InputBar } from './InputBar.js';
import { LogPane } from './LogPane.js';
import { SpawnDialog } from './SpawnDialog.js';
import { HelpOverlay } from './HelpOverlay.js';
import type { TuiStore } from '../store.js';
import type { Dimensions } from '../hooks/use-dimensions.js';

interface LayoutProps {
  store: TuiStore;
  dimensions: Dimensions;
  onSendMessage: (text: string) => void;
  onSpawnAgent: (name: string, cli: string, task?: string) => void;
}

export function Layout({ store, dimensions, onSendMessage, onSpawnAgent }: LayoutProps) {
  const { width, height } = dimensions;

  const {
    connected,
    daemonStatus,
    agents,
    messages,
    logs,
    channels,
    focusedPane,
    selectedTarget,
    sidebarIndex,
    activeThread,
    logsVisible,
    modal,
    scrollOffset,
  } = store;

  // Layout dimensions
  const sidebarWidth = Math.max(18, Math.floor(width * 0.2));
  const statusHeight = 1;
  const headerHeight = 1;
  const inputHeight = 3;
  const contentHeight = height - statusHeight - headerHeight;
  const chatHeight = contentHeight - inputHeight;

  const mainContentWidth = width - sidebarWidth;
  const chatWidth = logsVisible
    ? Math.floor(mainContentWidth * 0.55)
    : mainContentWidth;
  const logWidth = logsVisible ? mainContentWidth - chatWidth : 0;

  return (
    <Box flexDirection="column" width={width} height={height}>
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
          />
          <InputBar
            selectedTarget={selectedTarget}
            focused={focusedPane === 'chat'}
            onSubmit={onSendMessage}
            width={chatWidth}
          />
        </Box>

        {/* Log pane (optional) */}
        {logsVisible && (
          <LogPane
            logs={logs}
            selectedTarget={selectedTarget}
            focused={focusedPane === 'logs'}
            width={logWidth}
            height={contentHeight}
          />
        )}
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
            onClose={() => store.setModal(null)}
          />
        </Box>
      )}
      {modal === 'help' && (
        <Box position="absolute" marginLeft={Math.floor(width / 2) - 25} marginTop={Math.floor(height / 4)}>
          <HelpOverlay onClose={() => store.setModal(null)} />
        </Box>
      )}
    </Box>
  );
}
