/**
 * Supervisor Inbox Utilities
 *
 * Provides an atomic "claim" for an agent inbox file to avoid losing messages
 * that arrive while the supervisor is processing.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface InboxMessage {
  from: string;
  timestamp: string;
  body: string;
}

export interface ClaimedInbox {
  inboxPath: string;
  processingPath: string;
  content: string;
}

// Supported inbox formats:
// 1) New canonical:
//    ## Message from <sender> | <iso>
//    <body>
//
// 2) Legacy (from early inbox-write):
//    ## Message from <sender>
//    **Time:** <iso>
//    <body>
const MESSAGE_HEADER_V1 = /^## Message from (.+?) \| (.+?)$/gm;
const MESSAGE_HEADER_LEGACY = /^## Message from (.+?)$/gm;
const LEGACY_TIME_LINE = /^\*\*Time:\*\*\s*(.+?)\s*$/m;

/**
 * Parse inbox markdown into structured messages.
 *
 * Expected format (repeated blocks):
 * ## Message from <sender> | <timestamp>
 * <body>
 */
export function parseInboxMarkdown(content: string): InboxMessage[] {
  const matches: Array<{ index: number; from: string; timestamp: string; headerLen: number; isLegacy: boolean }> = [];

  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = MESSAGE_HEADER_V1.exec(content)) !== null) {
    matches.push({
      index: m.index,
      from: (m[1] ?? '').trim(),
      timestamp: (m[2] ?? '').trim(),
      headerLen: m[0].length,
      isLegacy: false,
    });
  }

  // If no canonical headers, try legacy headers.
  if (matches.length === 0) {
    // eslint-disable-next-line no-cond-assign
    while ((m = MESSAGE_HEADER_LEGACY.exec(content)) !== null) {
      matches.push({
        index: m.index,
        from: (m[1] ?? '').trim(),
        timestamp: '',
        headerLen: m[0].length,
        isLegacy: true,
      });
    }
  }

  if (matches.length === 0) return [];

  const messages: InboxMessage[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];

    const bodyStart = cur.index + cur.headerLen;
    const bodyEnd = next ? next.index : content.length;
    let bodyChunk = content.substring(bodyStart, bodyEnd).replace(/^\s*\n/, '');

    let timestamp = cur.timestamp;
    if (cur.isLegacy) {
      const t = bodyChunk.match(LEGACY_TIME_LINE);
      if (t?.[1]) {
        timestamp = t[1].trim();
        // Remove the time line from the body
        bodyChunk = bodyChunk.replace(LEGACY_TIME_LINE, '').replace(/^\s*\n/, '');
      }
    }

    const body = bodyChunk.trim();

    if (!cur.from) continue;
    if (!timestamp) timestamp = new Date().toISOString();
    if (!body) continue;

    messages.push({ from: cur.from, timestamp, body });
  }

  return messages;
}

/**
 * Atomically claim an inbox by renaming it to a processing file.
 * New incoming messages will be written to a new inbox.md.
 */
export function claimInbox(inboxPath: string): ClaimedInbox | null {
  if (!fs.existsSync(inboxPath)) return null;

  const dir = path.dirname(inboxPath);
  const processingPath = path.join(dir, 'inbox.processing.md');

  try {
    fs.renameSync(inboxPath, processingPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // If someone else claimed it or it disappeared, treat as no work.
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EBUSY') {
      return null;
    }
    throw err;
  }

  let content = '';
  try {
    content = fs.readFileSync(processingPath, 'utf-8');
  } catch {
    content = '';
  }

  return { inboxPath, processingPath, content };
}

/**
 * Finalize a claimed inbox.
 *
 * - On success: delete processing file.
 * - On failure: re-queue the claimed content back into inbox.md without
 *   overwriting any messages that arrived while processing.
 */
export function finalizeClaim(claim: ClaimedInbox, success: boolean): void {
  if (success) {
    try {
      if (fs.existsSync(claim.processingPath)) {
        fs.unlinkSync(claim.processingPath);
      }
    } catch {
      // Best-effort cleanup
    }
    return;
  }

  // Failure path: merge back into inbox.
  try {
    const claimedContent = fs.existsSync(claim.processingPath)
      ? fs.readFileSync(claim.processingPath, 'utf-8')
      : claim.content;

    if (!claimedContent.trim()) {
      // Nothing to restore
      if (fs.existsSync(claim.processingPath)) fs.unlinkSync(claim.processingPath);
      return;
    }

    if (!fs.existsSync(claim.inboxPath)) {
      fs.renameSync(claim.processingPath, claim.inboxPath);
      return;
    }

    // Inbox exists (new messages arrived). Prepend claimed content so older messages come first.
    const currentInbox = fs.readFileSync(claim.inboxPath, 'utf-8');
    const merged = `${claimedContent.trimEnd()}\n\n${currentInbox.trimStart()}`;

    const tmpPath = `${claim.inboxPath}.tmp`;
    fs.writeFileSync(tmpPath, merged, 'utf-8');
    fs.renameSync(tmpPath, claim.inboxPath);

    if (fs.existsSync(claim.processingPath)) {
      fs.unlinkSync(claim.processingPath);
    }
  } catch (err) {
    // Last-resort: don't crash the supervisor on finalize
    // eslint-disable-next-line no-console
    console.error('[supervisor] Failed to finalize inbox claim:', err);
  }
}
