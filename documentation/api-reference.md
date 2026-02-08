# Public API Reference

## Overview

Reference for exported functions, types, and subpath APIs. New code should prefer `armorer/core` for tool specs and registry/search, and `armorer/runtime` for execution and composition.

### Runtime export: `armorer/runtime`

#### `createTool(options)`

Creates an executable tool with Zod validation, events, and a callable proxy interface.

Options (`CreateToolOptions`):

- `name`: string (maps to `identity.name`)
- `description`: string (maps to `display.description`)
- `schema?`: Zod object schema for input validation or a plain object shape; defaults to `z.object({})`.
- `execute`: async `(params: TInput, context: ToolContext) => TOutput`.
- `dryRun?`: async `(params: TInput, context: ToolContext) => Promise<unknown>` - optional handler for previewing effects.
- `tags?`: kebab-case strings, de-duped.
- `metadata?`: `ToolMetadata` bag used for filtering and inspection.
- `timeoutMs?`: number.
- `concurrency?`: number (per-tool concurrency limit).

Returns: `ToolboxTool`.

Exposed properties and methods:

- `tool(params)` call signature.
- `identity`: `{ name, namespace, version }`.
- `display`: `{ title, description, examples }`.
- `schema`: the Zod schema.
- `tags`, `metadata`, `configuration`.
- `execute(call | params, options?)`: returns `ToolResult` (for call) or raw output (for params).
- `dryRun(params, context)`: direct access to dry-run logic.
- `addEventListener`, `dispatchEvent`, `on`, `once`, `subscribe`, `toObservable`, `events`.
- `complete()`, `completed`.

```typescript
function createTool<...>(
  options: CreateToolOptions<...>,
  armorer?: Toolbox,
): ToolboxTool;
```

#### `createToolbox(serialized?, options?)`

Creates an execution engine and tool registry.

Options (`ToolboxOptions`):

- `context?`: `ToolboxContext` merged into all tool execution contexts.
- `middleware?`: Array of `ToolMiddleware` functions.
- `policy?`: Global policy hooks.
- `telemetry?`: boolean - enable detailed execution events.

### Instrumentation export: `armorer/instrumentation`

#### `instrument(armorer, options?)`

Auto-instruments an Toolbox instance with OpenTelemetry tracing.

```typescript
import { instrument } from 'armorer/instrumentation';
unregister = instrument(armorer);
```

### Middleware export: `armorer/middleware`

#### `createCacheMiddleware(options)`

Caches tool results based on input hash.

#### `createRateLimitMiddleware(options)`

Limits tool execution frequency.

#### `createTimeoutMiddleware(ms)`

Enforces a hard execution timeout.

### Testing export: `armorer/test`

#### `createMockTool(options)`

Creates a mock tool with `.mockResolve()` and `.mockReject()` helpers and a `.calls` history.

#### `createTestRegistry()`

Creates an Toolbox instance that records all execution history in a `.history` array.

### Core export: `armorer/core`

#### `defineTool(options)`

Defines a static tool specification (identity, display, schema) without execution logic. Recommended for shared libraries.

#### `serializeToolDefinition(tool)`

Converts a tool definition to a provider-neutral JSON-serializable format.

Registry surface (`Toolbox`):

- `register(...entries: (ToolConfig | ToolboxTool)[])`
- `createTool(options)`: create and register a tool in one call
- `execute(call | calls)`
- `tools()` (returns registered `ToolboxTool[]` for registry helpers)
- `getTool(name)`
- `getMissingTools(names)`
- `hasAllTools(names)`
- `inspect(detailLevel?: InspectorDetailLevel)`
- `toJSON(): SerializedToolbox`
- Event methods: `addEventListener`, `dispatchEvent`, `on`, `once`, `subscribe`, `toObservable`, `events`
- Lifecycle: `complete()`, `completed`

`register()` accepts tool instances or raw configurations. When you register a tool, its `configuration` is stored for serialization. `createTool()` is a convenience that uses the same options as `createTool(options)`, registers the result, and returns the registered instance. If `schema` is omitted, it defaults to `z.object({})`.

