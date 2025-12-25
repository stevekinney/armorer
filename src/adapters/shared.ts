import type { Quartermaster, QuartermasterTool, ToolConfig } from '../index';
import { isTool } from '../is-tool';

/**
 * Type guard to check if input is a Quartermaster registry.
 */
export function isQuartermaster(input: unknown): input is Quartermaster {
  return (
    input !== null &&
    typeof input === 'object' &&
    'query' in input &&
    'register' in input &&
    'execute' in input &&
    typeof (input as Quartermaster).query === 'function'
  );
}

/**
 * Type guard to check if input is a ToolConfig (not a QuartermasterTool).
 */
export function isToolConfig(input: unknown): input is ToolConfig {
  return (
    input !== null &&
    typeof input === 'object' &&
    'name' in input &&
    'description' in input &&
    'schema' in input &&
    'execute' in input &&
    !isTool(input)
  );
}

/**
 * Converts a QuartermasterTool to its ToolConfig.
 */
function toolToConfig(tool: QuartermasterTool): ToolConfig {
  return tool.toolConfiguration;
}

/**
 * Normalizes various input types to an array of ToolConfig objects.
 */
export function normalizeToToolConfigs(
  input:
    | QuartermasterTool
    | ToolConfig
    | (QuartermasterTool | ToolConfig)[]
    | Quartermaster,
): ToolConfig[] {
  // Handle Quartermaster registry
  if (isQuartermaster(input)) {
    const tools = input.query();
    if (Array.isArray(tools)) {
      return tools.map(toolToConfig);
    }
    throw new Error(
      'Async queries not supported in adapter. Call query() first and await it.',
    );
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
      throw new TypeError('Invalid tool input: expected QuartermasterTool or ToolConfig');
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

  throw new TypeError(
    'Invalid input: expected tool, tool array, or Quartermaster registry',
  );
}

/**
 * Determines if the input was a single item (returns true) or array/registry (returns false).
 */
export function isSingleInput(
  input:
    | QuartermasterTool
    | ToolConfig
    | (QuartermasterTool | ToolConfig)[]
    | Quartermaster,
): boolean {
  return !Array.isArray(input) && !isQuartermaster(input);
}

/**
 * Union type for adapter input.
 */
export type AdapterInput =
  | QuartermasterTool
  | ToolConfig
  | (QuartermasterTool | ToolConfig)[]
  | Quartermaster;
