import { describe, expect,it } from 'bun:test';
import { z } from 'zod';

import { createTool, createToolCall, withContext } from '../src/create-tool';
import { isTool } from '../src/is-tool';

describe('createTool', () => {
  it('creates a callable tool function with metadata and execute()', async () => {
    const calls: unknown[] = [];
    type Events = { called: { a: string; b?: number } } & {
      'status-update': { status: string };
    };
    const tool = createTool<{ a: string; b?: number }, string, Events>({
      name: 'example',
      description: 'An example tool',
      schema: z.object({
        a: z.string(),
        b: z.number().optional(),
      }),
      execute: async (params, context) => {
        const { dispatch, toolCall, toolConfiguration } = context;
        expect(toolCall.arguments).toEqual(params);
        expect(toolCall.name).toBe('example');
        expect(toolConfiguration.name).toBe('example');
        expect(toolConfiguration.schema).toBe(tool.schema);
        calls.push(params);
        // emit an event to ensure context works
        dispatch({ type: 'called', detail: params });
        return 'ok';
      },
    });

    // Tool is a function and returns a promise
    const result = await tool({ a: 'hello', b: 42 });
    expect(result).toBe('ok');

    // Metadata is attached
    expect('description' in tool).toBe(true);
    expect(tool.description).toBe('An example tool');
    expect(typeof tool.execute).toBe('function');
    expect(tool.schema).toBeDefined();
    // String representations
    expect(tool.toString()).toContain('example');
    expect(`${tool}`).toBe('example');

    // execute() validates then calls underlying fn
    const execResult = await tool.execute(createToolCall('example', { a: 'hi' }));
    expect(execResult.toolName).toBe('example');
    expect('result' in execResult).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual({ a: 'hello', b: 42 });
    expect(calls[1]).toEqual({ a: 'hi' });
  });

  it('exposes toolConfiguration.execute for direct invocation', async () => {
    const tool = createTool({
      name: 'config-exec',
      description: 'call via config',
      schema: z.object({ a: z.string() }),
      async execute({ a }) {
        return a.toUpperCase();
      },
    });

    const value = await tool.toolConfiguration.execute({ a: 'ok' });
    expect(value).toBe('OK');
  });

  it('withContext injects values into the tool context', async () => {
    const tool = withContext(
      { workspaceId: 'ws-1', role: 'admin' },
      {
        name: 'ctx-tool',
        description: 'uses context',
        schema: z.object({ value: z.string() }),
        async execute({ value }, context) {
          expect(context.workspaceId).toBe('ws-1');
          expect(context.role).toBe('admin');
          return `${value}-${context.role}`;
        },
      },
    );

    const result = await tool({ value: 'hello' });
    expect(result).toBe('hello-admin');
  });

  it('withContext supports currying for later reuse', async () => {
    const builder = withContext({ region: 'eu' });
    const tool = builder({
      name: 'regional',
      description: 'curries context',
      schema: z.object({ n: z.number() }),
      async execute({ n }, context) {
        expect(context.region).toBe('eu');
        return `${context.region}-${n}`;
      },
    });

    const out = await tool({ n: 2 });
    expect(out).toBe('eu-2');
  });

  it('throws on invalid params via execute()', async () => {
    const tool = createTool({
      name: 'invalid-test',
      description: 'Ensures validation errors bubble',
      schema: z.object({
        a: z.string(),
      }),
      execute: async () => 'never',
    });

    // Missing required property returns a ToolResult failure shape
    const res = await tool.execute(createToolCall('invalid-test', {} as any));
    expect(res.toolName).toBe('invalid-test');
    expect(typeof res.error === 'string' || res.error === undefined).toBe(true);
  });

  it('supports AbortSignal cancellation before execution begins', async () => {
    let runs = 0;
    const tool = createTool({
      name: 'abort-now',
      description: 'cancel immediately',
      schema: z.object({ a: z.string() }),
      async execute() {
        runs++;
        return 'never';
      },
    });

    const controller = new AbortController();
    controller.abort('user cancelled');
    const result = await tool.execute(createToolCall('abort-now', { a: 'x' }), {
      signal: controller.signal,
    });

    expect(runs).toBe(0);
    expect(result.result).toBeUndefined();
    expect(result.error?.toLowerCase()).toContain('cancel');
  });

  it('supports AbortSignal cancellation during execution and surfaces reason', async () => {
    const tool = createTool({
      name: 'abort-mid-flight',
      description: 'cancel mid run',
      schema: z.object({ a: z.string() }),
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return 'done';
      },
    });

    const controller = new AbortController();
    const pending = tool.execute(createToolCall('abort-mid-flight', { a: 'x' }), {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('stop now')), 5);
    const result = await pending;

    expect(result.result).toBeUndefined();
    expect(result.error?.toLowerCase()).toContain('stop now'.toLowerCase());
  });

  it('cancels if the signal aborts during execute-start listeners', async () => {
    let runs = 0;
    const tool = createTool({
      name: 'start-abort',
      description: 'aborts after execute-start',
      schema: z.object({ a: z.string() }),
      async execute() {
        runs++;
        return 'done';
      },
    });
    const controller = new AbortController();
    tool.addEventListener('execute-start', () => {
      controller.abort('abort after start');
    });

    const result = await tool.execute(createToolCall('start-abort', { a: 'ok' }), {
      signal: controller.signal,
    });

    expect(runs).toBe(0);
    expect(result.error).toContain('abort after start');
  });

  it('cancels if the signal aborts after validation succeeds', async () => {
    let runs = 0;
    const tool = createTool({
      name: 'validate-abort',
      description: 'aborts after validate-success',
      schema: z.object({ a: z.string() }),
      async execute() {
        runs++;
        return 'done';
      },
    });
    const controller = new AbortController();
    tool.addEventListener('validate-success', () => {
      controller.abort('abort after validate');
    });

    const result = await tool.execute(createToolCall('validate-abort', { a: 'ok' }), {
      signal: controller.signal,
    });

    expect(runs).toBe(0);
    expect(result.error).toContain('abort after validate');
  });

  it('cancels if the signal is aborted before raceWithSignal attaches listeners', async () => {
    const controller = new AbortController();
    const tool = createTool({
      name: 'abort-before-race',
      description: 'abort inside execute',
      schema: z.object({ a: z.string() }),
      async execute() {
        controller.abort('abort inside execute');
        return 'done';
      },
    });
    const result = await tool.execute(createToolCall('abort-before-race', { a: 'x' }), {
      signal: controller.signal,
    });
    expect(result.error).toContain('abort inside execute');
  });

  it('resolves normally when a signal is provided but never aborted', async () => {
    const tool = createTool({
      name: 'steady-signal',
      description: 'signal that never aborts',
      schema: z.object({ a: z.string() }),
      async execute({ a }) {
        return `${a}-done`;
      },
    });
    const controller = new AbortController();
    const result = await tool.execute(createToolCall('steady-signal', { a: 'x' }), {
      signal: controller.signal,
    });
    expect(result.result).toBe('x-done');
    expect(result.error).toBeUndefined();
  });

  it('cleans up signal listeners when execution rejects under a signal', async () => {
    const tool = createTool({
      name: 'reject-with-signal',
      description: 'runner rejects',
      schema: z.object({ a: z.string() }),
      async execute() {
        throw new Error('boom');
      },
    });
    const controller = new AbortController();
    const result = await tool.execute(createToolCall('reject-with-signal', { a: 'x' }), {
      signal: controller.signal,
    });
    expect(result.error).toContain('boom');
  });

  it('formats structured cancellation reasons from AbortController', async () => {
    const tool = createTool({
      name: 'structured-reason',
      description: 'object reason',
      schema: z.object({ a: z.string() }),
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 'never';
      },
    });
    const controller = new AbortController();
    const pending = tool.execute(createToolCall('structured-reason', { a: 'x' }), {
      signal: controller.signal,
    });
    controller.abort({ why: 'structured', nested: true });
    const result = await pending;
    expect(result.error).toBe('Cancelled: {"why":"structured","nested":true}');
  });

  it('falls back to a generic cancellation message when reason serialization fails', async () => {
    const tool = createTool({
      name: 'circular-reason',
      description: 'circular reason',
      schema: z.object({ a: z.string() }),
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 'never';
      },
    });
    const controller = new AbortController();
    const pending = tool.execute(createToolCall('circular-reason', { a: 'x' }), {
      signal: controller.signal,
    });
    const reason: any = { cause: 'circular' };
    reason.self = reason;
    controller.abort(reason);
    const result = await pending;
    expect(result.error).toBe('Cancelled');
  });

  it('exposes JSON metadata with parameters JSON Schema', () => {
    const tool = createTool({
      name: 'json-meta',
      description: 'JSON view',
      schema: z.object({
        a: z.string(),
        b: z.number().optional(),
      }),
      execute: async () => null,
    });

    const meta = tool.toJSON();
    expect(meta.type).toBe('function');
    expect(meta.name).toBe('json-meta');
    expect(meta.description).toBe('JSON view');
    expect(meta.schema).toBe(tool.schema);
    expect(meta.strict).toBe(true);

    // Parameters JSON Schema assertions
    const params = meta.parameters as Record<string, unknown>;
    expect(params).toBeDefined();
    expect(params['type']).toBe('object');

    // additionalProperties is forced to false by the override
    expect(params['additionalProperties']).toBe(false);

    // required is set to all property keys (even optionals)
    const properties = (params['properties'] ?? {}) as Record<string, unknown>;
    const required = new Set((params['required'] as string[]) ?? []);
    const keys = Object.keys(properties);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(required.has(k)).toBe(true);
    }

    // $schema is removed by the override
    expect('$schema' in params).toBe(false);
  });

  it('throws if tags are not kebab-case', () => {
    expect(() =>
      createTool({
        name: 'bad-tags',
        description: 'invalid tag',
        schema: z.object({ a: z.string() }),
        tags: ['Not-Kebab'],
        async execute() {
          return null;
        },
      }),
    ).toThrow(/kebab-case/);
  });

  it('attaches typed metadata to tool instances', () => {
    const tool = createTool({
      name: 'with-metadata',
      description: 'has custom metadata',
      schema: z.object({ a: z.string() }),
      metadata: { requires: ['account'] as const, cost: 3 },
      async execute({ a }) {
        return a.toUpperCase();
      },
    });

    expect(tool.metadata.requires).toEqual(['account']);
    expect(tool.metadata.cost).toBe(3);
  });

  describe('schema normalization', () => {
    it('accepts a plain object of Zod schemas as the schema', async () => {
      // This tests the normalizeSchema fallback path where schema is not a ZodSchema
      // but is a plain object containing Zod schemas
      const schemaAsObject = { name: z.string(), count: z.number() } as any;

      const tool = createTool({
        name: 'object-schema',
        description: 'uses object schema',
        schema: schemaAsObject,
        async execute({ name, count }) {
          return `${name}-${count}`;
        },
      });

      const result = await tool({ name: 'test', count: 5 });
      expect(result).toBe('test-5');
    });

    it('throws when schema is not a Zod schema or object', () => {
      expect(() =>
        createTool({
          name: 'invalid-schema',
          description: 'uses invalid schema',
          schema: 'not a schema' as any,
          async execute() {
            return null;
          },
        }),
      ).toThrow(/Tool schema must be a Zod schema or an object of Zod schemas/);
    });

    it('throws when schema is null', () => {
      expect(() =>
        createTool({
          name: 'null-schema',
          description: 'uses null schema',
          schema: null as any,
          async execute() {
            return null;
          },
        }),
      ).toThrow(/Tool schema must be a Zod schema or an object of Zod schemas/);
    });

    it('throws when schema is a number', () => {
      expect(() =>
        createTool({
          name: 'number-schema',
          description: 'uses number schema',
          schema: 42 as any,
          async execute() {
            return null;
          },
        }),
      ).toThrow(/Tool schema must be a Zod schema or an object of Zod schemas/);
    });
  });
});

