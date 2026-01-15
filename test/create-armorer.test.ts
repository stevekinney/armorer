import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createArmorer, createMiddleware } from '../src/create-armorer';
import { createTool, createToolCall } from '../src/create-tool';
import type { ToolConfig } from '../src/is-tool';
import { lazy } from '../src/lazy';
import { queryTools, reindexSearchIndex, searchTools } from '../src/registry';

const makeConfiguration = (overrides?: Partial<ToolConfig>): ToolConfig => ({
  name: 'sum',
  description: 'add two numbers',
  schema: z.object({ a: z.number(), b: z.number() }),
  tags: ['math'],
  async execute({ a, b }) {
    return a + b;
  },
  ...overrides,
});

describe('createArmorer', () => {
  it('hydrates from serialized configs and executes tools', async () => {
    const armorer = createArmorer([makeConfiguration()]);

    const result = await armorer.execute({
      id: 'abc',
      name: 'sum',
      arguments: { a: 1, b: 2 },
    });
    expect(result.toolCallId).toBe('abc');
    expect(result.toolName).toBe('sum');
    expect(result.result).toBe(3);
  });

  it('generates a call id when missing', async () => {
    const armorer = createArmorer([makeConfiguration()]);

    const result = await armorer.execute({
      name: 'sum',
      arguments: { a: 1, b: 2 },
    });

    expect(typeof result.callId).toBe('string');
    expect(result.callId.length).toBeGreaterThan(0);
    expect(result.toolCallId).toBe(result.callId);
    expect(result.outcome).toBe('success');
    expect(result.content).toBe(3);
  });

  it('supports lazy execute functions in configs', async () => {
    const executePromise = Promise.resolve().then(
      () => async ({ a, b }: { a: number; b: number }) => a + b + 1,
    );
    const armorer = createArmorer([
      makeConfiguration({
        name: 'sum-lazy',
        execute: executePromise,
      }),
    ]);

    const result = await armorer.execute({
      id: 'lazy',
      name: 'sum-lazy',
      arguments: { a: 1, b: 2 },
    });
    expect(result.result).toBe(4);
  });

  it('supports lazy helper in configs', async () => {
    let loads = 0;
    const armorer = createArmorer([
      makeConfiguration({
        name: 'sum-lazy-helper',
        execute: lazy(async () => {
          loads += 1;
          return async ({ a, b }: { a: number; b: number }) => a + b + 1;
        }),
      }),
    ]);

    expect(loads).toBe(0);
    const result = await armorer.execute({
      id: 'lazy-helper',
      name: 'sum-lazy-helper',
      arguments: { a: 1, b: 2 },
    });
    expect(result.result).toBe(4);
    expect(loads).toBe(1);

    const second = await armorer.execute({
      id: 'lazy-helper-2',
      name: 'sum-lazy-helper',
      arguments: { a: 2, b: 2 },
    });
    expect(second.result).toBe(5);
    expect(loads).toBe(1);
  });

  it('returns an error when lazy execute rejects in configs', async () => {
    const armorer = createArmorer([
      makeConfiguration({
        name: 'sum-lazy-fail',
        execute: Promise.resolve().then(() => {
          throw new Error('config lazy load failed');
        }),
      }),
    ]);

    const result = await armorer.execute({
      id: 'lazy-fail',
      name: 'sum-lazy-fail',
      arguments: { a: 1, b: 2 },
    });
    expect(result.error).toContain('config lazy load failed');
  });

  it('passes diagnostics through tool configs', async () => {
    const report = { warnings: [], cost: 1 };
    const hints = [
      {
        path: 'arguments.value',
        message: 'Value must be a string',
        suggestion: 'Provide a string value',
      },
    ];
    const diagnostics = {
      safeParseWithReport: () => ({
        success: false as const,
        error: new Error('bad input'),
        report,
      }),
      createRepairHints: () => hints,
    };

    const armorer = createArmorer([
      makeConfiguration({
        name: 'diagnostic-tool',
        description: 'diagnostics',
        schema: z.object({ value: z.string() }),
        async execute({ value }) {
          return value;
        },
        diagnostics,
      }),
    ]);

    const tool = armorer.getTool('diagnostic-tool')!;
    let captured: any;
    tool.addEventListener('validate-error', (event) => {
      captured = event.detail;
    });

    const result = await tool.execute(
      createToolCall('diagnostic-tool', { value: 123 } as any),
    );

    expect(result.error).toBeDefined();
    expect(captured.report).toEqual(report);
    expect(captured.repairHints).toEqual(hints);
  });

  it('serializes registered configs and rehydrates clean copies', async () => {
    const armorer = createArmorer();
    armorer.register(makeConfiguration({ tags: ['math', 'utilities'] }));

    const serialized = armorer.toJSON();
    expect(serialized).toHaveLength(1);
    expect(serialized[0]?.name).toBe('sum');
    expect(serialized[0]?.tags).toEqual(['math', 'utilities']);

    // Mutating the serialized tag list does not affect the stored config.
    (serialized[0]?.tags as string[]).push('mutated');
    const tool = armorer.getTool('sum');
    expect(tool?.tags).toEqual(['math', 'utilities']);

    const rehydrated = createArmorer(serialized);
    const result = await rehydrated.execute({
      id: 'rehydrated',
      name: 'sum',
      arguments: { a: 2, b: 2 },
    });
    expect(result.result).toBe(4);
  });

  it('returns built tools via getTool()', async () => {
    const armorer = createArmorer();
    armorer.register(
      makeConfiguration({
        name: 'bump',
        async execute({ a, b }) {
          return a + b + 1;
        },
      }),
    );
    const tool = armorer.getTool('bump');
    expect(tool).toBeDefined();
    const value = await tool!({ a: 1, b: 1 } as any);
    expect(value).toBe(3);
  });

  it('supports registering tools from createTool()', async () => {
    const built = createTool({
      name: 'echo',
      description: 'returns the provided value',
      schema: z.object({ text: z.string() }),
      async execute({ text }) {
        return text;
      },
      tags: ['utility'],
    });
    const armorer = createArmorer();
    armorer.register(built);
    const result = await armorer.execute({
      id: 'echo-1',
      name: 'echo',
      arguments: { text: 'hi' },
    });
    expect(result.result).toBe('hi');
  });

  it('creates and registers tools via createTool()', async () => {
    const armorer = createArmorer();
    const tool = armorer.createTool({
      name: 'from-armorer',
      description: 'created via armorer',
      schema: z.object({ value: z.string() }),
      async execute({ value }) {
        return value.toUpperCase();
      },
    });

    expect(armorer.getTool('from-armorer')).toBe(tool);

    const result = await armorer.execute({
      id: 'from-armorer-1',
      name: 'from-armorer',
      arguments: { value: 'hi' },
    });
    expect(result.result).toBe('HI');
  });

  it('createTool supports tags and metadata', () => {
    const armorer = createArmorer();
    const tool = armorer.createTool({
      name: 'tagged',
      description: 'tagged tool',
      schema: z.object({}),
      tags: ['alpha', 'beta'],
      metadata: { tier: 'gold' },
      execute: async () => 'ok',
    });

    expect(tool.tags).toEqual(['alpha', 'beta']);
    expect(tool.metadata).toEqual({ tier: 'gold' });
  });

  it('enforces readOnly for mutating tools', async () => {
    const armorer = createArmorer([], { readOnly: true });
    armorer.register({
      name: 'mutating',
      description: 'mutates',
      schema: z.object({}),
      metadata: { mutates: true },
      execute: async () => 'ok',
    });

    const result = await armorer.execute({
      id: 'mutating-1',
      name: 'mutating',
      arguments: {},
    });

    expect(result.error).toContain('not allowed');
  });

  it('enforces session budgets for max calls', async () => {
    const armorer = createArmorer([], { budget: { maxCalls: 1 } });
    armorer.register({
      name: 'one',
      description: 'budgeted',
      schema: z.object({}),
      execute: async () => 'ok',
    });

    const first = await armorer.execute({
      id: 'call-1',
      name: 'one',
      arguments: {},
    });
    const second = await armorer.execute({
      id: 'call-2',
      name: 'one',
      arguments: {},
    });

    expect(first.result).toBe('ok');
    expect(second.errorCategory).toBe('denied');
    expect(second.error).toContain('Budget exceeded');
  });

  it('enforces session budgets for max duration', async () => {
    const armorer = createArmorer([], { budget: { maxDurationMs: 0 } });
    armorer.register({
      name: 'time',
      description: 'budgeted',
      schema: z.object({}),
      execute: async () => 'ok',
    });

    const result = await armorer.execute({
      id: 'call-1',
      name: 'time',
      arguments: {},
    });

    expect(result.errorCategory).toBe('denied');
    expect(result.error).toContain('Budget exceeded');
  });

  it('createTool accepts object schemas', () => {
    const armorer = createArmorer();
    const tool = armorer.createTool({
      name: 'object-schema',
      description: 'object schema',
      schema: { value: z.string() },
      execute: async ({ value }) => value,
    });

    expect(tool.schema.safeParse({ value: 'ok' }).success).toBe(true);
  });

  it('createTool rejects invalid execute types', () => {
    const armorer = createArmorer();
    expect(() =>
      armorer.createTool({
        name: 'bad-execute',
        description: 'invalid execute type',
        schema: z.object({}),
        execute: 42 as any,
      }),
    ).toThrow('execute must be a function or a promise that resolves to a function');
  });

  it('createTool rejects invalid schema types', () => {
    const armorer = createArmorer();
    expect(() =>
      armorer.createTool({
        name: 'bad-schema',
        description: 'invalid schema type',
        schema: 123 as any,
        execute: async () => null,
      }),
    ).toThrow('Tool schema must be a Zod object schema or an object of Zod schemas');
  });

  it('createTool rejects non-object Zod schemas', () => {
    const armorer = createArmorer();
    expect(() =>
      armorer.createTool({
        name: 'bad-zod-schema',
        description: 'invalid zod schema',
        schema: z.number(),
        execute: async () => null,
      }),
    ).toThrow('Tool schema must be a Zod object schema');
  });

  it('createTool throws when toolFactory returns mismatched name', () => {
    const armorer = createArmorer([], {
      toolFactory: (configuration) =>
        createTool({
          name: `other-${configuration.name}`,
          description: configuration.description,
          schema: configuration.schema,
          execute: async () => null,
        }),
    });

    expect(() =>
      armorer.createTool({
        name: 'mismatch',
        description: 'should fail',
        schema: z.object({}),
        execute: async () => null,
      }),
    ).toThrow('Failed to register tool: mismatch');
  });

  it('defaults schema when using armorer.createTool', async () => {
    const armorer = createArmorer();
    const tool = armorer.createTool({
      name: 'from-armorer-default',
      description: 'default schema',
      execute: async () => 'ok',
    });

    expect(tool.schema.safeParse({}).success).toBe(true);

    const result = await armorer.execute({
      id: 'from-armorer-default-1',
      name: 'from-armorer-default',
      arguments: {},
    });
    expect(result.result).toBe('ok');
  });

  it('returns an error when lazy execute resolves to non-function in configs', async () => {
    const armorer = createArmorer([
      makeConfiguration({
        name: 'sum-lazy-bad',
        execute: Promise.resolve(123 as any),
      }),
    ]);

    const result = await armorer.execute({
      id: 'lazy-bad',
      name: 'sum-lazy-bad',
      arguments: { a: 1, b: 2 },
    });
    expect(result.error).toContain(
      'ToolConfig.execute must be a function or a promise that resolves to a function',
    );
  });

  it('marks registry as completed', () => {
    const armorer = createArmorer();
    expect(armorer.completed).toBe(false);
    armorer.complete();
    expect(armorer.completed).toBe(true);
  });

  it('provides robust query support', () => {
    const armorer = createArmorer();
    armorer.register(
      makeConfiguration({
        name: 'increment',
        description: 'increase by one',
        tags: ['math'],
        async execute({ a }) {
          return a + 1;
        },
        schema: z.object({ a: z.number() }),
      }),
      makeConfiguration({
        name: 'double',
        description: 'double it',
        tags: ['math', 'fast'],
        async execute({ a }) {
          return a * 2;
        },
        schema: z.object({ a: z.number() }),
      }),
      makeConfiguration({
        name: 'describe',
        description: 'describe value',
        tags: ['text'],
        schema: z.object({ value: z.string() }),
        async execute({ value }) {
          return value.toUpperCase();
        },
      }),
    );

    const tagMatches = queryTools(armorer, { tags: { any: ['math'] } });
    expect(tagMatches.map((tool) => tool.name).sort()).toEqual(['double', 'increment']);

    const descriptorMatches = queryTools(armorer, {
      tags: { any: ['fast'] },
      text: 'double',
    });
    expect(descriptorMatches.map((tool) => tool.name)).toEqual(['double']);

    const argumentMatches = queryTools(armorer, { schema: { keys: ['value'] } });
    expect(argumentMatches.map((tool) => tool.name)).toEqual(['describe']);

    const schemaMatches = queryTools(armorer, {
      schema: { matches: z.object({ a: z.number() }) },
    });
    expect(schemaMatches.map((tool) => tool.name).sort()).toEqual(['double', 'increment']);

    const predicateMatches = queryTools(armorer, {
      predicate: (tool) => tool.tags?.includes('text') ?? false,
    });
    expect(predicateMatches.map((tool) => tool.name)).toEqual(['describe']);
  });

  it('supports boolean query groups', () => {
    const armorer = createArmorer();
    armorer.register(
      makeConfiguration({
        name: 'alpha',
        tags: ['math'],
        schema: z.object({ a: z.number() }),
      }),
      makeConfiguration({
        name: 'beta',
        tags: ['text'],
        schema: z.object({ value: z.string() }),
      }),
      makeConfiguration({
        name: 'gamma',
        tags: ['math', 'fast'],
        schema: z.object({ a: z.number(), fast: z.boolean() }),
      }),
    );

    const orMatches = queryTools(armorer, {
      or: [{ tags: { any: ['text'] } }, { tags: { all: ['math', 'fast'] } }],
    });
    expect(orMatches.map((tool) => tool.name).sort()).toEqual(['beta', 'gamma']);

    const notMatches = queryTools(armorer, {
      tags: { any: ['math'] },
      not: { tags: { any: ['fast'] } },
    });
    expect(notMatches.map((tool) => tool.name)).toEqual(['alpha']);
  });

  it('returns all tools when no query criteria is provided', () => {
    const armorer = createArmorer();
    armorer.register(makeConfiguration({ name: 'foo' }), makeConfiguration({ name: 'bar' }));

    const allTools = queryTools(armorer);
    expect(allTools.map((tool) => tool.name).sort()).toEqual(['bar', 'foo']);
  });

  it('supports pagination and selection in queries', () => {
    const armorer = createArmorer();
    armorer.register(
      makeConfiguration({ name: 'alpha' }),
      makeConfiguration({ name: 'beta' }),
      makeConfiguration({ name: 'gamma' }),
    );

    const names = queryTools(armorer, { select: 'name', offset: 1, limit: 1 });
    expect(names).toEqual(['beta']);

    const summaries = queryTools(armorer, { select: 'summary', includeSchema: true });
    expect(summaries[0]?.schema).toBeDefined();
  });

  it('throws when query input is not an object', () => {
    const armorer = createArmorer();
    armorer.register(makeConfiguration({ name: 'alpha' }), makeConfiguration({ name: 'beta' }));

    expect(() => queryTools(armorer, 42 as unknown as any)).toThrow(
      'query expects a ToolQuery object',
    );
  });

  it('supports schema descriptors within query objects', () => {
    const armorer = createArmorer();
    const schema = z.object({ text: z.string(), flag: z.boolean().optional() });
    armorer.register(
      makeConfiguration({
        name: 'writer',
        schema,
        async execute({ text }) {
          return text;
        },
      }),
      makeConfiguration({ name: 'mathy', schema: z.object({ a: z.number() }) }),
    );

    const matches = queryTools(armorer, { schema: { matches: schema } });
    expect(matches.map((tool) => tool.name)).toEqual(['writer']);
  });

  it('ignores predicate errors while filtering', () => {
    const armorer = createArmorer();
    armorer.register(makeConfiguration({ name: 'ok' }), makeConfiguration({ name: 'nope' }));

    const matches = queryTools(armorer, {
      predicate: (tool) => {
        if (tool.name === 'nope') {
          throw new Error('boom');
        }
        return tool.name === 'ok';
      },
    });

    expect(matches.map((tool) => tool.name)).toEqual(['ok']);
  });

  it('handles invalid configs by throwing a helpful error', () => {
    const armorer = createArmorer();
    expect(() => {
      armorer.register({} as any);
    }).toThrow(/ToolConfig/);
    expect(() => {
      armorer.register(null as any);
    }).toThrow(/ToolConfig/);
    expect(() => {
      armorer.register({
        name: '',
        description: 'ok',
        schema: makeConfiguration().schema,
        execute: async () => {},
      } as any);
    }).toThrow(/ToolConfig/);
    expect(() => {
      armorer.register({
        name: 'x',
        description: 42 as any,
        schema: makeConfiguration().schema,
        execute: async () => {},
      } as any);
    }).toThrow(/ToolConfig/);
    expect(() => {
      armorer.register({
        name: 'x',
        description: 'ok',
        schema: undefined as any,
        execute: async () => {},
      } as any);
    }).toThrow(/ToolConfig/);
    expect(() => {
      armorer.register({
        name: 'x',
        description: 'ok',
        schema: makeConfiguration().schema,
        execute: null as any,
      });
    }).toThrow(/ToolConfig/);
  });

  it('emits lifecycle events for register, call, complete, error, and not-found', async () => {
    const armorer = createArmorer();
    const events: Record<string, number> = {
      registering: 0,
      registered: 0,
      call: 0,
      complete: 0,
      error: 0,
      'not-found': 0,
    };
    (Object.keys(events) as (keyof typeof events)[]).forEach((type) => {
      armorer.addEventListener(type, () => {
        events[type] += 1;
      });
    });

    armorer.register(
      makeConfiguration({ name: 'ok' }),
      makeConfiguration({
        name: 'boom',
        async execute() {
          throw new Error('boom');
        },
      }),
    );
    await armorer.execute({ id: 'ok-1', name: 'ok', arguments: { a: 1, b: 1 } });
    await armorer.execute({ id: 'boom-1', name: 'boom', arguments: { a: 0, b: 0 } });
    await armorer.execute({ id: 'missing', name: 'nope', arguments: {} as any });

    expect(events.registering).toBe(2);
    expect(events.registered).toBe(2);
    expect(events.call).toBe(2);
    expect(events.complete).toBe(1);
    expect(events.error).toBe(1);
    expect(events['not-found']).toBe(1);
  });

  it('passes armorer context into registered tools', async () => {
    const contexts: any[] = [];
    const armorer = createArmorer([], {
      context: { workspaceId: 'ws-123', role: 'admin' },
    });
    armorer.register({
      name: 'ctx',
      description: 'ctx aware',
      schema: z.object({}),
      async execute(_params, context) {
        contexts.push(context);
        expect(context.workspaceId).toBe('ws-123');
        expect(context.role).toBe('admin');
        expect(typeof context.dispatchEvent).toBe('function');
        expect(context.toolCall.id).toBe('ctx-1');
        return 'ok';
      },
    });

    const res = await armorer.execute({ id: 'ctx-1', name: 'ctx', arguments: {} });
    expect(res.result).toBe('ok');
    expect(contexts).toHaveLength(1);
  });

  it('clears listeners when provided signal aborts', async () => {
    const controller = new AbortController();
    const armorer = createArmorer([], { signal: controller.signal as any });

    let calls = 0;
    armorer.addEventListener('call', () => {
      calls += 1;
    });

    controller.abort();

    armorer.register(makeConfiguration({ name: 'adder' }));
    await armorer.execute({ id: 'adder', name: 'adder', arguments: { a: 1, b: 2 } });
    expect(calls).toBe(0);
  });

  it('clears listeners immediately when provided signal is already aborted', () => {
    const signal = {
      aborted: true,
      addEventListener() {
        throw new Error('should not add abort listeners');
      },
      removeEventListener() {},
    };
    expect(() => createArmorer([], { signal: signal as any })).not.toThrow();
  });

  it('allows tools to dispatch status:update events via context.dispatchEvent', async () => {
    const statusUpdates: Array<{
      callId: string;
      name: string;
      status: string;
      percent?: number;
    }> = [];

    const armorer = createArmorer([], {
      context: { tabId: 42 },
    });

    armorer.addEventListener('status:update', (event) => {
      statusUpdates.push(event.detail);
    });

    armorer.register({
      name: 'long-task',
      description: 'a task that reports progress',
      schema: z.object({ steps: z.number() }),
      async execute({ steps }, context) {
        for (let i = 1; i <= steps; i++) {
          context.dispatchEvent({
            type: 'status:update',
            detail: {
              callId: context.toolCall.id,
              name: 'long-task',
              status: `Step ${i} of ${steps}`,
              percent: Math.round((i / steps) * 100),
            },
          });
        }
        return { completed: steps };
      },
    });

    const result = await armorer.execute({
      id: 'task-1',
      name: 'long-task',
      arguments: { steps: 3 },
    });

    expect(result.result).toEqual({ completed: 3 });
    expect(statusUpdates).toHaveLength(3);
    expect(statusUpdates[0]).toEqual({
      callId: 'task-1',
      name: 'long-task',
      status: 'Step 1 of 3',
      percent: 33,
    });
    expect(statusUpdates[2]).toEqual({
      callId: 'task-1',
      name: 'long-task',
      status: 'Step 3 of 3',
      percent: 100,
    });
  });

  it('surfaces unexpected tool execution errors as ToolResult errors', async () => {
    const armorer = createArmorer([], {
      toolFactory(configuration, { buildDefaultTool }) {
        const tool = buildDefaultTool(configuration);
        if (configuration.name !== 'fragile') {
          return tool;
        }
        return new Proxy(tool, {
          get(target, prop, receiver) {
            if (prop === 'execute') {
              return () => {
                throw new Error('kaboom');
              };
            }
            return Reflect.get(target as any, prop, receiver);
          },
          apply(target, thisArg, args) {
            return Reflect.apply(target as any, thisArg, args);
          },
        });
      },
    });
    armorer.register(makeConfiguration({ name: 'fragile' }));

    const result = await armorer.execute({
      id: 'fragile-1',
      name: 'fragile',
      arguments: { a: 1, b: 2 },
    });
    expect(String(result.error)).toContain('kaboom');
  });

  describe('getMissingTools', () => {
    it('returns empty array when all tools are registered', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'toolA' }),
        makeConfiguration({ name: 'toolB' }),
        makeConfiguration({ name: 'toolC' }),
      );

      const missing = armorer.getMissingTools(['toolA', 'toolB', 'toolC']);
      expect(missing).toEqual([]);
    });

    it('returns only the missing tool names when some are not registered', () => {
      const armorer = createArmorer();
      armorer.register(makeConfiguration({ name: 'toolA' }), makeConfiguration({ name: 'toolC' }));

      const missing = armorer.getMissingTools(['toolA', 'toolB', 'toolC', 'toolD']);
      expect(missing).toEqual(['toolB', 'toolD']);
    });

    it('returns all tool names when none are registered', () => {
      const armorer = createArmorer();

      const missing = armorer.getMissingTools(['toolA', 'toolB']);
      expect(missing).toEqual(['toolA', 'toolB']);
    });

    it('returns empty array for empty input', () => {
      const armorer = createArmorer();

      const missing = armorer.getMissingTools([]);
      expect(missing).toEqual([]);
    });
  });

  describe('hasAllTools', () => {
    it('returns true when all tools are registered', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'toolA' }),
        makeConfiguration({ name: 'toolB' }),
        makeConfiguration({ name: 'toolC' }),
      );

      expect(armorer.hasAllTools(['toolA', 'toolB', 'toolC'])).toBe(true);
    });

    it('returns true when checking a subset of registered tools', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'toolA' }),
        makeConfiguration({ name: 'toolB' }),
        makeConfiguration({ name: 'toolC' }),
      );

      expect(armorer.hasAllTools(['toolA', 'toolB'])).toBe(true);
    });

    it('returns false when any tool is not registered', () => {
      const armorer = createArmorer();
      armorer.register(makeConfiguration({ name: 'toolA' }), makeConfiguration({ name: 'toolB' }));

      expect(armorer.hasAllTools(['toolA', 'toolB', 'toolC'])).toBe(false);
    });

    it('returns false when no tools are registered', () => {
      const armorer = createArmorer();

      expect(armorer.hasAllTools(['toolA'])).toBe(false);
    });

    it('returns true for empty input array', () => {
      const armorer = createArmorer();

      expect(armorer.hasAllTools([])).toBe(true);
    });
  });

  describe('tag filters', () => {
    it('excludes tools with forbidden tags', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'safe-tool', tags: ['safe', 'utility'] }),
        makeConfiguration({ name: 'dangerous-tool', tags: ['destructive', 'utility'] }),
        makeConfiguration({ name: 'another-safe', tags: ['safe'] }),
      );

      const results = queryTools(armorer, { tags: { none: ['destructive'] } });
      expect(results.map((t) => t.name).sort()).toEqual(['another-safe', 'safe-tool']);
    });

    it('performs case-insensitive tag exclusions', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'tool-a', tags: ['safe'] }),
        makeConfiguration({ name: 'tool-b', tags: ['destructive'] }),
      );

      const results = queryTools(armorer, { tags: { none: ['DESTRUCTIVE'] } });
      expect(results.map((t) => t.name)).toEqual(['tool-a']);
    });

    it('requires all tags when using tags.all', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'math-fast', tags: ['math', 'fast'] }),
        makeConfiguration({ name: 'math-only', tags: ['math'] }),
      );

      const results = queryTools(armorer, { tags: { all: ['math', 'fast'] } });
      expect(results.map((t) => t.name)).toEqual(['math-fast']);
    });
  });

  describe('search ranking', () => {
    it('uses embeddings to match query text when configured', () => {
      const embed = (texts: string[]) =>
        texts.map((text) => {
          const normalized = text.toLowerCase();
          if (normalized.includes('weather') || normalized.includes('forecast')) {
            return [1, 0];
          }
          if (normalized.includes('stocks')) {
            return [0, 1];
          }
          return [0, 0];
        });

      const armorer = createArmorer([], { embed });
      armorer.register(
        makeConfiguration({
          name: 'forecast-tool',
          description: 'daily forecast',
          tags: ['reports'],
        }),
        makeConfiguration({
          name: 'stock-tool',
          description: 'market summary',
          tags: ['finance'],
        }),
      );

      const results = queryTools(armorer, { text: 'weather' });
      expect(results.map((tool) => tool.name)).toEqual(['forecast-tool']);
    });

    it('ranks tools by preferred tags', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'no-match', tags: ['other'] }),
        makeConfiguration({ name: 'one-match', tags: ['math'] }),
        makeConfiguration({ name: 'two-matches', tags: ['math', 'fast'] }),
        makeConfiguration({ name: 'zero-tags', tags: undefined }),
      );

      const results = searchTools(armorer, { rank: { tags: ['math', 'fast'] } });
      expect(results.map((t) => t.tool.name)).toEqual([
        'two-matches',
        'one-match',
        'no-match',
        'zero-tags',
      ]);
      expect(results[0]?.reasons).toContain('tag:math');
    });

    it('applies filters before ranking', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'best', tags: ['math', 'fast', 'destructive'] }),
        makeConfiguration({ name: 'good', tags: ['math', 'fast'] }),
        makeConfiguration({ name: 'ok', tags: ['math'] }),
      );

      const results = searchTools(armorer, {
        filter: { tags: { none: ['destructive'] } },
        rank: { tags: ['math', 'fast'] },
      });
      expect(results.map((t) => t.tool.name)).toEqual(['good', 'ok']);
    });

    it('supports tag boosts', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'standard', tags: ['misc'] }),
        makeConfiguration({ name: 'boosted', tags: ['fast'] }),
      );

      const results = searchTools(armorer, { rank: { tagWeights: { fast: 4 } } });
      expect(results[0]?.tool.name).toBe('boosted');
      expect(results[0]?.reasons).toContain('tag:fast');
    });

    it('supports custom rankers and tie breakers', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'alpha', tags: ['misc'] }),
        makeConfiguration({ name: 'beta', tags: ['misc'] }),
        makeConfiguration({ name: 'preferred', tags: ['misc'] }),
      );

      const results = searchTools(armorer, {
        ranker: (tool) =>
          tool.name === 'preferred' ? { score: 10, reasons: ['custom'] } : { score: 0 },
        tieBreaker: (a, b) => b.tool.name.localeCompare(a.tool.name),
      });

      expect(results[0]?.tool.name).toBe('preferred');
      expect(results[0]?.reasons).toContain('custom');
      expect(results[1]?.tool.name).toBe('beta');
    });

    it('limits results and includes text reasons', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'double', description: 'double it', tags: ['math'] }),
        makeConfiguration({ name: 'increment', description: 'increase by one', tags: ['math'] }),
      );

      const results = searchTools(armorer, { rank: { text: 'double' }, limit: 1 });
      expect(results).toHaveLength(1);
      expect(results[0]?.tool.name).toBe('double');
      expect(results[0]?.reasons).toContain('text:name');
    });

    it('supports selection and pagination in search results', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'alpha', tags: ['misc'] }),
        makeConfiguration({ name: 'beta', tags: ['misc'] }),
        makeConfiguration({ name: 'gamma', tags: ['misc'] }),
      );

      const results = searchTools(armorer, {
        select: 'summary',
        includeSchema: true,
        offset: 1,
        limit: 1,
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.tool.name).toBe('beta');
      expect(results[0]?.tool.schema).toBeDefined();
    });

    it('sorts by name when scores tie', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'beta', tags: ['misc'] }),
        makeConfiguration({ name: 'alpha', tags: ['misc'] }),
      );

      const results = searchTools(armorer);
      expect(results.map((t) => t.tool.name)).toEqual(['alpha', 'beta']);
    });

    it('treats non-finite limits as no limit', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'first', tags: ['misc'] }),
        makeConfiguration({ name: 'second', tags: ['misc'] }),
      );

      const results = searchTools(armorer, { limit: Number.POSITIVE_INFINITY });
      expect(results).toHaveLength(2);
    });

    it('handles empty text ranking input', () => {
      const armorer = createArmorer();
      armorer.register(makeConfiguration({ name: 'alpha', tags: ['misc'] }));

      const results = searchTools(armorer, { rank: { text: '' } });
      expect(results[0]?.score).toBe(0);
      expect(results[0]?.reasons).toEqual([]);
    });

    it('applies ranking weights', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({
          name: 'b-tagged',
          description: 'slow path',
          tags: ['priority'],
          schema: z.object({ value: z.string() }),
        }),
        makeConfiguration({
          name: 'a-text',
          description: 'double output',
          tags: ['other'],
          schema: z.object({ value: z.string() }),
        }),
      );

      const results = searchTools(armorer, {
        rank: { tags: ['priority'], text: 'double', weights: { tags: 2, text: 1 } },
      });
      expect(results[0]?.tool.name).toBe('b-tagged');
    });

    it('ranks by number of matched text tokens', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'one-token', tags: ['alpha'] }),
        makeConfiguration({ name: 'two-token', tags: ['alpha', 'beta'] }),
      );

      const results = searchTools(armorer, { rank: { text: 'alpha beta' } });
      expect(results[0]?.tool.name).toBe('two-token');
    });

    it('respects text field weights', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({
          name: 'summarize',
          description: 'misc',
          tags: [],
        }),
        makeConfiguration({
          name: 'notes',
          description: 'summarize notes',
          tags: [],
        }),
      );

      const results = searchTools(armorer, {
        rank: {
          text: {
            query: 'summarize',
            weights: { name: 2, description: 0.5 },
          },
        },
      });
      expect(results[0]?.tool.name).toBe('summarize');
    });

    it('uses embeddings to rank text matches when configured', () => {
      const embed = (texts: string[]) =>
        texts.map((text) => {
          const normalized = text.toLowerCase();
          if (normalized.includes('weather') || normalized.includes('forecast')) {
            return [1, 0];
          }
          if (normalized.includes('stocks')) {
            return [0, 1];
          }
          return [0, 0];
        });

      const armorer = createArmorer([], { embed });
      armorer.register(
        makeConfiguration({
          name: 'forecast-tool',
          description: 'daily forecast',
        }),
        makeConfiguration({
          name: 'stock-tool',
          description: 'market summary',
        }),
      );

      const results = searchTools(armorer, {
        rank: {
          text: {
            query: 'weather',
            weights: { description: 2, name: 0.1 },
          },
        },
        explain: true,
      });
      expect(results[0]?.tool.name).toBe('forecast-tool');
      expect(results[0]?.reasons).toEqual(
        expect.arrayContaining([expect.stringContaining('embedding:description')]),
      );
      expect(results[0]?.matches?.embedding?.field).toBe('description');
    });

    it('includes tag and schema key text reasons', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({
          name: 'audit-tool',
          description: 'writes events',
          tags: ['audit-log'],
          schema: z.object({ logId: z.string() }),
          metadata: { logId: 'audit' },
        }),
        makeConfiguration({
          name: 'other-tool',
          description: 'unrelated',
          tags: ['misc'],
          schema: z.object({ value: z.string() }),
        }),
      );

      const results = searchTools(armorer, { rank: { text: 'log' }, explain: true });
      expect(results[0]?.tool.name).toBe('audit-tool');
      expect(results[0]?.reasons).toContain('text:tags(audit-log)');
      expect(results[0]?.reasons).toContain('text:schema-keys(logId)');
      expect(results[0]?.reasons).toContain('text:metadata-keys(logId)');
      expect(results[0]?.matches?.fields).toEqual(
        expect.arrayContaining(['tags', 'schemaKeys', 'metadataKeys']),
      );
      expect(results[0]?.matches?.tags).toEqual(['audit-log']);
      expect(results[0]?.matches?.schemaKeys).toEqual(['logId']);
      expect(results[0]?.matches?.metadataKeys).toEqual(['logId']);
    });

    it('reindexes cached search data on demand', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({
          name: 'audit-tool',
          description: 'writes events',
          tags: ['audit'],
          schema: z.object({ eventId: z.string() }),
          metadata: { owner: 'team-a' },
        }),
      );

      const tool = armorer.getTool('audit-tool');
      expect(tool).toBeDefined();

      const initial = searchTools(armorer, { rank: { text: 'trace' }, explain: true });
      expect(initial[0]?.reasons).toEqual([]);
      expect(initial[0]?.matches?.metadataKeys).toBeUndefined();

      const metadata = tool?.metadata as Record<string, unknown>;
      metadata.traceId = 'trace-1';

      const stale = searchTools(armorer, { rank: { text: 'trace' }, explain: true });
      expect(stale[0]?.reasons).toEqual([]);
      expect(stale[0]?.matches?.metadataKeys).toBeUndefined();

      reindexSearchIndex(armorer);

      const refreshed = searchTools(armorer, { rank: { text: 'trace' }, explain: true });
      expect(refreshed[0]?.reasons).toContain('text:metadata-keys(traceId)');
      expect(refreshed[0]?.matches?.metadataKeys).toEqual(['traceId']);
    });

    it('throws when search input is not an object', () => {
      const armorer = createArmorer();
      expect(() => searchTools(armorer, 42 as unknown as any)).toThrow(
        'search expects a ToolSearchOptions object',
      );
    });
  });

  describe('metadata filters', () => {
    it('filters by metadata predicate', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'tool-a', tags: ['test'] }),
        makeConfiguration({ name: 'tool-b', tags: ['test'] }),
      );

      const results = queryTools(armorer, {
        metadata: { predicate: (meta) => meta === undefined },
      });
      expect(results).toHaveLength(2);

      const noResults = queryTools(armorer, {
        metadata: {
          predicate: (meta) => meta !== undefined && (meta as any).category === 'special',
        },
      });
      expect(noResults).toHaveLength(0);
    });

    it('ignores metadata predicate errors', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({
          name: 'safe-meta',
          metadata: { tier: 'gold' },
        }),
        makeConfiguration({
          name: 'boom-meta',
          metadata: { tier: 'silver' },
        }),
      );

      const results = queryTools(armorer, {
        metadata: {
          predicate: (meta) => {
            if ((meta as any)?.tier === 'silver') {
              throw new Error('boom');
            }
            return (meta as any)?.tier === 'gold';
          },
        },
      });
      expect(results.map((t) => t.name)).toEqual(['safe-meta']);
    });

    it('filters tools with metadata eq and has', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({
          name: 'premium-tool',
          tags: ['utility'],
          metadata: { category: 'premium', tier: 1 },
        }),
        makeConfiguration({
          name: 'basic-tool',
          tags: ['utility'],
          metadata: { category: 'basic', tier: 2 },
        }),
        makeConfiguration({
          name: 'no-metadata-tool',
          tags: ['utility'],
        }),
      );

      const premiumResults = queryTools(armorer, {
        metadata: { eq: { category: 'premium' } },
      });
      expect(premiumResults.map((t) => t.name)).toEqual(['premium-tool']);

      const tieredResults = queryTools(armorer, {
        metadata: { has: ['tier'] },
      });
      expect(tieredResults.map((t) => t.name).sort()).toEqual([
        'basic-tool',
        'premium-tool',
      ]);

      const undefinedResults = queryTools(armorer, {
        metadata: { predicate: (meta) => meta === undefined },
      });
      expect(undefinedResults.map((t) => t.name)).toEqual(['no-metadata-tool']);
    });

    it('supports contains, startsWith, and range metadata filters', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({
          name: 'alpha-tool',
          metadata: { owner: 'team-alpha', score: 10, labels: ['fast', 'safe'] },
        }),
        makeConfiguration({
          name: 'beta-tool',
          metadata: { owner: 'team-beta', score: 3, labels: ['safe'] },
        }),
      );

      const containsResults = queryTools(armorer, {
        metadata: { contains: { owner: 'team-' } },
      });
      expect(containsResults.map((t) => t.name).sort()).toEqual([
        'alpha-tool',
        'beta-tool',
      ]);

      const labelResults = queryTools(armorer, {
        metadata: { contains: { labels: 'fast' } },
      });
      expect(labelResults.map((t) => t.name)).toEqual(['alpha-tool']);

      const startsWithResults = queryTools(armorer, {
        metadata: { startsWith: { owner: 'team-a' } },
      });
      expect(startsWithResults.map((t) => t.name)).toEqual(['alpha-tool']);

      const rangeResults = queryTools(armorer, {
        metadata: { range: { score: { min: 5, max: 12 } } },
      });
      expect(rangeResults.map((t) => t.name)).toEqual(['alpha-tool']);
    });

    it('preserves metadata through serialization and rehydration', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({
          name: 'meta-tool',
          metadata: { category: 'special', value: 42 },
        }),
      );

      const serialized = armorer.toJSON();
      expect(serialized[0]?.metadata).toEqual({ category: 'special', value: 42 });

      const rehydrated = createArmorer(serialized);
      const results = queryTools(rehydrated, {
        metadata: { eq: { category: 'special' } },
      });
      expect(results.map((t) => t.name)).toEqual(['meta-tool']);
    });
  });

  describe('combined query options', () => {
    it('supports tags, schema keys, and text together', () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({
          name: 'increment',
          description: 'increase by one',
          tags: ['math'],
          schema: z.object({ a: z.number() }),
        }),
        makeConfiguration({
          name: 'double',
          description: 'double it',
          tags: ['math', 'fast'],
          schema: z.object({ a: z.number() }),
        }),
        makeConfiguration({
          name: 'describe',
          description: 'describe value',
          tags: ['text'],
          schema: z.object({ value: z.string() }),
        }),
      );

      const matches = queryTools(armorer, {
        tags: { any: ['math'], none: ['slow'] },
        schema: { keys: ['a'] },
        text: 'double',
      });
      expect(matches.map((t) => t.name)).toEqual(['double']);
    });
  });

  describe('middleware', () => {
    it('applies synchronous middleware during registration', () => {
      const middleware = (config: ToolConfig) => ({
        ...config,
        description: `[Enhanced] ${config.description}`,
      });

      const armorer = createArmorer([], { middleware: [middleware] });
      armorer.register(makeConfiguration({ name: 'test-tool' }));

      const tool = armorer.getTool('test-tool');
      expect(tool?.description).toBe('[Enhanced] add two numbers');
    });

    it('throws error for async middleware', () => {
      const asyncMiddleware = async (config: ToolConfig) => ({
        ...config,
        description: `[Async] ${config.description}`,
      });

      const armorer = createArmorer([], { middleware: [asyncMiddleware as any] });
      expect(() => armorer.register(makeConfiguration())).toThrow(
        'Async middleware is not supported. Provide synchronous middleware only.',
      );
    });
  });

  describe('tool replacement', () => {
    it('replaces an existing tool when re-registering with same name', () => {
      const armorer = createArmorer();

      armorer.register(
        makeConfiguration({ name: 'calc', execute: async ({ a, b }) => a + b }),
      );
      expect(armorer.getTool('calc')).toBeDefined();

      // Register a replacement tool with the same name
      armorer.register(
        makeConfiguration({ name: 'calc', execute: async ({ a, b }) => a * b }),
      );

      // Should still have exactly one tool
      expect(armorer.tools()).toHaveLength(1);
    });
  });

  describe('createMiddleware helper', () => {
    it('creates a typed middleware function', () => {
      const middleware = createMiddleware((config) => ({
        ...config,
        metadata: { ...config.metadata, enhanced: true },
      }));

      const armorer = createArmorer([], { middleware: [middleware] });
      armorer.register(makeConfiguration({ name: 'test' }));

      const tool = armorer.getTool('test');
      expect(tool?.metadata).toEqual({ enhanced: true });
    });
  });

  describe('multi-tool execution', () => {
    it('executes multiple tools and returns results in order', async () => {
      const armorer = createArmorer();
      armorer.register(
        makeConfiguration({ name: 'add', execute: async ({ a, b }) => a + b }),
        makeConfiguration({ name: 'subtract', execute: async ({ a, b }) => a - b }),
      );

      const results = await armorer.execute([
        { name: 'add', arguments: { a: 10, b: 5 } },
        { name: 'subtract', arguments: { a: 10, b: 5 } },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]?.result).toBe(15);
      expect(results[1]?.result).toBe(5);
    });
  });
});
