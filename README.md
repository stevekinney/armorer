# Armorer

A lightweight, type-safe registry for validated AI tools. Build tools with Zod schemas and metadata, register them in an armorer, and execute/query them with event hooks.

## Why Armorer?

AI tool-calling is often the "wild west" of your application. Managing a growing list of functions, validating LLM-generated arguments, and tracking execution across different providers can quickly become a maintenance nightmare.

**Armorer** transforms your tools from loose functions into a structured, observable, and searchable "armory."

- **Zod-Powered Type Safety**: Define your tool's schema once. Armorer handles validation and provides full TypeScript inference, so you never have to guess what's in your `params`.
- **Provider Agnostic**: Whether you're using OpenAI, Anthropic, Gemini, or a local Llama model, Armorer speaks their language by generating standard JSON Schemas.
- **Deep Observability**: With a built-in event system, you can hook into every stage of a tool's lifecycle—track progress, log errors, or update UIs in real-time as the LLM works.
- **Dynamic Discovery**: Don't just hardcode a list of tools. Use the powerful query system to find tools by tags, metadata, or schema shape, allowing your agent to discover the capabilities it needs on the fly.

## Features

- **Type-Safe Tools**: Define tools with Zod schemas for runtime validation and TypeScript inference
- **Tool Registry**: Register, query, and execute tools from a central registry
- **Event System**: Listen to tool lifecycle events (start, success, error, progress)
- **Query + Search**: Filter tools by tags/schema/metadata and rank matches with scores + reasons
- **Provider Adapters**: One-line export to OpenAI, Anthropic, and Google Gemini formats
- **Tool Composition**: Chain and specialize tools with `pipe()`, `compose()`, and `bind()`
- **Pipelines Are Tools**: Composed pipelines are full tools you can register, query, serialize, and export
- **AbortSignal Support**: Cancel tool execution with standard AbortController
- **Metadata Support**: Attach custom metadata to tools for filtering and categorization
- **Zero Dependencies on LLM Providers**: Works with any LLM that supports tool calling

## Installation

```bash
# npm
npm install armorer zod

# bun
bun add armorer zod

# pnpm
pnpm add armorer zod
```

## Quick Start

```typescript
import { createArmorer, createTool } from 'armorer';
import { z } from 'zod';

// Create a tool
const addNumbers = createTool({
  name: 'add-numbers',
  description: 'Add two numbers together',
  schema: z.object({
    a: z.number(),
    b: z.number(),
  }),
  tags: ['math', 'calculator'],
  async execute({ a, b }) {
    return a + b;
  },
});

// Create an armorer and register tools
const armorer = createArmorer();
armorer.register(addNumbers);

// Execute a tool call (as you'd receive from an LLM)
const result = await armorer.execute({
  id: 'call-123',
  name: 'add-numbers',
  arguments: { a: 5, b: 3 },
});

console.log(result.result); // 8
```

## Creating Tools

### Basic Tool

```typescript
const greetUser = createTool({
  name: 'greet-user',
  description: 'Greet a user by name',
  schema: z.object({
    name: z.string(),
    formal: z.boolean().optional(),
  }),
  async execute({ name, formal }) {
    return formal ? `Good day, ${name}.` : `Hey ${name}!`;
  },
});
```

Tools are callable. `await tool(params)` and `await tool.execute(params)` are equivalent.
If you need a `ToolResult` object instead of throwing on errors, use
`tool.execute(toolCall)` or `tool.executeWith(...)`.

`executeWith(...)` lets you supply params plus `callId`, `timeoutMs`, and `signal`
in a single call, returning a `ToolResult` instead of throwing. `rawExecute(...)`
invokes the underlying implementation with a full `ToolContext` when you need
precise control over dispatch/meta or to bypass the `ToolCall` wrapper.

Tool schemas must be object schemas (`z.object(...)` or a plain object shape). Tool
calls always pass a JSON object for `arguments`, so wrap primitives inside an
object (for example, `z.object({ value: z.number() })`).

### Tool Without Inputs

If your tool accepts no parameters, omit `schema` (it defaults to `z.object({})`):

```typescript
const healthCheck = createTool({
  name: 'health-check',
  description: 'Verify service is alive',
  async execute() {
    return 'ok';
  },
});
```

### Tool with Metadata

