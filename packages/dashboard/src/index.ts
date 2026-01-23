/**
 * @agent-relay/dashboard
 *
 * Optional web dashboard for Agent Relay.
 * Install separately: npm install -g @agent-relay/dashboard
 *
 * This package provides:
 * - Dashboard HTTP API for agent management
 * - WebSocket connections for real-time updates
 * - User bridge for browser-based users
 * - Metrics collection and reporting
 * - Static Next.js UI for visual agent coordination
 */

export { startDashboard } from './server.js';
export { UserBridge, type IRelayClient } from './user-bridge.js';
export { computeNeedsAttention, type AttentionMessage } from './needs-attention.js';
export {
  computeSystemMetrics,
  formatPrometheusMetrics,
  type AgentMetrics,
  type ThroughputMetrics,
} from './metrics.js';
export { HealthWorkerManager, getHealthPort, type HealthWorkerConfig, type HealthStatsProvider } from './health-worker-manager.js';
export type { ThreadMetadata } from './types/threading.js';
