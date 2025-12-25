import type { Quartermaster, QuartermasterTool, ToolConfig } from '../../index';
import { toJSONSchema } from '../../to-json-schema';
import { isSingleInput, normalizeToToolConfigs } from '../shared';
import type { GeminiFunctionDeclaration, GeminiSchema } from './types';

export type { GeminiFunctionDeclaration, GeminiSchema, GeminiTool } from './types';

/**
 * Converts Quartermaster tools to Google Gemini API format.
 *
 * Returns function declarations that should be wrapped in a tool object:
 * `{ functionDeclarations: toGemini(tools) }`
 *
 * @example
 * ```ts
 * import { toGemini } from 'quartermaster/gemini';
 *
 * // Single tool
 * const declaration = toGemini(myTool);
 *
 * // Multiple tools
 * const declarations = toGemini([tool1, tool2]);
 *
 * // From registry
 * const declarations = toGemini(quartermaster);
 *
 * // Use with Gemini SDK
 * const model = genAI.getGenerativeModel({
 *   model: 'gemini-pro',
 *   tools: [{ functionDeclarations: toGemini(quartermaster) }],
 * });
 * ```
 */
export function toGemini(tool: QuartermasterTool | ToolConfig): GeminiFunctionDeclaration;
export function toGemini(
  tools: (QuartermasterTool | ToolConfig)[],
): GeminiFunctionDeclaration[];
export function toGemini(registry: Quartermaster): GeminiFunctionDeclaration[];
export function toGemini(
  input:
    | QuartermasterTool
    | ToolConfig
    | (QuartermasterTool | ToolConfig)[]
    | Quartermaster,
): GeminiFunctionDeclaration | GeminiFunctionDeclaration[] {
  const configs = normalizeToToolConfigs(input);
  const converted = configs.map(convertToGemini);

  return isSingleInput(input) ? converted[0]! : converted;
}

function convertToGemini(config: ToolConfig): GeminiFunctionDeclaration {
  const jsonSchema = toJSONSchema(config);

  return {
    name: jsonSchema.name,
    description: jsonSchema.description,
    parameters: transformToGeminiSchema(jsonSchema.parameters),
  };
}

/**
 * Transforms JSON Schema to Gemini-compatible schema format.
 * Gemini uses OpenAPI 3.0 style schemas.
 */
function transformToGeminiSchema(schema: Record<string, unknown>): GeminiSchema {
  // Remove $schema if present (already done in toJSONSchema, but be safe)
  const { $schema, ...rest } = schema;

  return rest as GeminiSchema;
}
