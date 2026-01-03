/**
 * Scaling Orchestrator
 *
 * Main integration layer that connects:
 * - AutoScaler (policy evaluation and scaling decisions)
 * - CapacityManager (workspace capacity tracking)
 * - WorkspaceProvisioner (actual instance provisioning)
 * - Monitoring (memory/CPU metrics from agents)
 *
 * Handles the complete scaling lifecycle:
 * 1. Receives metrics from monitoring
 * 2. Updates capacity manager
 * 3. Triggers auto-scaler evaluation
 * 4. Executes scaling via provisioner
 * 5. Updates capacity after scaling
 */

import { EventEmitter } from 'events';
import { AutoScaler, createAutoScaler, ScalingOperation } from './auto-scaler.js';
import { CapacityManager, createCapacityManager, CapacityForecast } from './capacity-manager.js';
import { ScalingDecision, WorkspaceMetrics, getScalingPolicyService } from './scaling-policy.js';
import { WorkspaceProvisioner, getProvisioner, ProvisionConfig, ProvisionResult } from '../provisioner/index.js';
import { db } from '../db/index.js';

export interface ScalingEvent {
  type: 'scale_up' | 'scale_down' | 'rebalance' | 'alert';
  userId: string;
  workspaceId?: string;
  decision?: ScalingDecision;
  operation?: ScalingOperation;
  result?: ProvisionResult;
  error?: string;
  timestamp: Date;
}

export interface OrchestratorConfig {
  enabled: boolean;
  redisUrl?: string;
  autoProvision: boolean; // Automatically provision when scaling up
  autoDeprovision: boolean; // Automatically deprovision idle workspaces
  idleTimeoutMs: number; // How long a workspace can be idle before deprovisioning
  minUserWorkspaces: number; // Minimum workspaces per user (won't scale below this)
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  enabled: true,
  autoProvision: true,
  autoDeprovision: false, // Disabled by default for safety
  idleTimeoutMs: 30 * 60 * 1000, // 30 minutes
  minUserWorkspaces: 1,
};