```typescript
const fetchWeather = createTool({
  name: 'fetch-weather',
  description: 'Get current weather for a location',
  schema: z.object({
    city: z.string(),
    units: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  tags: ['weather', 'api', 'external'],
  metadata: {
    requiresAuth: true,
    rateLimit: 100,
    capabilities: ['read'],
  },
  async execute({ city, units = 'celsius' }) {
    // ... fetch weather data
    return { temp: 22, conditions: 'sunny' };
  },
});
```

### Tool with Context

Use `withContext` to inject shared context into tools:

```typescript
const createToolWithContext = withContext({ userId: 'user-123', apiKey: 'secret' });

const userTool = createToolWithContext({
  name: 'get-user-data',
  description: 'Fetch user data',
  schema: z.object({}),
  async execute(_params, context) {
    // Access context.userId and context.apiKey
    return { userId: context.userId };
  },
});
```

### Lazy-Loaded Execute Functions

You can supply `execute` as a promise that resolves to a function. This is useful for
lazy-loading tool code with dynamic imports:

```typescript
const heavyTool = createTool({
  name: 'heavy-tool',
  description: 'Runs an expensive workflow',
  schema: z.object({ input: z.string() }),
  execute: import('./tools/heavy-tool').then((mod) => mod.execute),
});
```

If the promise rejects or resolves to a non-function, `tool.execute(toolCall)` returns a
`ToolResult` with `error` set, and `tool.execute(params)` or calling the tool directly
throws an `Error` with the same message.

### Tool Events

Listen to tool execution lifecycle events:

```typescript
const tool = createTool({
  name: 'my-tool',
  description: 'A tool with events',
  schema: z.object({ input: z.string() }),
  async execute({ input }, { dispatch }) {
    dispatch({ type: 'progress', detail: { percent: 50, message: 'Processing...' } });
    return input.toUpperCase();
  },
});

tool.addEventListener('execute-start', (event) => {
  console.log('Starting:', event.detail.params);
});

tool.addEventListener('execute-success', (event) => {
  console.log('Result:', event.detail.result);
});

tool.addEventListener('execute-error', (event) => {
  console.error('Error:', event.detail.error);
});

tool.addEventListener('progress', (event) => {
  console.log(`${event.detail.percent}%: ${event.detail.message}`);
});
```

### Dispatching Progress Events

To report progress from inside a tool, use the `dispatch` function provided in the
`ToolContext` (second argument to `execute`). Emit a `progress` event with a
`percent` number (0–100) and an optional `message`:

```typescript
const longTask = createTool({
  name: 'long-task',
  description: 'Does work in phases',
  schema: z.object({ input: z.string() }),
  async execute({ input }, { dispatch }) {
    dispatch({ type: 'progress', detail: { percent: 10, message: 'Queued' } });
    // ... do work
    dispatch({ type: 'progress', detail: { percent: 50, message: 'Halfway' } });
    // ... do more work
    dispatch({ type: 'progress', detail: { percent: 100, message: 'Done' } });
    return input.toUpperCase();
  },
});
```

Then subscribe to `progress` on the tool:

```typescript
longTask.addEventListener('progress', (event) => {
  console.log(`${event.detail.percent}%: ${event.detail.message ?? ''}`);
});
```

## Armorer Registry

### Registration

```typescript
const armorer = createArmorer();

// Register individual tools
armorer.register(tool1);
armorer.register(tool2, tool3);

// Or register configurations directly
armorer.register(tool1.configuration, tool2.configuration);

// Or initialize with tool configurations
const armorer = createArmorer([tool1.configuration, tool2.configuration]);

// Or create + register in one step
const registered = armorer.createTool({
  name: 'quick-tool',
  description: 'Registered on creation',
  schema: z.object({ value: z.string() }),
  async execute({ value }) {
    return value.toUpperCase();
  },
});
```

Tool configs also support lazy execute functions:

```typescript
armorer.register({
  name: 'lazy-config',
  description: 'Loads on first use',
  schema: z.object({ id: z.string() }),
  execute: import('./tools/lazy-config').then((mod) => mod.execute),
});
```

Tool configs require an object schema. For a no-params tool config, use
`schema: z.object({})`. (Only `createTool` defaults the schema when omitted.)

### Execution

```typescript
// Execute a single tool call
const result = await armorer.execute({
  id: 'call-id',
  name: 'tool-name',
  arguments: { key: 'value' },
});

// Execute multiple tool calls
const results = await armorer.execute([
  { id: 'call-1', name: 'tool-a', arguments: { x: 1 } },
  { id: 'call-2', name: 'tool-b', arguments: { y: 2 } },
]);
```

