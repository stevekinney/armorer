import { z } from 'zod';

import { getSchemaShape } from '../core/schema-utilities';
import type {
  AnyTool,
  ComposedTool,
  InferToolInput,
  InferToolOutput,
  ToolWithInput,
} from './compose-types';
import { createTool } from './create-tool';
import type { DefaultToolEvents, ToolContext, ToolParametersSchema } from './is-tool';

/**
 * Error thrown when a pipeline step fails.
 * Contains context about which step failed and the original error.
 */
export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly context: {
      stepIndex: number;
      stepName: string;
      originalError: unknown;
    },
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

type OutputAsInput<TTool extends AnyTool> = InferToolOutput<TTool> &
  Record<string, unknown>;

// Overloads for 2-9 tools with type inference

/** Pipe 2 tools together */
export function pipe<A extends AnyTool, B extends ToolWithInput<OutputAsInput<A>>>(
  a: A,
  b: B,
): ComposedTool<InferToolInput<A>, InferToolOutput<B>>;

/** Pipe 3 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<OutputAsInput<A>>,
  C extends ToolWithInput<OutputAsInput<B>>,
>(a: A, b: B, c: C): ComposedTool<InferToolInput<A>, InferToolOutput<C>>;

/** Pipe 4 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<OutputAsInput<A>>,
  C extends ToolWithInput<OutputAsInput<B>>,
  D extends ToolWithInput<OutputAsInput<C>>,
>(a: A, b: B, c: C, d: D): ComposedTool<InferToolInput<A>, InferToolOutput<D>>;

/** Pipe 5 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<OutputAsInput<A>>,
  C extends ToolWithInput<OutputAsInput<B>>,
  D extends ToolWithInput<OutputAsInput<C>>,
  E extends ToolWithInput<OutputAsInput<D>>,
>(a: A, b: B, c: C, d: D, e: E): ComposedTool<InferToolInput<A>, InferToolOutput<E>>;

/** Pipe 6 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<OutputAsInput<A>>,
  C extends ToolWithInput<OutputAsInput<B>>,
  D extends ToolWithInput<OutputAsInput<C>>,
  E extends ToolWithInput<OutputAsInput<D>>,
  F extends ToolWithInput<OutputAsInput<E>>,
>(
  a: A,
  b: B,
  c: C,
  d: D,
  e: E,
  f: F,
): ComposedTool<InferToolInput<A>, InferToolOutput<F>>;

/** Pipe 7 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<OutputAsInput<A>>,
  C extends ToolWithInput<OutputAsInput<B>>,
  D extends ToolWithInput<OutputAsInput<C>>,
  E extends ToolWithInput<OutputAsInput<D>>,
  F extends ToolWithInput<OutputAsInput<E>>,
  G extends ToolWithInput<OutputAsInput<F>>,
>(
  a: A,
  b: B,
  c: C,
  d: D,
  e: E,
  f: F,
  g: G,
): ComposedTool<InferToolInput<A>, InferToolOutput<G>>;

/** Pipe 8 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<OutputAsInput<A>>,
  C extends ToolWithInput<OutputAsInput<B>>,
  D extends ToolWithInput<OutputAsInput<C>>,
  E extends ToolWithInput<OutputAsInput<D>>,
  F extends ToolWithInput<OutputAsInput<E>>,
  G extends ToolWithInput<OutputAsInput<F>>,
  H extends ToolWithInput<OutputAsInput<G>>,
>(
  a: A,
  b: B,
  c: C,
  d: D,
  e: E,
  f: F,
  g: G,
  h: H,
): ComposedTool<InferToolInput<A>, InferToolOutput<H>>;

/** Pipe 9 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<OutputAsInput<A>>,
  C extends ToolWithInput<OutputAsInput<B>>,
  D extends ToolWithInput<OutputAsInput<C>>,
  E extends ToolWithInput<OutputAsInput<D>>,
  F extends ToolWithInput<OutputAsInput<E>>,
  G extends ToolWithInput<OutputAsInput<F>>,
  H extends ToolWithInput<OutputAsInput<G>>,
  I extends ToolWithInput<OutputAsInput<H>>,
>(
  a: A,
  b: B,
  c: C,
  d: D,
  e: E,
  f: F,
  g: G,
  h: H,
  i: I,
): ComposedTool<InferToolInput<A>, InferToolOutput<I>>;

/**
 * Chains tools together, passing the output of each tool as input to the next.
 * Returns a new ArmorerTool that can be used like any other tool.
 *
 * @example
 * ```ts
 * const fetchUser = createTool<{ id: string }, User>({...});
 * const enrichProfile = createTool<User, EnrichedUser>({...});
 * const formatResponse = createTool<EnrichedUser, APIResponse>({...});
 *
 * // Types flow through: (id: string) => Promise<APIResponse>
 * const pipeline = pipe(fetchUser, enrichProfile, formatResponse);
 *
 * // Fully typed - result is APIResponse
 * const result = await pipeline({ id: 'user-123' });
 * ```
 */
