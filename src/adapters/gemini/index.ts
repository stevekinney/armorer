import type { Armorer, ArmorerTool, ToolConfig } from '../../index';
import { toJSONSchema } from '../../to-json-schema';
import { isSingleInput, normalizeToToolConfigs } from '../shared';
import type { GeminiFunctionDeclaration, GeminiSchema } from './types';

export type { GeminiFunctionDeclaration, GeminiSchema, GeminiTool } from './types';

/**
 * Converts Armorer tools to Google Gemini API format.
 *
 * Returns function declarations that should be wrapped in a tool object:
 * `{ functionDeclarations: toGemini(tools) }`
 *
 * @example
 * ```ts
 * import { toGemini } from 'armorer/gemini';
 *
 * // Single tool
 * const declaration = toGemini(myTool);
 *
 * // Multiple tools
 * const declarations = toGemini([tool1, tool2]);
 *
 * // From registry
 * const declarations = toGemini(armorer);
 *
 * // Use with Gemini SDK
 * const model = genAI.getGenerativeModel({
 *   model: 'gemini-pro',
 *   tools: [{ functionDeclarations: toGemini(armorer) }],
 * });
 * ```
 */
export function toGemini(tool: ArmorerTool | ToolConfig): GeminiFunctionDeclaration;
export function toGemini(
  tools: (ArmorerTool | ToolConfig)[],
): GeminiFunctionDeclaration[];
export function toGemini(registry: Armorer): GeminiFunctionDeclaration[];
export function toGemini(
  input: ArmorerTool | ToolConfig | (ArmorerTool | ToolConfig)[] | Armorer,
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