export class ScalingOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private autoScaler: AutoScaler;
  private capacityManager: CapacityManager;
  private provisioner: WorkspaceProvisioner;
  private initialized: boolean = false;
  private scalingHistory: ScalingEvent[] = [];
  private maxHistorySize: number = 1000;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.autoScaler = createAutoScaler({ enabled: this.config.enabled });
    this.capacityManager = createCapacityManager();
    this.provisioner = getProvisioner();
  }

  /**
   * Initialize the orchestrator with Redis for cross-server coordination
   */
  async initialize(redisUrl?: string): Promise<void> {
    if (this.initialized) return;

    const url = redisUrl || this.config.redisUrl;
    if (!url) {
      console.warn('[ScalingOrchestrator] No Redis URL provided, running in local mode');
      this.initialized = true;
      return;
    }

    try {
      // Initialize both services with Redis
      await Promise.all([
        this.autoScaler.initialize(url),
        this.capacityManager.initialize(url),
      ]);

      // Set up event handlers
      this.setupEventHandlers();

      this.initialized = true;
      this.emit('initialized');
    } catch (error) {
      this.emit('error', { context: 'initialization', error });
      throw error;
    }
  }

  /**
   * Set up event handlers between components
   */
  private setupEventHandlers(): void {
    // Handle scaling execution requests from auto-scaler
    this.autoScaler.on('execute_scaling', async ({ operation, decision }) => {
      try {
        await this.executeScaling(operation, decision);
      } catch (error) {
        this.recordEvent({
          type: operation.action,
          userId: operation.userId,
          operation,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date(),
        });
      }
    });

    // Handle capacity updates
    this.capacityManager.on('capacity_updated', (capacity) => {
      // Check if any user needs scaling based on new capacity data
      this.checkScalingNeeded(capacity.userId);
    });

    // Handle stale workspaces
    this.capacityManager.on('workspace_stale', async ({ workspaceId }) => {
      this.emit('workspace_stale', workspaceId);
      // Could trigger health check or restart here
    });

    // Forward auto-scaler events
    this.autoScaler.on('scaling_started', (op) => this.emit('scaling_started', op));
    this.autoScaler.on('scaling_completed', (op) => this.emit('scaling_completed', op));
    this.autoScaler.on('scaling_error', (data) => this.emit('scaling_error', data));
  }

  /**
   * Check if scaling is needed for a user
   */
  private async checkScalingNeeded(userId: string): Promise<void> {
    const forecast = this.capacityManager.getCapacityForecast(userId);
    if (!forecast) return;

    // Emit forecast for monitoring
    this.emit('capacity_forecast', forecast);

    // Take action based on recommendation
    if (forecast.recommendation === 'critical' || forecast.recommendation === 'scale_now') {
      this.emit('scaling_recommended', {
        userId,
        recommendation: forecast.recommendation,
        forecast,
      });
    }
  }

  /**
   * Execute a scaling operation
   */
  private async executeScaling(
    operation: ScalingOperation,
    decision: ScalingDecision
  ): Promise<void> {
    const event: ScalingEvent = {
      type: operation.action,
      userId: operation.userId,
      decision,
      operation,
      timestamp: new Date(),
    };

    try {
      switch (operation.action) {
        case 'scale_up':
          await this.handleScaleUp(operation, decision, event);
          break;
        case 'scale_down':
          await this.handleScaleDown(operation, decision, event);
          break;
        case 'rebalance':
          await this.handleRebalance(operation, decision, event);
          break;
      }
    } catch (error) {
      event.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    } finally {
      this.recordEvent(event);
    }
  }

  /**
   * Handle scale up - provision new workspace
   */
  private async handleScaleUp(
    operation: ScalingOperation,
    decision: ScalingDecision,
    event: ScalingEvent
  ): Promise<void> {
    if (!this.config.autoProvision) {
      this.emit('scaling_blocked', {
        reason: 'auto_provision_disabled',
        operation,
      });
      return;
    }

    // Get user's existing workspace config as template
    const existingWorkspaces = await db.workspaces.findByUserId(operation.userId);
    if (existingWorkspaces.length === 0) {
      throw new Error('No existing workspace to use as template');
    }

    const template = existingWorkspaces[0];
    const workspaceNumber = existingWorkspaces.length + 1;

    // Provision new workspace
    const provisionConfig: ProvisionConfig = {
      userId: operation.userId,
      name: `${template.name}-${workspaceNumber}`,
      providers: template.config.providers || [],
      repositories: template.config.repositories || [],
      supervisorEnabled: template.config.supervisorEnabled,
      maxAgents: template.config.maxAgents,
    };

    const result = await this.provisioner.provision(provisionConfig);
    event.result = result;
    event.workspaceId = result.workspaceId;

    if (result.status === 'error') {
      throw new Error(result.error || 'Provisioning failed');
    }

    this.emit('workspace_provisioned', {
      userId: operation.userId,
      workspaceId: result.workspaceId,
      publicUrl: result.publicUrl,
      triggeredBy: operation.triggeredBy,
    });
  }

  /**
   * Handle scale down - deprovision workspace
   */
  private async handleScaleDown(
    operation: ScalingOperation,
    decision: ScalingDecision,
    event: ScalingEvent
  ): Promise<void> {
    if (!this.config.autoDeprovision) {
      this.emit('scaling_blocked', {
        reason: 'auto_deprovision_disabled',
        operation,
      });
      return;
    }

    // Get user's workspaces
    const workspaces = await db.workspaces.findByUserId(operation.userId);

    // Don't scale below minimum
    if (workspaces.length <= this.config.minUserWorkspaces) {
      this.emit('scaling_blocked', {
        reason: 'at_minimum_workspaces',
        operation,
      });
      return;
    }

    // Find the best workspace to deprovision (lowest utilization)
    const recommendations = this.capacityManager.recommendPlacement(operation.userId, 0);
    const bestToRemove = recommendations[recommendations.length - 1]; // Highest score = lowest utilization

    if (!bestToRemove) {
      throw new Error('No workspace found to deprovision');
    }

    // Check if workspace has active agents
    const capacity = this.capacityManager.getUserWorkspaces(operation.userId)
      .find(w => w.workspaceId === bestToRemove.workspaceId);

    if (capacity && capacity.currentAgents > 0) {
      // Need to migrate agents first
      this.emit('migration_required', {
        fromWorkspaceId: bestToRemove.workspaceId,
        agentCount: capacity.currentAgents,
      });
      return;
    }

    // Deprovision
    await this.provisioner.deprovision(bestToRemove.workspaceId);
    await this.capacityManager.removeWorkspace(bestToRemove.workspaceId);
    event.workspaceId = bestToRemove.workspaceId;

    this.emit('workspace_deprovisioned', {
      userId: operation.userId,
      workspaceId: bestToRemove.workspaceId,
      triggeredBy: operation.triggeredBy,
    });
  }

  /**
   * Handle rebalance - redistribute agents across workspaces
   */
  private async handleRebalance(
    operation: ScalingOperation,
    _decision: ScalingDecision,
    _event: ScalingEvent
  ): Promise<void> {
    // Rebalancing would involve:
    // 1. Identifying overloaded workspaces
    // 2. Finding agents that can be migrated
    // 3. Selecting target workspaces
    // 4. Coordinating agent migration via coordinator service

    this.emit('rebalance_requested', {
      userId: operation.userId,
      // Would include specific migration plan
    });

    // Actual implementation would coordinate with the agent coordinator
    // to move agents between workspaces
  }

  /**
   * Record a scaling event in history
   */
  private recordEvent(event: ScalingEvent): void {
    this.scalingHistory.push(event);

    // Trim history if too large
    if (this.scalingHistory.length > this.maxHistorySize) {
      this.scalingHistory = this.scalingHistory.slice(-this.maxHistorySize);
    }

    // Persist to database if significant
    if (event.type === 'scale_up' || event.type === 'scale_down') {
      this.persistScalingEvent(event).catch((err) => {
        console.error('[ScalingOrchestrator] Failed to persist event:', err);
      });
    }
  }

  /**
   * Persist scaling event to database
   */
  private async persistScalingEvent(event: ScalingEvent): Promise<void> {
    // Would insert into scaling_events table
    // For now, just emit for external handling
    this.emit('event_recorded', event);
  }

  /**
   * Report metrics from monitoring service
   * This is the main entry point for metrics from agents
   */
  async reportMetrics(userId: string, workspaces: WorkspaceMetrics[]): Promise<void> {
    // Update capacity manager
    for (const workspace of workspaces) {
      const capacityUpdate = this.capacityManager.fromWorkspaceMetrics(userId, workspace);
      await this.capacityManager.reportCapacity(
        workspace.workspaceId,
        userId,
        capacityUpdate
      );
    }

    // Report to auto-scaler for policy evaluation
    await this.autoScaler.reportMetrics(userId, workspaces);
  }

  /**
   * Manually trigger scaling evaluation for a user
   */
  async evaluateScaling(userId: string): Promise<ScalingDecision | null> {
    return this.autoScaler.triggerEvaluation(userId);
  }

  /**
   * Get capacity forecast for a user
   */
  getCapacityForecast(userId: string): CapacityForecast | null {
    return this.capacityManager.getCapacityForecast(userId);
  }

  /**
   * Get best placement for new agents
   */
  recommendPlacement(userId: string, agentCount: number = 1) {
    return this.capacityManager.recommendPlacement(userId, agentCount);
  }

  /**
   * Get scaling history for a user
   */
  getScalingHistory(userId?: string): ScalingEvent[] {
    if (userId) {
      return this.scalingHistory.filter((e) => e.userId === userId);
    }
    return [...this.scalingHistory];
  }

  /**
   * Get current status of the orchestrator
   */
  getStatus() {
    return {
      initialized: this.initialized,
      autoScaler: this.autoScaler.getStatus(),
      capacity: this.capacityManager.getGlobalMetrics(),
      config: {
        autoProvision: this.config.autoProvision,
        autoDeprovision: this.config.autoDeprovision,
        minUserWorkspaces: this.config.minUserWorkspaces,
      },
      historySize: this.scalingHistory.length,
    };
  }

  /**
   * Update user's plan tier
   */
  async setUserPlan(userId: string, plan: 'free' | 'pro' | 'team' | 'enterprise'): Promise<void> {
    await this.autoScaler.setUserPlan(userId, plan);
  }

  /**
   * Clean shutdown
   */
  async shutdown(): Promise<void> {
    await Promise.all([
      this.autoScaler.shutdown(),
      this.capacityManager.shutdown(),
    ]);
    this.initialized = false;
    this.emit('shutdown');
  }
}

// Singleton instance
let _orchestrator: ScalingOrchestrator | null = null;

export function getScalingOrchestrator(): ScalingOrchestrator {
  if (!_orchestrator) {
    _orchestrator = new ScalingOrchestrator();
  }
  return _orchestrator;
}

export function createScalingOrchestrator(
  config: Partial<OrchestratorConfig> = {}
): ScalingOrchestrator {
  _orchestrator = new ScalingOrchestrator(config);
  return _orchestrator;
}
