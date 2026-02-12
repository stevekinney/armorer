import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createTool } from '../../../create-tool';
import { createToolbox } from '../../../create-toolbox';
import { createOpenAIToolGate, toOpenAIAgentTools } from './index';

describe('open-ai agents adapter', () => {
  it('creates SDK tools with mutating and dangerous lists', async () => {
    const toolbox = createToolbox([
      createTool({
        name: 'safe-tool',
        description: 'safe',
        schema: z.object({}),
        async execute() {
          return { ok: true };
        },
      }),
      createTool({
        name: 'mutating-tool',
        description: 'mutates',
        schema: z.object({}),
        metadata: { mutates: true },
        async execute() {
          return { ok: true };
        },
      }),
      createTool({
        name: 'dangerous-tool',
        description: 'dangerous',
        schema: z.object({}),
        metadata: { dangerous: true },
        async execute() {
          return { ok: true };
        },
      }),
    ]);

    const { toolNames, mutatingToolNames, dangerousToolNames } =
      await toOpenAIAgentTools(toolbox);

    expect(toolNames).toEqual(['safe-tool', 'mutating-tool', 'dangerous-tool']);
    expect(mutatingToolNames).toEqual(['mutating-tool']);
    expect(dangerousToolNames).toEqual(['dangerous-tool']);
  });

  it('denies mutating and dangerous tools when gated', async () => {
    const toolbox = createToolbox([
      createTool({
        name: 'mutating-tool',
        description: 'mutates',
        schema: z.object({}),
        metadata: { mutates: true },
        async execute() {
          return { ok: true };
        },
      }),
      createTool({
        name: 'dangerous-tool',
        description: 'dangerous',
        schema: z.object({}),
        metadata: { dangerous: true },
        async execute() {
          return { ok: true };
        },
      }),
    ]);

    const gate = createOpenAIToolGate({
      registry: toolbox,
      readOnly: true,
      allowDangerous: false,
    });

    const mutatingDecision = await gate('mutating-tool');
    const dangerousDecision = await gate('dangerous-tool');

    expect(mutatingDecision).toEqual({
      behavior: 'deny',
      message: 'Read-only mode: mutating tools disabled.',
    });
    expect(dangerousDecision).toEqual({
      behavior: 'deny',
      message: 'Use --apply to allow mutating tools.',
    });
  });

  it('allows builtin dangerous tools when allowDangerous is true', async () => {
    const gate = createOpenAIToolGate({
      registry: createToolbox(),
      readOnly: true,
      allowMutation: false,
      allowDangerous: true,
      builtin: { dangerous: ['bash'] },
    });

    const decision = await gate('bash');

    expect(decision).toEqual({ behavior: 'allow' });
  });

  it('uses tags and readOnly metadata to classify tools', async () => {
    const toolbox = createToolbox([
      createTool({
        name: 'tag-mutating',
        description: 'mutating via tag',
        schema: z.object({}),
        tags: ['mutating'],
        async execute() {
          return { ok: true };
        },
      }),
      createTool({
        name: 'tag-readonly',
        description: 'read-only via metadata',
        schema: z.object({}),
        tags: ['mutating'],
        metadata: { readOnly: true },
        async execute() {
          return { ok: true };
        },
      }),
      createTool({
        name: 'tag-dangerous',
        description: 'dangerous via tag',
        schema: z.object({}),
        tags: ['dangerous'],
        async execute() {
          return { ok: true };
        },
      }),
    ]);

    const { mutatingToolNames, dangerousToolNames } = await toOpenAIAgentTools(toolbox);

    expect(mutatingToolNames).toContain('tag-mutating');
    expect(mutatingToolNames).not.toContain('tag-readonly');
    expect(dangerousToolNames).toContain('tag-dangerous');
  });

  it('builds SDK tools with correct structure', async () => {
    const structured = createTool({
      name: 'structured',
      description: 'returns an object',
      schema: z.object({}),
      async execute() {
        return { ok: true };
      },
    });
    const empty = createTool({
      name: 'empty',
      description: 'returns undefined',
      schema: z.object({}),
      async execute() {
        return undefined;
      },
    });
    const stringResult = createTool({
      name: 'string',
      description: 'returns string',
      schema: z.object({}),
      async execute() {
        return 'hello';
      },
    });

    const { tools } = await toOpenAIAgentTools([structured, empty, stringResult]);

    // Check tool structure
    expect(tools[0]!.name).toBe('structured');
    expect(tools[0]!.description).toBe('returns an object');
    expect(tools[0]!.type).toBe('function');
    expect(typeof tools[0]!.invoke).toBe('function');

    expect(tools[1]!.name).toBe('empty');
    expect(tools[2]!.name).toBe('string');
  });

  it('allows unknown tools with gate', async () => {
    const gate = createOpenAIToolGate({
      registry: createToolbox(),
      allowUnknown: true,
    });
    const decision = await gate('mystery');
    expect(decision).toEqual({ behavior: 'allow' });
  });

  it('denies unknown tools by default with custom messages', async () => {
    const gate = createOpenAIToolGate({
      registry: createToolbox(),
      messages: { unknown: (name) => `nope:${name}` },
    });

    const decision = await gate('unknown');
    expect(decision).toEqual({ behavior: 'deny', message: 'nope:unknown' });
  });

  it('rejects invalid tool lists', () => {
    const create = createOpenAIToolGate as unknown as (options: {
      registry: unknown;
    }) => (toolName: string) => Promise<unknown>;
    expect(() => create({ registry: [{}] })).toThrow('Invalid tool input');
  });

  it('handles tool configuration overrides', async () => {
    const tool = createTool({
      name: 'original',
      description: 'original description',
      schema: z.object({ a: z.number() }),
      async execute({ a }) {
        return a * 2;
      },
    });

    const { tools, toolNames } = await toOpenAIAgentTools(tool, {
      toolConfiguration: (t) => ({
        name: `custom_${t.name}`,
        description: `Enhanced: ${t.description}`,
      }),
    });

    expect(toolNames).toEqual(['custom_original']);
    expect(tools[0]!.name).toBe('custom_original');
    expect(tools[0]!.description).toBe('Enhanced: original description');
  });
});
