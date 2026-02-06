import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { colors, symbols } from '../utils/theme.js';
import { truncate } from '../utils/format.js';
import type { AgentInfo, SelectedTarget, FocusedPane } from '../types.js';

interface SidebarProps {
  agents: AgentInfo[];
  channels: string[];
  selectedTarget: SelectedTarget | null;
  sidebarIndex: number;
  focused: boolean;
  width: number;
  height: number;
}

export const Sidebar = memo(function Sidebar({
  agents,
  channels,
  selectedTarget,
  sidebarIndex,
  focused,
  width,
  height,
}: SidebarProps) {
  const borderColor = focused ? colors.borderFocused : colors.border;
  const innerWidth = width - 2; // account for border

  // Build sidebar items list
  const items: SidebarItem[] = [];

  // Section: Agents
  items.push({ type: 'header', label: 'AGENTS' });
  for (const agent of agents) {
    items.push({
      type: 'agent',
      label: agent.name,
      cli: agent.cli,
      selected: selectedTarget?.type === 'agent' && selectedTarget.name === agent.name,
    });
  }
  if (agents.length === 0) {
    items.push({ type: 'empty', label: 'no agents' });
  }

  // Separator
  items.push({ type: 'separator' });

  // Section: Channels
  items.push({ type: 'header', label: 'CHANNELS' });
  for (const ch of channels) {
    items.push({
      type: 'channel',
      label: `#${ch}`,
      selected: selectedTarget?.type === 'channel' && selectedTarget.name === ch,
    });
  }

  // Separator and spawn button
  items.push({ type: 'separator' });
  items.push({ type: 'action', label: '[s] Spawn' });

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={borderColor}
    >
      {items.map((item, i) => (
        <SidebarRow
          key={`${item.type}-${item.label}-${i}`}
          item={item}
          isHighlighted={focused && i === sidebarIndex}
          width={innerWidth}
        />
      ))}
    </Box>
  );
});

interface SidebarItem {
  type: 'header' | 'agent' | 'channel' | 'separator' | 'action' | 'empty';
  label?: string;
  cli?: string;
  selected?: boolean;
}

function SidebarRow({ item, isHighlighted, width }: { item: SidebarItem; isHighlighted: boolean; width: number }) {
  if (item.type === 'separator') {
    return (
      <Text dimColor>
        {symbols.separator.repeat(Math.max(0, width))}
      </Text>
    );
  }

  if (item.type === 'header') {
    return (
      <Text bold dimColor>
        {' '}{item.label}
      </Text>
    );
  }

  if (item.type === 'empty') {
    return (
      <Text dimColor italic>
        {'  '}{item.label}
      </Text>
    );
  }

  if (item.type === 'action') {
    return (
      <Box>
        <Text color={isHighlighted ? colors.accent : colors.muted}>
          {isHighlighted ? '>' : ' '} {item.label}
        </Text>
      </Box>
    );
  }

  const prefix = item.selected ? symbols.selected : symbols.unselected;
  const indicator = item.type === 'agent' ? symbols.online : '';
  const indicatorColor = item.type === 'agent' ? colors.online : colors.channel;
  const labelColor = item.selected ? colors.primary : colors.text;
  const bgColor = isHighlighted ? 'gray' : undefined;

  return (
    <Box>
      <Text backgroundColor={bgColor}>
        <Text color={indicatorColor}>{indicator ? ` ${indicator}` : '  '}</Text>
        <Text color={isHighlighted ? colors.accent : labelColor}>
          {prefix}{truncate(item.label ?? '', width - 4)}
        </Text>
        {item.cli && (
          <Text dimColor> {item.cli}</Text>
        )}
      </Text>
    </Box>
  );
}

/**
 * Get the indices of interactive (selectable) sidebar items.
 * Skips headers, separators, and empty placeholders.
 */
export function getSidebarInteractiveIndices(agents: AgentInfo[], channels: string[]): number[] {
  const indices: number[] = [];
  const agentCount = agents.length > 0 ? agents.length : 1; // 1 for "empty" placeholder
  // 0: header "AGENTS"
  // 1..agentCount: agents (interactive) or empty (not interactive)
  if (agents.length > 0) {
    for (let i = 0; i < agents.length; i++) {
      indices.push(1 + i);
    }
  }
  // agentCount+1: separator
  // agentCount+2: header "CHANNELS"
  const channelStart = 1 + agentCount + 2;
  for (let i = 0; i < channels.length; i++) {
    indices.push(channelStart + i);
  }
  // channelStart+channels.length: separator
  // channelStart+channels.length+1: action
  indices.push(channelStart + channels.length + 1);
  return indices;
}

/**
 * Determine what a sidebar index maps to.
 */
export function getSidebarTarget(
  index: number,
  agents: AgentInfo[],
  channels: string[],
): { type: 'agent' | 'channel' | 'action' | 'none'; name: string } {
  const agentCount = agents.length > 0 ? agents.length : 1;
  // Skip: header(0), agents(1..agentCount), separator, header, channels, separator, action
  const agentStart = 1;
  const agentEnd = agentStart + agentCount;
  const channelStart = agentEnd + 2; // separator + header
  const channelEnd = channelStart + channels.length;
  const actionIndex = channelEnd + 1; // separator + action

  if (index >= agentStart && index < agentEnd && agents.length > 0) {
    return { type: 'agent', name: agents[index - agentStart].name };
  }
  if (index >= channelStart && index < channelEnd) {
    return { type: 'channel', name: channels[index - channelStart] };
  }
  if (index === actionIndex) {
    return { type: 'action', name: 'spawn' };
  }
  return { type: 'none', name: '' };
}
