/**
 * relay_channel_join / relay_channel_leave / relay_channel_message - Channel operations
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RelayClient } from '../client.js';

// Join channel
export const relayChannelJoinSchema = z.object({
  channel: z.string().describe('The channel name to join (e.g., "#general")'),
  display_name: z.string().optional().describe('Optional display name to use in the channel'),
});

export type RelayChannelJoinInput = z.infer<typeof relayChannelJoinSchema>;

export const relayChannelJoinTool: Tool = {
  name: 'relay_channel_join',
  description: 'Join a channel to participate in group conversations. Channels start with #.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'The channel name to join (e.g., "#general")' },
      display_name: { type: 'string', description: 'Optional display name to use in the channel' },
    },
    required: ['channel'],
  },
};

export async function handleRelayChannelJoin(client: RelayClient, input: RelayChannelJoinInput): Promise<string> {
  const result = await client.joinChannel(input.channel, input.display_name);
  if (result.success) {
    return `Joined channel "${input.channel}"`;
  }
  return `Failed to join channel: ${result.error}`;
}

// Leave channel
export const relayChannelLeaveSchema = z.object({
  channel: z.string().describe('The channel name to leave'),
  reason: z.string().optional().describe('Optional reason for leaving'),
});

export type RelayChannelLeaveInput = z.infer<typeof relayChannelLeaveSchema>;

export const relayChannelLeaveTool: Tool = {
  name: 'relay_channel_leave',
  description: 'Leave a channel you are currently in.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'The channel name to leave' },
      reason: { type: 'string', description: 'Optional reason for leaving' },
    },
    required: ['channel'],
  },
};

export async function handleRelayChannelLeave(client: RelayClient, input: RelayChannelLeaveInput): Promise<string> {
  const result = await client.leaveChannel(input.channel, input.reason);
  if (result.success) {
    return `Left channel "${input.channel}"`;
  }
  return `Failed to leave channel: ${result.error}`;
}

// Send channel message
export const relayChannelMessageSchema = z.object({
  channel: z.string().describe('The channel to send the message to'),
  message: z.string().describe('The message content'),
  thread: z.string().optional().describe('Optional thread ID for threaded conversations'),
});

export type RelayChannelMessageInput = z.infer<typeof relayChannelMessageSchema>;

export const relayChannelMessageTool: Tool = {
  name: 'relay_channel_message',
  description: 'Send a message to a channel. You must be a member of the channel.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'The channel to send the message to' },
      message: { type: 'string', description: 'The message content' },
      thread: { type: 'string', description: 'Optional thread ID for threaded conversations' },
    },
    required: ['channel', 'message'],
  },
};

export async function handleRelayChannelMessage(client: RelayClient, input: RelayChannelMessageInput): Promise<string> {
  await client.sendChannelMessage(input.channel, input.message, { thread: input.thread });
  return `Message sent to channel "${input.channel}"`;
}
