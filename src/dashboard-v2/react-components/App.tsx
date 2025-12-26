/**
 * Dashboard V2 - Main Application Component
 *
 * Root component that combines sidebar, header, and main content area.
 * Manages global state via hooks and provides context to child components.
 */

import React, { useState, useCallback } from 'react';
import type { Agent } from '../types/index.js';
import { Sidebar } from './layout/Sidebar.js';
import { Header } from './layout/Header.js';
import { MessageList } from './MessageList.js';
import { CommandPalette } from './CommandPalette.js';
import { SpawnModal, type SpawnConfig } from './SpawnModal.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useAgents } from './hooks/useAgents.js';
import { useMessages } from './hooks/useMessages.js';
import { api } from '../lib/api.js';

export interface AppProps {
  /** Initial WebSocket URL (optional, defaults to current host) */
  wsUrl?: string;
}

export function App({ wsUrl }: AppProps) {
  // WebSocket connection for real-time data
  const { data, isConnected, error: wsError } = useWebSocket({ url: wsUrl });

  // View mode state
  const [viewMode, setViewMode] = useState<'local' | 'fleet'>('local');

  // Spawn modal state
  const [isSpawnModalOpen, setIsSpawnModalOpen] = useState(false);
  const [isSpawning, setIsSpawning] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  // Command palette state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Agent state management
  const {
    agents,
    groups,
    selectedAgent,
    selectAgent,
    searchQuery,
    setSearchQuery,
    totalCount,
    onlineCount,
    needsAttentionCount,
  } = useAgents({
    agents: data?.agents ?? [],
  });

  // Message state management
  const {
    messages,
    currentChannel,
    setCurrentChannel,
    currentThread,
    setCurrentThread,
    sendMessage,
    isSending,
    sendError,
  } = useMessages({
    messages: data?.messages ?? [],
  });

  // Check if fleet view is available
  const isFleetAvailable = Boolean(data?.fleet?.servers?.length);

  // Handle agent selection
  const handleAgentSelect = useCallback((agent: Agent) => {
    selectAgent(agent.name);
    setCurrentChannel(agent.name);
  }, [selectAgent, setCurrentChannel]);

  // Handle spawn button click
  const handleSpawnClick = useCallback(() => {
    setSpawnError(null);
    setIsSpawnModalOpen(true);
  }, []);

  // Handle spawn agent
  const handleSpawn = useCallback(async (config: SpawnConfig): Promise<boolean> => {
    setIsSpawning(true);
    setSpawnError(null);
    try {
      const result = await api.spawnAgent(config.name, config.command, config.cwd);
      if (!result.success) {
        setSpawnError(result.error || 'Failed to spawn agent');
        return false;
      }
      return true;
    } catch (err) {
      setSpawnError(err instanceof Error ? err.message : 'Failed to spawn agent');
      return false;
    } finally {
      setIsSpawning(false);
    }
  }, []);

  // Handle command palette
  const handleCommandPaletteOpen = useCallback(() => {
    setIsCommandPaletteOpen(true);
  }, []);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K for command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }

      // Escape to close modals
      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
        setIsSpawnModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="dashboard-app">
      {/* Sidebar */}
      <Sidebar
        agents={agents}
        selectedAgent={selectedAgent?.name}
        viewMode={viewMode}
        isFleetAvailable={isFleetAvailable}
        isConnected={isConnected}
        onAgentSelect={handleAgentSelect}
        onViewModeChange={setViewMode}
        onSpawnClick={handleSpawnClick}
      />

      {/* Main Content */}
      <main className="dashboard-main">
        {/* Header */}
        <Header
          currentChannel={currentChannel}
          selectedAgent={selectedAgent}
          onCommandPaletteOpen={handleCommandPaletteOpen}
        />

        {/* Content Area */}
        <div className="dashboard-content">
          {wsError ? (
            <div className="error-state">
              <ErrorIcon />
              <h2>Connection Error</h2>
              <p>{wsError.message}</p>
              <button onClick={() => window.location.reload()}>
                Retry Connection
              </button>
            </div>
          ) : !data ? (
            <div className="loading-state">
              <LoadingSpinner />
              <p>Connecting to dashboard...</p>
            </div>
          ) : (
            <div className="messages-container">
              <MessageList
                messages={messages}
                currentChannel={currentChannel}
                onThreadClick={(messageId) => setCurrentThread(messageId)}
                highlightedMessageId={currentThread ?? undefined}
              />
            </div>
          )}
        </div>

        {/* Message Composer */}
        <div className="message-composer">
          <MessageComposer
            recipient={currentChannel === 'general' ? '*' : currentChannel}
            onSend={sendMessage}
            isSending={isSending}
            error={sendError}
          />
        </div>
      </main>

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        agents={agents}
        onAgentSelect={handleAgentSelect}
        onSpawnClick={handleSpawnClick}
      />

      {/* Spawn Modal */}
      <SpawnModal
        isOpen={isSpawnModalOpen}
        onClose={() => setIsSpawnModalOpen(false)}
        onSpawn={handleSpawn}
        existingAgents={agents.map((a) => a.name)}
        isSpawning={isSpawning}
        error={spawnError}
      />
    </div>
  );
}

