import type { Quartermaster, QuartermasterTool, ToolConfig } from '../../index';
import { toJSONSchema } from '../../to-json-schema';
import { isSingleInput, normalizeToToolConfigs } from '../shared';
import type { JSONSchema, OpenAITool } from './types';

export type { JSONSchema, OpenAIFunction, OpenAITool } from './types';

/**
 * Converts Quartermaster tools to OpenAI Chat Completions API format.
 *
 * @example
 * ```ts
 * import { toOpenAI } from 'quartermaster/openai';
 *
 * // Single tool
 * const tool = toOpenAI(myTool);
 *
 * // Multiple tools
 * const tools = toOpenAI([tool1, tool2]);
 *
 * // From registry
 * const tools = toOpenAI(quartermaster);
 *
 * // Use with OpenAI SDK
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages,
 *   tools: toOpenAI(quartermaster),
 * });
 * ```
 */
export function toOpenAI(tool: QuartermasterTool | ToolConfig): OpenAITool;
export function toOpenAI(tools: (QuartermasterTool | ToolConfig)[]): OpenAITool[];
export function toOpenAI(registry: Quartermaster): OpenAITool[];
export function toOpenAI(
  input:
    | QuartermasterTool
    | ToolConfig
    | (QuartermasterTool | ToolConfig)[]
    | Quartermaster,
): OpenAITool | OpenAITool[] {
  const configs = normalizeToToolConfigs(input);
  const converted = configs.map(convertToOpenAI);

  return isSingleInput(input) ? converted[0]! : converted;
}

function convertToOpenAI(config: ToolConfig): OpenAITool {
  const jsonSchema = toJSONSchema(config);

  return {
    type: 'function',
    function: {
      name: jsonSchema.name,
      description: jsonSchema.description,
      parameters: jsonSchema.parameters as JSONSchema,
      strict: jsonSchema.strict,
    },
  };
}
