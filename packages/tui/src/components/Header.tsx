import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../utils/theme.js';
import type { AgentInfo } from '../types.js';

interface HeaderProps {
  projectRoot?: string;
  agents: AgentInfo[];
  connected: boolean;
  width: number;
}

export function Header({ projectRoot, agents, connected, width }: HeaderProps) {
  const projectName = projectRoot
    ? projectRoot.split('/').pop() ?? 'relay'
    : 'relay';
  const onlineCount = agents.length;
  const status = connected ? 'connected' : 'connecting...';
  const statusColor = connected ? colors.success : colors.error;

  return (
    <Box
      width={width}
      height={1}
      borderStyle={undefined}
      paddingX={1}
      justifyContent="space-between"
    >
      <Text bold color={colors.primary}>
        Agent Relay
      </Text>
      <Box>
        <Text dimColor>relay://{projectName}  </Text>
        <Text color={statusColor}>{connected ? `${onlineCount} online` : status}</Text>
      </Box>
    </Box>
  );
}