### Querying Tools

```typescript
// Query by tag (OR match)
const mathTools = armorer.query({ tags: { any: ['math'] } });

// Require all tags (AND match)
const fastMath = armorer.query({ tags: { all: ['math', 'fast'] } });

// Exclude tags
const safeTools = armorer.query({ tags: { none: ['destructive', 'dangerous'] } });

// Query by text (searches name, description, tags, schema keys)
const tools = armorer.query({ text: 'weather' });

// Query by schema keys or shape
const toolsByKeys = armorer.query({ schema: { keys: ['city'] } });
const toolsByShape = armorer.query({
  schema: { matches: z.object({ city: z.string() }) },
});

// Query by metadata
const premiumTools = armorer.query({ metadata: { eq: { tier: 'premium' } } });
const keyedTools = armorer.query({ metadata: { has: ['capabilities'] } });

// Custom predicate
const tools = armorer.query({ predicate: (tool) => tool.tags?.includes('api') });
```

### Selecting Tools (Search)

Use `search` to rank tools and get explanations for why they matched:

```typescript
const matches = armorer.search({
  filter: { tags: { none: ['dangerous'] } },
  rank: {
    tags: ['summarize', 'fast'],
    text: 'summarize meeting notes',
  },
  limit: 5,
});

for (const match of matches) {
  console.log(match.tool.name, match.score, match.reasons);
}
```

### Registry Events

```typescript
armorer.addEventListener('registered', (event) => {
  console.log('Registered:', event.detail.name);
});

armorer.addEventListener('call', (event) => {
  console.log('Calling:', event.detail.call.name);
});

armorer.addEventListener('complete', (event) => {
  console.log('Completed:', event.detail.result);
});

armorer.addEventListener('error', (event) => {
  console.error('Error:', event.detail.result.error);
});

armorer.addEventListener('search', (event) => {
  console.log('Search results:', event.detail.results);
});

armorer.addEventListener('status:update', (event) => {
  console.log(`${event.detail.name}: ${event.detail.status}`);
});
```

### Context Injection

Pass shared context to all registered tools:

```typescript
const armorer = createArmorer([], {
  context: {
    userId: 'user-123',
    sessionId: 'session-456',
  },
});

armorer.register({
  name: 'context-aware',
  description: 'A tool that uses context',
  schema: z.object({}),
  async execute(_params, context) {
    // Access context.userId and context.sessionId
    console.log('User:', context.userId);
    return 'ok';
  },
});
```

### Inspection

Inspect the registry for debugging:

```typescript
const inspection = armorer.inspect(); // 'standard' detail level
const summary = armorer.inspect('summary'); // Less detail
const full = armorer.inspect('full'); // Full schema shapes

console.log(inspection.counts.total); // Number of registered tools
console.log(inspection.tools); // Array of tool inspections
```

### Serialization

```typescript
// Export for storage/transmission
const serialized = armorer.toJSON();

// Rehydrate from serialized state
const restored = createArmorer(serialized);
```

## AbortSignal Support

Cancel tool execution with standard AbortController:

```typescript
const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort('Timeout'), 5000);

const result = await tool.execute(
  { id: 'call-1', name: 'slow-tool', arguments: {} },
  { signal: controller.signal },
);

if (result.error) {
  console.log('Cancelled:', result.error);
}
```

## JSON Schema Output

Get JSON Schema representation for LLM tool definitions:

The output is plain JSON and safe to serialize.

```typescript
const tool = createTool({
  name: 'my-tool',
  description: 'Does something',
  schema: z.object({ input: z.string() }),
  execute: async () => 'done',
});

const jsonSchema = tool.toJSON();
// {
//   type: 'function',
//   name: 'my-tool',
//   description: 'Does something',
//   strict: true,
//   parameters: { type: 'object', properties: { input: { type: 'string' } }, ... }
// }
```

## Provider Adapters

Export tools in the format expected by different LLM providers. Each adapter is available as a separate subpath export.

### OpenAI

```typescript
import { toOpenAI } from 'armorer/openai';

// Single tool
const openAITool = toOpenAI(myTool);

// Multiple tools
const openAITools = toOpenAI([tool1, tool2]);

// From registry
const openAITools = toOpenAI(armorer);

// Use with OpenAI SDK
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages,
  tools: toOpenAI(armorer),
});
```

