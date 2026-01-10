# Proposal: Robust Context Injection for Agent Startup

**Status**: Draft
**Author**: Claude
**Date**: 2026-01-10
**Problem**: Startup context injection is unreliable - agents often ignore or never receive it

## Problem Statement

When agents start, we try to inject context from previous sessions (continuity data, task context, code search results). This frequently fails because:

1. **Bad timing**: We inject after arbitrary 3s delay, but agent may not be ready
2. **Idle requirement**: We wait for agent to be "idle" (no output for 1.5s), but agents generating responses are never idle
3. **No feedback**: We don't know if agent received the context
4. **Queue starvation**: Context sits in queue while agent is busy

## Current Architecture

```typescript
// tmux-wrapper.ts:454
setTimeout(() => this.injectInstructions(), 3000);

// tmux-wrapper.ts:578-584
this.messageQueue.push({
  from: 'system',
  body: context.formatted,
  messageId: `continuity-startup-${Date.now()}`,
});
this.checkForInjectionOpportunity();

// tmux-wrapper.ts:1381
const timeSinceOutput = Date.now() - this.lastOutputTime;
if (timeSinceOutput < (this.config.idleBeforeInjectMs ?? 1500)) {
  // Retry later...
}
```

## Proposed Solution: Multi-Stage Injection with Acknowledgment

### Stage 1: Readiness Detection

Instead of arbitrary delay, detect when agent is actually ready for input:

```typescript
interface ReadinessSignal {
  type: 'prompt_detected' | 'first_response_complete' | 'explicit_ready';
  timestamp: number;
}

class AgentReadinessDetector {
  private signals: ReadinessSignal[] = [];

  // Patterns indicating agent is waiting for input
  private readyPatterns = [
    /\n>\s*$/,                    // Claude prompt
    /\n\$\s*$/,                   // Shell prompt (in agent context)
    /waiting for input/i,         // Explicit message
    /how can i help/i,            // Claude greeting
  ];

  // Patterns indicating agent finished a response
  private responseCompletePatterns = [
    /\n\n$/,                      // Double newline (response ended)
    /```\n\s*$/,                  // Code block closed
  ];

  checkOutput(output: string): ReadinessSignal | null {
    for (const pattern of this.readyPatterns) {
      if (pattern.test(output)) {
        return { type: 'prompt_detected', timestamp: Date.now() };
      }
    }

    for (const pattern of this.responseCompletePatterns) {
      if (pattern.test(output)) {
        return { type: 'first_response_complete', timestamp: Date.now() };
      }
    }

    return null;
  }
}
```

### Stage 2: Priority Queue with Escalation

Startup context should have priority and escalating retry strategy:

```typescript
interface QueuedMessage {
  from: string;
  body: string;
  messageId: string;
  priority: 'startup' | 'normal' | 'low';
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  escalationStrategy: EscalationStrategy;
}

type EscalationStrategy =
  | { type: 'retry'; backoffMs: number[] }
  | { type: 'file_fallback'; path: string }
  | { type: 'notification'; message: string };

