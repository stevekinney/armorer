import { z } from 'zod';

import type {
  AnyTool,
  ComposedTool,
  InferToolInput,
  InferToolOutput,
} from '../compose-types';
import { createTool } from '../create-tool';
import type { DefaultToolEvents, ToolContext } from '../is-tool';

type PreprocessMapper<TInput, TTransformedInput> = (
  input: TInput,
  context: ToolContext<DefaultToolEvents>,
) => TTransformedInput | Promise<TTransformedInput>;

/**
 * Maps/transforms inputs before they're passed to a tool.
 * Useful for normalizing, validating, or enriching input data.
 *
 * @example
 * ```ts
 * const addNumbers = createTool({
 *   name: 'add-numbers',
 *   schema: z.object({ a: z.number(), b: z.number() }),
 *   execute: async ({ a, b }) => a + b,
 * });
 *
 * // Preprocess to convert string numbers to actual numbers
 * const addNumbersWithPreprocessing = preprocess(
 *   addNumbers,
 *   async (input: { a: string; b: string }) => ({
 *     a: Number(input.a),
 *     b: Number(input.b),
 *   }),
 * );
 *
 * // Now accepts string inputs
 * const result = await addNumbersWithPreprocessing({ a: '5', b: '3' });
 * ```
 */
export function preprocess<TTool extends AnyTool, TNewInput extends object>(
  tool: TTool,
  mapper: PreprocessMapper<TNewInput, InferToolInput<TTool>>,
): ComposedTool<TNewInput, InferToolOutput<TTool>> {
  const name = `preprocess(${tool.name})`;
  const description = `Preprocessed tool: ${tool.description}`;
  const tags = tool.tags && tool.tags.length ? tool.tags : undefined;

  // Create a schema that matches the new input type
  // We use a passthrough object schema since we can't infer the exact schema from the mapper
  // The mapper is responsible for transforming to the tool's expected input
  const schema = z.object({}).passthrough() as z.ZodType<TNewInput>;

  const runPreprocess = async (
    params: unknown,
    context: ToolContext<DefaultToolEvents>,
    isDryRun: boolean,
  ) => {
    const transformed = await mapper(params as TNewInput, context);
    const executeOptions =
      context.signal || context.timeoutMs !== undefined || isDryRun
        ? {
            ...(context.signal ? { signal: context.signal } : {}),
            ...(context.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
            ...(isDryRun ? { dryRun: true } : {}),
          }
        : undefined;
    return tool.execute(transformed, executeOptions);
  };

  const toolOptions: Parameters<typeof createTool>[0] = {
    name,
    description,
    schema,
    async execute(params, context) {
      return runPreprocess(params, context, false);
    },
    async dryRun(params, context) {
      return runPreprocess(params, context, true);
    },
  };
  if (tags) {
    toolOptions.tags = tags;
  }
  if (tool.metadata !== undefined) {
    toolOptions.metadata = tool.metadata;
  }
  return createTool(toolOptions) as ComposedTool<TNewInput, InferToolOutput<TTool>>;
}
