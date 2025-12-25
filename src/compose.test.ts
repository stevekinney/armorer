import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { compose, pipe, PipelineError } from './compose';
import { createQuartermaster } from './create-quartermaster';
import { createTool } from './create-tool';

describe('pipe()', () => {
  // Setup test tools
  const parseNumber = createTool({
    name: 'parse-number',
    description: 'Parses a string to a number',
    schema: z.object({ str: z.string() }),
    execute: async ({ str }) => parseInt(str, 10),
  });

  const double = createTool({
    name: 'double',
    description: 'Doubles a number',
    schema: z.number(),
    execute: async (n) => n * 2,
  });

  const stringify = createTool({
    name: 'stringify',
    description: 'Converts number to formatted string',
    schema: z.number(),
    execute: async (n) => `Result: ${n}`,
  });

  const addPrefix = createTool({
    name: 'add-prefix',
    description: 'Adds prefix to string',
    schema: z.string(),
    execute: async (s) => `PREFIX: ${s}`,
  });

  describe('basic functionality', () => {
    it('throws if less than 2 tools provided', () => {
      // Cast to any to bypass TypeScript's compile-time check (overloads require 2+ args)
      const pipeAny = pipe as (...tools: any[]) => any;
      expect(() => pipeAny(parseNumber)).toThrow('pipe() requires at least 2 tools');
    });

    it('creates a tool with composed name', () => {
      const pipeline = pipe(parseNumber, double);
      expect(pipeline.name).toBe('pipe(parse-number, double)');
    });

    it('creates a tool with description showing flow', () => {
      const pipeline = pipe(parseNumber, double);
      expect(pipeline.description).toBe('Composed pipeline: parse-number → double');
    });

    it('uses first tool schema for input validation', () => {
      const pipeline = pipe(parseNumber, double);
      expect(pipeline.schema).toBe(parseNumber.schema);
    });
  });

  describe('execution', () => {
    it('executes 2 tools in sequence', async () => {
      const pipeline = pipe(parseNumber, double);
      const result = await pipeline({ str: '21' });
      expect(result).toBe(42);
    });

    it('executes 3 tools in sequence', async () => {
      const pipeline = pipe(parseNumber, double, stringify);
      const result = await pipeline({ str: '21' });
      expect(result).toBe('Result: 42');
    });

    it('executes 4 tools in sequence', async () => {
      const pipeline = pipe(parseNumber, double, stringify, addPrefix);
      const result = await pipeline({ str: '21' });
      expect(result).toBe('PREFIX: Result: 42');
    });

    it('validates input using first tool schema', async () => {
      const pipeline = pipe(parseNumber, double);
      // Pass wrong type - str should be string, not number
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(
        pipeline({ str: 123 } as unknown as { str: string }),
      ).rejects.toThrow();
    });

    it('validates intermediate results at each step', async () => {
      // Create a tool that returns wrong type
      const badTool = createTool({
        name: 'bad-tool',
        description: 'Returns wrong type',
        schema: z.object({ str: z.string() }),
        execute: async () => 'not a number' as unknown as number,
      });

      const pipeline = pipe(badTool, double);
      // double expects a number, but badTool returns a string
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(pipeline({ str: 'test' })).rejects.toThrow();
    });
  });

  describe('events', () => {
    // Helper to add event listener with any event type (step events are emitted at runtime)
    const addListener = (tool: any, type: string, fn: (e: any) => void) => {
      tool.addEventListener(type, fn);
    };

    it('emits step-start events', async () => {
      const pipeline = pipe(parseNumber, double);
      const events: any[] = [];

      addListener(pipeline, 'step-start', (e) => {
        events.push(e.detail);
      });
      await pipeline({ str: '5' });

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        stepIndex: 0,
        stepName: 'parse-number',
        input: { str: '5' },
      });
      expect(events[1]).toEqual({
        stepIndex: 1,
        stepName: 'double',
        input: 5,
      });
    });

    it('emits step-complete events', async () => {
      const pipeline = pipe(parseNumber, double);
      const events: any[] = [];

      addListener(pipeline, 'step-complete', (e) => {
        events.push(e.detail);
      });
      await pipeline({ str: '5' });

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        stepIndex: 0,
        stepName: 'parse-number',
        output: 5,
      });
      expect(events[1]).toEqual({
        stepIndex: 1,
        stepName: 'double',
        output: 10,
      });
    });

    it('emits step-error event on failure', async () => {
      const failing = createTool({
        name: 'failing',
        description: 'Always fails',
        schema: z.number(),
        execute: async () => {
          throw new Error('boom');
        },
      });

      const pipeline = pipe(parseNumber, failing);
      const errors: any[] = [];
      addListener(pipeline, 'step-error', (e) => {
        errors.push(e.detail);
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(pipeline({ str: '5' })).rejects.toThrow();

      expect(errors).toHaveLength(1);
      expect(errors[0].stepIndex).toBe(1);
      expect(errors[0].stepName).toBe('failing');
      expect(errors[0].error).toBeInstanceOf(Error);
    });
  });

  describe('error handling', () => {
    it('includes step info in error message', async () => {
      const failing = createTool({
        name: 'failing',
        description: 'Always fails',
        schema: z.number(),
        execute: async () => {
          throw new Error('boom');
        },
      });

      const pipeline = pipe(parseNumber, failing);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(pipeline({ str: '5' })).rejects.toThrow(
        'Pipeline failed at step 1 (failing)',
      );
    });

    it('executeWith returns error details', async () => {
      const failing = createTool({
        name: 'failing',
        description: 'Always fails',
        schema: z.number(),
        execute: async () => {
          throw new Error('boom');
        },
      });

      const pipeline = pipe(parseNumber, failing);
      const result = await pipeline.executeWith({ params: { str: '5' } });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Pipeline failed at step 1 (failing)');
    });
  });

  describe('composability', () => {
    it('composed tools can be registered in Quartermaster', () => {
      const pipeline = pipe(parseNumber, double);
      const qm = createQuartermaster().register(pipeline.toolConfiguration);
      const found = qm.getTool('pipe(parse-number, double)');
      expect(found).toBeDefined();
      expect(found?.name).toBe('pipe(parse-number, double)');
    });

    it('composed tools can be further composed', async () => {
      const first = pipe(parseNumber, double);
      const second = pipe(first, stringify);

      const result = await second({ str: '10' });
      expect(result).toBe('Result: 20');
    });

    it('nested pipelines have combined names', () => {
      const first = pipe(parseNumber, double);
      const second = pipe(first, stringify);

      expect(second.name).toBe('pipe(pipe(parse-number, double), stringify)');
    });
  });

  describe('tool interface compatibility', () => {
    it('has required tool properties', () => {
      const pipeline = pipe(parseNumber, double);

      expect(pipeline.name).toBeDefined();
      expect(pipeline.description).toBeDefined();
      expect(pipeline.schema).toBeDefined();
      expect(pipeline.toolConfiguration).toBeDefined();
      expect(typeof pipeline.execute).toBe('function');
      expect(typeof pipeline.addEventListener).toBe('function');
    });

    it('can use executeWith', async () => {
      const pipeline = pipe(parseNumber, double);
      const result = await pipeline.executeWith({
        params: { str: '21' },
      });

      expect(result.result).toBe(42);
      expect(result.toolName).toBe('pipe(parse-number, double)');
    });
  });
});

