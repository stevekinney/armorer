import { z } from 'zod';

import type {
  AnyTool,
  ComposedTool,
  InferToolInput,
  InferToolOutput,
  ToolWithInput,
} from '../compose-types';
import { createTool } from '../create-tool';
import type { DefaultToolEvents, ToolContext } from '../is-tool';

type WhenPredicate<TInput = unknown> = (
  input: TInput,
  context: ToolContext<DefaultToolEvents>,
) => boolean | Promise<boolean>;

/**
 * Creates conditional tool execution based on a predicate function.
 *
 * Evaluates a predicate and executes different tools based on the result.
 * Useful for branching logic, validation gates, and dynamic routing.
 *
 * @param predicate - Function that determines which branch to execute
 * @param whenTrue - Tool to execute if predicate returns true
 * @param whenFalse - Optional tool to execute if predicate returns false (if omitted, returns input unchanged)
 * @returns A conditional tool that executes the appropriate branch
 *
 * @example Basic conditional
 * ```typescript
 * import { createTool } from 'armorer';
 * import { when } from 'armorer/runtime';
 * import { z } from 'zod';
 *
 * const expensiveProcess = createTool({
 *   name: 'expensive',
 *   schema: z.object({ value: z.number() }),
 *   async execute({ value }) {
 *     return value * 2;
 *   },
 * });
 *
 * const cheapProcess = createTool({
 *   name: 'cheap',
 *   schema: z.object({ value: z.number() }),
 *   async execute({ value }) {
 *     return value + 1;
 *   },
 * });
 *
 * const smartTool = when(
 *   ({ value }) => value > 100,
 *   expensiveProcess,
 *   cheapProcess,
 * );
 * ```
 */
export function when<
  TTool extends AnyTool,
  TElse extends ToolWithInput<InferToolInput<TTool>> | undefined = undefined,
>(
  predicate: WhenPredicate<InferToolInput<TTool>>,
  whenTrue: TTool,
  whenFalse?: TElse,
): ComposedTool<
  InferToolInput<TTool>,
  | InferToolOutput<TTool>
  | (TElse extends AnyTool ? InferToolOutput<TElse> : InferToolInput<TTool>)
> {
  const name = whenFalse
    ? `when(${whenTrue.name}, ${whenFalse.name})`
    : `when(${whenTrue.name})`;
  const description = whenFalse
    ? `Conditional tool: ${whenTrue.name} or ${whenFalse.name}`
    : `Conditional tool: ${whenTrue.name}`;

  const runWhen = async (
    params: unknown,
    context: ToolContext<DefaultToolEvents>,
    isDryRun: boolean,
  ) => {
    const input = params as InferToolInput<TTool>;
    const executeOptions =
      context.signal || context.timeoutMs !== undefined || isDryRun
        ? {
            ...(context.signal ? { signal: context.signal } : {}),
            ...(context.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
            ...(isDryRun ? { dryRun: true } : {}),
          }
        : undefined;
    const shouldRun = await predicate(input, context);
    if (shouldRun) {
      return whenTrue.execute(input, executeOptions);
    }
    if (whenFalse) {
      return whenFalse.execute(input, executeOptions);
    }
    return input;
  };

  return createTool({
    name,
    description,
    schema: whenTrue.schema as z.ZodTypeAny,
    async execute(params, context) {
      return runWhen(params, context, false);
    },
    async dryRun(params, context) {
      return runWhen(params, context, true);
    },
  }) as ComposedTool<
    InferToolInput<TTool>,
    | InferToolOutput<TTool>
    | (TElse extends AnyTool ? InferToolOutput<TElse> : InferToolInput<TTool>)
  >;
}
