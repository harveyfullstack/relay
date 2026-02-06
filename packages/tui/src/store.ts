import { createStore } from 'zustand/vanilla';
import type {
  TuiMessage,
  LogEntry,
  FocusedPane,
  ModalType,
  SelectedTarget,
  AgentInfo,
  StatusResponsePayload,
} from './types.js';

const MAX_MESSAGES = 2000;
const MAX_LOGS_PER_AGENT = 500;

export interface TuiState {
  // Connection
  connected: boolean;
  daemonStatus: StatusResponsePayload | null;

  // Agents
  agents: AgentInfo[];

  // Messages
  messages: TuiMessage[];

  // Logs (keyed by agent name)
  logs: Record<string, LogEntry[]>;

  // Channels the TUI has joined
  channels: string[];

  // UI state
  focusedPane: FocusedPane;
  selectedTarget: SelectedTarget | null;
  sidebarIndex: number;
  activeThread: string | null;
  logsVisible: boolean;
  modal: ModalType;
  scrollOffset: number;
}

export interface TuiActions {
  // Connection
  setConnected: (connected: boolean) => void;
  setDaemonStatus: (status: StatusResponsePayload) => void;

  // Agents
  setAgents: (agents: AgentInfo[]) => void;

  // Messages
  addMessage: (msg: TuiMessage) => void;
  loadMessages: (msgs: TuiMessage[]) => void;

  // Logs
  addLog: (entry: LogEntry) => void;

  // Channels
  addChannel: (channel: string) => void;
  removeChannel: (channel: string) => void;

  // UI
  setFocusedPane: (pane: FocusedPane) => void;
  cycleFocus: () => void;
  setSelectedTarget: (target: SelectedTarget | null) => void;
  setSidebarIndex: (index: number) => void;
  setActiveThread: (threadId: string | null) => void;
  toggleLogs: () => void;
  setModal: (modal: ModalType) => void;
  setScrollOffset: (offset: number) => void;
  scrollUp: (lines: number) => void;
  scrollDown: (lines: number) => void;
}

export type TuiStore = TuiState & TuiActions;

export function createTuiStore() {
  return createStore<TuiStore>((set, get) => ({
    // Initial state
    connected: false,
    daemonStatus: null,
    agents: [],
    messages: [],
    logs: {},
    channels: [],
    focusedPane: 'sidebar',
    selectedTarget: null,
    sidebarIndex: 0,
    activeThread: null,
    logsVisible: false,
    modal: null,
    scrollOffset: 0,

    // Connection
    setConnected: (connected) => set({ connected }),
    setDaemonStatus: (status) => set({ daemonStatus: status }),

    // Agents
    setAgents: (agents) => set({ agents }),

    // Messages (deduplicate by ID)
    addMessage: (msg) =>
      set((state) => {
        // Skip if we already have this message
        if (state.messages.some((m) => m.id === msg.id)) return state;
        const messages = [...state.messages, msg];
        if (messages.length > MAX_MESSAGES) {
          return { messages: messages.slice(messages.length - MAX_MESSAGES) };
        }
        return { messages };
      }),

    loadMessages: (msgs) =>
      set({ messages: msgs.slice(-MAX_MESSAGES) }),

    // Logs
    addLog: (entry) =>
      set((state) => {
        const agentLogs = state.logs[entry.agent] ?? [];
        const updated = [...agentLogs, entry];
        // Cap at MAX_LOGS_PER_AGENT
        const capped = updated.length > MAX_LOGS_PER_AGENT
          ? updated.slice(updated.length - MAX_LOGS_PER_AGENT)
          : updated;
        return { logs: { ...state.logs, [entry.agent]: capped } };
      }),

    // Channels
    addChannel: (channel) =>
      set((state) => {
        if (state.channels.includes(channel)) return state;
        return { channels: [...state.channels, channel] };
      }),

    removeChannel: (channel) =>
      set((state) => ({
        channels: state.channels.filter((c) => c !== channel),
      })),

    // UI
    setFocusedPane: (pane) => set({ focusedPane: pane }),

    cycleFocus: () =>
      set((state) => {
        const panes: FocusedPane[] = state.logsVisible
          ? ['sidebar', 'chat', 'logs']
          : ['sidebar', 'chat'];
        const currentIndex = panes.indexOf(state.focusedPane);
        const nextIndex = (currentIndex + 1) % panes.length;
        return { focusedPane: panes[nextIndex] };
      }),

    setSelectedTarget: (target) => set({ selectedTarget: target, scrollOffset: 0, activeThread: null }),
    setSidebarIndex: (index) => set({ sidebarIndex: index }),
    setActiveThread: (threadId) => set({ activeThread: threadId, scrollOffset: 0 }),
    toggleLogs: () => set((state) => ({ logsVisible: !state.logsVisible })),
    setModal: (modal) => set({ modal }),
    setScrollOffset: (offset) => set({ scrollOffset: Math.max(0, offset) }),

    scrollUp: (lines) =>
      set((state) => ({ scrollOffset: state.scrollOffset + lines })),

    scrollDown: (lines) =>
      set((state) => ({ scrollOffset: Math.max(0, state.scrollOffset - lines) })),
  }));
}
