export { combineArmorers } from './runtime/combine-armorers';
export type {
  Armorer,
  ArmorerContext,
  ArmorerEvents,
  ArmorerOptions,
  ArmorerToolRuntimeContext,
  SerializedArmorer,
  ToolMiddleware,
  ToolStatusUpdate,
} from './runtime/create-armorer';
export { createArmorer, createMiddleware, isArmorer } from './runtime/create-armorer';
export type { CreateToolOptions, WithContext } from './runtime/create-tool';
export { createTool, createToolCall, lazy, withContext } from './runtime/create-tool';
export type {
  AddEventListenerOptionsLike,
  ArmorerTool,
  AsyncIteratorOptions,
  DefaultToolEvents,
  MinimalAbortSignal,
  ObservableLike,
  Observer,
  OutputValidationMode,
  OutputValidationResult,
  Subscription,
  ToolCallWithArguments,
  ToolConfig,
  ToolContext,
  ToolCustomEvent,
  ToolDiagnostics,
  ToolDiagnosticsAdapter,
  ToolDigestOptions,
  ToolEventsMap,
  ToolExecuteOptions,
  ToolExecuteWithOptions,
  ToolMetadata,
  ToolParametersSchema,
  ToolPolicyAfterContext,
  ToolPolicyContext,
  ToolPolicyContextProvider,
  ToolPolicyDecision,
  ToolPolicyHooks,
  ToolRepairHint,
  ToolValidationReport,
  ToolValidationWarning,
} from './runtime/is-tool';
export { isTool } from './runtime/is-tool';

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
} from './core/query-predicates';

// Inspector exports
export type {
  InspectorDetailLevel,
  MetadataFlags,
  RegistryInspection,
  SchemaSummary,
  ToolInspection,
} from './core/inspect';
export {
  extractMetadataFlags,
  extractSchemaSummary,
  inspectRegistry,
  inspectTool,
  MetadataFlagsSchema,
  RegistryInspectionSchema,
  SchemaSummarySchema,
  ToolInspectionSchema,
} from './core/inspect';

// Types
export type {
  ToolCall,
  ToolCallInput,
  ToolConfiguration,
  ToolResult,
} from './runtime/types';
