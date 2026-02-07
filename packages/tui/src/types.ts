import type { AgentInfo, StatusResponsePayload } from '@agent-relay/protocol';

export interface TuiMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  timestamp: number;
  kind: string;
  thread?: string;
  channel?: string;
  data?: Record<string, unknown>;
  status?: 'sending' | 'sent' | 'failed';
}

export interface LogEntry {
  timestamp: number;
  agent: string;
  data: string;
}

export type FocusedPane = 'sidebar' | 'chat';

export type ModalType = 'spawn' | 'help' | 'settings' | 'terminal' | 'confirm-release' | null;

export interface TuiSettings {
  /** Display name shown to agents (default: 'Boss') */
  displayName: string;
}

export interface SelectedTarget {
  type: 'agent' | 'channel';
  name: string;
}

export interface TuiConfig {
  socketPath?: string;
  dataDir?: string;
  projectRoot?: string;
}

export type { AgentInfo, StatusResponsePayload };
