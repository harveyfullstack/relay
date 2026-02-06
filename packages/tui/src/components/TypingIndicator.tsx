import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { colors } from '../utils/theme.js';

const FRAMES = ['·', '··', '···'];
const SPEED_MS = 400;

interface TypingIndicatorProps {
  agentName: string;
}

export function TypingIndicator({ agentName }: TypingIndicatorProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, SPEED_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color={colors.agent} dimColor>
        {agentName} is thinking {FRAMES[frame]}
      </Text>
    </Box>
  );
}
