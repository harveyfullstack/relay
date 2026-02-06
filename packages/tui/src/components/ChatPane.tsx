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

/**
 * Check if a message is "direct" — involves You/TUI as sender or recipient.
 */
function isDirectMessage(msg: TuiMessage): boolean {
  return msg.from === 'You' || msg.to === 'TUI' || msg.to === 'You';
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
      // Show all messages involving this agent:
      // - Messages from the agent (to anyone)
      // - Messages to the agent (from anyone, including You)
      const name = selectedTarget.name;
      msgs = messages.filter(
        (m) =>
          (m.from === name || m.to === name ||
           // Our messages to this agent (locally added as from: 'You', to: agentName)
           (m.from === 'You' && m.to === name)) &&
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

  // Reserve lines for header + scroll indicators + borders
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
          <Text dimColor>Select an agent or channel from the sidebar</Text>
        )}
        {selectedTarget && visibleMessages.length === 0 && (
          <Text dimColor>No messages yet. Say hello!</Text>
        )}
        {visibleMessages.map((msg) => (
          <Message
            key={msg.id}
            message={msg}
            isDirect={isDirectMessage(msg)}
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