describe('compose()', () => {
  const increment = createTool({
    name: 'increment',
    description: 'Adds 1',
    schema: z.number(),
    execute: async (n) => n + 1,
  });

  const double = createTool({
    name: 'double',
    description: 'Doubles',
    schema: z.number(),
    execute: async (n) => n * 2,
  });

  const square = createTool({
    name: 'square',
    description: 'Squares',
    schema: z.number(),
    execute: async (n) => n * n,
  });

  it('composes right-to-left', async () => {
    // compose(double, increment) means: first increment, then double
    // Input: 5 -> increment -> 6 -> double -> 12
    const composed = compose(double, increment);
    const result = await composed(5);
    expect(result).toBe(12);
  });

  it('is equivalent to pipe with reversed order', async () => {
    const pipeResult = await pipe(increment, double, square)(5);
    const composeResult = await compose(square, double, increment)(5);

    expect(pipeResult).toEqual(composeResult);
  });

  it('creates tool with correct name', () => {
    const composed = compose(double, increment);
    // After reversing: increment, double
    expect(composed.name).toBe('pipe(increment, double)');
  });
});

describe('PipelineError', () => {
  it('has correct name', () => {
    const error = new PipelineError('test', {
      stepIndex: 0,
      stepName: 'test-step',
      originalError: new Error('original'),
    });

    expect(error.name).toBe('PipelineError');
  });

  it('exposes context', () => {
    const original = new Error('original');
    const error = new PipelineError('test message', {
      stepIndex: 2,
      stepName: 'my-step',
      originalError: original,
    });

    expect(error.message).toBe('test message');
    expect(error.context.stepIndex).toBe(2);
    expect(error.context.stepName).toBe('my-step');
    expect(error.context.originalError).toBe(original);
  });
});

describe('type inference', () => {
  // These tests are primarily compile-time checks
  // If they compile, the type inference is working

  it('infers input type from first tool', async () => {
    const toNumber = createTool({
      name: 'to-number',
      description: 'Parses string to number',
      schema: z.object({ value: z.string() }),
      execute: async ({ value }) => parseInt(value, 10),
    });

    const add10 = createTool({
      name: 'add-10',
      description: 'Adds 10',
      schema: z.number(),
      execute: async (n) => n + 10,
    });

    const pipeline = pipe(toNumber, add10);

    // TypeScript should know this expects { value: string }
    const result = await pipeline({ value: '5' });
    expect(result).toBe(15);
  });

  it('preserves type through multiple steps', async () => {
    interface User {
      id: string;
      name: string;
    }

    interface EnrichedUser extends User {
      enriched: true;
    }

    const fetchUser = createTool({
      name: 'fetch-user',
      description: 'Fetches user by ID',
      schema: z.object({ id: z.string() }),
      execute: async ({ id }): Promise<User> => ({ id, name: 'Test User' }),
    });

    const enrichUser = createTool({
      name: 'enrich-user',
      description: 'Enriches user data',
      schema: z.object({ id: z.string(), name: z.string() }),
      execute: async (user): Promise<EnrichedUser> => ({ ...user, enriched: true }),
    });

    const formatUser = createTool({
      name: 'format-user',
      description: 'Formats user for display',
      schema: z.object({ id: z.string(), name: z.string(), enriched: z.boolean() }),
      execute: async (user) =>
        `User ${user.id}: ${user.name} (enriched: ${user.enriched})`,
    });

    const pipeline = pipe(fetchUser, enrichUser, formatUser);
    const result = await pipeline({ id: 'user-123' });

    expect(result).toBe('User user-123: Test User (enriched: true)');
  });
});