Signature:

```typescript
const tool = armorer.createTool(options);
```

`ToolConfig.execute` receives `ToolboxToolRuntimeContext`, which includes any base context plus `dispatchEvent`, `configuration`, `toolCall`, `signal`, and `timeoutMs`. `ToolConfig.execute` may also be a `Promise` that resolves to an execute function, or use `lazy(() => import(...))` to defer dynamic imports.

#### `getMissingTools(names)`

Returns the subset of tool names that are not registered.

Example:

```typescript
const missing = armorer.getMissingTools(['toolA', 'toolB', 'toolC']);
// -> ['toolB', 'toolC']
```

Signature:

```typescript
function createToolbox(serialized?: SerializedToolbox, options?: ToolboxOptions): Toolbox;
```

#### `isTool(value)`

Type guard for `ToolboxTool`.

Signature:

```typescript
function isTool(value: unknown): value is ToolboxTool;
```

#### Tool events (`DefaultToolEvents`)

- `execute-start`: `{ params }`
- `validate-success`: `{ params, parsed }`
- `validate-error`: `{ params, error }`
- `execute-success`: `{ result }`
- `execute-error`: `{ error }`
- `settled`: `{ result?, error? }`
- `progress`: `{ percent?, message? }`
- `output-chunk`: `{ chunk }`
- `log`: `{ level, message, data? }`
- `cancelled`: `{ reason? }`
- `status-update`: `{ status }`

Execution and validation events include `toolCall` and `configuration` in their detail payload.

#### Registry events (`ToolboxEvents`)

- `registering`: tool about to be registered
- `registered`: tool registered
- `call`: `{ tool, call }`
- `complete`: `{ tool, result }`
- `error`: `{ tool?, result }`
- `not-found`: `ToolCall` for missing tool
- `query`: `{ criteria?, results }`
- `search`: `{ options, results }`
- `status:update`: `ToolStatusUpdate` for UI progress

`query` and `search` events are emitted by `queryTools`/`searchTools` when you pass the armorer registry as the input.

#### Query helpers and types

Registry helpers live in `armorer/registry` and accept an armorer, tool, or iterable.

Functions:

- `queryTools(input, criteria?)`: filter-only query
- `searchTools(input, options?)`: ranked selection with reasons
- `reindexSearchIndex(input)`: rebuild cached text indexes on demand

`ToolQuery` fields include `tags`, `text`, `schema`, `metadata`, `predicate`, and boolean groups (`and`, `or`, `not`) plus paging/selection (`limit`, `offset`, `select`). `TagFilter` supports `any`, `all`, and `none`. `SchemaFilter` supports `keys` and `matches`. `MetadataFilter` supports `has`, `eq`, `contains`, `startsWith`, `range`, and `predicate`. `ToolPredicate` is `(tool) => boolean`.

`ToolSearchOptions` includes `filter`, `rank`, `ranker`, `tieBreaker`, `limit`, `offset`, `select`, `includeSchema`, `includeToolConfiguration`, and `explain`. `ToolSearchRank` supports `tags`, `tagWeights`, `text`, and optional `weights`. `ToolMatch` includes `tool`, `score`, `reasons`, and optional `matches`.

Functions:

- `tagsMatchAny(tags)`: match tools that contain any tag
- `tagsMatchAll(tags)`: match tools that contain all tags
- `tagsMatchNone(tags)`: exclude tools that contain any tag
- `schemaMatches(schema)`: loose schema match
- `schemaHasKeys(keys)`: require schema keys
- `textMatches(query)`: search name, description, tags, schema keys, and metadata keys

#### Type guards

- `isTool(obj)`: returns `obj is ToolboxTool` - checks if an object is a tool
- `isToolbox(input)`: returns `input is Toolbox` - checks if an object is an Toolbox registry

#### Inspection helpers and schemas

