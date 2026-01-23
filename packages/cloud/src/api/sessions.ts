/**
 * Agent Session Persistence API Routes
 *
 * Provides endpoints for workspace containers to persist agent session data.
 * Workspaces call these endpoints instead of accessing the database directly,
 * which provides better security isolation (workspaces can only write their own data).
 *
 * Authentication: Workspace token (same as git gateway)
 */

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/drizzle.js';
import { agentSessions, agentSummaries } from '../db/schema.js';
import { getConfig } from '../config.js';

export const sessionsRouter = Router();

// Validation patterns
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_AGENT_NAME_LENGTH = 255;

/**
 * Generate expected workspace token using HMAC
 */
function generateExpectedToken(workspaceId: string): string {
  const config = getConfig();
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(`workspace:${workspaceId}`)
    .digest('hex');
}

/**
 * Verify workspace access token
 */
function verifyWorkspaceToken(req: Request, workspaceId: string): { valid: true } | { valid: false; reason: string } {
  const authHeader = req.get('authorization');

  if (!authHeader) {
    return { valid: false, reason: 'No Authorization header. WORKSPACE_TOKEN may not be set in the container.' };
  }

  if (!authHeader.startsWith('Bearer ')) {
    return { valid: false, reason: 'Invalid Authorization header format. Expected: Bearer <token>' };
  }

  const providedToken = authHeader.slice(7);
  if (!providedToken) {
    return { valid: false, reason: 'Empty bearer token provided.' };
  }

  const expectedToken = generateExpectedToken(workspaceId);

  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedToken),
      Buffer.from(expectedToken)
    );

    if (!isValid) {
      return { valid: false, reason: 'Token mismatch. Workspace may need reprovisioning or SESSION_SECRET changed.' };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: 'Token comparison failed (length mismatch). Workspace may need reprovisioning.' };
  }
}

/**
 * Validate UUID format
 */
function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Validate agent name format
 */
function isValidAgentName(name: string): { valid: true } | { valid: false; reason: string } {
  if (name.length > MAX_AGENT_NAME_LENGTH) {
    return { valid: false, reason: `agentName exceeds maximum length of ${MAX_AGENT_NAME_LENGTH} characters` };
  }
  if (!AGENT_NAME_REGEX.test(name)) {
    return { valid: false, reason: 'agentName contains invalid characters (only alphanumeric, underscore, and hyphen allowed)' };
  }
  return { valid: true };
}

/**
 * Validate summary object structure
 */
function validateSummary(summary: unknown): { valid: true } | { valid: false; reason: string } {
  if (typeof summary !== 'object' || summary === null || Array.isArray(summary)) {
    return { valid: false, reason: 'summary must be an object' };
  }

  const s = summary as Record<string, unknown>;
  const allowedKeys = ['currentTask', 'completedTasks', 'decisions', 'context', 'files'];

  for (const key of Object.keys(s)) {
    if (!allowedKeys.includes(key)) {
      // Allow extra keys but log warning (don't reject - for forward compatibility)
      continue;
    }
  }

  // Validate types of known fields
  if (s.currentTask !== undefined && typeof s.currentTask !== 'string') {
    return { valid: false, reason: 'summary.currentTask must be a string' };
  }
  if (s.completedTasks !== undefined && !Array.isArray(s.completedTasks)) {
    return { valid: false, reason: 'summary.completedTasks must be an array' };
  }
  if (s.decisions !== undefined && !Array.isArray(s.decisions)) {
    return { valid: false, reason: 'summary.decisions must be an array' };
  }
  if (s.context !== undefined && typeof s.context !== 'string') {
    return { valid: false, reason: 'summary.context must be a string' };
  }
  if (s.files !== undefined && !Array.isArray(s.files)) {
    return { valid: false, reason: 'summary.files must be an array' };
  }

  return { valid: true };
}

/**
 * POST /api/sessions/create
 * Create a new agent session
 *
 * Body: { workspaceId: string, agentName: string }
 * Returns: { sessionId: string }
 */
