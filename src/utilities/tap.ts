import { z } from 'zod';

import type {
  AnyTool,
  ComposedTool,
  InferToolInput,
  InferToolOutput,
} from '../compose-types';
import { createTool } from '../create-tool';
import type { DefaultToolEvents, ToolContext } from '../is-tool';

type TapEffect<TOutput> = (
  output: TOutput,
  context: ToolContext<DefaultToolEvents>,
) => void | Promise<void>;

export function tap<TTool extends AnyTool>(
  tool: TTool,
  effect: TapEffect<InferToolOutput<TTool>>,
): ComposedTool<InferToolInput<TTool>, InferToolOutput<TTool>> {
  const name = `tap(${tool.name})`;
  const description = `Tap tool: ${tool.description}`;
  const tags = tool.tags && tool.tags.length ? tool.tags : undefined;

  const toolOptions: Parameters<typeof createTool>[0] = {
    name,
    description,
    schema: tool.schema as z.ZodType<InferToolInput<TTool>>,
    async execute(params, context) {
      const result = await tool(params as InferToolInput<TTool>);
      await effect(result as InferToolOutput<TTool>, context);
      return result;
    },
  };
  if (tags) {
    toolOptions.tags = tags;
  }
  if (tool.metadata !== undefined) {
    toolOptions.metadata = tool.metadata;
  }
  return createTool(toolOptions) as ComposedTool<
    InferToolInput<TTool>,
    InferToolOutput<TTool>
  >;
}
