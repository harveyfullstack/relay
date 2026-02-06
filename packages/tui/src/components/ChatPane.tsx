import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Message } from './Message.js';
import { colors, symbols } from '../utils/theme.js';
import { useScroll } from '../hooks/use-scroll.js';
import type { TuiMessage, SelectedTarget } from '../types.js';

interface ChatPaneProps {
  messages: TuiMessage[];
  selectedTarget: SelectedTarget | null;
  activeThread: string | null;
  scrollOffset: number;
  focused: boolean;
  width: number;
  height: number;
}

export function ChatPane({
  messages,
  selectedTarget,
  activeThread,
  scrollOffset,
  focused,
  width,
  height,
}: ChatPaneProps) {
  const borderColor = focused ? colors.borderFocused : colors.border;

  // Filter messages for selected target
  const filtered = useMemo(() => {
    if (!selectedTarget) return [];

    let msgs: TuiMessage[];
    if (selectedTarget.type === 'channel') {
      msgs = messages.filter((m) => m.channel === selectedTarget.name);
    } else {
      msgs = messages.filter(
        (m) =>
          (m.from === selectedTarget.name || m.to === selectedTarget.name) &&
          !m.channel,
      );
    }

    // If viewing a thread, filter to that thread
    if (activeThread) {
      msgs = msgs.filter(
        (m) => m.id === activeThread || m.thread === activeThread,
      );
    }

    return msgs;
  }, [messages, selectedTarget, activeThread]);

  // Reserve 2 lines for header + scroll indicator
  const messageAreaHeight = Math.max(1, height - 4);
  const { visibleMessages, aboveCount, belowCount } = useScroll(
    filtered,
    messageAreaHeight,
    scrollOffset,
  );

  // Header
  const headerLabel = selectedTarget
    ? selectedTarget.type === 'channel'
      ? `#${selectedTarget.name}`
      : selectedTarget.name
    : 'Select a target';

  const threadLabel = activeThread ? ' > Thread' : '';

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={borderColor}
    >
      {/* Chat header */}
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color={colors.primary}>
          {headerLabel}{threadLabel}
        </Text>
        {activeThread && (
          <Text dimColor>[Esc] back</Text>
        )}
      </Box>

      {/* Scroll up indicator */}
      {aboveCount > 0 && (
        <Box justifyContent="center">
          <Text dimColor>{symbols.scrollUp} {aboveCount} more above</Text>
        </Box>
      )}

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {!selectedTarget && (
          <Box justifyContent="center" alignItems="center" flexGrow={1}>
            <Text dimColor>Select an agent or channel from the sidebar</Text>
          </Box>
        )}
        {selectedTarget && visibleMessages.length === 0 && (
          <Box justifyContent="center" alignItems="center" flexGrow={1}>
            <Text dimColor>No messages yet. Say hello!</Text>
          </Box>
        )}
        {visibleMessages.map((msg) => (
          <Message
            key={msg.id}
            message={msg}
            isInThread={!!activeThread && msg.id !== activeThread}
          />
        ))}
      </Box>

      {/* Scroll down indicator */}
      {belowCount > 0 && (
        <Box justifyContent="center">
          <Text dimColor>{symbols.scrollDown} {belowCount} more below</Text>
        </Box>
      )}
    </Box>
  );
}
