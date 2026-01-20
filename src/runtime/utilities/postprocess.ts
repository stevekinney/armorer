import { z } from 'zod';

import type {
  AnyTool,
  ComposedTool,
  InferToolInput,
  InferToolOutput,
} from '../compose-types';
import { createTool } from '../create-tool';
import type { DefaultToolEvents, ToolContext } from '../is-tool';

type PostprocessMapper<TOutput, TNewOutput> = (
  output: TOutput,
  context: ToolContext<DefaultToolEvents>,
) => TNewOutput | Promise<TNewOutput>;

/**
 * Maps/transforms outputs after a tool executes.
 * Useful for formatting, enriching, or normalizing output data.
 *
 * @example
 * ```ts
 * const fetchUser = createTool({
 *   name: 'fetch-user',
 *   schema: z.object({ id: z.string() }),
 *   execute: async ({ id }) => ({ userId: id, name: 'John' }),
 * });
 *
 * // Postprocess to format the output
 * const fetchUserFormatted = postprocess(
 *   fetchUser,
 *   async (output) => ({
 *     ...output,
 *     displayName: `${output.name} (${output.userId})`,
 *   }),
 * );
 *
 * // Returns enriched output
 * const result = await fetchUserFormatted({ id: '123' });
 * // { userId: '123', name: 'John', displayName: 'John (123)' }
 * ```
 */
export function postprocess<TTool extends AnyTool, TNewOutput>(
  tool: TTool,
  mapper: PostprocessMapper<InferToolOutput<TTool>, TNewOutput>,
): ComposedTool<InferToolInput<TTool>, TNewOutput> {
  const name = `postprocess(${tool.name})`;
  const description = `Postprocessed tool: ${tool.description}`;
  const tags = tool.tags && tool.tags.length ? tool.tags : undefined;

  const toolOptions: Parameters<typeof createTool>[0] = {
    name,
    description,
    schema: tool.schema as z.ZodType<InferToolInput<TTool>>,
    async execute(params, context) {
      const executeOptions =
        context.signal || context.timeoutMs !== undefined
          ? {
              ...(context.signal ? { signal: context.signal } : {}),
              ...(context.timeoutMs !== undefined
                ? { timeoutMs: context.timeoutMs }
                : {}),
            }
          : undefined;
      const result = await tool.execute(params as InferToolInput<TTool>, executeOptions);
      return mapper(result as InferToolOutput<TTool>, context);
    },
  };
  if (tags) {
    toolOptions.tags = tags;
  }
  if (tool.metadata !== undefined) {
    toolOptions.metadata = tool.metadata;
  }
  return createTool(toolOptions) as ComposedTool<InferToolInput<TTool>, TNewOutput>;
}
