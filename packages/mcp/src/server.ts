import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { RelayClient } from './client.js';
import {
  relaySendTool,
  relaySendSchema,
  handleRelaySend,
  relayInboxTool,
  relayInboxSchema,
  handleRelayInbox,
  relayWhoTool,
  relayWhoSchema,
  handleRelayWho,
  relaySpawnTool,
  relaySpawnSchema,
  handleRelaySpawn,
  relayReleaseTool,
  relayReleaseSchema,
  handleRelayRelease,
  relayStatusTool,
  relayStatusSchema,
  handleRelayStatus,
} from './tools/index.js';

/**
 * All available relay tools
 */
const TOOLS = [
  relaySendTool,
  relayInboxTool,
  relayWhoTool,
  relaySpawnTool,
  relayReleaseTool,
  relayStatusTool,
];

/**
 * MCP Server configuration options
 */
export interface MCPServerConfig {
  name?: string;
  version?: string;
}

/**
 * Create and configure an MCP server for Agent Relay
 */
export function createMCPServer(client: RelayClient, config?: MCPServerConfig): Server {
  const serverName = config?.name ?? 'agent-relay-mcp';
  const serverVersion = config?.version ?? '0.1.0';

  const server = new Server(
    {
      name: serverName,
      version: serverVersion,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: string;

      switch (name) {
        case 'relay_send': {
          const input = relaySendSchema.parse(args);
          result = await handleRelaySend(client, input);
          break;
        }

        case 'relay_inbox': {
          const input = relayInboxSchema.parse(args);
          result = await handleRelayInbox(client, input);
          break;
        }

        case 'relay_who': {
          const input = relayWhoSchema.parse(args);
          result = await handleRelayWho(client, input);
          break;
        }

        case 'relay_spawn': {
          const input = relaySpawnSchema.parse(args);
          result = await handleRelaySpawn(client, input);
          break;
        }

        case 'relay_release': {
          const input = relayReleaseSchema.parse(args);
          result = await handleRelayRelease(client, input);
          break;
        }

        case 'relay_status': {
          const input = relayStatusSchema.parse(args);
          result = await handleRelayStatus(client, input);
          break;
        }

        default:
          return {
            content: [
              {
                type: 'text' as const,
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: result,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error executing ${name}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Run the MCP server with stdio transport.
 * This is the main entry point when running as a standalone process.
 */
export async function runMCPServer(client: RelayClient, config?: MCPServerConfig): Promise<void> {
  const server = createMCPServer(client, config);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}
