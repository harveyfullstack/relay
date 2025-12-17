/**
 * PTY Output Parser
 * Extracts relay commands from agent terminal output.
 *
 * Supports two formats:
 * 1. Inline: @relay:<target> <message> (single line, start of line only)
 * 2. Block: [[RELAY]]{ json }[[/RELAY]] (multi-line, structured)
 *
 * Rules:
 * - Inline only matches at start of line (after whitespace)
 * - Ignores content inside code fences
 * - Escape with \@relay: to output literal
 * - Block format is preferred for structured data
 */

import type { SendPayload, PayloadKind } from '../protocol/types.js';

export interface ParsedCommand {
  to: string;
  kind: PayloadKind;
  body: string;
  data?: Record<string, unknown>;
  raw: string;
}

export interface ParserOptions {
  maxBlockBytes?: number;
  enableInline?: boolean;
  enableBlock?: boolean;
}

const DEFAULT_OPTIONS: Required<ParserOptions> = {
  maxBlockBytes: 1024 * 1024, // 1 MiB
  enableInline: true,
  enableBlock: true,
};

// Patterns
const INLINE_RELAY = /^(\s*)@relay:(\S+)\s+(.+)$/;
const INLINE_THINKING = /^(\s*)@thinking:(\S+)\s+(.+)$/;
const BLOCK_START = /^\s*\[\[RELAY\]\]/;
const BLOCK_END = /\[\[\/RELAY\]\]/;
const CODE_FENCE = /^```/;
const ESCAPE_PREFIX = /^(\s*)\\@(relay|thinking):/;

export class OutputParser {
  private options: Required<ParserOptions>;
  private buffer = '';
  private inCodeFence = false;
  private inBlock = false;
  private blockBuffer = '';

  constructor(options: ParserOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Push data into the parser and extract commands.
   * Returns array of parsed commands and cleaned output.
   */
  parse(data: string): { commands: ParsedCommand[]; output: string } {
    const commands: ParsedCommand[] = [];
    let output = '';

    this.buffer += data;

    // Process line by line for inline, but handle blocks specially
    const lines = this.buffer.split('\n');

    // Keep last incomplete line in buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const result = this.processLine(line);
      if (result.command) {
        commands.push(result.command);
      }
      if (result.output !== null) {
        output += result.output + '\n';
      }
    }

    return { commands, output };
  }

  /**
   * Process a single line.
   */
  private processLine(line: string): { command: ParsedCommand | null; output: string | null } {
    // Handle code fences
    if (CODE_FENCE.test(line)) {
      this.inCodeFence = !this.inCodeFence;
      return { command: null, output: line };
    }

    // Inside code fence - pass through
    if (this.inCodeFence) {
      return { command: null, output: line };
    }

    // Handle block mode
    if (this.inBlock) {
      return this.processBlockLine(line);
    }

    // Check for block start
    if (this.options.enableBlock && BLOCK_START.test(line)) {
      const startIdx = line.search(/\[\[RELAY\]\]/);
      const before = line.substring(0, startIdx);
      const after = line.substring(startIdx + '[[RELAY]]'.length);

      this.inBlock = true;
      this.blockBuffer = after;

      // Check if block ends on same line
      if (BLOCK_END.test(this.blockBuffer)) {
        return this.finishBlock(before);
      }

      return { command: null, output: before || null };
    }

    // Check for escaped inline
    const escapeMatch = line.match(ESCAPE_PREFIX);
    if (escapeMatch) {
      // Output with escape removed
      const unescaped = line.replace(/\\@/, '@');
      return { command: null, output: unescaped };
    }

    // Check for inline relay
    if (this.options.enableInline) {
      const relayMatch = line.match(INLINE_RELAY);
      if (relayMatch) {
        const [raw, , target, body] = relayMatch;
        return {
          command: {
            to: target,
            kind: 'message',
            body,
            raw,
          },
          output: null, // Don't output relay commands
        };
      }

      const thinkingMatch = line.match(INLINE_THINKING);
      if (thinkingMatch) {
        const [raw, , target, body] = thinkingMatch;
        return {
          command: {
            to: target,
            kind: 'thinking',
            body,
            raw,
          },
          output: null,
        };
      }
    }

    // Regular line
    return { command: null, output: line };
  }

  /**
   * Process a line while in block mode.
   */
  private processBlockLine(line: string): { command: ParsedCommand | null; output: string | null } {
    this.blockBuffer += '\n' + line;

    // Check for block end
    if (BLOCK_END.test(line)) {
      return this.finishBlock(null);
    }

    // Check size limit
    if (this.blockBuffer.length > this.options.maxBlockBytes) {
      console.error('[parser] Block too large, discarding');
      this.inBlock = false;
      this.blockBuffer = '';
      return { command: null, output: null };
    }

    return { command: null, output: null };
  }

  /**
   * Finish processing a block and extract command.
   */
  private finishBlock(beforeText: string | null): { command: ParsedCommand | null; output: string | null } {
    const endIdx = this.blockBuffer.indexOf('[[/RELAY]]');
    const jsonStr = this.blockBuffer.substring(0, endIdx).trim();

    this.inBlock = false;
    this.blockBuffer = '';

    try {
      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      if (!parsed.to || !parsed.type) {
        console.error('[parser] Block missing required fields (to, type)');
        return { command: null, output: beforeText };
      }

      return {
        command: {
          to: parsed.to,
          kind: parsed.type as PayloadKind,
          body: parsed.body ?? parsed.text ?? '',
          data: parsed.data,
          raw: jsonStr,
        },
        output: beforeText,
      };
    } catch (err) {
      console.error('[parser] Invalid JSON in block:', err);
      return { command: null, output: beforeText };
    }
  }

  /**
   * Flush any remaining buffer (call on stream end).
   */
  flush(): { commands: ParsedCommand[]; output: string } {
    const result = this.parse('\n');
    this.buffer = '';
    this.inBlock = false;
    this.blockBuffer = '';
    this.inCodeFence = false;
    return result;
  }

  /**
   * Reset parser state.
   */
  reset(): void {
    this.buffer = '';
    this.inBlock = false;
    this.blockBuffer = '';
    this.inCodeFence = false;
  }
}

/**
 * Format a relay command for injection into agent input.
 */
export function formatIncomingMessage(from: string, body: string, kind: PayloadKind = 'message'): string {
  const prefix = kind === 'thinking' ? '[THINKING]' : '[MSG]';
  return `\n${prefix} from ${from}: ${body}\n`;
}
