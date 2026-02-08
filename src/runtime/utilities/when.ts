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
