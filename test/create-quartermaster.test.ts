import { describe, expect,it } from 'bun:test';
import { z } from 'zod';

import { createQuartermaster } from '../src/create-quartermaster';
import { createTool } from '../src/create-tool';
import type { ToolConfig } from '../src/is-tool';

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

describe('createQuartermaster', () => {
  it('hydrates from serialized configs and executes tools', async () => {
    const qm = createQuartermaster([makeConfiguration()]);

    const result = await qm.execute({
      id: 'abc',
      name: 'sum',
      arguments: { a: 1, b: 2 },
    });
    expect(result.toolCallId).toBe('abc');
    expect(result.toolName).toBe('sum');
    expect(result.result).toBe(3);
  });

  it('serializes registered configs and rehydrates clean copies', async () => {
    const qm = createQuartermaster();
    qm.register(makeConfiguration({ tags: ['math', 'utilities'] }));

    const serialized = qm.toJSON();
    expect(serialized).toHaveLength(1);
    expect(serialized[0]?.name).toBe('sum');
    expect(serialized[0]?.tags).toEqual(['math', 'utilities']);

    // Mutating the serialized tag list does not affect the stored config.
    (serialized[0]?.tags as string[]).push('mutated');
    const tool = qm.getTool('sum');
    expect(tool?.tags).toEqual(['math', 'utilities']);

    const rehydrated = createQuartermaster(serialized);
    const result = await rehydrated.execute({
      id: 'rehydrated',
      name: 'sum',
      arguments: { a: 2, b: 2 },
    });
    expect(result.result).toBe(4);
  });

  it('returns built tools via getTool()', async () => {
    const qm = createQuartermaster();
    qm.register(
      makeConfiguration({
        name: 'bump',
        async execute({ a, b }) {
          return a + b + 1;
        },
      }),
    );
    const tool = qm.getTool('bump');
    expect(tool).toBeDefined();
    const value = await tool!({ a: 1, b: 1 } as any);
    expect(value).toBe(3);
  });

  it('supports registering configs from createTool()', async () => {
    const built = createTool({
      name: 'echo',
      description: 'returns the provided value',
      schema: z.object({ text: z.string() }),
      async execute({ text }) {
        return text;
      },
      tags: ['utility'],
    });
    const qm = createQuartermaster();
    qm.register({
      ...built.toolConfiguration,
      tags: built.tags,
    });
    const result = await qm.execute({
      id: 'echo-1',
      name: 'echo',
      arguments: { text: 'hi' },
    });
    expect(result.result).toBe('hi');
  });

  it('provides robust query support', async () => {
    const qm = createQuartermaster();
    qm.register(
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

    const tagMatches = await qm.query('math');
    expect(tagMatches.map((tool) => tool.name).sort()).toEqual(['double', 'increment']);

    const descriptorMatches = await qm.query({ tags: ['fast'], text: 'double' });
    expect(descriptorMatches.map((tool) => tool.name)).toEqual(['double']);

    const argumentMatches = await qm.query({ argument: 'value' });
    expect(argumentMatches.map((tool) => tool.name)).toEqual(['describe']);

    const schemaMatches = await qm.query(z.object({ a: z.number() }));
    expect(schemaMatches.map((tool) => tool.name).sort()).toEqual(['double', 'increment']);

    const predicateMatches = await qm.query(async (tool) => tool.tags?.includes('text') ?? false);
    expect(predicateMatches.map((tool) => tool.name)).toEqual(['describe']);
  });

  it('returns all tools when no query criteria is provided', async () => {
    const qm = createQuartermaster();
    qm.register(makeConfiguration({ name: 'foo' }), makeConfiguration({ name: 'bar' }));

    const allTools = await qm.query();
    expect(allTools.map((tool) => tool.name).sort()).toEqual(['bar', 'foo']);
  });

  it('returns all tools when query input cannot be parsed', async () => {
    const qm = createQuartermaster();
    qm.register(makeConfiguration({ name: 'alpha' }), makeConfiguration({ name: 'beta' }));

    const results = await qm.query(42 as unknown as any);
    expect(results.map((tool) => tool.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('supports schema descriptors within query objects', async () => {
    const qm = createQuartermaster();
    const schema = z.object({ text: z.string(), flag: z.boolean().optional() });
    qm.register(
      makeConfiguration({
        name: 'writer',
        schema,
        async execute({ text }) {
          return text;
        },
      }),
      makeConfiguration({ name: 'mathy', schema: z.object({ a: z.number() }) }),
    );

    const matches = await qm.query({ schema });
    expect(matches.map((tool) => tool.name)).toEqual(['writer']);
  });

  it('ignores predicate rejections while filtering', async () => {
    const qm = createQuartermaster();
    qm.register(makeConfiguration({ name: 'ok' }), makeConfiguration({ name: 'nope' }));

    const matches = await qm.query(async (tool) => {
      if (tool.name === 'nope') {
        throw new Error('boom');
      }
      return tool.name === 'ok';
    });

    expect(matches.map((tool) => tool.name)).toEqual(['ok']);
  });

  it('handles invalid configs by throwing a helpful error', () => {
    const qm = createQuartermaster();
    expect(() => {
      qm.register({} as any);
    }).toThrow(/ToolConfig/);
    expect(() => {
      qm.register(null as any);
    }).toThrow(/ToolConfig/);
    expect(() => {
      qm.register({
        name: '',
        description: 'ok',
        schema: makeConfiguration().schema,
        execute: async () => {},
      } as any);
    }).toThrow(/ToolConfig/);
    expect(() => {
      qm.register({
        name: 'x',
        description: 42 as any,
        schema: makeConfiguration().schema,
        execute: async () => {},
      } as any);
    }).toThrow(/ToolConfig/);
    expect(() => {
      qm.register({
        name: 'x',
        description: 'ok',
        schema: undefined as any,
        execute: async () => {},
      } as any);
    }).toThrow(/ToolConfig/);
    expect(() => {
      qm.register({
        name: 'x',
        description: 'ok',
        schema: makeConfiguration().schema,
        execute: null as any,
      });
    }).toThrow(/ToolConfig/);
  });

  it('emits lifecycle events for register, call, complete, error, and not-found', async () => {
    const qm = createQuartermaster();
    const events: Record<string, number> = {
      registering: 0,
      registered: 0,
      call: 0,
      complete: 0,
      error: 0,
      'not-found': 0,
    };
    (Object.keys(events) as (keyof typeof events)[]).forEach((type) => {
      qm.addEventListener(type, () => {
        events[type] += 1;
      });
    });

    qm.register(
      makeConfiguration({ name: 'ok' }),
      makeConfiguration({
        name: 'boom',
        async execute() {
          throw new Error('boom');
        },
      }),
    );
    await qm.execute({ id: 'ok-1', name: 'ok', arguments: { a: 1, b: 1 } });
    await qm.execute({ id: 'boom-1', name: 'boom', arguments: { a: 0, b: 0 } });
    await qm.execute({ id: 'missing', name: 'nope', arguments: {} as any });

    expect(events.registering).toBe(2);
    expect(events.registered).toBe(2);
    expect(events.call).toBe(2);
    expect(events.complete).toBe(1);
    expect(events.error).toBe(1);
    expect(events['not-found']).toBe(1);
  });

  it('passes quartermaster context into registered tools', async () => {
    const contexts: any[] = [];
    const qm = createQuartermaster([], {
      context: { workspaceId: 'ws-123', role: 'admin' },
    });
    qm.register({
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

    const res = await qm.execute({ id: 'ctx-1', name: 'ctx', arguments: {} });
    expect(res.result).toBe('ok');
    expect(contexts).toHaveLength(1);
  });

  it('clears listeners when provided signal aborts', async () => {
    const controller = new AbortController();
    const qm = createQuartermaster([], { signal: controller.signal as any });

    let calls = 0;
    qm.addEventListener('call', () => {
      calls += 1;
    });

    controller.abort();

    qm.register(makeConfiguration({ name: 'adder' }));
    await qm.execute({ id: 'adder', name: 'adder', arguments: { a: 1, b: 2 } });
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
    expect(() => createQuartermaster([], { signal: signal as any })).not.toThrow();
  });

  it('allows tools to dispatch status:update events via context.dispatchEvent', async () => {
    const statusUpdates: Array<{
      callId: string;
      name: string;
      status: string;
      percent?: number;
    }> = [];

    const qm = createQuartermaster([], {
      context: { tabId: 42 },
    });

    qm.addEventListener('status:update', (event) => {
      statusUpdates.push(event.detail);
    });

    qm.register({
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

    const result = await qm.execute({
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
    const qm = createQuartermaster([], {
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
    qm.register(makeConfiguration({ name: 'fragile' }));

    const result = await qm.execute({
      id: 'fragile-1',
      name: 'fragile',
      arguments: { a: 1, b: 2 },
    });
    expect(String(result.error)).toContain('kaboom');
  });

  describe('getMissingTools', () => {
    it('returns empty array when all tools are registered', () => {
      const qm = createQuartermaster();
      qm.register(
        makeConfiguration({ name: 'toolA' }),
        makeConfiguration({ name: 'toolB' }),
        makeConfiguration({ name: 'toolC' }),
      );

      const missing = qm.getMissingTools(['toolA', 'toolB', 'toolC']);
      expect(missing).toEqual([]);
    });

    it('returns only the missing tool names when some are not registered', () => {
      const qm = createQuartermaster();
      qm.register(makeConfiguration({ name: 'toolA' }), makeConfiguration({ name: 'toolC' }));

      const missing = qm.getMissingTools(['toolA', 'toolB', 'toolC', 'toolD']);
      expect(missing).toEqual(['toolB', 'toolD']);
    });

    it('returns all tool names when none are registered', () => {
      const qm = createQuartermaster();

      const missing = qm.getMissingTools(['toolA', 'toolB']);
      expect(missing).toEqual(['toolA', 'toolB']);
    });

    it('returns empty array for empty input', () => {
      const qm = createQuartermaster();

      const missing = qm.getMissingTools([]);
      expect(missing).toEqual([]);
    });
  });

  describe('hasAllTools', () => {
    it('returns true when all tools are registered', () => {
      const qm = createQuartermaster();
      qm.register(
        makeConfiguration({ name: 'toolA' }),
        makeConfiguration({ name: 'toolB' }),
        makeConfiguration({ name: 'toolC' }),
      );

      expect(qm.hasAllTools(['toolA', 'toolB', 'toolC'])).toBe(true);
    });

    it('returns true when checking a subset of registered tools', () => {
      const qm = createQuartermaster();
      qm.register(
        makeConfiguration({ name: 'toolA' }),
        makeConfiguration({ name: 'toolB' }),
        makeConfiguration({ name: 'toolC' }),
      );

      expect(qm.hasAllTools(['toolA', 'toolB'])).toBe(true);
    });

    it('returns false when any tool is not registered', () => {
      const qm = createQuartermaster();
      qm.register(makeConfiguration({ name: 'toolA' }), makeConfiguration({ name: 'toolB' }));

      expect(qm.hasAllTools(['toolA', 'toolB', 'toolC'])).toBe(false);
    });

    it('returns false when no tools are registered', () => {
      const qm = createQuartermaster();

      expect(qm.hasAllTools(['toolA'])).toBe(false);
    });

    it('returns true for empty input array', () => {
      const qm = createQuartermaster();

      expect(qm.hasAllTools([])).toBe(true);
    });
  });

  describe('forbiddenTags query', () => {
    it('excludes tools with forbidden tags', async () => {
      const qm = createQuartermaster();
      qm.register(
        makeConfiguration({ name: 'safe-tool', tags: ['safe', 'utility'] }),
        makeConfiguration({ name: 'dangerous-tool', tags: ['destructive', 'utility'] }),
        makeConfiguration({ name: 'another-safe', tags: ['safe'] }),
      );

      const results = await qm.query({ forbiddenTags: ['destructive'] });
      expect(results.map((t) => t.name).sort()).toEqual(['another-safe', 'safe-tool']);
    });

    it('performs case-insensitive forbidden tag matching', async () => {
      const qm = createQuartermaster();
      qm.register(
        makeConfiguration({ name: 'tool-a', tags: ['safe'] }),
        makeConfiguration({ name: 'tool-b', tags: ['destructive'] }),
      );

      // Query with uppercase forbidden tag should still match lowercase tool tag
      const results = await qm.query({ forbiddenTags: ['DESTRUCTIVE'] });
      expect(results.map((t) => t.name)).toEqual(['tool-a']);
    });

    it('combines forbidden tags with other filters', async () => {
      const qm = createQuartermaster();
      qm.register(
        makeConfiguration({ name: 'math-safe', tags: ['math', 'safe'] }),
        makeConfiguration({ name: 'math-dangerous', tags: ['math', 'destructive'] }),
        makeConfiguration({ name: 'text-safe', tags: ['text', 'safe'] }),
      );

      const results = await qm.query({
        tags: ['math'],
        forbiddenTags: ['destructive'],
      });
      expect(results.map((t) => t.name)).toEqual(['math-safe']);
    });
  });

  describe('intentTags query (ranking)', () => {
    it('ranks tools by intent tag matches', async () => {
      const qm = createQuartermaster();
      qm.register(
        makeConfiguration({ name: 'no-match', tags: ['other'] }),
        makeConfiguration({ name: 'one-match', tags: ['math'] }),
        makeConfiguration({ name: 'two-matches', tags: ['math', 'fast'] }),
      );

      const results = await qm.query({ intentTags: ['math', 'fast'] });
      expect(results.map((t) => t.name)).toEqual(['two-matches', 'one-match', 'no-match']);
    });

    it('returns all tools when intentTags is empty', async () => {
      const qm = createQuartermaster();
      qm.register(
        makeConfiguration({ name: 'tool-a', tags: ['alpha'] }),
        makeConfiguration({ name: 'tool-b', tags: ['beta'] }),
      );

      const results = await qm.query({ intentTags: [] });
      expect(results).toHaveLength(2);
    });

    it('combines intentTags ranking with forbidden tags filtering', async () => {
      const qm = createQuartermaster();
      qm.register(
        makeConfiguration({ name: 'best-match', tags: ['math', 'fast', 'destructive'] }),
        makeConfiguration({ name: 'good-match', tags: ['math', 'fast'] }),
        makeConfiguration({ name: 'ok-match', tags: ['math'] }),
      );

      const results = await qm.query({
        intentTags: ['math', 'fast'],
        forbiddenTags: ['destructive'],
      });
      // best-match excluded due to forbidden tag, good-match ranked higher than ok-match
      expect(results.map((t) => t.name)).toEqual(['good-match', 'ok-match']);
    });
  });

  describe('metadata predicate query', () => {
    it('filters by metadata predicate', async () => {
      const qm = createQuartermaster();
      // Note: metadata is set on tools via createTool, but we can test the predicate
      // by verifying the predicate function is called correctly
      qm.register(
        makeConfiguration({ name: 'tool-a', tags: ['test'] }),
        makeConfiguration({ name: 'tool-b', tags: ['test'] }),
      );

      // Since these tools don't have metadata, they will have undefined metadata
      const results = await qm.query({
        metadata: (meta) => meta === undefined,
      });
      expect(results).toHaveLength(2);

      const noResults = await qm.query({
        metadata: (meta) => meta !== undefined && (meta as any).category === 'special',
      });
      expect(noResults).toHaveLength(0);
    });

    it('filters tools with metadata from ToolConfig', async () => {
      const qm = createQuartermaster();
      qm.register(
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

      const premiumResults = await qm.query({
        metadata: (meta) => meta !== undefined && (meta as any).category === 'premium',
      });
      expect(premiumResults.map((t) => t.name)).toEqual(['premium-tool']);

      const tieredResults = await qm.query({
        metadata: (meta) => meta !== undefined && (meta as any).tier <= 1,
      });
      expect(tieredResults.map((t) => t.name)).toEqual(['premium-tool']);

      const undefinedResults = await qm.query({
        metadata: (meta) => meta === undefined,
      });
      expect(undefinedResults.map((t) => t.name)).toEqual(['no-metadata-tool']);
    });

    it('preserves metadata through serialization and rehydration', async () => {
      const qm = createQuartermaster();
      qm.register(
        makeConfiguration({
          name: 'meta-tool',
          metadata: { category: 'special', value: 42 },
        }),
      );

      const serialized = qm.toJSON();
      expect(serialized[0]?.metadata).toEqual({ category: 'special', value: 42 });

      const rehydrated = createQuartermaster(serialized);
      const results = await rehydrated.query({
        metadata: (meta) => meta !== undefined && (meta as any).category === 'special',
      });
      expect(results.map((t) => t.name)).toEqual(['meta-tool']);
    });
  });

  describe('combined query options (backwards compatibility)', () => {
    it('preserves existing query behavior with new options', async () => {
      const qm = createQuartermaster();
      qm.register(
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

      // Original tag query still works
      const tagMatches = await qm.query({ tags: ['math'] });
      expect(tagMatches.map((t) => t.name).sort()).toEqual(['double', 'increment']);

      // Combined with intentTags for ranking
      const rankedMatches = await qm.query({ tags: ['math'], intentTags: ['fast'] });
      expect(rankedMatches.map((t) => t.name)).toEqual(['double', 'increment']);

      // Text search still works
      const textMatches = await qm.query({ text: 'double' });
      expect(textMatches.map((t) => t.name)).toEqual(['double']);
    });
  });
});
