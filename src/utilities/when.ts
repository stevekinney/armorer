import type {
  AnyTool,
  ComposedTool,
  InferToolInput,
  InferToolOutput,
  ToolWithInput,
} from '../compose-types';
import { createTool } from '../create-tool';
import type { DefaultToolEvents, ToolContext } from '../is-tool';

type WhenPredicate<TInput extends Record<string, unknown>> = (
  input: TInput,
  context: ToolContext<DefaultToolEvents>,
) => boolean | Promise<boolean>;

export function when<
  TTool extends AnyTool,
  TElse extends ToolWithInput<InferToolInput<TTool>>,
>(
  predicate: WhenPredicate<InferToolInput<TTool>>,
  whenTrue: TTool,
  whenFalse: TElse,
): ComposedTool<InferToolInput<TTool>, InferToolOutput<TTool> | InferToolOutput<TElse>>;
export function when<TTool extends AnyTool>(
  predicate: WhenPredicate<InferToolInput<TTool>>,
  whenTrue: TTool,
): ComposedTool<InferToolInput<TTool>, InferToolOutput<TTool> | InferToolInput<TTool>>;
export function when(
  predicate: WhenPredicate<Record<string, unknown>>,
  whenTrue: AnyTool,
  whenFalse?: AnyTool,
): AnyTool {
  const name = whenFalse
    ? `when(${whenTrue.name}, ${whenFalse.name})`
    : `when(${whenTrue.name})`;
  const description = whenFalse
    ? `Conditional tool: ${whenTrue.name} or ${whenFalse.name}`
    : `Conditional tool: ${whenTrue.name}`;

  return createTool({
    name,
    description,
    schema: whenTrue.schema,
    async execute(params, context) {
      const input = params;
      const shouldRun = await predicate(input, context);
      if (shouldRun) {
        return whenTrue(input);
      }
      if (whenFalse) {
        return whenFalse(input);
      }
      return input;
    },
  }) as AnyTool;
}
