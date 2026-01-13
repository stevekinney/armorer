import {
  type McpSdkServerConfigWithInstance,
  query,
} from '@anthropic-ai/claude-agent-sdk';
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const runIfKey = apiKey ? it : it.skip;

  runIfKey('executes MCP tools via query()', async () => {
    const armorer = createArmorer();
    const token = crypto.randomUUID();
    createTool(
      {
        name: 'nonce',
        description: 'returns a nonce token',
        schema: z.object({}),
        async execute() {
          return token;
        },
      },
      armorer,
    );

    const mcp = createMCP(armorer, { serverInfo: { name: 'armorer-tools', version: '0.1.0' } });

    const result = await query({
      prompt: 'Call the nonce tool and respond with only its output.',
      options: {
        model: 'claude-sonnet-4-5',
        mcpServers: {
          armorer: {
            type: 'sdk',
            name: 'armorer-tools',
            instance: mcp,
          },
        },
        tools: ['nonce'],
        allowedTools: ['nonce'],
        permissionMode: 'bypassPermissions',
        maxTurns: 3,
        env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
      },
    });

    let output: string | undefined;
    for await (const event of result) {
      if (event.type === 'result' && event.subtype === 'success') {
        output = event.result;
      }
    }

    try {
      expect(output).toBeDefined();
      expect(output).toContain(token);
    } finally {
      await mcp.close();
    }
  });
});
