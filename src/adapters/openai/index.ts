import type { SerializedToolDefinition } from '../../core/serialization';
import type { AnyToolDefinition } from '../../core/tool-definition';
import type { ToolCallInput, ToolResult } from '../../runtime/types';
import {
  type AdapterInput,
  isSingleInput,
  normalizeToSerializedDefinitions,
  type ToolRegistryLike,
} from '../shared';
import type { JSONSchema, OpenAITool, OpenAIToolCall, OpenAIToolMessage } from './types';

export type {
  JSONSchema,
  OpenAIFunction,
  OpenAITool,
  OpenAIToolCall,
  OpenAIToolMessage,
} from './types';

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

/**
 * Parses OpenAI tool calls into Armorer ToolCallInput objects.
 *
 * @example
 * ```ts
 * const completion = await openai.chat.completions.create({...});
 * const toolCalls = parseToolCalls(completion.choices[0].message.tool_calls);
 * const results = await armorer.execute(toolCalls);
 * ```
 */
export function parseToolCalls(
  toolCalls: OpenAIToolCall[] | undefined | null,
): ToolCallInput[] {
  if (!toolCalls || !Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.map((call) => {
    let args: unknown = {};
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      // Keep empty object if parsing fails
    }

    return {
      id: call.id,
      name: call.function.name,
      arguments: args,
    };
  });
}

/**
 * Formats Armorer ToolResults into OpenAI tool messages.
 *
 * @example
 * ```ts
 * const results = await armorer.execute(toolCalls);
 * const messages = formatToolResults(results);
 * // Add messages to conversation history
 * ```
 */
export function formatToolResults(
  results: ToolResult | ToolResult[],
): OpenAIToolMessage[] {
  const list = Array.isArray(results) ? results : [results];
  return list.map((result) => {
    let content = '';
    if (typeof result.content === 'string') {
      content = result.content;
    } else if (result.content === undefined || result.content === null) {
      content = 'null';
    } else {
      try {
        content = JSON.stringify(result.content);
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        content = String(result.content);
      }
    }

    return {
      role: 'tool',
      tool_call_id: result.toolCallId,
      content,
    };
  });
}

function convertToOpenAI(tool: SerializedToolDefinition): OpenAITool {
  const parameters = stripSchemaId(tool.schema as JSONSchema);
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
