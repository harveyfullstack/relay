import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { colors } from '../utils/theme.js';
import { useAgentOutput } from '../hooks/use-agent-output.js';

interface AgentTermPaneProps {
  agentName: string | null;
  width: number;
  height: number;
  dataDir?: string;
}

export const AgentTermPane = memo(function AgentTermPane({
  agentName,
  width,
  height,
  dataDir,
}: AgentTermPaneProps) {
  const borderColor = colors.accent;
  const lines = useAgentOutput(agentName, dataDir);

  // Reserve lines for header (1) + borders (2)
  const visibleHeight = Math.max(1, height - 3);
  const contentWidth = Math.max(1, width - 4); // borders + padding

  const visibleLines = useMemo(() => {
    // Show last N lines that fit
    const tail = lines.slice(-visibleHeight);
    // Truncate lines to content width
    return tail.map(l => l.length > contentWidth ? l.substring(0, contentWidth) : l);
  }, [lines, visibleHeight, contentWidth]);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={borderColor}
      overflow="hidden"
    >
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color={colors.primary}>
          {agentName ? agentName : 'Terminal'}
        </Text>
        {agentName && lines.length > 0 && (
          <Text color={colors.success} bold> LIVE</Text>
        )}
      </Box>

      <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        {!agentName && (
          <Text dimColor>Select an agent to view terminal</Text>
        )}
        {agentName && lines.length === 0 && (
          <Text dimColor>Waiting for output...</Text>
        )}
        {visibleLines.map((line, i) => (
          <Text key={i} wrap="truncate">{line || ' '}</Text>
        ))}
      </Box>
    </Box>
  );
});
