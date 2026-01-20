# Public API Reference

## Overview

Reference for exported functions, types, and subpath APIs. New code should prefer `armorer/core` for tool specs and registry/search, and `armorer/runtime` for execution and composition.

### Runtime export: `armorer/runtime` (root `armorer` still works)

#### `createTool(options)`

Creates a tool with Zod validation, events, and a callable interface.

Options (`CreateToolOptions`):

- `name`: string
- `description`: string
- `schema?`: Zod object schema for input validation (`ToolParametersSchema`) or a plain object shape; defaults to `z.object({})`
- `execute`: async `(params: TInput, context: ToolContext) => TOutput`, a `Promise` that resolves to that function, or `lazy(() => import(...))` to defer dynamic imports
- `tags?`: kebab-case strings, de-duped
- `metadata?`: `ToolMetadata` bag used for filtering and inspection
- `timeoutMs?`: number (default timeout applied when executing the tool)

Returns: `ArmorerTool`.

Exposed properties and methods:

- `tool(params)` call signature
- `name`, `description`, `schema`, `tags`, `metadata`, `configuration`
- `execute(call, options?)`: returns `ToolResult`
- `execute(params, options?)`: returns raw output (same as `tool(params)`)
- `executeWith(options: ToolExecuteWithOptions)`: returns `ToolResult` with `callId`, `timeoutMs`, and `signal` support
- `rawExecute(params, context)`: low-level invoke with full `ToolContext`
- `addEventListener`, `dispatchEvent`, `on`, `once`, `subscribe`, `toObservable`, `events`
- `complete()`, `completed`
- Runtime helpers: `toJSON()` (serializable JSON schema output), `toString()`, `Symbol.toPrimitive`

```typescript
function createTool<
  TInput extends Record<string, unknown> = Record<string, never>,
  TOutput = unknown,
  E extends ToolEventsMap = DefaultToolEvents,
  Tags extends readonly string[] = readonly string[],
  M extends ToolMetadata | undefined = undefined,
  TContext extends ToolContext<E> = ToolContext<E>,
  TParameters extends Record<string, unknown> = TInput,
  TReturn = TOutput,
>(
  options: CreateToolOptions<TInput, TOutput, E, Tags, M, TContext, TParameters, TReturn>,
  armorer?: Armorer,
): ArmorerTool;
```

You can also pass an optional `armorer` as the second argument to automatically register the tool:

```typescript
const armorer = createArmorer();
const tool = createTool({ name: 'my-tool', ... }, armorer);
// Tool is automatically registered with the armorer
```

If the armorer has `context` set, it will be merged into the tool's execution context automatically.

#### `lazy(loader)`

Defers loading an async execute function until the first call. Import from `armorer/lazy`. The loader is memoized; if it rejects, the next call retries.

Signature:

```typescript
function lazy<TExecute extends (...args: any[]) => Promise<any>>(
  loader: () => PromiseLike<TExecute> | TExecute,
): TExecute;
```

#### `createToolCall(toolName, args, id?)`

Creates a `ToolCall` with `arguments` populated and a generated id if omitted.

```typescript
function createToolCall<Args>(
  toolName: string,
  args: Args,
  id?: string,
): ToolCall & { arguments: Args };
```

#### `withContext(context, options?)`

Build tools that receive additional context merged into `ToolContext`.

Usage forms:

- Builder: `const build = withContext(ctx); const tool = build(options);`
- Immediate: `const tool = withContext(ctx, options);`

The `execute` function receives `ToolContext & Ctx`. The helper type `WithContext<Ctx>` models that merge.

#### `combineArmorers(...armorers)`

Merges multiple Armorer instances into a fresh Armorer. Tools are copied via `toJSON()` and registered into a new armorer. If multiple armorers define the same tool name, the last one wins. Contexts are shallow-merged in the same order.

```typescript
function combineArmorers(...armorers: [Armorer, ...Armorer[]]): Armorer;
```

#### `createArmorer(serialized?, options?)`

Creates a registry of tools. `serialized` can be a `SerializedArmorer` created by `armorer.toJSON()`.

Options (`ArmorerOptions`):

- `signal?`: `MinimalAbortSignal` used to clear listeners on abort
- `context?`: `ArmorerContext` merged into tool execution context
- `embed?`: `(texts: string[]) => number[][] | Promise<number[][]>` for semantic search
- `toolFactory?`: `(configuration, { dispatchEvent, baseContext, buildDefaultTool }) => ArmorerTool`
- `getTool?`: `(configuration: Omit<ToolConfig, 'execute'>) => ToolConfig['execute']` - Called when a tool configuration doesn't have an execute method (typically when deserializing)
- `middleware?`: Array of `ToolMiddleware` functions to transform tool configurations during registration (must be synchronous when deserializing)

#### `createMiddleware(fn)`

Creates a typed middleware function for transforming tool configurations during registration:

```typescript
function createMiddleware(fn: (config: ToolConfig) => ToolConfig): ToolMiddleware;
```

Registry surface (`Armorer`):

