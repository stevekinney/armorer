import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createArmorer } from '../src/create-armorer';
import { createTool } from '../src/create-tool';
import { createMCP } from '../src/mcp';

describe('Anthropic Agent SDK MCP integration', () => {
  it('accepts an in-process MCP server instance', async () => {
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

    const config = {
      type: 'sdk',
      name: 'armorer-tools',
      instance: mcp,
    } satisfies McpSdkServerConfigWithInstance;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'anthropic-agent-sdk-test', version: '0.0.0' });
    await config.instance.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === 'sum')).toBe(true);
    } finally {
      await client.close();
      await config.instance.close();
    }
  });
});
