export type {
  Quartermaster,
  QuartermasterContext,
  QuartermasterEvents,
  QuartermasterOptions,
  QuartermasterToolRuntimeContext,
  QueryDescriptor,
  QueryInput,
  QueryResult,
  SerializedQuartermaster,
  ToolStatusUpdate,
} from './create-quartermaster';
export { createQuartermaster } from './create-quartermaster';
export type { CreateToolOptions, WithContext } from './create-tool';
export { createTool, createToolCall, withContext } from './create-tool';
export type {
  AddEventListenerOptionsLike,
  AsyncIteratorOptions,
  DefaultToolEvents,
  MinimalAbortSignal,
  ObservableLike,
  Observer,
  QuartermasterTool,
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
  byForbiddenTags,
  bySchema,
  byTag,
  fuzzyText,
  matchesIntentTags,
  rankByIntent,
  schemaContainsKeys,
  scoreIntentMatch,
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
export { compose, pipe, PipelineError } from './compose';
export type {
  AnyTool,
  ComposedTool,
  ComposedToolEvents,
  InferToolInput,
  InferToolOutput,
  ToolWithInput,
} from './compose-types';
