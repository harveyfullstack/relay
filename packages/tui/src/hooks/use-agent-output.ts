import { useState, useEffect, useRef } from 'react';
import fs from 'node:fs';
import path from 'node:path';

const MAX_LINES = 500;
const INITIAL_READ_BYTES = 32768; // Read last 32KB on first load
const POLL_INTERVAL_MS = 500;

/**
 * Hook that tails an agent's worker log file and processes it through
 * a virtual terminal to reconstruct the current screen state.
 *
 * Returns the visible lines of the agent's terminal output.
 */
export function useAgentOutput(agentName: string | null, dataDir?: string): string[] {
  const [lines, setLines] = useState<string[]>([]);
  const vtRef = useRef<VirtualTerminal | null>(null);
  const offsetRef = useRef<number>(0);

  useEffect(() => {
    if (!agentName) {
      setLines([]);
      return;
    }

    const logPath = resolveLogPath(agentName, dataDir);
    if (!logPath) {
      setLines([]);
      return;
    }

    // Fresh VT for each agent
    const vt = new VirtualTerminal(MAX_LINES);
    vtRef.current = vt;
    offsetRef.current = 0;

    // Initial load: read last chunk of file
    try {
      const stat = fs.statSync(logPath);
      const fileSize = stat.size;
      const start = Math.max(0, fileSize - INITIAL_READ_BYTES);
      const fd = fs.openSync(logPath, 'r');
      const buf = Buffer.alloc(fileSize - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      vt.write(buf.toString('utf-8'));
      offsetRef.current = fileSize;
      setLines(vt.getScreenLines());
    } catch {
      // File may not exist yet
      offsetRef.current = 0;
    }

    // Poll for new data
    const interval = setInterval(() => {
      try {
        const stat = fs.statSync(logPath);
        if (stat.size <= offsetRef.current) return;

        const fd = fs.openSync(logPath, 'r');
        const newBytes = stat.size - offsetRef.current;
        const buf = Buffer.alloc(newBytes);
        fs.readSync(fd, buf, 0, newBytes, offsetRef.current);
        fs.closeSync(fd);
        offsetRef.current = stat.size;

        vt.write(buf.toString('utf-8'));
        setLines(vt.getScreenLines());
      } catch {
        // File might be mid-write or deleted
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      vtRef.current = null;
    };
  }, [agentName, dataDir]);

  return lines;
}

function resolveLogPath(agentName: string, dataDir?: string): string | null {
  if (dataDir) {
    return path.join(dataDir, 'team', 'worker-logs', `${agentName}.log`);
  }
  const relayDir = path.join(process.cwd(), '.agent-relay');
  return path.join(relayDir, 'team', 'worker-logs', `${agentName}.log`);
}

// =============================================================================
// Virtual Terminal Processor
//
// Processes raw PTY output including ANSI escape sequences and cursor
// movement to reconstruct what the terminal screen looks like.
// Only tracks text content — all styling (colors, bold, etc.) is stripped.
// =============================================================================

class VirtualTerminal {
  private lines: string[] = [''];
  private cursorRow = 0;
  private cursorCol = 0;
  private maxLines: number;

  constructor(maxLines = 500) {
    this.maxLines = maxLines;
  }

  write(data: string): void {
    let i = 0;
    while (i < data.length) {
      const ch = data[i];

      // ESC sequence
      if (ch === '\x1B') {
        const seq = this.parseEscape(data, i);
        if (seq) {
          this.handleEscape(seq.code, seq.params);
          i += seq.length;
          continue;
        }
        // Incomplete escape at end of buffer — skip ESC
        i++;
        continue;
      }

      // Newline
      if (ch === '\n') {
        this.cursorRow++;
        this.cursorCol = 0;
        this.ensureRow(this.cursorRow);
        i++;
        continue;
      }

      // Carriage return
      if (ch === '\r') {
        this.cursorCol = 0;
        i++;
        continue;
      }

      // Tab
      if (ch === '\t') {
        const nextTab = (Math.floor(this.cursorCol / 8) + 1) * 8;
        this.cursorCol = nextTab;
        i++;
        continue;
      }

      // Skip other control characters (BEL, BS, etc.)
      const code = ch.charCodeAt(0);
      if (code < 32 && code !== 10 && code !== 13 && code !== 9) {
        i++;
        continue;
      }

      // Regular character — write to virtual screen
      this.ensureRow(this.cursorRow);
      this.padLine(this.cursorRow, this.cursorCol);

      const line = this.lines[this.cursorRow];
      if (this.cursorCol < line.length) {
        this.lines[this.cursorRow] =
          line.substring(0, this.cursorCol) + ch + line.substring(this.cursorCol + 1);
      } else {
        this.lines[this.cursorRow] += ch;
      }
      this.cursorCol++;
      i++;
    }

    this.trimLines();
  }

  /** Get the current screen content as an array of lines. */
  getScreenLines(): string[] {
    // Return lines, trimming trailing empty lines
    let end = this.lines.length;
    while (end > 0 && this.lines[end - 1].trim() === '') {
      end--;
    }
    return this.lines.slice(0, end).map(l => l.trimEnd());
  }

  private ensureRow(row: number): void {
    while (this.lines.length <= row) {
      this.lines.push('');
    }
  }

  private padLine(row: number, col: number): void {
    while (this.lines[row].length < col) {
      this.lines[row] += ' ';
    }
  }

  private trimLines(): void {
    if (this.lines.length > this.maxLines) {
      const excess = this.lines.length - this.maxLines;
      this.lines.splice(0, excess);
      this.cursorRow = Math.max(0, this.cursorRow - excess);
    }
  }

  private parseEscape(
    data: string,
    start: number,
  ): { code: string; params: number[]; length: number } | null {
    if (start + 1 >= data.length) return null;

    const next = data[start + 1];

    // OSC sequence: ESC ] ... BEL/ST — skip entirely
    if (next === ']') {
      let j = start + 2;
      while (j < data.length) {
        if (data[j] === '\x07') return { code: 'OSC', params: [], length: j - start + 1 };
        if (data[j] === '\x1B' && j + 1 < data.length && data[j + 1] === '\\') {
          return { code: 'OSC', params: [], length: j - start + 2 };
        }
        j++;
      }
      return null; // Incomplete
    }

    // CSI sequence: ESC [ params code
    if (next === '[') {
      let j = start + 2;
      let paramStr = '';
      while (j < data.length && ((data[j] >= '0' && data[j] <= '9') || data[j] === ';' || data[j] === '?')) {
        paramStr += data[j];
        j++;
      }
      if (j >= data.length) return null; // Incomplete
      const code = data[j];
      const params = paramStr
        ? paramStr.replace(/^\?/, '').split(';').map(n => parseInt(n, 10) || 0)
        : [];
      return { code, params, length: j - start + 1 };
    }

    // Two-char escape (ESC 7, ESC 8, etc.) — skip
    return { code: next, params: [], length: 2 };
  }

  private handleEscape(code: string, params: number[]): void {
    switch (code) {
      case 'A': // Cursor up
        this.cursorRow = Math.max(0, this.cursorRow - (params[0] || 1));
        break;
      case 'B': // Cursor down
        this.cursorRow += (params[0] || 1);
        this.ensureRow(this.cursorRow);
        break;
      case 'C': // Cursor forward
        this.cursorCol += (params[0] || 1);
        break;
      case 'D': // Cursor back
        this.cursorCol = Math.max(0, this.cursorCol - (params[0] || 1));
        break;
      case 'G': // Cursor to column
        this.cursorCol = Math.max(0, (params[0] || 1) - 1);
        break;
      case 'H':
      case 'f': // Cursor position
        this.cursorRow = Math.max(0, (params[0] || 1) - 1);
        this.cursorCol = Math.max(0, (params[1] || 1) - 1);
        this.ensureRow(this.cursorRow);
        break;
      case 'J': { // Erase in display
        const mode = params[0] || 0;
        if (mode === 2 || mode === 3) {
          // Erase entire display
          this.lines = [''];
          this.cursorRow = 0;
          this.cursorCol = 0;
        } else if (mode === 0) {
          // Erase from cursor to end
          this.ensureRow(this.cursorRow);
          this.lines[this.cursorRow] = this.lines[this.cursorRow].substring(0, this.cursorCol);
          this.lines.length = this.cursorRow + 1;
        }
        break;
      }
      case 'K': { // Erase in line
        this.ensureRow(this.cursorRow);
        const lineMode = params[0] || 0;
        if (lineMode === 0) {
          // Erase from cursor to end of line
          this.lines[this.cursorRow] = this.lines[this.cursorRow].substring(0, this.cursorCol);
        } else if (lineMode === 1) {
          // Erase from start to cursor
          const rest = this.lines[this.cursorRow].substring(this.cursorCol);
          this.lines[this.cursorRow] = ' '.repeat(this.cursorCol) + rest;
        } else if (lineMode === 2) {
          // Erase entire line
          this.lines[this.cursorRow] = '';
        }
        break;
      }
      case 'm': // SGR (styling) — ignore, we strip colors
        break;
      case 'h': // Set mode (e.g., ?25h show cursor) — ignore
      case 'l': // Reset mode — ignore
      case 's': // Save cursor — ignore
      case 'u': // Restore cursor — ignore
      case 'r': // Set scrolling region — ignore
      case 'n': // Device status report — ignore
        break;
      default:
        // Unknown escape — ignore
        break;
    }
  }
}
