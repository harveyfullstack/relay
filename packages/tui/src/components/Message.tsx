import React, { memo } from 'react';
import { Text } from 'ink';
import { colors } from '../utils/theme.js';
import { formatTime } from '../utils/format.js';
import type { TuiMessage } from '../types.js';

interface MessageProps {
  message: TuiMessage;
  isDirect: boolean;
  isInThread?: boolean;
}

/**
 * Render a single chat message.
 * Direct messages (to/from You) render in full color.
 * Indirect messages (agent-to-agent) render dimmed with a [from -> to] prefix.
 */
export const Message = memo(function Message({ message, isDirect, isInThread }: MessageProps) {
  const isYou = message.from === 'You';
  const time = formatTime(message.timestamp);

  if (!isDirect) {
    // Indirect: agent-to-agent traffic, show dimmed with routing info
    const route = `${message.from} -> ${message.to}`;
    return (
      <Text dimColor wrap="wrap">
        {`  ${route}  ${time}\n  ${message.body}\n`}
      </Text>
    );
  }

  // Direct message: full color
  const nameColor = isYou ? colors.you : colors.agent;

  return (
    <Text wrap="wrap">
      <Text bold color={nameColor}>{message.from}</Text>
      <Text dimColor>{` ${time}`}</Text>
      {isInThread ? <Text dimColor>{' [thread]'}</Text> : null}
      {`\n${message.body}\n`}
    </Text>
  );
});
