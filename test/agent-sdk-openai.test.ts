import { MCPServerStdio, MCPServerStreamableHttp } from '@openai/agents';
import { describe, expect, it } from 'bun:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createArmorer } from '../src/create-armorer';
import { createTool } from '../src/create-tool';
import { createMCP } from '../src/mcp';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

const fixturePath = () => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, 'fixtures', 'armorer-mcp-server.ts');
};

describe('OpenAI Agents SDK MCP integration', () => {
  it('lists tools over stdio', async () => {
    const server = new MCPServerStdio({
      command: 'bun',
      args: [fixturePath()],
      name: 'armorer-tools',
      cacheToolsList: true,
    });

    try {
      await server.connect();
      const tools = await server.listTools();
      expect(tools.some((tool) => tool.name === 'sum')).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('lists tools over streamable HTTP', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'sum',
        description: 'adds two numbers',
        schema: z.object({ a: z.number(), b: z.number() }),
        async execute({ a, b }) {
          return a + b;
        },
      },
      armorer,
    );

    const mcp = createMCP(armorer, { serverInfo: { name: 'armorer-tools', version: '0.1.0' } });
    const transport = new WebStandardStreamableHTTPServerTransport();
    await mcp.connect(transport);

    const server = new MCPServerStreamableHttp({
      url: 'http://armorer.local/mcp',
      name: 'armorer-tools',
      cacheToolsList: true,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        return transport.handleRequest(request);
      },
    });

    try {
      await server.connect();
      const tools = await server.listTools();
      expect(tools.some((tool) => tool.name === 'sum')).toBe(true);
    } finally {
      await server.close();
      await mcp.close();
    }
  });
});
