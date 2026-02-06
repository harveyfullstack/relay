import React, { memo } from 'react';
import { Box, Text } from 'ink';
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
 *
 * Uses Box+Text instead of \n in a single Text — Ink's wrap="wrap"
 * does not reliably honour \n, causing header/body to run together.
 */
export const Message = memo(function Message({ message, isDirect, isInThread }: MessageProps) {
  const isYou = message.from === 'You';
  const time = formatTime(message.timestamp);
  const isSystemError = message.from === '_system' && message.data?._isSystemError;

  // System error: render as a warning notification
  if (isSystemError) {
    return (
      <Box marginBottom={1}>
        <Text color={colors.error} wrap="wrap">{`  [!] ${message.body}`}</Text>
      </Box>
    );
  }

  if (!isDirect) {
    const route = `${message.from} \u2192 ${message.to}`;
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>{`  ${route}  ${time}`}</Text>
        <Text dimColor wrap="wrap">{`  ${message.body}`}</Text>
      </Box>
    );
  }

  const nameColor = isYou ? colors.you : colors.agent;

  // Status indicator for user's own messages
  let statusIcon: string | null = null;
  let statusColor: string | undefined;
  if (isYou && message.status) {
    switch (message.status) {
      case 'sending': statusIcon = '○'; statusColor = undefined; break;
      case 'sent':    statusIcon = '✓'; statusColor = colors.success; break;
      case 'failed':  statusIcon = '✗'; statusColor = colors.error; break;
    }
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold color={nameColor}>{message.from}</Text>
        <Text dimColor>{` ${time}`}</Text>
        {statusIcon ? <Text dimColor={!statusColor} color={statusColor}>{` ${statusIcon}`}</Text> : null}
        {isInThread ? <Text dimColor>{' [thread]'}</Text> : null}
      </Text>
      <Text wrap="wrap">{message.body}</Text>
    </Box>
  );
});