### Anthropic

```typescript
import { toAnthropic } from 'armorer/anthropic';

// Single tool
const anthropicTool = toAnthropic(myTool);

// Multiple tools
const anthropicTools = toAnthropic([tool1, tool2]);

// From registry
const anthropicTools = toAnthropic(armorer);

// Use with Anthropic SDK
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  messages,
  tools: toAnthropic(armorer),
});
```

### Google Gemini

```typescript
import { toGemini } from 'armorer/gemini';

// Single tool
const geminiDeclaration = toGemini(myTool);

// Multiple tools
const geminiDeclarations = toGemini([tool1, tool2]);

// From registry
const geminiDeclarations = toGemini(armorer);

// Use with Gemini SDK
const model = genAI.getGenerativeModel({
  model: 'gemini-pro',
  tools: [{ functionDeclarations: toGemini(armorer) }],
});
```

## Tool Composition

Chain and specialize tools with `pipe()`, `compose()`, and `bind()`. The output of each tool flows as input to the next, with full TypeScript type inference preserved across the chain.

Pipelines are first-class tools. The result of `pipe()` or `compose()` is an `ArmorerTool`, so you can register it, query it, serialize it, and export it to provider adapters just like any other tool.

### pipe()

Chains tools left-to-right (data flows forward):

```typescript
import { pipe, createTool } from 'armorer';
import { z } from 'zod';

const parseNumber = createTool({
  name: 'parse-number',
  description: 'Parse string to number',
  schema: z.object({ str: z.string() }),
  execute: async ({ str }) => parseInt(str, 10),
});

const double = createTool({
  name: 'double',
  description: 'Double a number',
  schema: z.object({ value: z.number() }),
  execute: async ({ value }) => ({ value: value * 2 }),
});

const stringify = createTool({
  name: 'stringify',
  description: 'Format as result string',
  schema: z.object({ value: z.number() }),
  execute: async ({ value }) => `Result: ${value}`,
});

// Chain tools together - types flow through automatically
const pipeline = pipe(parseNumber, double, stringify);

// Input type is inferred from first tool: { str: string }
// Output type is inferred from last tool: string
const result = await pipeline({ str: '21' });
console.log(result); // "Result: 42"
```

### compose()

Chains tools right-to-left (mathematical function composition):

```typescript
import { compose } from 'armorer';

// compose(c, b, a) is equivalent to pipe(a, b, c)
const pipeline = compose(stringify, double, parseNumber);

const result = await pipeline({ str: '21' });
console.log(result); // "Result: 42"
```

### bind()

Bind some or all parameters of a tool and get back a new tool that only needs the
remaining inputs. Bound keys are removed from the new tool's schema; any provided
values for those keys are ignored in favor of the bound values.

Optional third argument: `{ name?: string; description?: string }`.

```typescript
import { bind } from 'armorer';

const sendEmail = createTool({
  name: 'send-email',
  description: 'Send an email',
  schema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  async execute({ to, subject, body }) {
    // ...
    return { to, subject, body };
  },
});

const sendAlert = bind(sendEmail, { to: 'alerts@example.com' }, { name: 'send-alert' });
await sendAlert({ subject: 'Outage', body: 'Investigating' });
```

`bind()` operates on object schemas and removes the bound keys from the input shape.

### Composed Tools are Tools

Pipelines created with `pipe()` or `compose()`, as well as tools created with
`bind()`, are valid tools in their own right. They implement the full
`ArmorerTool` interface (and pass `isTool()`), so you can register, query,
serialize, and adapt them just like any other tool.

```typescript
import { isTool } from 'armorer';

const pipeline = pipe(parseNumber, double);
console.log(isTool(pipeline)); // true

// Register in an armorer
armorer.register(pipeline);

// Serialize or export
const json = pipeline.toJSON();

// Listen to events
pipeline.addEventListener('step-start', (e) => {
  console.log(`Step ${e.detail.stepIndex}: ${e.detail.stepName}`);
});

pipeline.addEventListener('step-complete', (e) => {
  console.log(`Step ${e.detail.stepIndex} output:`, e.detail.output);
});

// Compose further
const extendedPipeline = pipe(pipeline, stringify);
```

### Error Handling

Errors are wrapped with step context for debugging:

