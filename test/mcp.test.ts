import { PassThrough } from 'node:stream';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createArmorer } from '../src/create-armorer';
import { createTool } from '../src/create-tool';
import { createMCP } from '../src/mcp';

type ConnectedMcp = {
  client: Client;
  server: ReturnType<typeof createMCP>;
};

class LoopbackTransport {
  private readonly readBuffer = new ReadBuffer();
  private readonly onData: (chunk: Buffer) => void;
  private readonly onError: (error: unknown) => void;
  private started = false;

  onmessage?: (message: unknown) => void;
  onclose?: () => void;
  onerror?: (error: unknown) => void;

  constructor(
    private readonly readable: PassThrough,
    private readonly writable: PassThrough,
  ) {
    this.onData = (chunk: Buffer) => {
      this.readBuffer.append(chunk);
      while (true) {
        try {
          const message = this.readBuffer.readMessage();
          if (message === null) break;
          this.onmessage?.(message);
        } catch (error) {
          this.onerror?.(error);
        }
      }
    };
    this.onError = (error: unknown) => {
      this.onerror?.(error);
    };
  }

  async start() {
    if (this.started) {
      throw new Error('LoopbackTransport already started');
    }
    this.started = true;
    this.readable.on('data', this.onData);
    this.readable.on('error', this.onError);
  }

  async close() {
    this.readable.off('data', this.onData);
    this.readable.off('error', this.onError);
    this.readBuffer.clear();
    this.onclose?.();
  }

  send(message: unknown) {
    return new Promise<void>((resolve) => {
      const json = serializeMessage(message);
      if (this.writable.write(json)) {
        resolve();
      } else {
        this.writable.once('drain', resolve);
      }
    });
  }
}

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
            outputSchema: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok'],
              additionalProperties: false,
            },
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

  it('uses tool metadata as _meta when not overridden', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'meta-default',
        description: 'uses metadata by default',
        schema: z.object({}),
        metadata: { owner: 'armorer', scope: 'test' },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer);

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((entry) => entry.name === 'meta-default');
      expect(tool?._meta).toEqual({ owner: 'armorer', scope: 'test' });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('adds readOnlyHint annotation for read-only tools', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'read-only-tool',
        description: 'read-only',
        schema: z.object({}),
        metadata: { readOnly: true },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer);

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((entry) => entry.name === 'read-only-tool');
      expect(tool?.annotations?.readOnlyHint).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('ignores non-object metadata for _meta', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'meta-invalid',
        description: 'metadata is an array',
        schema: z.object({}),
        metadata: [] as unknown as Record<string, unknown>,
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer);

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((entry) => entry.name === 'meta-invalid');
      expect(tool?._meta).toBeUndefined();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('prefers toolConfig over metadata mcp settings', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'override-config',
        description: 'should be overridden',
        schema: z.object({}),
        metadata: {
          mcp: {
            title: 'meta-title',
            description: 'meta-description',
            inputSchema: {
              type: 'object',
              properties: { fromMeta: { type: 'boolean' } },
              required: ['fromMeta'],
              additionalProperties: false,
            },
            outputSchema: {
              type: 'object',
              properties: { meta: { type: 'boolean' } },
              required: ['meta'],
              additionalProperties: false,
            },
            meta: { source: 'metadata' },
          },
        },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer, {
      toolConfig: () => ({
        title: 'override-title',
        description: 'override-description',
        inputSchema: z.object({ fromConfig: z.string() }),
        outputSchema: z.object({ config: z.boolean() }),
        meta: { source: 'config' },
      }),
    });

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((entry) => entry.name === 'override-config');
      expect(tool?.title).toBe('override-title');
      expect(tool?.description).toBe('override-description');
      expect(tool?._meta).toEqual({ source: 'config' });
      expect(tool?.inputSchema?.type).toBe('object');
      expect(tool?.inputSchema?.properties).toHaveProperty('fromConfig');
      expect(tool?.outputSchema?.properties).toHaveProperty('config');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('accepts non-object input schemas via toolConfig without falling back', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'string-input',
        description: 'accepts string input',
        schema: z.object({ fromTool: z.boolean() }),
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer, {
      toolConfig: () => ({
        inputSchema: z.string(),
      }),
    });

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((entry) => entry.name === 'string-input');
      expect(tool?.inputSchema?.type).toBe('object');
      expect(tool?.inputSchema?.properties).not.toHaveProperty('fromTool');
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

  it('handles parallel tool calls', async () => {
    const armorer = createArmorer();
    let calls = 0;
    createTool(
      {
        name: 'echo',
        description: 'echoes the id after a delay',
        schema: z.object({ id: z.number() }),
        async execute({ id }) {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { id };
        },
      },
      armorer,
    );

    const { client, server } = await connect(armorer);

    try {
      const [first, second] = await Promise.all([
        client.callTool({ name: 'echo', arguments: { id: 1 } }),
        client.callTool({ name: 'echo', arguments: { id: 2 } }),
      ]);
      expect(first.structuredContent).toEqual({ id: 1 });
      expect(second.structuredContent).toEqual({ id: 2 });
      expect(calls).toBe(2);
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

  it('supports stdio transports via a loopback pair', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'ping',
        description: 'ping tool',
        schema: z.object({}),
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const server = createMCP(armorer);
    const client = new Client({ name: 'armorer-test-client', version: '0.0.0' });

    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const serverTransport = new StdioServerTransport(clientToServer, serverToClient);
    const clientTransport = new LoopbackTransport(serverToClient, clientToServer);

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.some((entry) => entry.name === 'ping')).toBe(true);
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
      const call = client.callTool({ name: 'wait', arguments: {} }, undefined, {
        signal: controller.signal,
      });
      controller.abort('stop');
      await expect(call).rejects.toBeDefined();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
