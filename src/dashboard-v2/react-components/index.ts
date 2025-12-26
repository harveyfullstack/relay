/**
 * Dashboard V2 React Components
 *
 * This module requires React to be installed.
 * Install with: npm install react react-dom
 */

// Core Components
export { AgentCard, agentCardStyles, type AgentCardProps } from './AgentCard.js';
export { AgentList, agentListStyles, type AgentListProps } from './AgentList.js';
export { MessageList, messageListStyles, type MessageListProps } from './MessageList.js';
export { CommandPalette, commandPaletteStyles, type CommandPaletteProps, type Command } from './CommandPalette.js';
export { SpawnModal, spawnModalStyles, type SpawnModalProps, type SpawnConfig } from './SpawnModal.js';
export { TrajectoryViewer, trajectoryViewerStyles, type TrajectoryViewerProps, type TrajectoryStep } from './TrajectoryViewer.js';
export { DecisionQueue, decisionQueueStyles, type DecisionQueueProps, type Decision } from './DecisionQueue.js';
export { ServerCard, serverCardStyles, type ServerCardProps, type ServerInfo } from './ServerCard.js';
export { FleetOverview, fleetOverviewStyles, type FleetOverviewProps } from './FleetOverview.js';
export { BroadcastComposer, broadcastComposerStyles, type BroadcastComposerProps, type BroadcastTarget } from './BroadcastComposer.js';
export { SettingsPanel, settingsPanelStyles, defaultSettings, type SettingsPanelProps, type Settings } from './SettingsPanel.js';
export { NotificationToast, notificationToastStyles, useToasts, type NotificationToastProps, type Toast } from './NotificationToast.js';
export { ThemeProvider, ThemeToggle, themeStyles, themeToggleStyles, useTheme, type ThemeProviderProps, type Theme, type ResolvedTheme } from './ThemeProvider.js';
export { App, appStyles, type AppProps } from './App.js';

// Layout Components
export { Sidebar, sidebarStyles, type SidebarProps } from './layout/Sidebar.js';
export { Header, headerStyles, type HeaderProps } from './layout/Header.js';

// Hooks
export {
  useWebSocket,
  useAgents,
  useMessages,
  type UseWebSocketOptions,
  type UseWebSocketReturn,
  type UseAgentsOptions,
  type UseAgentsReturn,
  type UseMessagesOptions,
  type UseMessagesReturn,
  type DashboardData,
  type AgentWithColor,
} from './hooks/index.js';

// Combined styles for easy import
export const allStyles = `
/* Agent Card Styles */
${/* agentCardStyles - imported dynamically */ ''}

/* Agent List Styles */
${/* agentListStyles - imported dynamically */ ''}

/* Sidebar Styles */
${/* sidebarStyles - imported dynamically */ ''}

/* Header Styles */
${/* headerStyles - imported dynamically */ ''}
`;
