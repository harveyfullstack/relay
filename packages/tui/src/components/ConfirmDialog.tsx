import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../utils/theme.js';

interface ConfirmDialogProps {
  message: string;
}

export function ConfirmDialog({ message }: ConfirmDialogProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={colors.error}
      paddingX={2}
      paddingY={1}
      width={44}
    >
      <Text bold color={colors.error}>Confirm</Text>
      <Text> </Text>
      <Text>{message}</Text>
      <Text> </Text>
      <Text dimColor>[Y] yes  [N/Esc] cancel</Text>
    </Box>
  );
}