- `inspectTool(tool, detailLevel?)`: returns `ToolInspection`
- `inspectRegistry(tools, detailLevel?)`: returns `RegistryInspection`
- `extractSchemaSummary(schema, includeShape?)`: returns `SchemaSummary`
- `extractMetadataFlags(metadata)`: returns `MetadataFlags`

Runtime validation schemas:

- `SchemaSummarySchema`
- `MetadataFlagsSchema`
- `ToolInspectionSchema`
- `RegistryInspectionSchema`

#### Type exports

Core registry types (main export):

- `Toolbox`: registry interface
- `ToolboxContext`: base context bag for registry execution
- `ToolboxOptions`: options for `createToolbox`
- `ToolboxEvents`: registry event map
- `ToolboxToolRuntimeContext`: context passed to `ToolConfig.execute`
- `SerializedToolbox`: serialized `ToolConfig[]`
- `ToolStatusUpdate`: registry status payload

Registry helper types (`armorer/registry`):

- `QueryResult`: array of `ToolboxTool`
- `QuerySelectionResult`: query result union for selections
- `Embedder`: `(texts: string[]) => number[][] | Promise<number[][]>` - function to generate embeddings
- `EmbeddingVector`: numeric vector returned by `Embedder`
- `EmbeddingMatch`: embedding match metadata with `field` and `score`
- `TagFilter`: tag filters (`any`, `all`, `none`)
- `SchemaFilter`: schema filters (`keys`, `matches`)
- `MetadataFilter`: metadata filters (`has`, `eq`, `contains`, `startsWith`, `range`, `predicate`)
- `MetadataPrimitive`: primitive metadata values
- `MetadataRange`: numeric range for metadata
- `ToolQuery`: query input + paging/selection
- `ToolQueryCriteria`: filter-only query input
- `ToolQueryOptions`: paging/selection options
- `ToolQuerySelect`: selection mode (`tool`, `name`, `config`, `summary`)
- `ToolSummary`: summarized tool shape
- `ToolSearchOptions`: search options (filter + rank)
- `ToolSearchRank`: ranking preferences
- `ToolMatch`: search result with score + reasons
- `ToolMatchDetails`: optional match metadata
- `EmbeddingMatch`: embedding match metadata (field + score)
- `ToolRanker`: custom rank callback
- `ToolRankContext`: rank context for custom rankers
- `ToolRankResult`: ranker return shape
- `ToolTieBreaker`: tie-breaker selector

Tool types:

- `CreateToolOptions`: options for `createTool`
- `WithContext`: helper type for merged context
- `ToolboxTool`: callable tool interface
- `ToolConfig`: registry tool configuration (execute may be lazy)
- `ToolMetadata`: metadata bag for filtering and inspection
- `ToolParametersSchema`: Zod object schema alias
- `ToolEventsMap`: event name to detail map
- `DefaultToolEvents`: built-in tool event map
- `ToolCustomEvent`: typed event wrapper
- `ToolContext`: tool execution context
- `ToolCallWithArguments`: tool call with parsed arguments
- `ToolExecuteOptions`: execution options (`signal`)
- `ToolExecuteWithOptions`: execution options with params, callId, timeout

Policy types:

- `ToolPolicyHooks`: hooks for policy enforcement (`beforeExecute`, `afterExecute`)
- `ToolPolicyContext`: context passed to `beforeExecute` hook
- `ToolPolicyAfterContext`: context passed to `afterExecute` hook
- `ToolPolicyDecision`: return type from policy hooks (`{ allow: boolean, reason?: string }`)
- `ToolPolicyContextProvider`: function returning policy context

Validation and diagnostics types:

- `OutputValidationMode`: `'warn' | 'error' | 'silent'`
- `OutputValidationResult`: result of output validation
- `ToolValidationReport`: validation report with warnings and errors
- `ToolValidationWarning`: individual validation warning
- `ToolRepairHint`: hint for repairing validation issues
- `ToolDiagnostics`: diagnostics options for tools
- `ToolDiagnosticsAdapter`: adapter for custom diagnostics reporting
- `ToolDigestOptions`: options for tool digest generation