```typescript
import { PipelineError } from 'armorer';

try {
  await pipeline({ str: 'invalid' });
} catch (e) {
  if (e.message.includes('Pipeline failed at step')) {
    // Error message includes: "Pipeline failed at step 1 (double)"
    console.error(e.message);
  }
}

// Or use executeWith for detailed results
const result = await pipeline.executeWith({ params: { str: '21' } });
if (result.error) {
  console.error('Pipeline error:', result.error);
}
```

## Public API Reference

### Root export: `armorer`

#### `createTool(options)`

Creates a tool with Zod validation, events, and a callable interface.

Options (`CreateToolOptions`):

- `name`: string
- `description`: string
- `schema?`: Zod object schema for input validation (`ToolParametersSchema`) or a
  plain object shape; defaults to `z.object({})`
- `execute`: async `(params: TInput, context: ToolContext) => TOutput` or a
  `Promise` that resolves to that function (for lazy imports)
- `tags?`: kebab-case strings, de-duped
- `metadata?`: `ToolMetadata` bag used for filtering and inspection
- `timeoutMs?`: number (currently unused; prefer `executeWith({ timeoutMs })`)

Returns: `ArmorerTool`.

Exposed properties and methods:

- `tool(params)` call signature
- `name`, `description`, `schema`, `tags`, `metadata`, `configuration`
- `execute(call, options?)`: returns `ToolResult`
- `execute(params, options?)`: returns raw output (same as `tool(params)`)
- `executeWith(options: ToolExecuteWithOptions)`: returns `ToolResult` with `callId`,
  `timeoutMs`, and `signal` support
- `rawExecute(params, context)`: low-level invoke with full `ToolContext`
- `addEventListener`, `dispatchEvent`, `on`, `once`, `subscribe`, `toObservable`, `events`
- `complete()`, `completed`
- Runtime helpers: `toJSON()` (serializable JSON schema output), `toString()`, `Symbol.toPrimitive`

Signature:

```typescript
function createTool<
  TInput extends Record<string, unknown> = Record<string, never>,
  TOutput = unknown,
  E extends ToolEventsMap = DefaultToolEvents,
  Tags extends readonly string[] = readonly string[],
  M extends ToolMetadata | undefined = undefined,
>(options: CreateToolOptions<TInput, TOutput, E, Tags, M>): ArmorerTool;
```

#### `createToolCall(toolName, args, id?)`

Creates a `ToolCall` with `arguments` populated and a generated id if omitted.

Signature:

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

The `execute` function receives `ToolContext & Ctx`. The helper type `WithContext<Ctx>`
models that merge.

#### `createArmorer(serialized?, options?)`

Creates a registry of tools. `serialized` can be a `SerializedArmorer` created by
`armorer.toJSON()`.

Options (`ArmorerOptions`):

- `signal?`: `MinimalAbortSignal` used to clear listeners on abort
- `context?`: `ArmorerContext` merged into tool execution context
- `toolFactory?`: `(configuration, { dispatchEvent, baseContext, buildDefaultTool }) => ArmorerTool`

Registry surface (`Armorer`):

- `register(...entries: (ToolConfig | ArmorerTool)[])`
- `createTool(options)`: create and register a tool in one call
- `execute(call | calls)`
- `query(criteria?: ToolQuery)` (filter-only)
- `search(options?: ToolSearchOptions)` (ranked selection with reasons)
- `getTool(name)`
- `getMissingTools(names)`
- `hasAllTools(names)`
- `inspect(detailLevel?: InspectorDetailLevel)`
- `toJSON(): SerializedArmorer`
- Event methods: `addEventListener`, `dispatchEvent`, `on`, `once`, `subscribe`,
  `toObservable`, `events`
- Lifecycle: `complete()`, `completed`

`register()` accepts tool instances or raw configurations. When you register a tool,
its `configuration` is stored for serialization.
`createTool()` is a convenience that uses the same options as `createTool(options)`,
registers the result, and returns the registered instance.
If `schema` is omitted, it defaults to `z.object({})`.

Signature:

```typescript
const tool = armorer.createTool(options);
```

`ToolConfig.execute` receives `ArmorerToolRuntimeContext`, which includes any base
context plus `dispatchEvent`, `configuration`, and `toolCall`.
`ToolConfig.execute` may also be a `Promise` that resolves to an execute function,
allowing lazy imports.

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
- `progress`: `{ percent, message? }`
- `output-chunk`: `{ chunk }`
- `log`: `{ level, message, data? }`
- `cancelled`: `{ reason? }`
- `status-update`: `{ status }`