export function pipe(...tools: AnyTool[]): AnyTool {
  if (tools.length < 2) {
    throw new Error('pipe() requires at least 2 tools');
  }

  const first = tools[0]!;
  const toolNames = tools.map((t) => t.identity.name);

  // Helper to emit events with proper typing (event-emission accepts partial events at runtime)
  const emit = (
    dispatch: ToolContext<DefaultToolEvents>['dispatch'],
    type: string,
    detail: unknown,
  ) => dispatch({ type, detail } as Parameters<typeof dispatch>[0]);

  const runPipeline = async (
    input: unknown,
    context: ToolContext<DefaultToolEvents>,
    isDryRun: boolean,
  ) => {
    let result: unknown = input;
    const executeOptions =
      context.signal || context.timeoutMs !== undefined || isDryRun
        ? {
            ...(context.signal ? { signal: context.signal } : {}),
            ...(context.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
            ...(isDryRun ? { dryRun: true } : {}),
          }
        : undefined;

    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i]!;
      if (context.signal?.aborted) {
        throw toError(context.signal.reason ?? new Error('Cancelled'));
      }

      // Emit step-start event
      emit(context.dispatch, 'step-start', {
        stepIndex: i,
        stepName: tool.identity.name,
        input: result,
        dryRun: isDryRun,
      });

      try {
        // Execute step - tool validates its own input via its schema
        result = await tool.execute(result, executeOptions);

        // Emit step-complete event
        emit(context.dispatch, 'step-complete', {
          stepIndex: i,
          stepName: tool.identity.name,
          output: result,
          dryRun: isDryRun,
        });
      } catch (error) {
        // Emit step-error event
        emit(context.dispatch, 'step-error', {
          stepIndex: i,
          stepName: tool.identity.name,
          error,
          dryRun: isDryRun,
        });

        // Wrap error with step context
        throw new PipelineError(`Pipeline failed at step ${i} (${tool.identity.name})`, {
          stepIndex: i,
          stepName: tool.identity.name,
          originalError: error,
        });
      }
    }

    return result;
  };

  return createTool({
    name: `pipe(${toolNames.join(', ')})`,
    description: `Composed pipeline: ${toolNames.join(' → ')}`,
    schema: first.schema as z.ZodTypeAny,

    async execute(input: unknown, context: ToolContext<DefaultToolEvents>) {
      return runPipeline(input, context, false);
    },
    async dryRun(input: unknown, context: ToolContext<DefaultToolEvents>) {
      return runPipeline(input, context, true);
    },
  }) as AnyTool;
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

// Compose overloads (right-to-left, like function composition)

/** Compose 2 tools (right-to-left: compose(b, a) === pipe(a, b)) */
export function compose<A extends AnyTool, B extends ToolWithInput<OutputAsInput<A>>>(
  b: B,
  a: A,
): ComposedTool<InferToolInput<A>, InferToolOutput<B>>;

/** Compose 3 tools (right-to-left) */
export function compose<
  A extends AnyTool,
  B extends ToolWithInput<OutputAsInput<A>>,
  C extends ToolWithInput<OutputAsInput<B>>,
>(c: C, b: B, a: A): ComposedTool<InferToolInput<A>, InferToolOutput<C>>;

/** Compose 4 tools (right-to-left) */
export function compose<
  A extends AnyTool,
  B extends ToolWithInput<OutputAsInput<A>>,
  C extends ToolWithInput<OutputAsInput<B>>,
  D extends ToolWithInput<OutputAsInput<C>>,
>(d: D, c: C, b: B, a: A): ComposedTool<InferToolInput<A>, InferToolOutput<D>>;

/** Compose 5 tools (right-to-left) */
export function compose<
  A extends AnyTool,
  B extends ToolWithInput<OutputAsInput<A>>,
  C extends ToolWithInput<OutputAsInput<B>>,
  D extends ToolWithInput<OutputAsInput<C>>,
  E extends ToolWithInput<OutputAsInput<D>>,
