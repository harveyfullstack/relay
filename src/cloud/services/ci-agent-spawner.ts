/**
 * CI Agent Spawner Service
 *
 * Spawns agents to fix CI failures automatically.
 * Called by the webhook handler when CI checks fail on PRs.
 */

import { db, CIFailureEvent, CIAnnotation } from '../db/index.js';

/**
 * Spawn an agent to fix CI failures
 *
 * This function:
 * 1. Finds the workspace for the repository
 * 2. Creates a fix attempt record
 * 3. Spawns an agent with the failure context
 *
 * @param failureEvent - The CI failure event from the database
 */
export async function spawnCIFixAgent(failureEvent: CIFailureEvent): Promise<void> {
  console.log(`[ci-spawner] Spawning agent for failure: ${failureEvent.id}`);
  console.log(`[ci-spawner] Repository: ${failureEvent.repository}`);
  console.log(`[ci-spawner] Check: ${failureEvent.checkName}`);
  console.log(`[ci-spawner] PR: #${failureEvent.prNumber}`);

  // Generate agent name and ID
  const agentName = `ci-fix-${failureEvent.checkName}-${failureEvent.prNumber}`;
  const agentId = `ci-${failureEvent.id}`;

  // Create fix attempt record
  const fixAttempt = await db.ciFixAttempts.create({
    failureEventId: failureEvent.id,
    agentId,
    agentName,
    status: 'pending',
  });

  console.log(`[ci-spawner] Created fix attempt: ${fixAttempt.id}`);

  try {
    // Build the agent prompt
    const prompt = buildAgentPrompt(failureEvent);

    // Update status to in_progress
    await db.ciFixAttempts.updateStatus(fixAttempt.id, 'in_progress');

    // TODO: Actually spawn the agent
    // This will integrate with the workspace provisioner to:
    // 1. Find or create workspace for the repository
    // 2. Clone/checkout the correct branch
    // 3. Spawn the agent with the prompt
    //
    // For now, we just log the intent
    console.log(`[ci-spawner] Would spawn agent with prompt:`);
    console.log(`[ci-spawner] --- BEGIN PROMPT ---`);
    console.log(prompt);
    console.log(`[ci-spawner] --- END PROMPT ---`);

    // In a real implementation:
    // const workspace = await findOrCreateWorkspace(failureEvent.repository);
    // await workspace.spawnAgent({
    //   name: agentName,
    //   prompt,
    //   branch: failureEvent.branch,
    //   workingDirectory: `/workspace/repos/${failureEvent.repository}`,
    // });

  } catch (error) {
    console.error(`[ci-spawner] Failed to spawn agent:`, error);
    await db.ciFixAttempts.complete(
      fixAttempt.id,
      'failed',
      undefined,
      error instanceof Error ? error.message : 'Unknown error'
    );
    throw error;
  }
}

/**
 * Build the prompt for the CI fix agent
 */
function buildAgentPrompt(failureEvent: CIFailureEvent): string {
  const annotations = failureEvent.annotations as CIAnnotation[] | null;
  const annotationsList = annotations && annotations.length > 0
    ? annotations
        .slice(0, 20) // Limit to first 20 annotations
        .map(a => `- ${a.path}:${a.startLine} - ${a.message}`)
        .join('\n')
    : null;

  return `
# CI Failure Fix Task

A CI check has failed on PR #${failureEvent.prNumber} in ${failureEvent.repository}.

## Failure Details

**Check Name:** ${failureEvent.checkName}
**Branch:** ${failureEvent.branch || 'unknown'}
**Commit:** ${failureEvent.commitSha || 'unknown'}

${failureEvent.failureTitle ? `**Title:** ${failureEvent.failureTitle}` : ''}

${failureEvent.failureSummary ? `**Summary:**\n${failureEvent.failureSummary}` : ''}

${failureEvent.failureDetails ? `**Details:**\n${failureEvent.failureDetails}` : ''}

${annotationsList ? `## Annotations\n\n${annotationsList}` : ''}

## Your Task

1. Checkout the branch: \`${failureEvent.branch || 'unknown'}\`
2. Analyze the failure based on the annotations and error messages
3. Fix the issues in the affected files
4. Run the relevant checks locally to verify the fix
5. Commit and push your changes with a clear commit message
6. Report back with a summary of what was fixed

## Important

- Only fix the specific issues causing the CI failure
- Do not refactor or improve unrelated code
- If you cannot fix the issue, explain why and what manual intervention is needed
- Keep your commit message descriptive and reference the CI check name
`.trim();
}

/**
 * Notify an existing agent about a CI failure
 *
 * Used when an agent is already working on a PR and a new failure occurs.
 *
 * @param agentId - The ID of the existing agent
 * @param failureEvent - The new CI failure event
 */
export async function notifyAgentOfCIFailure(
  agentId: string,
  failureEvent: CIFailureEvent
): Promise<void> {
  console.log(`[ci-spawner] Notifying agent ${agentId} of new failure`);

  // Build notification message
  const annotations = failureEvent.annotations as CIAnnotation[] | null;
  const annotationsList = annotations && annotations.length > 0
    ? annotations
        .slice(0, 10)
        .map(a => `  - ${a.path}:${a.startLine}: ${a.message}`)
        .join('\n')
    : null;

  const message = `
CI FAILURE: ${failureEvent.checkName}

${failureEvent.failureTitle || 'Check failed'}

${failureEvent.failureSummary || ''}

${annotationsList ? `Issues:\n${annotationsList}` : ''}

Please investigate and fix these issues, then push your changes.
`.trim();

  // TODO: Send message via relay
  // This would use the agent-relay messaging system to send
  // the failure notification to the existing agent
  console.log(`[ci-spawner] Would send message to agent ${agentId}:`);
  console.log(message);
}

/**
 * Mark a fix attempt as complete
 *
 * Called when an agent reports completion (success or failure)
 */
export async function completeFixAttempt(
  fixAttemptId: string,
  success: boolean,
  commitSha?: string,
  errorMessage?: string
): Promise<void> {
  console.log(`[ci-spawner] Completing fix attempt ${fixAttemptId}: ${success ? 'success' : 'failed'}`);

  await db.ciFixAttempts.complete(
    fixAttemptId,
    success ? 'success' : 'failed',
    commitSha,
    errorMessage
  );
}

/**
 * Get failure history for a repository
 */
export async function getFailureHistory(
  repository: string,
  limit = 50
): Promise<CIFailureEvent[]> {
  return db.ciFailureEvents.findByRepository(repository, limit);
}

/**
 * Get failure history for a specific PR
 */
export async function getPRFailureHistory(
  repository: string,
  prNumber: number
): Promise<CIFailureEvent[]> {
  return db.ciFailureEvents.findByPR(repository, prNumber);
}
