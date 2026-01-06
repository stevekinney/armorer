export type {
  Armorer,
  ArmorerContext,
  ArmorerEvents,
  ArmorerOptions,
  ArmorerToolRuntimeContext,
  MetadataFilter,
  QueryResult,
  SchemaFilter,
  SerializedArmorer,
  TagFilter,
  ToolMatch,
  ToolQuery,
  ToolSearchOptions,
  ToolSearchRank,
  ToolStatusUpdate,
} from './create-armorer';
export { createArmorer } from './create-armorer';
export type { CreateToolOptions, WithContext } from './create-tool';
export { createTool, createToolCall, withContext } from './create-tool';
export type {
  AddEventListenerOptionsLike,
  ArmorerTool,
  AsyncIteratorOptions,
  DefaultToolEvents,
  MinimalAbortSignal,
  ObservableLike,
  Observer,
  Subscription,
  ToolCallWithArguments,
  ToolConfig,
  ToolContext,
  ToolCustomEvent,
  ToolEventsMap,
  ToolExecuteOptions,
  ToolExecuteWithOptions,
  ToolMetadata,
  ToolParametersSchema,
} from './is-tool';
export { isTool } from './is-tool';

// Query predicates and ranking helpers
export {
  schemaHasKeys,
  schemaMatches,
  tagsMatchAll,
  tagsMatchAny,
  tagsMatchNone,
  textMatches,
  type ToolPredicate,
} from './query-predicates';

// Inspector exports
export type {
  InspectorDetailLevel,
  MetadataFlags,
  RegistryInspection,
  SchemaSummary,
  ToolInspection,
} from './inspect';
export {
  extractMetadataFlags,
  extractSchemaSummary,
  inspectRegistry,
  inspectTool,
  MetadataFlagsSchema,
  RegistryInspectionSchema,
  SchemaSummarySchema,
  ToolInspectionSchema,
} from './inspect';

// Types
export type { ToolCall, ToolConfiguration, ToolResult } from './types';

// Tool composition
export { bind, compose, pipe, PipelineError } from './compose';
export type {
  AnyTool,
  ComposedTool,
  ComposedToolEvents,
  InferToolInput,
  InferToolOutput,
  ToolWithInput,
} from './compose-types';
