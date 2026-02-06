import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { colors } from '../utils/theme.js';
import { formatTime } from '../utils/format.js';
import type { LogEntry, SelectedTarget } from '../types.js';

interface LogPaneProps {
  logs: Record<string, LogEntry[]>;
  selectedTarget: SelectedTarget | null;
  focused: boolean;
  width: number;
  height: number;
}

export function LogPane({ logs, selectedTarget, focused, width, height }: LogPaneProps) {
  const borderColor = focused ? colors.borderFocused : colors.border;
  const agentName = selectedTarget?.type === 'agent' ? selectedTarget.name : null;

  const agentLogs = useMemo(() => {
    if (!agentName) return [];
    return logs[agentName] ?? [];
  }, [logs, agentName]);

  // Show last N lines that fit in the pane
  const visibleHeight = Math.max(1, height - 3); // header + borders
  const visibleLogs = agentLogs.slice(-visibleHeight);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={borderColor}
    >
      <Box paddingX={1}>
        <Text bold color={colors.primary}>
          Logs{agentName ? `: ${agentName}` : ''}
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {!agentName && (
          <Text dimColor>Select an agent to view logs</Text>
        )}
        {agentName && visibleLogs.length === 0 && (
          <Text dimColor>No log output yet</Text>
        )}
        {visibleLogs.map((entry, i) => (
          <Text key={`${entry.timestamp}-${i}`} wrap="truncate">
            <Text dimColor>[{formatTime(entry.timestamp)}]</Text>
            <Text> {entry.data}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
