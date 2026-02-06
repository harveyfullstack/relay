import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { colors } from '../utils/theme.js';
import { formatTime, formatMessageText } from '../utils/format.js';
import type { TuiMessage } from '../types.js';

interface MessageProps {
  message: TuiMessage;
  isInThread?: boolean;
}

export const Message = memo(function Message({ message, isInThread }: MessageProps) {
  const isYou = message.from === 'You';
  const nameColor = isYou ? colors.you : colors.agent;
  const time = formatTime(message.timestamp);
  const formattedBody = formatMessageText(message.body);

  return (
    <Box flexDirection="column" paddingLeft={isInThread ? 2 : 0}>
      <Box gap={1}>
        {isInThread && <Text dimColor>│</Text>}
        <Text bold color={nameColor}>{message.from}</Text>
        <Text dimColor>{time}</Text>
        {message.thread && !isInThread && (
          <Text dimColor>[thread]</Text>
        )}
      </Box>
      <Box paddingLeft={isInThread ? 2 : 0}>
        {isInThread && <Text dimColor>│ </Text>}
        <Text>{formattedBody}</Text>
      </Box>
    </Box>
  );
});