- `register(...entries: (ToolConfig | ArmorerTool)[])`
- `createTool(options)`: create and register a tool in one call
- `execute(call | calls)`
- `tools()` (returns registered `ArmorerTool[]` for registry helpers)
- `getTool(name)`
- `getMissingTools(names)`
- `hasAllTools(names)`
- `inspect(detailLevel?: InspectorDetailLevel)`
- `toJSON(): SerializedArmorer`
- Event methods: `addEventListener`, `dispatchEvent`, `on`, `once`, `subscribe`, `toObservable`, `events`
- Lifecycle: `complete()`, `completed`

`register()` accepts tool instances or raw configurations. When you register a tool, its `configuration` is stored for serialization. `createTool()` is a convenience that uses the same options as `createTool(options)`, registers the result, and returns the registered instance. If `schema` is omitted, it defaults to `z.object({})`.

Signature:

```typescript
const tool = armorer.createTool(options);
```

`ToolConfig.execute` receives `ArmorerToolRuntimeContext`, which includes any base context plus `dispatchEvent`, `configuration`, `toolCall`, `signal`, and `timeoutMs`. `ToolConfig.execute` may also be a `Promise` that resolves to an execute function, or use `lazy(() => import(...))` to defer dynamic imports.

#### `getMissingTools(names)`

Returns the subset of tool names that are not registered.

Example:

```typescript
const missing = armorer.getMissingTools(['toolA', 'toolB', 'toolC']);
// -> ['toolB', 'toolC']
```

Signature:

```typescript
function createArmorer(serialized?: SerializedArmorer, options?: ArmorerOptions): Armorer;
```

#### `isTool(value)`

Type guard for `ArmorerTool`.

Signature:

```typescript
function isTool(value: unknown): value is ArmorerTool;
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

#### Registry events (`ArmorerEvents`)

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

- `isTool(obj)`: returns `obj is ArmorerTool` - checks if an object is a tool
- `isArmorer(input)`: returns `input is Armorer` - checks if an object is an Armorer registry

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

- `Armorer`: registry interface
- `ArmorerContext`: base context bag for registry execution
- `ArmorerOptions`: options for `createArmorer`
- `ArmorerEvents`: registry event map
- `ArmorerToolRuntimeContext`: context passed to `ToolConfig.execute`
- `SerializedArmorer`: serialized `ToolConfig[]`
- `ToolStatusUpdate`: registry status payload

Registry helper types (`armorer/registry`):

- `QueryResult`: array of `ArmorerTool`
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
- `ArmorerTool`: callable tool interface
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

- `pipe(...tools)`: left-to-right composition (2 to 9 tools); returns an `ArmorerTool`
- `compose(...tools)`: right-to-left composition; returns an `ArmorerTool`
- `bind(tool, bound, options?)`: bind tool parameters; returns an `ArmorerTool`
- `tap(tool, effect)`: run a side effect and return the original output
- `when(predicate, whenTrue, whenFalse?)`: conditional tool routing
- `parallel(...tools)`: run tools concurrently (2 to 9 tools); returns an array of outputs
- `retry(tool, options?)`: retry a tool on failure with backoff options
- `preprocess(tool, mapper)`: transform inputs before passing to tool; returns an `ArmorerTool`
- `postprocess(tool, mapper)`: transform outputs after tool executes; returns an `ArmorerTool`
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

- `toOpenAI(input)`: converts a tool, tool array, or `Armorer` to OpenAI Chat Completions tools (`OpenAITool` or `OpenAITool[]`)
- Types: `JSONSchema`, `OpenAIFunction`, `OpenAITool`

### Subpath export: `armorer/adapters/anthropic` (also `armorer/anthropic`)

- `toAnthropic(input)`: converts a tool, tool array, or `Armorer` to Anthropic Messages tools (`AnthropicTool` or `AnthropicTool[]`)
- Types: `AnthropicInputSchema`, `AnthropicTool`, `JSONSchemaProperty`

### Subpath export: `armorer/adapters/gemini` (also `armorer/gemini`)

- `toGemini(input)`: converts a tool, tool array, or `Armorer` to Gemini function declarations (`GeminiFunctionDeclaration` or array)
- Type helper: `GeminiTool` for wrapper objects with `functionDeclarations`
- Types: `GeminiFunctionDeclaration`, `GeminiSchema`, `GeminiTool`

### Subpath export: `armorer/claude-agent-sdk`

Claude Agent SDK adapter for integrating Armorer tools with `@anthropic-ai/claude-agent-sdk`.

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

### Subpath export: `armorer/tools`

Pre-configured tools for common agentic workflows.

#### Search Tools Tool

A tool that searches for other tools in an Armorer registry, enabling semantic tool discovery in agentic workflows.

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
import { createArmorer } from 'armorer/runtime';
import { createSearchTool } from 'armorer/tools';

const armorer = createArmorer();
// ... register tools

const searchTool = createSearchTool(armorer);
const results = await searchTool({ query: 'send message' });
// [{ name: 'send-email', description: '...', score: 1.5 }, ...]
```

See [Search Tools Tool](search-tools.md) for complete documentation.
