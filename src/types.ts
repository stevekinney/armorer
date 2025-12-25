/**
 * Types for tool calls and results.
 * These are compatible with LLM provider tool call formats.
 */

/**
 * A tool call from an LLM.
 */
export interface ToolCall {
  id?: string;
  name: string;
  arguments?: unknown;
}

/**
 * The result of executing a tool.
 */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result?: unknown;
  error?: string;
}

/**
 * Tool configuration for JSON schema output.
 */
export interface ToolConfiguration<Schema = unknown> {
  name: string;
  description: string;
  schema: Schema;
}
