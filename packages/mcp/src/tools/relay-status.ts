import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RelayClient } from '../client.js';

export const relayStatusSchema = z.object({});

export type RelayStatusInput = z.infer<typeof relayStatusSchema>;

export const relayStatusTool: Tool = {
  name: 'relay_status',
  description: `Get relay connection status and diagnostics.

Returns:
- Connection state (connected/disconnected)
- Your agent name
- Project/socket info
- Daemon version`,
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * Return a human-readable relay status summary.
 */
export async function handleRelayStatus(
  client: RelayClient,
  _input: RelayStatusInput
): Promise<string> {
  const status = await client.getStatus();

  return `Relay Status:
- Connected: ${status.connected ? 'Yes' : 'No'}
- Agent Name: ${status.agentName || 'Not registered'}
- Project: ${status.project || 'Unknown'}
- Socket: ${status.socketPath}
- Daemon Version: ${status.daemonVersion || 'Unknown'}
- Uptime: ${status.uptime || 'N/A'}`;
}
