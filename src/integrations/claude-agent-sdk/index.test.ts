import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createArmorer } from '../../create-armorer';
import { createTool } from '../../create-tool';
import {
  createClaudeAgentSdkServer,
  createClaudeToolGate,
  toClaudeAgentSdkTools,
} from './index';

describe('claude-agent-sdk adapter', () => {
  it('creates SDK tools with mutating and dangerous lists', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'safe-tool',
        description: 'safe',
        schema: z.object({}),
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );
    createTool(
      {
        name: 'mutating-tool',
        description: 'mutates',
        schema: z.object({}),
        metadata: { mutates: true },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );
    createTool(
      {
        name: 'dangerous-tool',
        description: 'dangerous',
        schema: z.object({}),
        metadata: { dangerous: true },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const { toolNames, mutatingToolNames, dangerousToolNames } =
      await createClaudeAgentSdkServer(armorer, {
        name: 'test-tools',
        version: '0.0.0',
      });

    expect(toolNames).toEqual(['safe-tool', 'mutating-tool', 'dangerous-tool']);
    expect(mutatingToolNames).toEqual(['mutating-tool']);
    expect(dangerousToolNames).toEqual(['dangerous-tool']);
  });

  it('denies mutating and dangerous tools when gated', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'mutating-tool',
        description: 'mutates',
        schema: z.object({}),
        metadata: { mutates: true },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );
    createTool(
      {
        name: 'dangerous-tool',
        description: 'dangerous',
        schema: z.object({}),
        metadata: { dangerous: true },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const gate = createClaudeToolGate({
      registry: armorer,
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
    const gate = createClaudeToolGate({
      registry: createArmorer(),
      readOnly: true,
      allowMutation: false,
      allowDangerous: true,
      builtin: { dangerous: ['bash'] },
    });

    const decision = await gate('bash');

    expect(decision).toEqual({ behavior: 'allow' });
  });

  it('uses tags and readOnly metadata to classify tools', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'tag-mutating',
        description: 'mutating via tag',
        schema: z.object({}),
        tags: ['mutating'],
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );
    createTool(
      {
        name: 'tag-readonly',
        description: 'read-only via metadata',
        schema: z.object({}),
        tags: ['mutating'],
        metadata: { readOnly: true },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );
    createTool(
      {
        name: 'tag-dangerous',
        description: 'dangerous via tag',
        schema: z.object({}),
        tags: ['dangerous'],
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const { mutatingToolNames, dangerousToolNames } = await createClaudeAgentSdkServer(
      armorer,
      {
        name: 'tagged-tools',
        version: '0.0.0',
      },
    );

    expect(mutatingToolNames).toContain('tag-mutating');
    expect(mutatingToolNames).not.toContain('tag-readonly');
    expect(dangerousToolNames).toContain('tag-dangerous');
  });

  it('builds SDK tools that handle structured, empty, and error outputs', async () => {
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
    const bigint = createTool({
      name: 'bigint',
      description: 'returns bigint',
      schema: z.object({}),
      async execute() {
        return 1n;
      },
    });
    const failing = createTool({
      name: 'failing',
      description: 'throws',
      schema: z.object({}),
      async execute() {
        throw new Error('boom');
      },
    });

    const tools = await toClaudeAgentSdkTools([structured, empty, bigint, failing]);

    const structuredResult = await tools[0]!.handler({}, {});
    expect(structuredResult.structuredContent).toEqual({ ok: true });

    const emptyResult = await tools[1]!.handler({}, {});
    expect(emptyResult.content).toEqual([]);

    const bigintResult = await tools[2]!.handler({}, {});
    const bigintContent = bigintResult.content?.[0];
    expect(bigintContent?.type).toBe('text');
    expect((bigintContent as { text: string }).text).toBe('[unserializable]');

    const errorResult = await tools[3]!.handler({}, {});
    expect(errorResult.isError).toBe(true);
    const errorContent = errorResult.content?.[0];
    expect(errorContent?.type).toBe('text');
    expect((errorContent as { text: string }).text).toContain('boom');
  });

  it('uses formatResult overrides and allows unknown tools', async () => {
    const tool = createTool({
      name: 'formatted',
      description: 'formatted output',
      schema: z.object({}),
      async execute() {
        return { ok: true };
      },
    });

    const [sdkTool] = await toClaudeAgentSdkTools(tool, {
      formatResult: () => ({
        content: [{ type: 'text', text: 'formatted' }],
      }),
    });

    const result = await sdkTool!.handler({}, {});
    const formattedContent = result.content?.[0];
    expect(formattedContent?.type).toBe('text');
    expect((formattedContent as { text: string }).text).toBe('formatted');

    const gate = createClaudeToolGate({
      registry: createArmorer(),
      allowUnknown: true,
    });
    const decision = await gate('mystery');
    expect(decision).toEqual({ behavior: 'allow' });
  });

  it('denies unknown tools by default with custom messages', async () => {
    const gate = createClaudeToolGate({
      registry: createArmorer(),
      messages: { unknown: (name) => `nope:${name}` },
    });

    const decision = await gate('unknown');
    expect(decision).toEqual({ behavior: 'deny', message: 'nope:unknown' });
  });

  it('rejects invalid tool lists', () => {
    const create = createClaudeToolGate as unknown as (options: {
      registry: unknown;
    }) => (toolName: string) => Promise<unknown>;
    expect(() => create({ registry: [{}] })).toThrow('Invalid tool input');
  });
});
