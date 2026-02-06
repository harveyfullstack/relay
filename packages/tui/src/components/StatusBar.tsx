import React from 'react';
import { Box, Text } from 'ink';
import { colors, symbols } from '../utils/theme.js';
import { formatUptime } from '../utils/format.js';
import type { StatusResponsePayload, AgentInfo } from '../types.js';

interface StatusBarProps {
  connected: boolean;
  daemonStatus: StatusResponsePayload | null;
  agents: AgentInfo[];
  width: number;
}

export function StatusBar({ connected, daemonStatus, agents, width }: StatusBarProps) {
  const daemonLabel = connected ? 'running' : 'disconnected';
  const daemonColor = connected ? colors.success : colors.error;
  const uptime = daemonStatus?.uptime ? formatUptime(daemonStatus.uptime) : '--';
  const agentCount = agents.length;

  return (
    <Box
      width={width}
      height={1}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={2}>
        <Text>
          <Text color={daemonColor}>{symbols.online}</Text>
          <Text dimColor> daemon: </Text>
          <Text color={daemonColor}>{daemonLabel}</Text>
        </Text>
        <Text dimColor>│</Text>
        <Text>
          <Text dimColor>agents: </Text>
          <Text>{agentCount}</Text>
        </Text>
        <Text dimColor>│</Text>
        <Text>
          <Text dimColor>uptime: </Text>
          <Text>{uptime}</Text>
        </Text>
      </Box>
      <Text dimColor>Tab:focus  Ctrl+L:logs  ?:help  Ctrl+C:quit</Text>
    </Box>
  );
}
