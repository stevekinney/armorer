import type { Quartermaster, QuartermasterTool, ToolConfig } from '../../index';
import { toJSONSchema } from '../../to-json-schema';
import { isSingleInput, normalizeToToolConfigs } from '../shared';
import type { AnthropicTool } from './types';

export type { AnthropicInputSchema, AnthropicTool, JSONSchemaProperty } from './types';

/**
 * Converts Quartermaster tools to Anthropic Messages API format.
 *
 * @example
 * ```ts
 * import { toAnthropic } from 'quartermaster/anthropic';
 *
 * // Single tool
 * const tool = toAnthropic(myTool);
 *
 * // Multiple tools
 * const tools = toAnthropic([tool1, tool2]);
 *
 * // From registry
 * const tools = toAnthropic(quartermaster);
 *
 * // Use with Anthropic SDK
 * const response = await anthropic.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   messages,
 *   tools: toAnthropic(quartermaster),
 * });
 * ```
 */
export function toAnthropic(tool: QuartermasterTool | ToolConfig): AnthropicTool;
export function toAnthropic(tools: (QuartermasterTool | ToolConfig)[]): AnthropicTool[];
export function toAnthropic(registry: Quartermaster): AnthropicTool[];
export function toAnthropic(
  input:
    | QuartermasterTool
    | ToolConfig
    | (QuartermasterTool | ToolConfig)[]
    | Quartermaster,
): AnthropicTool | AnthropicTool[] {
  const configs = normalizeToToolConfigs(input);
  const converted = configs.map(convertToAnthropic);

  return isSingleInput(input) ? converted[0]! : converted;
}

function convertToAnthropic(config: ToolConfig): AnthropicTool {
  const jsonSchema = toJSONSchema(config);
  const params = jsonSchema.parameters;

  const inputSchema: AnthropicTool['input_schema'] = {
    type: 'object',
    properties: (params['properties'] ??
      {}) as AnthropicTool['input_schema']['properties'],
  };

  if (params['required']) {
    inputSchema.required = params['required'] as string[];
  }

  if (params['additionalProperties'] !== undefined) {
    inputSchema.additionalProperties = params['additionalProperties'] as boolean;
  }

  return {
    name: jsonSchema.name,
    description: jsonSchema.description,
    input_schema: inputSchema,
  };
}
