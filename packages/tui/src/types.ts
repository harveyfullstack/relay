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
}

export interface LogEntry {
  timestamp: number;
  agent: string;
  data: string;
}

export type FocusedPane = 'sidebar' | 'chat' | 'logs';

export type ModalType = 'spawn' | 'help' | null;

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