// Startup context gets special handling
const startupMessage: QueuedMessage = {
  from: 'system',
  body: context.formatted,
  messageId: `continuity-startup-${Date.now()}`,
  priority: 'startup',
  attempts: 0,
  maxAttempts: 5,
  createdAt: Date.now(),
  escalationStrategy: {
    type: 'retry',
    backoffMs: [1000, 2000, 5000, 10000, 30000],
  },
};
```

### Stage 3: Acknowledgment Loop

Request explicit acknowledgment from agent:

```typescript
async injectWithAcknowledgment(message: QueuedMessage): Promise<boolean> {
  // Inject with ACK request wrapper
  const wrappedContent = `
[CONTEXT INJECTION - Please acknowledge receipt]
${message.body}

[END CONTEXT - Reply "ACK: context received" to confirm]
`.trim();

  await this.inject(wrappedContent);

  // Watch for acknowledgment pattern
  const ackReceived = await this.waitForPattern(
    /ACK:\s*context received/i,
    5000 // 5s timeout
  );

  if (ackReceived) {
    this.logStderr('Context acknowledged by agent');
    return true;
  }

  // No ACK - agent may have ignored it
  this.logStderr('No acknowledgment received');
  return false;
}
```

### Stage 4: File-Based Fallback

If live injection fails repeatedly, write to CLAUDE.md:

```typescript
async escalateToFile(message: QueuedMessage): Promise<void> {
  const claudeMdPath = path.join(this.workingDirectory, 'CLAUDE.md');

  // Read existing CLAUDE.md
  let content = '';
  try {
    content = await fs.readFile(claudeMdPath, 'utf-8');
  } catch {
    content = '# Project Instructions\n\n';
  }

  // Check if we already have an injection section
  const injectionMarker = '<!-- STARTUP_CONTEXT_INJECTION -->';
  if (content.includes(injectionMarker)) {
    // Replace existing injection
    content = content.replace(
      /<!-- STARTUP_CONTEXT_INJECTION -->[\s\S]*<!-- END_STARTUP_CONTEXT -->/,
      ''
    );
  }

  // Append new injection
  const injection = `
${injectionMarker}
## Session Context (Auto-Injected)

${message.body}

<!-- END_STARTUP_CONTEXT -->
`;

  await fs.writeFile(claudeMdPath, content + '\n' + injection);

  // Notify agent to re-read CLAUDE.md
  await this.inject('[System] Session context written to CLAUDE.md - please review');
}
```

### Stage 5: Notification Fallback

If all else fails, at least tell the agent context is available:

```typescript
async notifyContextAvailable(): Promise<void> {
  const notification = `
[IMPORTANT] Session context from previous work is available.
Run: ->continuity:load
Or check CLAUDE.md for details.
`.trim();

  await this.inject(notification);
}
```

## Implementation: Revised Injection Flow

```typescript
class ContextInjector {
  private readinessDetector: AgentReadinessDetector;
  private messageQueue: PriorityQueue<QueuedMessage>;

  async injectStartupContext(context: StartupContext): Promise<void> {
    // Stage 1: Wait for readiness
    await this.waitForReadiness();

    // Stage 2: Queue with priority
    const message = this.createStartupMessage(context);
    this.messageQueue.enqueue(message);

    // Stage 3: Attempt injection with ACK
    const success = await this.tryInjectWithRetry(message);

    if (!success) {
      // Stage 4: Escalate to file
      await this.escalateToFile(message);
    }
  }

  private async waitForReadiness(): Promise<void> {
    // Wait for agent to be ready, with timeout
    const readySignal = await this.readinessDetector.waitForSignal(30000);

    if (!readySignal) {
      this.logStderr('Readiness timeout - proceeding anyway');
    } else {
      this.logStderr(`Agent ready: ${readySignal.type}`);
      // Small delay after readiness for stability
      await sleep(500);
    }
  }

  private async tryInjectWithRetry(message: QueuedMessage): Promise<boolean> {
    const backoffs = [1000, 2000, 5000, 10000];

    for (let attempt = 0; attempt < backoffs.length; attempt++) {
      message.attempts = attempt + 1;

      // Wait for injection opportunity
      const canInject = await this.waitForInjectionWindow(5000);
      if (!canInject) {
        this.logStderr(`Attempt ${attempt + 1}: No injection window`);
        await sleep(backoffs[attempt]);
        continue;
      }

      // Try injection with acknowledgment
      const acked = await this.injectWithAcknowledgment(message);
      if (acked) {
        return true;
      }

      this.logStderr(`Attempt ${attempt + 1}: No acknowledgment`);
      await sleep(backoffs[attempt]);
    }

    return false;
  }
}
```

## Configuration Options

```typescript
interface ContextInjectionConfig {
  /** Max time to wait for agent readiness (ms) */
  readinessTimeoutMs: number;  // default: 30000

  /** Require explicit acknowledgment */
  requireAcknowledgment: boolean;  // default: true

  /** Retry backoff schedule (ms) */
  retryBackoffs: number[];  // default: [1000, 2000, 5000, 10000]

  /** Fall back to CLAUDE.md after N failures */
  fileFallbackAfterAttempts: number;  // default: 3