Middleware types:

- `ToolMiddleware`: middleware function type for tool configuration transformation

Query types:

- `ToolPredicate`: sync tool predicate
- `TextQuery`: text query input (string or object)
- `TextQueryField`: text query fields
- `TextQueryMode`: `contains` | `exact` | `fuzzy`
- `TextQueryWeights`: per-field weights for text queries
- `NormalizedTextQuery`: normalized text query object
- `TextMatchScore`: text match scoring result
- `TextSearchIndex`: cached text index shape

Inspection types:

- `InspectorDetailLevel`: `summary` | `standard` | `full`
- `SchemaSummary`: schema keys and optional shape summary
- `MetadataFlags`: extracted metadata flags
- `ToolInspection`: per-tool inspection output
- `RegistryInspection`: registry inspection output

Core types:

- `ToolCall`: LLM tool call shape
- `ToolResult`: execution result shape
- `ToolConfiguration`: minimal tool configuration

Event system types (re-exported from `event-emission`):

- `AddEventListenerOptionsLike`: listener options
- `AsyncIteratorOptions`: async iterator configuration
- `MinimalAbortSignal`: AbortSignal-compatible shape
- `ObservableLike`: minimal observable interface
- `Observer`: observable callback set
- `Subscription`: subscription handle

### Subpath export: `armorer/mcp`

MCP server integration.

- `createMCP(armorer, options?)`: build an MCP server from an armorer registry
- `toolConfigFromMetadata(tool)`: read MCP config from `tool.metadata.mcp`
- Types: `CreateMCPOptions`, `MCPToolConfig`, `MCPResourceRegistrar`, `MCPPromptRegistrar`

### Subpath export: `armorer/registry`

Registry query/search helpers and types.

#### Registry API

- `queryTools(input, criteria?)`: filter-only query
- `searchTools(input, options?)`: ranked selection with reasons
- `reindexSearchIndex(input)`: rebuild cached text indexes

### Subpath export: `armorer/lazy`

Lazy helper for deferring execute function imports.

#### Lazy API

- `lazy(loader)`: memoized async loader for tool execute functions

### Subpath export: `armorer/utilities`

Composition helpers and types.

#### Composition API

- `pipe(...tools)`: left-to-right composition (2 to 9 tools); returns an `ToolboxTool`
- `compose(...tools)`: right-to-left composition; returns an `ToolboxTool`
- `bind(tool, bound, options?)`: bind tool parameters; returns an `ToolboxTool`
- `tap(tool, effect)`: run a side effect and return the original output
- `when(predicate, whenTrue, whenFalse?)`: conditional tool routing
- `parallel(...tools)`: run tools concurrently (2 to 9 tools); returns an array of outputs
- `retry(tool, options?)`: retry a tool on failure with backoff options
- `preprocess(tool, mapper)`: transform inputs before passing to tool; returns an `ToolboxTool`
- `postprocess(tool, mapper)`: transform outputs after tool executes; returns an `ToolboxTool`
- `PipelineError`: error with `{ stepIndex, stepName, originalError }`

Pipelines created with `pipe()`/`compose()` and tools created with `parallel()` emit `ComposedToolEvents` including `step-start`, `step-complete`, and `step-error`.

#### Composition types

- `AnyTool`: generic tool constraint
- `ToolWithInput`: tool constrained by input type
- `InferToolInput`: extract input type from tool
- `InferToolOutput`: extract output type from tool
- `ComposedTool`: composed tool type
- `ComposedToolEvents`: step event map

### Subpath export: `armorer/adapters/openai` (also `armorer/openai`)

- `toOpenAI(input)`: converts a tool, tool array, or `Toolbox` to OpenAI Chat Completions tools (`OpenAITool` or `OpenAITool[]`)
- Types: `JSONSchema`, `OpenAIFunction`, `OpenAITool`

### Subpath export: `armorer/adapters/anthropic` (also `armorer/anthropic`)