>(e: E, d: D, c: C, b: B, a: A): ComposedTool<InferToolInput<A>, InferToolOutput<E>>;

/**
 * Composes tools right-to-left (like mathematical function composition).
 * compose(c, b, a) is equivalent to pipe(a, b, c).
 *
 * @example
 * ```ts
 * // These are equivalent:
 * const pipeline1 = compose(format, enrich, fetch);
 * const pipeline2 = pipe(fetch, enrich, format);
 * ```
 */
export function compose(...tools: AnyTool[]): AnyTool {
  const reversed = tools.reverse();
  // We know there are at least 2 tools from the overload signatures
  return (pipe as (...args: AnyTool[]) => AnyTool)(...reversed);
}

type BindParams<TTool extends AnyTool> =
  InferToolInput<TTool> extends object
    ? Partial<InferToolInput<TTool>>
    : InferToolInput<TTool>;

type BindInput<TTool extends AnyTool, TBound extends BindParams<TTool>> =
  InferToolInput<TTool> extends object
    ? Omit<InferToolInput<TTool>, keyof TBound>
    : Record<string, never>;

type BindOptions = {
  name?: string;
  description?: string;
};

export function bind(tool: AnyTool, bound: unknown, options?: BindOptions): AnyTool;
export function bind<TTool extends AnyTool, TBound extends BindParams<TTool>>(
  tool: TTool,
  bound: TBound,
  options: BindOptions = {},
): AnyTool {
  const schema = resolveBoundSchema(tool.schema, bound);
  const name = options.name ?? `bind(${tool.identity.name})`;
  const description = options.description ?? `Bound tool: ${tool.display.description}`;
  const tags = tool.tags && tool.tags.length ? tool.tags : undefined;

  const toolOptions: Parameters<typeof createTool>[0] = {
    name,
    description,
    schema: schema as z.ZodType<BindInput<TTool, TBound>>,
    async execute(params, context) {
      const merged = mergeBoundParams(params, bound);
      const executeOptions =
        context.signal || context.timeoutMs !== undefined
          ? {
              ...(context.signal ? { signal: context.signal } : {}),
              ...(context.timeoutMs !== undefined
                ? { timeoutMs: context.timeoutMs }
                : {}),
            }
          : undefined;
      return tool.execute(merged as InferToolInput<TTool>, executeOptions);
    },
    async dryRun(params, context) {
      const merged = mergeBoundParams(params, bound);
      const executeOptions =
        context.signal || context.timeoutMs !== undefined
          ? {
              ...(context.signal ? { signal: context.signal } : {}),
              ...(context.timeoutMs !== undefined
                ? { timeoutMs: context.timeoutMs }
                : {}),
              dryRun: true,
            }
          : { dryRun: true };
      return tool.execute(merged as InferToolInput<TTool>, executeOptions);
    },
  };
  if (tags) {
    toolOptions.tags = tags;
  }
  if (tool.metadata !== undefined) {
    toolOptions.metadata = tool.metadata;
  }
  return createTool(toolOptions) as ComposedTool<
    BindInput<TTool, TBound>,
    InferToolOutput<TTool>
  >;
}

function resolveBoundSchema(
  schema: ToolParametersSchema,
  bound: unknown,
): ToolParametersSchema {
  const shape = getSchemaShape(schema);
  if (!shape) {
    throw new TypeError('bind() expects a tool with an object schema');
  }
  if (!isPlainObject(bound)) {
    throw new TypeError('bind() expects an object when binding an object-schema tool');
  }
  const shapeKeys = new Set(Object.keys(shape));
  const boundKeys = Object.keys(bound);
  const unknownKeys = boundKeys.filter((key) => !shapeKeys.has(key));
  if (unknownKeys.length) {
    throw new Error(`bind() cannot bind unknown keys: ${unknownKeys.sort().join(', ')}`);
  }
  const mask = Object.fromEntries(boundKeys.map((key) => [key, true])) as Record<
    string,
    true
  >;
  const objectSchema = schema as unknown as {
    omit: (mask: Record<string, true>) => ToolParametersSchema;
  };
  if (typeof objectSchema.omit !== 'function') {
    throw new TypeError('bind() expects a Zod object schema');
  }
  return objectSchema.omit(mask);
}

function mergeBoundParams(params: unknown, bound: unknown): unknown {
  const input = isPlainObject(params) ? params : {};
  return { ...input, ...(bound as Record<string, unknown>) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
