/**
 * @deprecated Import from '@agent-relay/wrapper' instead.
 *
 * This file re-exports from the @agent-relay/wrapper package for backward compatibility.
 * All wrapper functionality has been moved to packages/wrapper/.
 */

export * from '@agent-relay/wrapper';

// Note: tmux-wrapper.ts and pty-wrapper.ts are intentionally not exported here.
// They're dynamically imported in CLI only, as they have different
// runtime requirements (tmux/pty must be available).
