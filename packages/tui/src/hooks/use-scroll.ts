import { useMemo } from 'react';
import type { TuiMessage } from '../types.js';

export interface ScrollInfo {
  visibleMessages: TuiMessage[];
  aboveCount: number;
  belowCount: number;
  isAtBottom: boolean;
}

/**
 * Estimate how many terminal lines a message will occupy.
 * Header (1) + wrapped body lines + marginBottom (1).
 */
export function estimateMessageLines(body: string, availableWidth: number): number {
  const w = Math.max(1, availableWidth);
  let lines = 1; // header (author + timestamp)
  if (body.length === 0) {
    lines += 1;
  } else {
    for (const line of body.split('\n')) {
      lines += line.length === 0 ? 1 : Math.ceil(line.length / w);
    }
  }
  lines += 1; // marginBottom spacing
  return lines;
}

/**
 * Compute the visible window of messages given a viewport height, scroll offset,
 * and per-message line estimates so we never overflow the container.
 * scrollOffset counts messages from the bottom (0 = at bottom).
 */
export function useScroll(
  messages: TuiMessage[],
  viewportHeight: number,
  scrollOffset: number,
  lineEstimates: number[],
): ScrollInfo {
  return useMemo(() => {
    const total = messages.length;
    if (total === 0 || viewportHeight <= 0) {
      return { visibleMessages: [], aboveCount: 0, belowCount: 0, isAtBottom: true };
    }

    // Clamp scroll offset to valid message count
    const clampedOffset = Math.min(scrollOffset, Math.max(0, total - 1));
    const endIndex = total - clampedOffset;

    // Walk backwards from endIndex, fitting messages within viewport
    let startIndex = endIndex;
    let usedLines = 0;
    while (startIndex > 0) {
      const msgLines = lineEstimates[startIndex - 1] ?? 3;
      if (usedLines + msgLines > viewportHeight) break;
      startIndex--;
      usedLines += msgLines;
    }

    return {
      visibleMessages: messages.slice(startIndex, endIndex),
      aboveCount: startIndex,
      belowCount: total - endIndex,
      isAtBottom: clampedOffset === 0,
    };
  }, [messages, viewportHeight, scrollOffset, lineEstimates]);
}
