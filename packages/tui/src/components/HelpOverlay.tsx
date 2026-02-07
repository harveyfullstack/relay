import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../utils/theme.js';

interface HelpOverlayProps {
  onClose: () => void;
}

const shortcuts = [
  { section: 'Global' },
  { key: 'Tab', action: 'Cycle focus between panes' },
  { key: 'Ctrl+L', action: 'Toggle agent terminal' },
  { key: '?', action: 'Show/hide this help' },
  { key: 'Ctrl+C', action: 'Quit' },
  { section: 'Sidebar' },
  { key: 'Up/Down', action: 'Navigate agents and channels' },
  { key: 'Enter', action: 'Select agent/channel' },
  { key: 'S', action: 'Spawn new agent' },
  { key: ',', action: 'Settings' },
  { section: 'Chat' },
  { key: 'Up/Down', action: 'Scroll messages' },
  { key: 'PgUp/PgDn', action: 'Scroll page' },
  { key: 'R', action: 'Enter thread view' },
  { key: 'Esc', action: 'Exit thread / close modal' },
] as const;

export function HelpOverlay({ onClose }: HelpOverlayProps) {
  useInput((_input, key) => {
    if (key.escape || key.return) {
      onClose();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={colors.primary}
      paddingX={2}
      paddingY={1}
      width={50}
    >
      <Text bold color={colors.primary}>Keyboard Shortcuts</Text>
      <Text> </Text>
      {shortcuts.map((item, i) => {
        if ('section' in item) {
          return (
            <Text key={i} bold dimColor>
              {i > 0 ? '\n' : ''}{item.section}
            </Text>
          );
        }
        return (
          <Box key={i} gap={1}>
            <Box width={14}>
              <Text color={colors.accent}>{item.key}</Text>
            </Box>
            <Text>{item.action}</Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text dimColor>[Enter] or [Esc] to close</Text>
    </Box>
  );
}
