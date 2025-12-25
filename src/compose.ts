import type {
  AnyTool,
  ComposedTool,
  InferToolInput,
  InferToolOutput,
  ToolWithInput,
} from './compose-types';
import { createTool } from './create-tool';
import type { DefaultToolEvents, ToolContext } from './is-tool';

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

// Overloads for 2-9 tools with type inference

/** Pipe 2 tools together */
export function pipe<A extends AnyTool, B extends ToolWithInput<InferToolOutput<A>>>(
  a: A,
  b: B,
): ComposedTool<InferToolInput<A>, InferToolOutput<B>>;

/** Pipe 3 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<InferToolOutput<A>>,
  C extends ToolWithInput<InferToolOutput<B>>,
>(a: A, b: B, c: C): ComposedTool<InferToolInput<A>, InferToolOutput<C>>;

/** Pipe 4 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<InferToolOutput<A>>,
  C extends ToolWithInput<InferToolOutput<B>>,
  D extends ToolWithInput<InferToolOutput<C>>,
>(a: A, b: B, c: C, d: D): ComposedTool<InferToolInput<A>, InferToolOutput<D>>;

/** Pipe 5 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<InferToolOutput<A>>,
  C extends ToolWithInput<InferToolOutput<B>>,
  D extends ToolWithInput<InferToolOutput<C>>,
  E extends ToolWithInput<InferToolOutput<D>>,
>(a: A, b: B, c: C, d: D, e: E): ComposedTool<InferToolInput<A>, InferToolOutput<E>>;

/** Pipe 6 tools together */
export function pipe<
  A extends AnyTool,
  B extends ToolWithInput<InferToolOutput<A>>,
  C extends ToolWithInput<InferToolOutput<B>>,
  D extends ToolWithInput<InferToolOutput<C>>,
  E extends ToolWithInput<InferToolOutput<D>>,
  F extends ToolWithInput<InferToolOutput<E>>,
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
  B extends ToolWithInput<InferToolOutput<A>>,
  C extends ToolWithInput<InferToolOutput<B>>,
  D extends ToolWithInput<InferToolOutput<C>>,
  E extends ToolWithInput<InferToolOutput<D>>,
  F extends ToolWithInput<InferToolOutput<E>>,
  G extends ToolWithInput<InferToolOutput<F>>,
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
  B extends ToolWithInput<InferToolOutput<A>>,
  C extends ToolWithInput<InferToolOutput<B>>,
  D extends ToolWithInput<InferToolOutput<C>>,
  E extends ToolWithInput<InferToolOutput<D>>,
  F extends ToolWithInput<InferToolOutput<E>>,
  G extends ToolWithInput<InferToolOutput<F>>,
  H extends ToolWithInput<InferToolOutput<G>>,
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
  B extends ToolWithInput<InferToolOutput<A>>,
  C extends ToolWithInput<InferToolOutput<B>>,
  D extends ToolWithInput<InferToolOutput<C>>,
  E extends ToolWithInput<InferToolOutput<D>>,
  F extends ToolWithInput<InferToolOutput<E>>,
  G extends ToolWithInput<InferToolOutput<F>>,
  H extends ToolWithInput<InferToolOutput<G>>,
  I extends ToolWithInput<InferToolOutput<H>>,
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
 * Returns a new QuartermasterTool that can be used like any other tool.
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
  const toolNames = tools.map((t) => t.name);

  // Helper to emit events with proper typing (event-emission accepts partial events at runtime)
  const emit = (
    dispatch: ToolContext<DefaultToolEvents>['dispatch'],
    type: string,
    detail: unknown,
  ) => dispatch({ type, detail } as Parameters<typeof dispatch>[0]);

  return createTool({
    name: `pipe(${toolNames.join(', ')})`,
    description: `Composed pipeline: ${toolNames.join(' → ')}`,
    schema: first.schema,

    async execute(input: unknown, context: ToolContext<DefaultToolEvents>) {
      let result: unknown = input;

      for (let i = 0; i < tools.length; i++) {
        const tool = tools[i]!;

        // Emit step-start event
        emit(context.dispatch, 'step-start', {
          stepIndex: i,
          stepName: tool.name,
          input: result,
        });

        try {
          // Execute step - tool validates its own input via its schema
          result = await tool(result);

          // Emit step-complete event
          emit(context.dispatch, 'step-complete', {
            stepIndex: i,
            stepName: tool.name,
            output: result,
          });
        } catch (error) {
          // Emit step-error event
          emit(context.dispatch, 'step-error', {
            stepIndex: i,
            stepName: tool.name,
            error,
          });

          // Wrap error with step context
          throw new PipelineError(`Pipeline failed at step ${i} (${tool.name})`, {
            stepIndex: i,
            stepName: tool.name,
            originalError: error,
          });
        }
      }

      return result;
    },
  }) as AnyTool;
}

// Compose overloads (right-to-left, like function composition)

/** Compose 2 tools (right-to-left: compose(b, a) === pipe(a, b)) */
export function compose<A extends AnyTool, B extends ToolWithInput<InferToolOutput<A>>>(
  b: B,
  a: A,
): ComposedTool<InferToolInput<A>, InferToolOutput<B>>;

/** Compose 3 tools (right-to-left) */
export function compose<
  A extends AnyTool,
  B extends ToolWithInput<InferToolOutput<A>>,
  C extends ToolWithInput<InferToolOutput<B>>,
>(c: C, b: B, a: A): ComposedTool<InferToolInput<A>, InferToolOutput<C>>;

/** Compose 4 tools (right-to-left) */
export function compose<
  A extends AnyTool,
  B extends ToolWithInput<InferToolOutput<A>>,
  C extends ToolWithInput<InferToolOutput<B>>,
  D extends ToolWithInput<InferToolOutput<C>>,
>(d: D, c: C, b: B, a: A): ComposedTool<InferToolInput<A>, InferToolOutput<D>>;

/** Compose 5 tools (right-to-left) */
export function compose<
  A extends AnyTool,
  B extends ToolWithInput<InferToolOutput<A>>,
  C extends ToolWithInput<InferToolOutput<B>>,
  D extends ToolWithInput<InferToolOutput<C>>,
  E extends ToolWithInput<InferToolOutput<D>>,
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
