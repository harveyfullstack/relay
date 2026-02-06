import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { colors } from '../utils/theme.js';
import type { TuiSettings } from '../types.js';

interface SettingsModalProps {
  settings: TuiSettings;
  onSave: (settings: TuiSettings) => void;
  onClose: () => void;
}

export function SettingsModal({ settings, onSave, onClose }: SettingsModalProps) {
  const [displayName, setDisplayName] = useState(settings.displayName);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    }
  });

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    if (trimmed) {
      onSave({ ...settings, displayName: trimmed });
    }
    onClose();
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={colors.accent}
      paddingX={2}
      paddingY={1}
      width={44}
    >
      <Text bold color={colors.accent}>Settings</Text>
      <Text> </Text>

      <Box>
        <Text bold>Display Name: </Text>
        <TextInput
          value={displayName}
          onChange={setDisplayName}
          onSubmit={handleSubmit}
          placeholder="Boss"
        />
      </Box>

      <Text> </Text>
      <Text dimColor>Agents will see you as this name.</Text>
      <Text dimColor>Takes effect on next restart.</Text>
      <Text> </Text>
      <Text dimColor>[Enter] save  [Esc] cancel</Text>
    </Box>
  );
}
