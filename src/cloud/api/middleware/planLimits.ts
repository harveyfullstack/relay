/**
 * Plan Limits Middleware
 *
 * Express middleware to enforce plan-based resource limits.
 */

import { Request, Response, NextFunction } from 'express';
import { canCreateWorkspace, canSpawnAgent } from '../../services/planLimits.js';

/**
 * Error response for plan limit violations
 */
interface PlanLimitError {
  error: string;
  code: 'PLAN_LIMIT_EXCEEDED';
  details: {
    plan: string;
    resource: string;
    limit: number;
    current: number;
  };
  upgrade: {
    message: string;
    url: string;
  };
}

/**
 * Middleware to check workspace creation limit
 *
 * Use this middleware on workspace creation endpoints.
 * Requires userId in session (use after requireAuth).
 */
export async function checkWorkspaceLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.session.userId;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const check = await canCreateWorkspace(userId);

    if (!check.allowed) {
      const response: PlanLimitError = {
        error: check.reason || 'Workspace limit exceeded',
        code: 'PLAN_LIMIT_EXCEEDED',
        details: {
          plan: 'current',
          resource: 'workspaces',
          limit: check.limit || 0,
          current: check.current || 0,
        },
        upgrade: {
          message: 'Upgrade your plan to create more workspaces',
          url: '/settings/billing',
        },
      };

      res.status(402).json(response);
      return;
    }

    next();
  } catch (error) {
    console.error('Error checking workspace limit:', error);
    res.status(500).json({ error: 'Failed to check workspace limit' });
  }
}

/**
 * Middleware to check agent spawn limit
 *
 * Use this middleware on agent creation endpoints.
 * Requires userId in session and currentAgentCount in request body or params.
 */
export async function checkAgentLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.session.userId;
  const workspaceId = req.params.id || req.body.workspaceId;
  const currentAgentCount = req.body.currentAgentCount || 0;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!workspaceId) {
    res.status(400).json({ error: 'Workspace ID required' });
    return;
  }

  try {
    const check = await canSpawnAgent(userId, workspaceId, currentAgentCount);

    if (!check.allowed) {
      const response: PlanLimitError = {
        error: check.reason || 'Agent limit exceeded',
        code: 'PLAN_LIMIT_EXCEEDED',
        details: {
          plan: 'current',
          resource: 'agents',
          limit: check.limit || 0,
          current: check.current || 0,
        },
        upgrade: {
          message: 'Upgrade your plan to spawn more agents',
          url: '/settings/billing',
        },
      };

      res.status(402).json(response);
      return;
    }

    next();
  } catch (error) {
    console.error('Error checking agent limit:', error);
    res.status(500).json({ error: 'Failed to check agent limit' });
  }
}
