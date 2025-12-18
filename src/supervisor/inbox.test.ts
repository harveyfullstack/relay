import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimInbox, finalizeClaim, parseInboxMarkdown } from './inbox.js';

function makeTempDir(): string {
  const base = path.join(process.cwd(), '.tmp-supervisor-tests');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'inbox-'));
  return dir;
}

describe('supervisor inbox utilities', () => {
  it('parses inbox markdown messages', () => {
    const content = `
# 📬 INBOX

## Message from AgentA | 2025-01-01T00:00:00.000Z
hello

## Message from AgentB | 2025-01-01T00:00:01.000Z
world
`.trim();

    const msgs = parseInboxMarkdown(content);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({
      from: 'AgentA',
      timestamp: '2025-01-01T00:00:00.000Z',
      body: 'hello',
    });
    expect(msgs[1].from).toBe('AgentB');
    expect(msgs[1].body).toBe('world');
  });

  it('claims inbox atomically and merges back on failure without losing new messages', () => {
    const dir = makeTempDir();
    const inboxPath = path.join(dir, 'inbox.md');

    const oldMsg = `## Message from AgentA | 2025-01-01T00:00:00.000Z\nold\n`;
    fs.writeFileSync(inboxPath, oldMsg, 'utf-8');

    const claim = claimInbox(inboxPath);
    expect(claim).not.toBeNull();
    expect(fs.existsSync(inboxPath)).toBe(false);
    expect(claim!.content).toContain('AgentA');

    // New messages arrive while processing.
    const newMsg = `## Message from AgentB | 2025-01-01T00:00:01.000Z\nnew\n`;
    fs.writeFileSync(inboxPath, newMsg, 'utf-8');

    // Supervisor fails; re-queue claimed messages.
    finalizeClaim(claim!, false);

    const merged = fs.readFileSync(inboxPath, 'utf-8');
    expect(merged).toContain('old');
    expect(merged).toContain('new');

    // Older messages should come first (prepended).
    expect(merged.indexOf('old')).toBeLessThan(merged.indexOf('new'));
  });
});