- `toAnthropic(input)`: converts a tool, tool array, or `Toolbox` to Anthropic Messages tools (`AnthropicTool` or `AnthropicTool[]`)
- Types: `AnthropicInputSchema`, `AnthropicTool`, `JSONSchemaProperty`

### Subpath export: `armorer/adapters/gemini` (also `armorer/gemini`)

- `toGemini(input)`: converts a tool, tool array, or `Toolbox` to Gemini function declarations (`GeminiFunctionDeclaration` or array)
- Type helper: `GeminiTool` for wrapper objects with `functionDeclarations`
- Types: `GeminiFunctionDeclaration`, `GeminiSchema`, `GeminiTool`

### Subpath export: `armorer/claude-agent-sdk`

Claude Agent SDK adapter for integrating Toolbox tools with `@anthropic-ai/claude-agent-sdk`.

Functions:

- `toClaudeAgentSdkTools(input, options?)`: async converter for Claude Agent SDK tool format
- `createClaudeAgentSdkServer(input, options?)`: async MCP server builder with tool metadata
- `createClaudeToolGate(options)`: creates a permission gate function for tool access control

Types:

- `ClaudeAgentSdkTool`: return type of Claude Agent SDK's `tool()` function
- `ClaudeAgentSdkServer`: return type of `createSdkMcpServer()`
- `ClaudeAgentSdkToolConfig`: tool configuration override options
- `ClaudeAgentSdkToolOptions`: options for `toClaudeAgentSdkTools()`
- `CreateClaudeAgentSdkServerOptions`: options for `createClaudeAgentSdkServer()`
- `ClaudeAgentSdkServerResult`: return type of `createClaudeAgentSdkServer()`
- `ClaudeToolGateOptions`: options for `createClaudeToolGate()`
- `ClaudeToolGateDecision`: return type of the gate function

### Subpath export: `armorer/openai-agents-sdk`

OpenAI Agents SDK adapter for integrating Toolbox tools with `@openai/agents`.

Functions:

- `toOpenAIAgentTools(input, options?)`: async converter for OpenAI Agents SDK tool format
- `createOpenAIToolGate(options)`: creates a permission gate function for tool access control

Types:

- `OpenAIAgentTool`: return type of OpenAI Agents SDK's `tool()` function
- `OpenAIAgentToolConfig`: tool configuration override options
- `OpenAIAgentToolOptions`: options for `toOpenAIAgentTools()`
- `OpenAIAgentToolsResult`: return type of `toOpenAIAgentTools()`
- `OpenAIToolGateOptions`: options for `createOpenAIToolGate()`
- `OpenAIToolGateDecision`: return type of the gate function

### Subpath export: `armorer/tools`

Pre-configured tools for common agentic workflows.

#### Search Tools Tool

A tool that searches for other tools in an Toolbox registry, enabling semantic tool discovery in agentic workflows.

Functions:

- `createSearchTool(armorer, options?)`: creates a search tool bound to an armorer

Options (`CreateSearchToolOptions`):

- `limit?`: Default maximum number of tools to return (default: 10)
- `explain?`: Include matching reasons in results (default: false)
- `name?`: Custom tool name (default: 'search-tools')
- `description?`: Custom tool description
- `tags?`: Additional tags to add to the tool
- `register?`: Automatically register with the armorer (default: true)

Types:

- `CreateSearchToolOptions`: options for `createSearchTool()`
- `SearchToolsResult`: individual search result with name, description, tags, score, and optional reasons
- `SearchToolsInput`: input parameters (query, limit, tags)
- `SearchTool`: the created tool type

Usage:

```typescript
import { createToolbox } from 'armorer';
import { createSearchTool } from 'armorer/tools';

const armorer = createToolbox();
// ... register tools

const searchTool = createSearchTool(armorer);
const results = await searchTool({ query: 'send message' });
// [{ name: 'send-email', description: '...', score: 1.5 }, ...]
```

See [Search Tools Tool](search-tools.md) for complete documentation.
