import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../utils/theme.js';

const CLI_OPTIONS = ['amp', 'claude', 'cursor'] as const;

interface TeamMember {
  role: string;
  name: string;
  task: string;
  enabled: boolean;
}

const DEFAULT_TEAM: TeamMember[] = [
  {
    role: 'Product Manager',
    name: 'PM',
    task: 'You are the Product Manager. Own requirements, prioritize work, write specs, and coordinate between Designer and Engineer. Focus on the "what" and "why" — not implementation details.',
    enabled: true,
  },
  {
    role: 'Software Engineer',
    name: 'Engineer',
    task: 'You are the Software Engineer. Implement features, write code, fix bugs, and handle architecture decisions. Coordinate with PM for requirements and Designer for UI specs.',
    enabled: true,
  },
  {
    role: 'UX Designer',
    name: 'Designer',
    task: 'You are the UX Designer. Own user experience, design interfaces, create component specs, and ensure accessibility. Coordinate with PM for requirements and Engineer for feasibility.',
    enabled: true,
  },
];

interface TeamInitDialogProps {
  onSpawnTeam: (members: { name: string; cli: string; task: string }[]) => void;
  onSkip: () => void;
}

export function TeamInitDialog({ onSpawnTeam, onSkip }: TeamInitDialogProps) {
  const [team, setTeam] = useState<TeamMember[]>(
    DEFAULT_TEAM.map((m) => ({ ...m })),
  );
  const [cliIndex, setCliIndex] = useState(0); // index into CLI_OPTIONS, default 0 = amp
  const [cursorIndex, setCursorIndex] = useState(0); // which team row is highlighted

  useInput((input, key) => {
    // Esc skips team init
    if (key.escape) {
      onSkip();
      return;
    }

    // Tab cycles CLI selection
    if (key.tab) {
      setCliIndex((i) => (i + 1) % CLI_OPTIONS.length);
      return;
    }

    // Up/down navigates team members
    if (key.upArrow) {
      setCursorIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setCursorIndex((i) => Math.min(team.length - 1, i + 1));
      return;
    }

    // Space toggles checkbox
    if (input === ' ') {
      setTeam((prev) =>
        prev.map((m, i) =>
          i === cursorIndex ? { ...m, enabled: !m.enabled } : m,
        ),
      );
      return;
    }

    // Enter spawns all selected
    if (key.return) {
      const selected = team.filter((m) => m.enabled);
      if (selected.length === 0) {
        onSkip();
        return;
      }
      const cli = CLI_OPTIONS[cliIndex];
      onSpawnTeam(selected.map((m) => ({ name: m.name, cli, task: m.task })));
      return;
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={colors.accent}
      paddingX={2}
      paddingY={1}
      width={52}
    >
      <Text bold color={colors.accent}>
        Initialize Team
      </Text>
      <Text> </Text>

      {/* CLI selector tabs */}
      <Box>
        <Text bold>CLI: </Text>
        {CLI_OPTIONS.map((cli, i) => (
          <React.Fragment key={cli}>
            {i > 0 && <Text dimColor> {'|'} </Text>}
            <Text
              bold={i === cliIndex}
              color={i === cliIndex ? colors.accent : colors.muted}
              underline={i === cliIndex}
            >
              {cli}
            </Text>
          </React.Fragment>
        ))}
        <Text dimColor>  [Tab] to switch</Text>
      </Box>

      <Text> </Text>

      {/* Team members with checkboxes */}
      <Text bold>Team Members:</Text>
      {team.map((member, i) => {
        const isHighlighted = i === cursorIndex;
        const checkbox = member.enabled ? '[x]' : '[ ]';
        return (
          <Box key={member.role}>
            <Text
              color={isHighlighted ? colors.accent : colors.text}
              bold={isHighlighted}
            >
              {isHighlighted ? '>' : ' '} {checkbox} {member.role}
            </Text>
            <Text dimColor> ({member.name})</Text>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>
        [Space] toggle  [Enter] spawn  [Esc] skip
      </Text>
    </Box>
  );
}
