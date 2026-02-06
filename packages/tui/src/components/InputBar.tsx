import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { colors } from '../utils/theme.js';
import type { SelectedTarget } from '../types.js';

interface InputBarProps {
  selectedTarget: SelectedTarget | null;
  focused: boolean;
  onSubmit: (text: string) => void;
  width: number;
}

export function InputBar({ selectedTarget, focused, onSubmit, width }: InputBarProps) {
  const [value, setValue] = useState('');

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !selectedTarget) return;
    onSubmit(trimmed);
    setValue('');
  };

  const placeholder = selectedTarget
    ? `Message ${selectedTarget.type === 'channel' ? '#' : ''}${selectedTarget.name}...`
    : 'Select an agent or channel';

  const borderColor = focused ? colors.borderFocused : colors.border;

  return (
    <Box
      width={width}
      height={3}
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
    >
      <Text color={colors.muted}>{'>  '}</Text>
      {focused && selectedTarget ? (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      ) : (
        <Text dimColor>{placeholder}</Text>
      )}
    </Box>
  );
}