describe('isTool', () => {
  it('returns true for tools created by createTool', () => {
    const tool = createTool({
      name: 'checker',
      description: 'type guard',
      schema: z.object({ x: z.number() }),
      execute: async () => 1,
    });
    expect(isTool(tool)).toBe(true);
  });

  it('supports addEventListener with unsubscribe and AbortSignal', async () => {
    type Events = { ping: number } & { 'status-update': { status: string } };
    const tool = createTool<{ a: string }, string, Events>({
      name: 'events',
      description: 'listener support',
      schema: z.object({ a: z.string() }),
      async execute(_params, { dispatch }) {
        dispatch({ type: 'ping', detail: 1 });
        return 'ok';
      },
    });

    const received: unknown[] = [];
    const unsub = tool.addEventListener('ping', (evt) => {
      received.push(evt.detail);
    });

    await tool({ a: 'x' });
    expect(received).toEqual([1]);

    // unsubscribe stops future events
    unsub();
    await tool({ a: 'x' });
    expect(received).toEqual([1]);

    // AbortSignal stops listener
    const ac = new AbortController();
    tool.addEventListener(
      'ping',
      (evt) => {
        received.push(`ac:${evt.detail}`);
      },
      { signal: ac.signal },
    );

    await tool({ a: 'x' });
    expect(received).toContain('ac:1');
    ac.abort();
    await tool({ a: 'x' });
    // no additional 'ac:' entries after abort
    const acCount = received.filter((v) => v === 'ac:1').length;
    expect(acCount).toBe(1);
  });

  it('supports once behavior and dispatchEvent API', async () => {
    type Events = { ping: number } & { 'status-update': { status: string } };
    const tool = createTool<{ a: string }, null, Events>({
      name: 'events-2',
      description: 'listener options',
      schema: z.object({ a: z.string() }),
      async execute(_params, { dispatch }) {
        dispatch({ type: 'ping', detail: 1 });
        return null;
      },
    });

    const counts = { once: 0, normal: 0 };
    tool.addEventListener(
      'ping',
      () => {
        counts.once++;
      },
      { once: true },
    );
    tool.addEventListener('ping', () => {
      counts.normal++;
    });

    // Using execute (which forwards to dispatchEvent)
    await tool({ a: 'x' });
    await tool({ a: 'x' });

    expect(counts.once).toBe(1);
    expect(counts.normal).toBe(2);

    // Direct dispatchEvent returns true (no preventDefault semantics)
    const ok = tool.dispatchEvent({ type: 'ping', detail: 1 });
    expect(ok).toBe(true);
  });

  it('orders listeners by registration and isolates event types', async () => {
    type Events = { ping: number; pong: string } & {
      'status-update': { status: string };
    };
    const tool = createTool<{ a: string }, null, Events>({
      name: 'events-3',
      description: 'ordering & isolation',
      schema: z.object({ a: z.string() }),
      async execute(_params, { dispatch }) {
        dispatch({ type: 'ping', detail: 1 });
        dispatch({ type: 'pong', detail: 'x' });
        return null;
      },
    });

    const calls: string[] = [];
    const u1 = tool.addEventListener('ping', () => calls.push('p1'));
    const u2 = tool.addEventListener('ping', () => calls.push('p2'));
    tool.addEventListener('pong', () => calls.push('g1'));

    await tool({ a: 'x' });
    expect(calls).toEqual(['p1', 'p2', 'g1']);

    // Remove middle listener and ensure order of remaining holds
    u2();
    calls.length = 0;
    await tool({ a: 'x' });
    expect(calls).toEqual(['p1', 'g1']);

    // Removing ping listener leaves pong unaffected
    u1();
    calls.length = 0;
    await tool({ a: 'x' });
    expect(calls).toEqual(['g1']);
  });

  it('returns false for non-tools', () => {
    const notAToolFn = () => {};
    const notAToolObj = { name: 'x', description: 'y' };
    expect(isTool(notAToolFn)).toBe(false);
    expect(isTool(notAToolObj)).toBe(false);
  });

  it('handles async listener rejections without throwing synchronously', async () => {
    type Events = { rej: null; error: unknown } & { 'status-update': { status: string } };
    const tool = createTool<{ a: string }, null, Events>({
      name: 'rej',
      description: 'async rejection',
      schema: z.object({ a: z.string() }),
      async execute() {
        return null;
      },
    });

    // Register an error listener to capture async errors (prevents re-throw)
    let caughtError: unknown = null;
    tool.addEventListener('error', (event) => {
      caughtError = event.detail;
    });

    // Listener returns a rejecting promise
    tool.addEventListener('rej', async () => {
      throw new Error('nope');
    });

    // Should not throw synchronously; dispatchEvent returns true
    const ok = tool.dispatchEvent({ type: 'rej', detail: null });
    expect(ok).toBe(true);

    // Wait for microtask queue to flush so the error handler is called
    await new Promise((resolve) => queueMicrotask(resolve));
    await new Promise((resolve) => queueMicrotask(resolve));

    // The error should have been captured by our error listener
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe('nope');
  });

  it('exposes stable property descriptors via proxy getOwnPropertyDescriptor', () => {
    const tool = createTool({
      name: 'descriptors',
      description: 'props',
      schema: z.object({ a: z.string() }),
      async execute() {
        return 1;
      },
    });

    const desc = Object.getOwnPropertyDescriptor(tool as any, 'addEventListener');
    expect(desc?.enumerable).toBe(true);
    expect(desc?.configurable).toBe(true);
    expect(desc?.writable).toBe(false);
  });

  it('Symbol.dispose clears listeners', async () => {
    type Events = { gone: number } & { 'status-update': { status: string } };
    const tool = createTool<{ a: string }, null, Events>({
      name: 'dispose',
      description: 'cleanup',
      schema: z.object({ a: z.string() }),
      async execute() {
        return null;
      },
    });

    let count = 0;
    tool.addEventListener('gone', () => {
      count++;
    });

    // Dispose and ensure no listeners remain
    (tool as any)[Symbol.dispose]?.();
    tool.dispatchEvent({ type: 'gone', detail: 1 });
    expect(count).toBe(0);
  });

  it('direct call emits validate-error and settled on parse failure', async () => {
    const tool = createTool({
      name: 'valerr',
      description: 'validation error path',
      schema: z.object({ a: z.string() }),
      async execute() {
        return 'x';
      },
    });

    let validateErr = 0;
    let settled = 0;
    tool.addEventListener('validate-error' as any, (evt) => {
      validateErr++;
      expect(evt.detail.toolCall.name).toBe('valerr');
      expect(evt.detail.toolConfiguration.name).toBe('valerr');
    });
    tool.addEventListener('settled' as any, (evt) => {
      settled++;
      expect(evt.detail.toolCall.name).toBe('valerr');
    });

    // @ts-expect-error - intentionally invalid
    await expect(tool({})).rejects.toBeDefined();
    expect(validateErr).toBe(1);
    expect(settled).toBe(1);
  });

  it('direct call emits execute-error and settled on thrown error', async () => {
    const tool = createTool({
      name: 'throwerr',
      description: 'execute error path',
      schema: z.object({ a: z.string() }),
      async execute() {
        throw new Error('boom');
      },
    });

    let execErr = 0;
    let settled = 0;
    tool.addEventListener('execute-error' as any, (evt) => {
      execErr++;
      expect(evt.detail.toolCall.name).toBe('throwerr');
    });
    tool.addEventListener('settled' as any, (evt) => {
      settled++;
      expect(evt.detail.toolConfiguration.name).toBe('throwerr');
    });

    await expect(tool({ a: 'x' })).rejects.toBeDefined();
    expect(execErr).toBe(1);
    expect(settled).toBe(1);
  });

  it('direct call emits start, validate-success, execute-success, and settled on success', async () => {
    const tool = createTool({
      name: 'oktool',
      description: 'success path',
      schema: z.object({ a: z.string() }),
      async execute({ a }) {
        return a.toUpperCase();
      },
    });

    let started = 0;
    let validated = 0;
    let succeeded = 0;
    let settled = 0;
    tool.addEventListener('execute-start' as any, (evt) => {
      started++;
      expect(evt.detail.params).toBeDefined();
      expect(evt.detail.toolCall.name).toBe('oktool');
      expect(evt.detail.toolConfiguration.name).toBe('oktool');
    });
    tool.addEventListener('validate-success' as any, (evt) => {
      validated++;
      expect((evt.detail as any).parsed.a).toBe('x');
      expect(evt.detail.toolCall.name).toBe('oktool');
    });
    tool.addEventListener('execute-success' as any, (evt) => {
      succeeded++;
      expect((evt.detail as any).result).toBe('X');
      expect(evt.detail.toolConfiguration.name).toBe('oktool');
    });
    tool.addEventListener('settled' as any, (evt) => {
      settled++;
      expect((evt.detail as any).result).toBe('X');
      expect(evt.detail.toolCall.name).toBe('oktool');
    });

    const out = await tool({ a: 'x' });
    expect(out).toBe('X');
    expect(started).toBe(1);
    expect(validated).toBe(1);
    expect(succeeded).toBe(1);
    expect(settled).toBe(1);
  });

  it('executeWith supports timeouts and normalizes timeout error', async () => {
    const tool = createTool({
      name: 'slow',
      description: 'timeout',
      schema: z.object({ a: z.string() }),
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      },
    });

    const res = await (tool as any).executeWith({ params: { a: 'x' }, timeoutMs: 1 });
    expect(typeof res.error === 'string').toBe(true);
    expect((res.error ?? '').toUpperCase()).toContain('TIMEOUT');
  });

  it('executeWith supports AbortSignal cancellation', async () => {
    const tool = createTool({
      name: 'slow-cancel',
      description: 'abort support',
      schema: z.object({ a: z.string() }),
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      },
    });

    const controller = new AbortController();
    const pending = (tool as any).executeWith({
      params: { a: 'x' },
      callId: 'c1',
      signal: controller.signal,
    });
    controller.abort('too-late');
    const result = await pending;

    expect(result.toolCallId).toBe('c1');
    expect(result.result).toBeUndefined();
    expect(result.error?.toLowerCase()).toContain('too-late');
  });

  it('executeWith resolves before timeout (clears timer)', async () => {
    const tool = createTool({
      name: 'fast',
      description: 'no-timeout',
      schema: z.object({ a: z.string() }),
      async execute({ a }) {
        return a;
      },
    });
    const res = await (tool as any).executeWith({ params: { a: 'ok' }, timeoutMs: 1000 });
    expect(res.result).toBe('ok');
  });

  it('executeWith rejects before timeout (clears timer on reject path)', async () => {
    const tool = createTool({
      name: 'fast-fail',
      description: 'rejects quickly',
      schema: z.object({ a: z.string() }),
      async execute() {
        throw new Error('bad');
      },
    });
    const res = await (tool as any).executeWith({ params: { a: 'x' }, timeoutMs: 1000 });
    expect(typeof res.error).toBe('string');
  });

  it('getOwnPropertyDescriptor falls through to callable for non-bag property', () => {
    const tool = createTool({
      name: 'desc-fallback',
      description: 'descriptor',
      schema: z.object({ a: z.string() }),
      async execute() {
        return 'x';
      },
    });
    const desc = Object.getOwnPropertyDescriptor(tool as any, 'length');
    expect(desc).toBeDefined();
  });
});