sessionsRouter.post('/create', async (req: Request, res: Response) => {
  const { workspaceId, agentName } = req.body;

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required', code: 'MISSING_WORKSPACE_ID' });
  }

  if (!isValidUUID(workspaceId)) {
    return res.status(400).json({ error: 'workspaceId must be a valid UUID', code: 'INVALID_WORKSPACE_ID' });
  }

  if (!agentName || typeof agentName !== 'string') {
    return res.status(400).json({ error: 'agentName is required', code: 'MISSING_AGENT_NAME' });
  }

  const agentNameValidation = isValidAgentName(agentName);
  if (!agentNameValidation.valid) {
    return res.status(400).json({ error: agentNameValidation.reason, code: 'INVALID_AGENT_NAME' });
  }

  const tokenVerification = verifyWorkspaceToken(req, workspaceId);
  if (!tokenVerification.valid) {
    console.warn(`[sessions] Token verification failed for workspace ${workspaceId.substring(0, 8)}: ${tokenVerification.reason}`);
    return res.status(401).json({
      error: 'Invalid workspace token',
      code: 'INVALID_WORKSPACE_TOKEN',
      hint: tokenVerification.reason,
    });
  }

  try {
    const db = getDb();

    const result = await db.insert(agentSessions).values({
      workspaceId,
      agentName,
      status: 'active',
      startedAt: new Date(),
    }).returning();

    const session = result[0];
    if (!session) {
      return res.status(500).json({ error: 'Failed to create session', code: 'CREATE_FAILED' });
    }

    console.log(`[sessions] Created session ${session.id.substring(0, 8)} for ${agentName} in workspace ${workspaceId.substring(0, 8)}`);

    return res.json({ sessionId: session.id });
  } catch (err) {
    console.error(`[sessions] Failed to create session:`, err);
    return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/sessions/summary
 * Add a summary to an existing session
 *
 * Body: {
 *   workspaceId: string,
 *   sessionId: string,
 *   agentName: string,
 *   summary: { currentTask?: string, completedTasks?: string[], ... }
 * }
 * Returns: { summaryId: string }
 */
sessionsRouter.post('/summary', async (req: Request, res: Response) => {
  const { workspaceId, sessionId, agentName, summary } = req.body;

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required', code: 'MISSING_WORKSPACE_ID' });
  }

  if (!isValidUUID(workspaceId)) {
    return res.status(400).json({ error: 'workspaceId must be a valid UUID', code: 'INVALID_WORKSPACE_ID' });
  }

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required', code: 'MISSING_SESSION_ID' });
  }

  if (!isValidUUID(sessionId)) {
    return res.status(400).json({ error: 'sessionId must be a valid UUID', code: 'INVALID_SESSION_ID' });
  }

  if (!agentName || typeof agentName !== 'string') {
    return res.status(400).json({ error: 'agentName is required', code: 'MISSING_AGENT_NAME' });
  }

  const agentNameValidation = isValidAgentName(agentName);
  if (!agentNameValidation.valid) {
    return res.status(400).json({ error: agentNameValidation.reason, code: 'INVALID_AGENT_NAME' });
  }

  if (!summary) {
    return res.status(400).json({ error: 'summary is required', code: 'MISSING_SUMMARY' });
  }

  const summaryValidation = validateSummary(summary);
  if (!summaryValidation.valid) {
    return res.status(400).json({ error: summaryValidation.reason, code: 'INVALID_SUMMARY' });
  }

  const tokenVerification = verifyWorkspaceToken(req, workspaceId);
  if (!tokenVerification.valid) {
    console.warn(`[sessions] Summary: Token verification failed for workspace ${workspaceId.substring(0, 8)}`);
    return res.status(401).json({
      error: 'Invalid workspace token',
      code: 'INVALID_WORKSPACE_TOKEN',
      hint: tokenVerification.reason,
    });
  }

  try {
    const db = getDb();

    // Verify the session exists and belongs to this workspace
    const existingSession = await db.select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    if (!existingSession[0]) {
      return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
    }

    if (existingSession[0].workspaceId !== workspaceId) {
      return res.status(403).json({ error: 'Session does not belong to this workspace', code: 'SESSION_FORBIDDEN' });
    }

    const result = await db.insert(agentSummaries).values({
      sessionId,
      agentName,
      summary,
      createdAt: new Date(),
    }).returning();

    const summaryRecord = result[0];
    if (!summaryRecord) {
      return res.status(500).json({ error: 'Failed to create summary', code: 'CREATE_FAILED' });
    }

    console.log(`[sessions] Saved summary for ${agentName}: ${(summary as Record<string, unknown>).currentTask || 'no task'}`);

    return res.json({ summaryId: summaryRecord.id });
  } catch (err) {
    console.error(`[sessions] Failed to save summary:`, err);
    return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/sessions/end
 * Mark a session as ended
 *
 * Body: {
 *   workspaceId: string,
 *   sessionId: string,
 *   endMarker: { summary?: string, completedTasks?: string[] }
 * }
 * Returns: { success: true }
 */
sessionsRouter.post('/end', async (req: Request, res: Response) => {
  const { workspaceId, sessionId, endMarker } = req.body;

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'workspaceId is required', code: 'MISSING_WORKSPACE_ID' });
  }

  if (!isValidUUID(workspaceId)) {
    return res.status(400).json({ error: 'workspaceId must be a valid UUID', code: 'INVALID_WORKSPACE_ID' });
  }

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required', code: 'MISSING_SESSION_ID' });
  }

  if (!isValidUUID(sessionId)) {
    return res.status(400).json({ error: 'sessionId must be a valid UUID', code: 'INVALID_SESSION_ID' });
  }

  const tokenVerification = verifyWorkspaceToken(req, workspaceId);
  if (!tokenVerification.valid) {
    console.warn(`[sessions] End: Token verification failed for workspace ${workspaceId.substring(0, 8)}`);
    return res.status(401).json({
      error: 'Invalid workspace token',
      code: 'INVALID_WORKSPACE_TOKEN',
      hint: tokenVerification.reason,
    });
  }

  try {
    const db = getDb();

    // Verify the session exists and belongs to this workspace
    const existingSession = await db.select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    if (!existingSession[0]) {
      return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
    }

    if (existingSession[0].workspaceId !== workspaceId) {
      return res.status(403).json({ error: 'Session does not belong to this workspace', code: 'SESSION_FORBIDDEN' });
    }

    await db.update(agentSessions)
      .set({
        status: 'ended',
        endedAt: new Date(),
        endMarker: endMarker || {},
      })
      .where(eq(agentSessions.id, sessionId));

    console.log(`[sessions] Session ended for workspace ${workspaceId.substring(0, 8)}: ${endMarker?.summary || 'no summary'}`);

    return res.json({ success: true });
  } catch (err) {
    console.error(`[sessions] Failed to end session:`, err);
    return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});
