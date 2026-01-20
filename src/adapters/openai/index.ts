import type { SerializedToolDefinition } from '../../core/serialization';
import type { AnyToolDefinition } from '../../core/tool-definition';
import {
  type AdapterInput,
  isSingleInput,
  normalizeToSerializedDefinitions,
  type ToolRegistryLike,
} from '../shared';
import type { JSONSchema, OpenAITool } from './types';

export type { JSONSchema, OpenAIFunction, OpenAITool } from './types';

/**
 * Converts Armorer tools to OpenAI Chat Completions API format.
 *
 * @example
 * ```ts
 * import { toOpenAI } from 'armorer/adapters/openai';
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
export function toOpenAI(tool: SerializedToolDefinition | AnyToolDefinition): OpenAITool;
export function toOpenAI(
  tools: (SerializedToolDefinition | AnyToolDefinition)[],
): OpenAITool[];
export function toOpenAI(registry: ToolRegistryLike): OpenAITool[];
export function toOpenAI(input: AdapterInput): OpenAITool | OpenAITool[];
export function toOpenAI(input: AdapterInput): OpenAITool | OpenAITool[] {
  const definitions = normalizeToSerializedDefinitions(input);
  const converted = definitions.map(convertToOpenAI);

  return isSingleInput(input) ? converted[0]! : converted;
}

function convertToOpenAI(tool: SerializedToolDefinition): OpenAITool {
  const parameters = stripSchemaId(tool.inputSchema as JSONSchema);
  return {
    type: 'function',
    function: {
      name: tool.identity.name,
      description: tool.display.description,
      parameters,
      strict: true,
    },
  };
}

function stripSchemaId(schema: JSONSchema): JSONSchema {
  if (!schema || typeof schema !== 'object') return schema;
  const copy = { ...(schema as Record<string, unknown>) } as JSONSchema;
  if ('$schema' in copy) {
    delete (copy as Record<string, unknown>)['$schema'];
  }
  return copy;
}