/**
 * Simple Message Composer Component
 */
interface MessageComposerProps {
  recipient: string;
  onSend: (to: string, content: string) => Promise<boolean>;
  isSending: boolean;
  error: string | null;
}

function MessageComposer({ recipient, onSend, isSending, error }: MessageComposerProps) {
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isSending) return;

    const success = await onSend(recipient, message);
    if (success) {
      setMessage('');
    }
  };

  return (
    <form className="composer-form" onSubmit={handleSubmit}>
      <input
        type="text"
        className="composer-input"
        placeholder={`Message ${recipient === '*' ? 'everyone' : '@' + recipient}...`}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={isSending}
      />
      <button
        type="submit"
        className="composer-send"
        disabled={!message.trim() || isSending}
      >
        {isSending ? 'Sending...' : 'Send'}
      </button>
      {error && <span className="composer-error">{error}</span>}
    </form>
  );
}

function LoadingSpinner() {
  return (
    <svg className="spinner" width="24" height="24" viewBox="0 0 24 24">
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeDasharray="32"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/**
 * CSS styles for the main app
 */
export const appStyles = `
.dashboard-app {
  display: flex;
  height: 100vh;
  background: #f5f5f5;
}

.dashboard-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dashboard-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  text-align: center;
}

.loading-state .spinner {
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.error-state svg {
  color: #ef4444;
  margin-bottom: 16px;
}

.error-state h2 {
  margin: 0 0 8px;
  color: #1a1a1a;
}

.error-state button {
  margin-top: 16px;
  padding: 8px 16px;
  background: #1264a3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.messages-placeholder {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.agent-summary {
  margin-top: 16px;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 4px;
}

.agent-summary p {
  margin: 4px 0;
  font-size: 13px;
}

.message-composer {
  padding: 16px;
  background: white;
  border-top: 1px solid #e8e8e8;
}

.composer-form {
  display: flex;
  gap: 8px;
  align-items: center;
}

.composer-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
}

.composer-input:focus {
  border-color: #1264a3;
}

.composer-send {
  padding: 10px 20px;
  background: #1264a3;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.composer-send:hover:not(:disabled) {
  background: #0d4f82;
}

.composer-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.composer-error {
  color: #ef4444;
  font-size: 12px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 8px;
  padding: 24px;
  min-width: 400px;
  max-width: 90vw;
}

.modal h2 {
  margin: 0 0 16px;
}

.command-palette {
  background: white;
  border-radius: 8px;
  padding: 8px;
  width: 500px;
  max-width: 90vw;
}

.command-palette input {
  width: 100%;
  padding: 12px 16px;
  border: none;
  font-size: 16px;
  outline: none;
}
`;
