import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { colors } from '../utils/theme.js';

const CLI_OPTIONS = ['claude', 'codex', 'gemini', 'aider', 'goose'] as const;

interface SpawnDialogProps {
  onSpawn: (name: string, cli: string, task?: string) => void;
  onClose: () => void;
}

type Step = 'cli' | 'name' | 'task';

export function SpawnDialog({ onSpawn, onClose }: SpawnDialogProps) {
  const [step, setStep] = useState<Step>('cli');
  const [cliIndex, setCliIndex] = useState(0);
  const [name, setName] = useState('');
  const [task, setTask] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (step === 'cli') {
      if (key.upArrow) {
        setCliIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setCliIndex((i) => Math.min(CLI_OPTIONS.length - 1, i + 1));
      } else if (key.return) {
        setStep('name');
      }
    }
  });

  const handleNameSubmit = (val: string) => {
    if (val.trim()) {
      setName(val.trim());
      setStep('task');
    }
  };

  const handleTaskSubmit = (val: string) => {
    const cli = CLI_OPTIONS[cliIndex];
    onSpawn(name, cli, val.trim() || undefined);
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
      <Text bold color={colors.accent}>Spawn Agent</Text>
      <Text> </Text>

      {/* Step 1: CLI selection */}
      <Text bold>CLI:</Text>
      {CLI_OPTIONS.map((cli, i) => (
        <Text key={cli}>
          <Text color={i === cliIndex ? colors.accent : colors.text}>
            {i === cliIndex ? ' > ' : '   '}
            {cli}
          </Text>
          {step === 'cli' && i === cliIndex && <Text dimColor> {'<'}</Text>}
        </Text>
      ))}

      {/* Step 2: Name */}
      {(step === 'name' || step === 'task') && (
        <Box marginTop={1}>
          <Text bold>Name: </Text>
          {step === 'name' ? (
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={handleNameSubmit}
              placeholder="AgentName"
            />
          ) : (
            <Text color={colors.primary}>{name}</Text>
          )}
        </Box>
      )}

      {/* Step 3: Task */}
      {step === 'task' && (
        <Box marginTop={1}>
          <Text bold>Task: </Text>
          <TextInput
            value={task}
            onChange={setTask}
            onSubmit={handleTaskSubmit}
            placeholder="(optional) Describe the task"
          />
        </Box>
      )}

      <Text> </Text>
      <Text dimColor>[Enter] next  [Esc] cancel</Text>
    </Box>
  );
}
