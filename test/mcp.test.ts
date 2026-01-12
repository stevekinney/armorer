import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createArmorer } from '../src/create-armorer';
import { createTool } from '../src/create-tool';
import { createMCP } from '../src/mcp';

type ConnectedMcp = {
  client: Client;
  server: ReturnType<typeof createMCP>;
};

const connect = async (armorer: ReturnType<typeof createArmorer>, options = {}) => {
  const server = createMCP(armorer, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'armorer-test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server } satisfies ConnectedMcp;
};

describe('createMCP', () => {
  it('registers armorer tools and exposes them via listTools', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'sum',
        description: 'adds two numbers',
        schema: z.object({ a: z.number(), b: z.number() }),
        metadata: { owner: 'armorer' },
        async execute({ a, b }) {
          return a + b;
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer, {
      toolConfig: (tool) => ({
        title: `${tool.name}-title`,
        outputSchema: z.object({ value: z.number() }),
        meta: { ...tool.metadata, source: 'mcp' },
      }),
    });

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((entry) => entry.name === 'sum');
      expect(tool).toBeDefined();
      expect(tool?.title).toBe('sum-title');
      expect(tool?.description).toBe('adds two numbers');
      expect(tool?.inputSchema.type).toBe('object');
      expect(tool?._meta).toEqual({ owner: 'armorer', source: 'mcp' });
      expect(tool?.outputSchema?.type).toBe('object');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('applies MCP metadata config when provided', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'meta-tool',
        description: 'reads metadata',
        schema: z.object({}),
        metadata: {
          mcp: {
            title: 'meta-title',
            outputSchema: z.object({ ok: z.boolean() }),
            meta: { source: 'metadata' },
          },
        },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer);

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((entry) => entry.name === 'meta-tool');
      expect(tool?.title).toBe('meta-title');
      expect(tool?._meta).toEqual({ source: 'metadata' });
      expect(tool?.outputSchema?.type).toBe('object');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('executes tools and returns structured content when output is an object', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'status',
        description: 'returns a status object',
        schema: z.object({}),
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer);

    try {
      const result = await client.callTool({ name: 'status', arguments: {} });
      expect(result.structuredContent).toEqual({ ok: true });
      expect(result.content?.[0]?.type).toBe('text');
      expect(result.content?.[0]?.text).toContain('"ok": true');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('refreshes tool definitions when a tool is re-registered', async () => {
    const armorer = createArmorer();

    armorer.register({
      name: 'swap',
      description: 'first description',
      schema: z.object({}),
      async execute() {
        return 'first';
      },
    });

    const { client, server } = await connect(armorer);

    try {
      let tools = await client.listTools();
      expect(tools.tools.find((entry) => entry.name === 'swap')?.description).toBe(
        'first description',
      );

      armorer.register({
        name: 'swap',
        description: 'second description',
        schema: z.object({}),
        async execute() {
          return 'second';
        },
      });

      tools = await client.listTools();
      expect(tools.tools.find((entry) => entry.name === 'swap')?.description).toBe(
        'second description',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('registers resources and prompts through registrars', async () => {
    const armorer = createArmorer();

    const { client, server } = await connect(armorer, {
      resources: (mcp) => {
        mcp.registerResource(
          'readme',
          'armorer://readme',
          { title: 'README' },
          async () => ({
            contents: [{ uri: 'armorer://readme', text: 'hello' }],
          }),
        );
      },
      prompts: (mcp) => {
        mcp.registerPrompt('hello', { description: 'say hello' }, async () => ({
          messages: [
            {
              role: 'assistant',
              content: { type: 'text', text: 'hello' },
            },
          ],
        }));
      },
    });

    try {
      const resources = await client.listResources();
      expect(resources.resources.some((entry) => entry.name === 'readme')).toBe(true);

      const prompts = await client.listPrompts();
      expect(prompts.prompts.some((entry) => entry.name === 'hello')).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('marks failures as errors with a text payload', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'explode',
        description: 'throws',
        schema: z.object({}),
        async execute() {
          throw new Error('boom');
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer);

    try {
      const result = await client.callTool({ name: 'explode', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.type).toBe('text');
      expect(result.content?.[0]?.text).toContain('boom');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects the MCP call when the client aborts', async () => {
    const armorer = createArmorer();

    createTool(
      {
        name: 'wait',
        description: 'waits for abort',
        schema: z.object({}),
        async execute() {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { ok: true };
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer);

    try {
      const controller = new AbortController();
      const call = client.callTool(
        { name: 'wait', arguments: {} },
        undefined,
        { signal: controller.signal },
      );
      controller.abort('stop');
      await expect(call).rejects.toBeDefined();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
