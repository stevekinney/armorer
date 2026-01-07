export type {
  Armorer,
  ArmorerContext,
  ArmorerEvents,
  ArmorerOptions,
  ArmorerToolRuntimeContext,
  SerializedArmorer,
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
  ToolDiagnostics,
  ToolDiagnosticsAdapter,
  ToolEventsMap,
  ToolExecuteOptions,
  ToolExecuteWithOptions,
  ToolMetadata,
  ToolParametersSchema,
  ToolRepairHint,
  ToolValidationReport,
  ToolValidationWarning,
} from './is-tool';
export { isTool } from './is-tool';

// Query predicates and ranking helpers
export {
  type NormalizedTextQuery,
  schemaHasKeys,
  schemaMatches,
  tagsMatchAll,
  tagsMatchAny,
  tagsMatchNone,
  textMatches,
  type TextMatchScore,
  type TextQuery,
  type TextQueryField,
  type TextQueryMode,
  type TextQueryWeights,
  type TextSearchIndex,
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
export type { ToolCall, ToolCallInput, ToolConfiguration, ToolResult } from './types';
