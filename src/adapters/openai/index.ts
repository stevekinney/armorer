import type { Armorer, ArmorerTool, ToolConfig } from '../../index';
import { toJSONSchema } from '../../to-json-schema';
import { isSingleInput, normalizeToToolConfigs } from '../shared';
import type { JSONSchema, OpenAITool } from './types';

export type { JSONSchema, OpenAIFunction, OpenAITool } from './types';

/**
 * Converts Armorer tools to OpenAI Chat Completions API format.
 *
 * @example
 * ```ts
 * import { toOpenAI } from 'armorer/openai';
 *
 * // Single tool
 * const tool = toOpenAI(myTool);
 *
 * // Multiple tools
 * const tools = toOpenAI([tool1, tool2]);
 *
 * // From registry
 * const tools = toOpenAI(armorer);
 *
 * // Use with OpenAI SDK
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages,
 *   tools: toOpenAI(armorer),
 * });
 * ```
 */
export function toOpenAI(tool: ArmorerTool | ToolConfig): OpenAITool;
export function toOpenAI(tools: (ArmorerTool | ToolConfig)[]): OpenAITool[];
export function toOpenAI(registry: Armorer): OpenAITool[];
export function toOpenAI(
  input: ArmorerTool | ToolConfig | (ArmorerTool | ToolConfig)[] | Armorer,
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
