import { useMemo } from 'react';
import type { TuiMessage } from '../types.js';

export interface ScrollInfo {
  visibleMessages: TuiMessage[];
  aboveCount: number;
  belowCount: number;
  isAtBottom: boolean;
}

/**
 * Compute the visible window of messages given a viewport height and scroll offset.
 * scrollOffset is measured from the bottom (0 = at bottom, N = N lines scrolled up).
 */
export function useScroll(
  messages: TuiMessage[],
  viewportHeight: number,
  scrollOffset: number,
): ScrollInfo {
  return useMemo(() => {
    const total = messages.length;
    if (total === 0 || viewportHeight <= 0) {
      return { visibleMessages: [], aboveCount: 0, belowCount: 0, isAtBottom: true };
    }

    const clampedOffset = Math.min(scrollOffset, Math.max(0, total - viewportHeight));
    const endIndex = total - clampedOffset;
    const startIndex = Math.max(0, endIndex - viewportHeight);

    return {
      visibleMessages: messages.slice(startIndex, endIndex),
      aboveCount: startIndex,
      belowCount: total - endIndex,
      isAtBottom: clampedOffset === 0,
    };
  }, [messages, viewportHeight, scrollOffset]);
}
