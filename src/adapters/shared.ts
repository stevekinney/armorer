import { isArmorer } from '../create-armorer';
import type { Armorer, ArmorerTool, ToolConfig } from '../index';
import { isTool } from '../is-tool';

/**
 * Type guard to check if input is a ToolConfig (not an ArmorerTool).
 */
export function isToolConfig(input: unknown): input is ToolConfig {
  return (
    input !== null &&
    typeof input === 'object' &&
    'name' in input &&
    'description' in input &&
    ('schema' in input || 'parameters' in input) &&
    'execute' in input &&
    !isTool(input)
  );
}

/**
 * Converts an ArmorerTool to its ToolConfig.
 */
function toolToConfig(tool: ArmorerTool): ToolConfig {
  return tool.configuration;
}

/**
 * Normalizes various input types to an array of ToolConfig objects.
 */
export function normalizeToToolConfigs(
  input: ArmorerTool | ToolConfig | (ArmorerTool | ToolConfig)[] | Armorer,
): ToolConfig[] {
  // Handle Armorer registry
  if (isArmorer(input)) {
    const tools = input.tools();
    if (Array.isArray(tools)) {
      return tools.map(toolToConfig);
    }
    throw new Error('Armorer.tools() must return an array.');
  }

  // Handle array of tools
  if (Array.isArray(input)) {
    return input.map((item) => {
      if (isTool(item)) {
        return toolToConfig(item);
      }
      if (isToolConfig(item)) {
        return item;
      }
      throw new TypeError('Invalid tool input: expected ArmorerTool or ToolConfig');
    });
  }

  // Handle single tool
  if (isTool(input)) {
    return [toolToConfig(input)];
  }

  // Handle single config
  if (isToolConfig(input)) {
    return [input];
  }

  throw new TypeError('Invalid input: expected tool, tool array, or Armorer registry');
}

/**
 * Determines if the input was a single item (returns true) or array/registry (returns false).
 */
export function isSingleInput(
  input: ArmorerTool | ToolConfig | (ArmorerTool | ToolConfig)[] | Armorer,
): boolean {
  return !Array.isArray(input) && !isArmorer(input);
}

/**
 * Union type for adapter input.
 */
export type AdapterInput =
  | ArmorerTool
  | ToolConfig
  | (ArmorerTool | ToolConfig)[]
  | Armorer;
