/**
 * Usage API Routes
 *
 * Track and report user resource usage against plan limits.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from './auth.js';
import { getRemainingQuota, getUserUsage, getPlanLimits } from '../services/planLimits.js';
import { db, PlanType } from '../db/index.js';

export const usageRouter = Router();

// All routes require authentication
usageRouter.use(requireAuth);

/**
 * GET /api/usage
 * Get current usage vs limits for the authenticated user
 */
usageRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.session.userId!;

  try {
    const user = await db.users.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const plan = (user.plan as PlanType) || 'free';
    const quota = await getRemainingQuota(userId);

    res.json({
      plan,
      limits: {
        workspaces: quota.limits.maxWorkspaces,
        agentsPerWorkspace: quota.limits.maxAgentsPerWorkspace,
        computeHoursPerMonth: quota.limits.maxComputeHoursPerMonth,
      },
      usage: {
        workspaces: quota.usage.workspaceCount,
        computeHoursThisMonth: quota.usage.computeHoursThisMonth,
      },
      remaining: {
        workspaces: quota.remaining.workspaces,
        computeHours: quota.remaining.computeHours,
      },
      percentUsed: {
        workspaces:
          quota.limits.maxWorkspaces === Infinity
            ? 0
            : Math.round((quota.usage.workspaceCount / quota.limits.maxWorkspaces) * 100),
        computeHours:
          quota.limits.maxComputeHoursPerMonth === Infinity
            ? 0
            : Math.round(
                (quota.usage.computeHoursThisMonth / quota.limits.maxComputeHoursPerMonth) * 100
              ),
      },
    });
  } catch (error) {
    console.error('Error getting usage:', error);
    res.status(500).json({ error: 'Failed to get usage' });
  }
});

/**
 * GET /api/usage/summary
 * Get a quick summary of plan and usage status
 */
usageRouter.get('/summary', async (req: Request, res: Response) => {
  const userId = req.session.userId!;

  try {
    const user = await db.users.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const plan = (user.plan as PlanType) || 'free';
    const limits = getPlanLimits(plan);
    const usage = await getUserUsage(userId);

    // Calculate warnings
    const warnings = [];
    if (
      limits.maxWorkspaces !== Infinity &&
      usage.workspaceCount >= limits.maxWorkspaces * 0.8
    ) {
      warnings.push({
        resource: 'workspaces',
        message: 'Approaching workspace limit',
        current: usage.workspaceCount,
        limit: limits.maxWorkspaces,
      });
    }

    if (
      limits.maxComputeHoursPerMonth !== Infinity &&
      usage.computeHoursThisMonth >= limits.maxComputeHoursPerMonth * 0.8
    ) {
      warnings.push({
        resource: 'compute_hours',
        message: 'Approaching compute hours limit',
        current: usage.computeHoursThisMonth,
        limit: limits.maxComputeHoursPerMonth,
      });
    }

    res.json({
      plan,
      status: warnings.length > 0 ? 'warning' : 'healthy',
      warnings,
    });
  } catch (error) {
    console.error('Error getting usage summary:', error);
    res.status(500).json({ error: 'Failed to get usage summary' });
  }
});
