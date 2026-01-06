import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { bind, compose, pipe, PipelineError } from './compose';
import { createArmorer } from './create-armorer';
import { createTool } from './create-tool';
import { isTool } from './is-tool';

describe('pipe()', () => {
  // Setup test tools
  const parseNumber = createTool({
    name: 'parse-number',
    description: 'Parses a string to a number',
    schema: z.object({ str: z.string() }),
    execute: async ({ str }) => ({ value: parseInt(str, 10) }),
  });

  const double = createTool({
    name: 'double',
    description: 'Doubles a number',
    schema: z.object({ value: z.number() }),
    execute: async ({ value }) => ({ value: value * 2 }),
  });

  const stringify = createTool({
    name: 'stringify',
    description: 'Converts number to formatted string',
    schema: z.object({ value: z.number() }),
    execute: async ({ value }) => ({ text: `Result: ${value}` }),
  });

  const addPrefix = createTool({
    name: 'add-prefix',
    description: 'Adds prefix to string',
    schema: z.object({ text: z.string() }),
    execute: async ({ text }) => `PREFIX: ${text}`,
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
      expect(result).toEqual({ value: 42 });
    });

    it('executes 3 tools in sequence', async () => {
      const pipeline = pipe(parseNumber, double, stringify);
      const result = await pipeline({ str: '21' });
      expect(result).toEqual({ text: 'Result: 42' });
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
        execute: async () => ({ value: 'not a number' as unknown as number }),
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
        input: { value: 5 },
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
        output: { value: 5 },
      });
      expect(events[1]).toEqual({
        stepIndex: 1,
        stepName: 'double',
        output: { value: 10 },
      });
    });

    it('emits step-error event on failure', async () => {
      const failing = createTool({
        name: 'failing',
        description: 'Always fails',
        schema: z.object({ value: z.number() }),
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
        schema: z.object({ value: z.number() }),
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
        schema: z.object({ value: z.number() }),
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
    it('composed tools can be registered in Armorer', () => {
      const pipeline = pipe(parseNumber, double);
      const armorer = createArmorer().register(pipeline);
      const found = armorer.getTool('pipe(parse-number, double)');
      expect(found).toBeDefined();
      expect(found?.name).toBe('pipe(parse-number, double)');
    });

    it('composed tools can be further composed', async () => {
      const first = pipe(parseNumber, double);
      const second = pipe(first, stringify);

      const result = await second({ str: '10' });
      expect(result).toEqual({ text: 'Result: 20' });
    });

    it('nested pipelines have combined names', () => {
      const first = pipe(parseNumber, double);
      const second = pipe(first, stringify);

      expect(second.name).toBe('pipe(pipe(parse-number, double), stringify)');
    });
  });

  describe('tool interface surface', () => {
    it('has required tool properties', () => {
      const pipeline = pipe(parseNumber, double);

      expect(isTool(pipeline)).toBe(true);
      expect(pipeline.name).toBeDefined();
      expect(pipeline.description).toBeDefined();
      expect(pipeline.schema).toBeDefined();
      expect(pipeline.configuration).toBeDefined();
      expect(typeof pipeline.execute).toBe('function');
      expect(typeof pipeline.addEventListener).toBe('function');
    });

    it('can use executeWith', async () => {
      const pipeline = pipe(parseNumber, double);
      const result = await pipeline.executeWith({
        params: { str: '21' },
      });

      expect(result.result).toEqual({ value: 42 });
      expect(result.toolName).toBe('pipe(parse-number, double)');
    });
  });
});

describe('compose()', () => {
  const increment = createTool({
    name: 'increment',
    description: 'Adds 1',
    schema: z.object({ value: z.number() }),
    execute: async ({ value }) => ({ value: value + 1 }),
  });

  const double = createTool({
    name: 'double',
    description: 'Doubles',
    schema: z.object({ value: z.number() }),
    execute: async ({ value }) => ({ value: value * 2 }),
  });

  const square = createTool({
    name: 'square',
    description: 'Squares',
    schema: z.object({ value: z.number() }),
    execute: async ({ value }) => ({ value: value * value }),
  });

  it('composes right-to-left', async () => {
    // compose(double, increment) means: first increment, then double
    // Input: 5 -> increment -> 6 -> double -> 12
    const composed = compose(double, increment);
    const result = await composed({ value: 5 });
    expect(result).toEqual({ value: 12 });
  });

  it('is equivalent to pipe with reversed order', async () => {
    const pipeResult = await pipe(increment, double, square)({ value: 5 });
    const composeResult = await compose(square, double, increment)({ value: 5 });

    expect(pipeResult).toEqual(composeResult);
  });

  it('creates tool with correct name', () => {
    const composed = compose(double, increment);
    // After reversing: increment, double
    expect(composed.name).toBe('pipe(increment, double)');
  });

  it('returns a valid tool instance', () => {
    const composed = compose(double, increment);
    expect(isTool(composed)).toBe(true);
    expect(composed.configuration).toBeDefined();
    expect(typeof composed.execute).toBe('function');
  });
});

describe('bind()', () => {
  const sum = createTool({
    name: 'sum',
    description: 'Adds two numbers',
    schema: z.object({ a: z.number(), b: z.number() }),
    execute: async ({ a, b }) => a + b,
  });

  it('binds object parameters and requires remaining inputs', async () => {
    const addOne = bind(sum, { a: 1 }, { name: 'add-one' });
    expect(isTool(addOne)).toBe(true);
    expect(addOne.name).toBe('add-one');
    expect(addOne.schema.safeParse({ b: 2 }).success).toBe(true);
    expect(addOne.schema.safeParse({}).success).toBe(false);
    const result = await addOne({ b: 2 });
    expect(result).toBe(3);
  });

  it('throws when binding unknown keys', () => {
    expect(() => bind(sum, { c: 1 } as any)).toThrow(/unknown keys/);
  });

  it('throws when binding non-object to object schema', () => {
    expect(() => bind(sum, 1 as any)).toThrow(/expects an object/);
  });

  it('throws when binding a tool with a non-object schema', () => {
    const rawTool = async function rawTool(params: number) {
      return params;
    };
    (rawTool as any).description = 'raw-number';
    (rawTool as any).schema = z.number();
    (rawTool as any).tags = [];
    (rawTool as any).metadata = undefined;

    expect(() => bind(rawTool as any, {} as any)).toThrow(/object schema/);
  });

  it('throws when schema does not support omit', () => {
    const schemaWithoutOmit = {
      shape: { a: z.string(), b: z.number() },
    };
    const rawTool = async function rawTool(params: { a: string; b: number }) {
      return params;
    };
    (rawTool as any).description = 'raw';
    (rawTool as any).schema = schemaWithoutOmit;
    (rawTool as any).tags = [];
    (rawTool as any).metadata = undefined;

    expect(() => bind(rawTool as any, { a: 'ok' }, { name: 'raw-bound' })).toThrow(
      /Zod object schema/,
    );
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
      execute: async ({ value }) => ({ value: parseInt(value, 10) }),
    });

    const add10 = createTool({
      name: 'add-10',
      description: 'Adds 10',
      schema: z.object({ value: z.number() }),
      execute: async ({ value }) => ({ value: value + 10 }),
    });

    const pipeline = pipe(toNumber, add10);

    // TypeScript should know this expects { value: string }
    const result = await pipeline({ value: '5' });
    expect(result).toEqual({ value: 15 });
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
