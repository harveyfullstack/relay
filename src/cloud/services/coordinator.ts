/**
 * Coordinator Agent Service
 *
 * Manages lifecycle of coordinator agents for project groups.
 * Coordinators oversee and orchestrate work across repositories in a group.
 */

import { db, ProjectGroup, Repository, CoordinatorAgentConfig } from '../db/index.js';

/**
 * Coordinator agent state
 */
interface CoordinatorState {
  groupId: string;
  groupName: string;
  agentName: string;
  model: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  startedAt?: Date;
  stoppedAt?: Date;
  error?: string;
  repositories: Repository[];
}

/**
 * In-memory coordinator state tracker
 * In production, this would be persisted to database or Redis
 */
const coordinatorStates = new Map<string, CoordinatorState>();

export interface CoordinatorService {
  start(groupId: string): Promise<void>;
  stop(groupId: string): Promise<void>;
  restart(groupId: string): Promise<void>;
  getStatus(groupId: string): Promise<CoordinatorState | null>;
  listActive(): Promise<CoordinatorState[]>;
}

/**
 * Start a coordinator agent for a project group
 */
async function start(groupId: string): Promise<void> {
  const group = await db.projectGroups.findById(groupId);
  if (!group) {
    throw new Error('Project group not found');
  }

  if (!group.coordinatorAgent?.enabled) {
    throw new Error('Coordinator is not enabled for this group');
  }

  const repositories = await db.repositories.findByProjectGroupId(groupId);
  if (repositories.length === 0) {
    throw new Error('Cannot start coordinator for empty group');
  }

  const config = group.coordinatorAgent;
  const agentName = config.name || `${group.name} Coordinator`;
  const model = config.model || 'claude-sonnet-4-5';

  // Check if already running
  const existing = coordinatorStates.get(groupId);
  if (existing && existing.status === 'running') {
    console.log(`Coordinator for group ${groupId} is already running`);
    return;
  }

  // Update state to starting
  const state: CoordinatorState = {
    groupId,
    groupName: group.name,
    agentName,
    model,
    status: 'starting',
    repositories,
  };
  coordinatorStates.set(groupId, state);

  try {
    // Spawn the coordinator agent
    // In a real implementation, this would:
    // 1. Connect to agent-relay daemon or cloud workspace
    // 2. Spawn agent with configured name and model
    // 3. Provide system prompt with group context
    // 4. Configure capabilities (read repos, create PRs, etc.)

    await spawnCoordinatorAgent(group, config, repositories);

    // Update state to running
    state.status = 'running';
    state.startedAt = new Date();
    coordinatorStates.set(groupId, state);

    console.log(`Coordinator agent started for group ${groupId}: ${agentName}`);
  } catch (error) {
    state.status = 'error';
    state.error = error instanceof Error ? error.message : 'Unknown error';
    coordinatorStates.set(groupId, state);
    throw error;
  }
}

/**
 * Stop a coordinator agent for a project group
 */
async function stop(groupId: string): Promise<void> {
  const state = coordinatorStates.get(groupId);
  if (!state) {
    // Not running, nothing to do
    return;
  }

  if (state.status === 'stopped') {
    return;
  }

  // Update state to stopping
  state.status = 'stopping';
  coordinatorStates.set(groupId, state);

  try {
    // Stop the coordinator agent
    // In a real implementation, this would:
    // 1. Send stop signal to the agent
    // 2. Wait for graceful shutdown
    // 3. Clean up resources

    await stopCoordinatorAgent(groupId, state);

    // Update state to stopped
    state.status = 'stopped';
    state.stoppedAt = new Date();
    coordinatorStates.set(groupId, state);

    console.log(`Coordinator agent stopped for group ${groupId}`);
  } catch (error) {
    state.status = 'error';
    state.error = error instanceof Error ? error.message : 'Unknown error';
    coordinatorStates.set(groupId, state);
    throw error;
  }
}

/**
 * Restart a coordinator agent
 */
async function restart(groupId: string): Promise<void> {
  await stop(groupId);
  await start(groupId);
}

/**
 * Get status of a coordinator agent
 */
async function getStatus(groupId: string): Promise<CoordinatorState | null> {
  return coordinatorStates.get(groupId) || null;
}

/**
 * List all active coordinators
 */
async function listActive(): Promise<CoordinatorState[]> {
  return Array.from(coordinatorStates.values()).filter(
    (state) => state.status === 'running' || state.status === 'starting'
  );
}

/**
 * Spawn the actual coordinator agent
 * This is a placeholder for the actual implementation
 */
async function spawnCoordinatorAgent(
  group: ProjectGroup,
  config: CoordinatorAgentConfig,
  repositories: Repository[]
): Promise<void> {
  // Build system prompt for the coordinator
  const systemPrompt = buildCoordinatorSystemPrompt(group, config, repositories);

  // In a real implementation, this would use one of:
  // 1. agent-relay spawn command via daemon
  // 2. Cloud workspace agent spawning API
  // 3. Direct Agent SDK integration

  console.log(`Spawning coordinator agent: ${config.name || group.name}`);
  console.log(`Model: ${config.model || 'claude-sonnet-4-5'}`);
  console.log(`Repositories: ${repositories.map((r) => r.githubFullName).join(', ')}`);
  console.log(`System prompt: ${systemPrompt}`);

  // Simulate async spawn operation
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Stop the actual coordinator agent
 */
async function stopCoordinatorAgent(groupId: string, state: CoordinatorState): Promise<void> {
  console.log(`Stopping coordinator agent for group ${groupId}: ${state.agentName}`);

  // Simulate async stop operation
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Build system prompt for coordinator agent
 */
function buildCoordinatorSystemPrompt(
  group: ProjectGroup,
  config: CoordinatorAgentConfig,
  repositories: Repository[]
): string {
  const repoList = repositories.map((r) => r.githubFullName).join('\n- ');

  let prompt = `You are the coordinator agent for the "${group.name}" project group.

Your role is to oversee and orchestrate work across the following repositories:
- ${repoList}

`;

  if (config.capabilities && config.capabilities.length > 0) {
    prompt += `You have the following capabilities:
${config.capabilities.map((c) => `- ${c}`).join('\n')}

`;
  }

  if (config.systemPrompt) {
    prompt += `${config.systemPrompt}\n\n`;
  }

  prompt += `When coordinating work:
1. Monitor all repositories in your group
2. Identify dependencies and coordination points
3. Delegate tasks to project-specific agents when appropriate
4. Ensure consistency across repositories
5. Report status and blockers to the team

Use the Agent Relay messaging system to communicate with other agents and team members.`;

  return prompt;
}

/**
 * Singleton instance
 */
let coordinatorServiceInstance: CoordinatorService | null = null;

/**
 * Get the coordinator service singleton
 */
export function getCoordinatorService(): CoordinatorService {
  if (!coordinatorServiceInstance) {
    coordinatorServiceInstance = {
      start,
      stop,
      restart,
      getStatus,
      listActive,
    };
  }
  return coordinatorServiceInstance;
}

/**
 * Initialize coordinator service
 * Restarts any coordinators that should be running
 */
export async function initializeCoordinatorService(): Promise<void> {
  console.log('Initializing coordinator service...');

  // In a production system, this would:
  // 1. Query database for all enabled coordinators
  // 2. Check their expected state
  // 3. Restart any that should be running

  // For now, just log initialization
  console.log('Coordinator service initialized');
}