  /** Send notification if all injections fail */
  sendNotificationOnFailure: boolean;  // default: true

  /** Patterns indicating agent is ready for input */
  readinessPatterns: RegExp[];

  /** Patterns indicating agent acknowledged */
  acknowledgmentPatterns: RegExp[];
}
```

## Metrics & Observability

Track injection success rates:

```typescript
interface InjectionMetrics {
  attempted: number;
  succeededOnFirstTry: number;
  succeededAfterRetry: number;
  escalatedToFile: number;
  failed: number;
  averageAttemptsToSuccess: number;
  averageTimeToSuccess: number;
}

// Emit metrics for dashboard
this.emit('injection:attempted', { messageId, attempt, type: 'startup' });
this.emit('injection:succeeded', { messageId, attempts, durationMs });
this.emit('injection:escalated', { messageId, escalationType: 'file' });
this.emit('injection:failed', { messageId, attempts, reason });
```

## Migration Path

### Phase 1: Add Readiness Detection (Non-Breaking)
- Add `AgentReadinessDetector` alongside existing logic
- Log when readiness detected vs 3s timeout
- Gather data on timing

### Phase 2: Add Retry with Backoff
- Replace single injection attempt with retry loop
- Add metrics tracking
- Still fall through to existing queue behavior

### Phase 3: Add Acknowledgment (Opt-In)
- New config flag `requireAcknowledgment`
- Default false for backward compatibility
- Test with specific agents

### Phase 4: Add File Fallback
- Implement CLAUDE.md injection
- Enable when acknowledgment fails
- Add cleanup on next successful injection

### Phase 5: Deprecate Old Path
- Remove arbitrary 3s delay
- Remove idle-only injection
- Full reliance on new system

## Testing Strategy

```typescript
describe('ContextInjector', () => {
  it('injects after readiness signal', async () => {
    const injector = new ContextInjector(config);
    const agent = new MockAgent();

    // Simulate agent startup
    agent.emit('output', 'Loading...\n');
    await sleep(100);
    agent.emit('output', 'Ready. How can I help?\n');

    // Should detect readiness and inject
    await injector.injectStartupContext(mockContext);

    expect(agent.receivedMessages).toContain(mockContext.formatted);
  });

  it('retries on busy agent', async () => {
    const injector = new ContextInjector(config);
    const agent = new MockAgent({ alwaysBusy: true });

    // Set to become ready after 3 attempts
    setTimeout(() => agent.setIdle(), 3000);

    await injector.injectStartupContext(mockContext);

    expect(injector.metrics.attempts).toBeGreaterThan(1);
    expect(agent.receivedMessages).toContain(mockContext.formatted);
  });

  it('falls back to file after max attempts', async () => {
    const injector = new ContextInjector({
      ...config,
      fileFallbackAfterAttempts: 2,
    });
    const agent = new MockAgent({ alwaysBusy: true });

    await injector.injectStartupContext(mockContext);

    // Should have written to CLAUDE.md
    const claudeMd = await fs.readFile('CLAUDE.md', 'utf-8');
    expect(claudeMd).toContain('Session Context');
  });
});
```

## Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| First-attempt success | ~30% | >70% |
| Overall success (with retry) | ~50% | >95% |
| Agent acknowledged context | 0% | >80% |
| Context visible to agent | ~50% | >99% |

## Open Questions

1. **Should acknowledgment be required?**
   - Pro: Guarantees agent saw it
   - Con: Adds noise to agent output

2. **How to handle multi-message context?**
   - Split into chunks?
   - Single large injection?

3. **Should file fallback be permanent or temporary?**
   - Clean up on next successful injection?
   - Keep for debugging?

4. **What if agent refuses to acknowledge?**
   - Some agents may not follow the pattern
   - Need graceful degradation

## Appendix: Agent-Specific Quirks

| Agent | Readiness Signal | ACK Pattern | Notes |
|-------|------------------|-------------|-------|
| Claude | `>` prompt | Follows instructions | Most reliable |
| Codex | `$` shell prompt | May need different format | Shell-focused |
| Gemini | Varies | Unpredictable | Most challenging |
| Aider | `>>>` prompt | Code-focused | May ignore prose |