Execution and validation events include `toolCall` and `configuration` in their
detail payload.

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

#### Query helpers and types

`ToolQuery` fields include `tags`, `text`, `schema`, `metadata`, and `predicate`.
`TagFilter` supports `any`, `all`, and `none`. `SchemaFilter` supports `keys` and
`matches`. `MetadataFilter` supports `has`, `eq`, and `predicate`. `ToolPredicate`
is `(tool) => boolean`.

`ToolSearchOptions` includes `filter`, `rank`, and `limit`. `ToolSearchRank`
supports `tags`, `text`, and optional `weights`. `ToolMatch` includes
`tool`, `score`, and `reasons`.

Functions:

- `tagsMatchAny(tags)`: match tools that contain any tag
- `tagsMatchAll(tags)`: match tools that contain all tags
- `tagsMatchNone(tags)`: exclude tools that contain any tag
- `schemaMatches(schema)`: loose schema match
- `schemaHasKeys(keys)`: require schema keys
- `textMatches(query)`: search name, description, tags, and schema keys

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

#### Composition API

- `pipe(...tools)`: left-to-right composition (2 to 9 tools); returns an `ArmorerTool`
- `compose(...tools)`: right-to-left composition; returns an `ArmorerTool`
- `bind(tool, bound, options?)`: bind tool parameters; returns an `ArmorerTool`
- `PipelineError`: error with `{ stepIndex, stepName, originalError }`

Composed tools emit `ComposedToolEvents` including `step-start`, `step-complete`,
and `step-error`.

#### Type exports

Registry types:

- `Armorer`: registry interface
- `ArmorerContext`: base context bag for registry execution
- `ArmorerOptions`: options for `createArmorer`
- `ArmorerEvents`: registry event map
- `ArmorerToolRuntimeContext`: context passed to `ToolConfig.execute`
- `QueryResult`: array of `ArmorerTool`
- `SerializedArmorer`: serialized `ToolConfig[]`
- `TagFilter`: tag filters (`any`, `all`, `none`)
- `SchemaFilter`: schema filters (`keys`, `matches`)
- `MetadataFilter`: metadata filters (`has`, `eq`, `predicate`)
- `ToolQuery`: filter-only query input
- `ToolSearchOptions`: search options (filter + rank)
- `ToolSearchRank`: ranking preferences
- `ToolMatch`: search result with score + reasons
- `ToolStatusUpdate`: registry status payload

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

Query types:

- `ToolPredicate`: sync tool predicate

Composition types:

- `AnyTool`: generic tool constraint
- `ToolWithInput`: tool constrained by input type
- `InferToolInput`: extract input type from tool
- `InferToolOutput`: extract output type from tool
- `ComposedTool`: composed tool type
- `ComposedToolEvents`: step event map

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

### Subpath export: `armorer/openai`

- `toOpenAI(input)`: converts a tool, tool array, or `Armorer` to OpenAI
  Chat Completions tools (`OpenAITool` or `OpenAITool[]`)
- Types: `JSONSchema`, `OpenAIFunction`, `OpenAITool`

### Subpath export: `armorer/anthropic`

- `toAnthropic(input)`: converts a tool, tool array, or `Armorer` to
  Anthropic Messages tools (`AnthropicTool` or `AnthropicTool[]`)
- Types: `AnthropicInputSchema`, `AnthropicTool`, `JSONSchemaProperty`

### Subpath export: `armorer/gemini`

- `toGemini(input)`: converts a tool, tool array, or `Armorer` to Gemini
  function declarations (`GeminiFunctionDeclaration` or array)
- Type helper: `GeminiTool` for wrapper objects with `functionDeclarations`
- Types: `GeminiFunctionDeclaration`, `GeminiSchema`, `GeminiTool`

## TypeScript

Armorer is written in TypeScript and provides full type inference:

```typescript
const tool = createTool({
  name: 'typed-tool',
  description: 'A typed tool',
  schema: z.object({
    count: z.number(),
    name: z.string().optional(),
  }),
  async execute(params) {
    // params is typed as { count: number; name?: string }
    return params.count * 2;
  },
});

// Return type is inferred
const result = await tool({ count: 5 }); // number
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run tests with coverage
bun test --coverage

# Type check
bun run typecheck

# Build
bun run build
```

## License

MIT
