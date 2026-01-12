# Armorer

A lightweight, type-safe registry for validated AI tools. Build tools with Zod schemas and metadata, register them in an armorer, execute them, and query/rank them with registry helpers and event hooks.

## Why Armorer?

AI tool-calling is often the "wild west" of your application. Managing a growing list of functions, validating LLM-generated arguments, and tracking execution across different providers can quickly become a maintenance nightmare.

**Armorer** transforms your tools from loose functions into a structured, observable, and searchable "armory."

- **Zod-Powered Type Safety**: Define your tool's schema once. Armorer handles validation and provides full TypeScript inference, so you never have to guess what's in your `params`.
- **Provider Agnostic**: Whether you're using OpenAI, Anthropic, Gemini, or a local Llama model, Armorer speaks their language by generating standard JSON Schemas.
- **Deep Observability**: With a built-in event system, you can hook into every stage of a tool's lifecycle—track progress, log errors, or update UIs in real-time as the LLM works.
- **Dynamic Discovery**: Don't just hardcode a list of tools. Use the registry helpers to find tools by tags, metadata, or schema shape, allowing your agent to discover the capabilities it needs on the fly.

## Features

- **Type-Safe Tools**: Define tools with Zod schemas for runtime validation and TypeScript inference
- **Tool Registry**: Register and execute tools from a central registry
- **Event System**: Listen to tool lifecycle events (start, success, error, progress)
- **Query + Search**: Filter tools by tags/schema/metadata and rank matches with scores + reasons
- **Provider Adapters**: One-line export to OpenAI, Anthropic, and Google Gemini formats
- **Tool Composition**: Chain and specialize tools with `pipe()`, `compose()`, `bind()`, `tap()`, `when()`, `parallel()`, `retry()`, `preprocess()`, and `postprocess()`
- **Pipelines Are Tools**: Composed pipelines are full tools you can register, query via registry helpers, serialize, and export
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
const toolCall = await armorer.execute({
  id: 'call-123',
  name: 'add-numbers',
  arguments: { a: 5, b: 3 },
});

console.log(toolCall.result); // 8
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

Tools are callable. `await tool(params)` and `await tool.execute(params)` are equivalent. If you need a `ToolResult` object instead of throwing on errors, use `tool.execute(toolCall)` or `tool.executeWith(...)`.

`executeWith(...)` lets you supply params plus `callId`, `timeoutMs`, and `signal` in a single call, returning a `ToolResult` instead of throwing. `rawExecute(...)` invokes the underlying implementation with a full `ToolContext` when you need precise control over dispatch/meta or to bypass the `ToolCall` wrapper.

Tool schemas must be object schemas (`z.object(...)` or a plain object shape). Tool calls always pass a JSON object for `arguments`, so wrap primitives inside an object (for example, `z.object({ value: z.number() })`).

You can use `isTool(obj)` to check if an object is a tool:

```typescript
import { isTool, createTool } from 'armorer';

const tool = createTool({ ... });
if (isTool(tool)) {
  // TypeScript knows tool is ArmorerTool here
  console.log(tool.name);
}
```

### Creating and Registering in One Step

You can create a tool and register it with an armorer in one step by passing the armorer as the second argument:

```typescript
const armorer = createArmorer([], {
  context: { userId: 'user-123', apiKey: 'secret' },
});

const tool = createTool(
  {
    name: 'my-tool',
    description: 'A tool with armorer context',
    schema: z.object({ input: z.string() }),
    async execute({ input }, context) {
      // context includes armorer.context automatically
      console.log('User:', context.userId);
      return input.toUpperCase();
    },
  },
  armorer, // Automatically registers the tool
);
```

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

Metadata is a lightweight, out-of-band descriptor for things that should not be part of the tool's input schema. It is useful for discovery and routing (filter/query by tier, cost, capabilities, auth requirements), for UI grouping, or for analytics and policy checks without changing the tool signature.

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

You can supply `execute` as a promise that resolves to a function. To avoid `import()` starting immediately, wrap the dynamic import with `lazy` so it only loads on first execution:

```typescript
import { lazy } from 'armorer/lazy';

const heavyTool = createTool({
  name: 'heavy-tool',
  description: 'Runs an expensive workflow',
  schema: z.object({ input: z.string() }),
  execute: lazy(() => import('./tools/heavy-tool').then((mod) => mod.execute)),
});
```

If the promise rejects or resolves to a non-function, `tool.execute(toolCall)` returns a `ToolResult` with `error` set, and `tool.execute(params)` or calling the tool directly throws an `Error` with the same message.

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
  if (event.detail.percent !== undefined) {
    console.log(`${event.detail.percent}%: ${event.detail.message ?? ''}`);
  } else {
    console.log(event.detail.message ?? 'Progress update');
  }
});
```

### Dispatching Progress Events

To report progress from inside a tool, use the `dispatch` function provided in the `ToolContext` (second argument to `execute`). Emit a `progress` event with an optional `percent` number (0–100) and an optional `message`:

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

Tool configs also support lazy execute functions (import from `armorer/lazy`):

```typescript
import { lazy } from 'armorer/lazy';

armorer.register({
  name: 'lazy-config',
  description: 'Loads on first use',
  schema: z.object({ id: z.string() }),
  execute: lazy(() => import('./tools/lazy-config').then((mod) => mod.execute)),
});
```

Tool configs require an object schema. For a no-params tool config, use `schema: z.object({})`. (Only `createTool` defaults the schema when omitted.)

### Execution

```typescript
// Execute a single tool call
const result = await armorer.execute({
  id: 'call-id',
  name: 'tool-name',
  arguments: { key: 'value' },
});

// Execute multiple tool calls in parallel
const results = await armorer.execute([
  { id: 'call-1', name: 'tool-a', arguments: { x: 1 } },
  { id: 'call-2', name: 'tool-b', arguments: { y: 2 } },
]);
// Returns: ToolResult[] - array of results in the same order as input calls

// Execute with AbortSignal support
const controller = new AbortController();
const results = await armorer.execute(calls, { signal: controller.signal });
```

When executing multiple tool calls, they are executed in parallel using `Promise.all()`. The return value is an array of `ToolResult` objects in the same order as the input calls. You can listen to events from individual tools using `armorer.addEventListener`:

```typescript
// Listen for progress events from any tool during parallel execution
armorer.addEventListener('progress', (event) => {
  console.log(`Tool ${event.detail.tool.name}: ${event.detail.percent}%`);
});

// Listen for execution events
armorer.addEventListener('execute-start', (event) => {
  console.log(`Starting: ${event.detail.tool.name}`);
});

armorer.addEventListener('execute-success', (event) => {
  console.log(`Completed: ${event.detail.tool.name}`, event.detail.result);
});

// All tool events are bubbled up when executing multiple tools:
// - execute-start, validate-success, validate-error
// - execute-success, execute-error, settled
// - progress, output-chunk, log, cancelled, status-update
```

### Querying Tools

```typescript
import { queryTools } from 'armorer/registry';

// Query by tag (OR match)
const mathTools = queryTools(armorer, { tags: { any: ['math'] } });

// Require all tags (AND match)
const fastMath = queryTools(armorer, { tags: { all: ['math', 'fast'] } });

// Exclude tags
const safeTools = queryTools(armorer, { tags: { none: ['destructive', 'dangerous'] } });

// Query by text (name, description, tags, schema keys, metadata keys)
const tools = queryTools(armorer, { text: 'weather' });

// Fuzzy text with field scoping
const fuzzy = queryTools(armorer, {
  text: {
    query: 'weathr',
    mode: 'fuzzy',
    threshold: 0.7,
    fields: ['name', 'description'],
  },
});

// Query by schema keys or shape
const toolsByKeys = queryTools(armorer, { schema: { keys: ['city'] } });
const toolsByShape = queryTools(armorer, {
  schema: { matches: z.object({ city: z.string() }) },
});

// Query by metadata
const premiumTools = queryTools(armorer, { metadata: { eq: { tier: 'premium' } } });
const keyedTools = queryTools(armorer, { metadata: { has: ['capabilities'] } });
const ranged = queryTools(armorer, { metadata: { range: { score: { min: 5 } } } });
const owned = queryTools(armorer, { metadata: { contains: { owner: 'team-' } } });

// Custom predicate
const tools = queryTools(armorer, { predicate: (tool) => tool.tags?.includes('api') });

// Boolean groups + pagination + selection
const summaries = queryTools(armorer, {
  or: [{ tags: { any: ['fast'] } }, { text: 'priority' }],
  not: { tags: { any: ['deprecated'] } },
  select: 'summary',
  limit: 10,
  offset: 10,
});
```

#### Query Details

`queryTools(input, criteria?)` filters tools with AND semantics across the provided criteria. It accepts an armorer registry, a single tool, an array of tools, or any iterable of tools. The `criteria` object is optional; if omitted, all tools are returned.

Core criteria:

- `tags`: `{ any?: string[]; all?: string[]; none?: string[] }` (case-insensitive)
- `text`: `string | { query: string; mode?: 'contains' | 'exact' | 'fuzzy'; fields?: TextQueryField[]; threshold?: number; weights?: Partial<Record<TextQueryField, number>> }`
- `schema`: `{ keys?: string[]; matches?: ToolParametersSchema }`
- `metadata`: `{ has?: string[]; eq?: Record<string, unknown>; contains?: Record<string, string | string[] | number | boolean | null>; startsWith?: Record<string, string>; range?: Record<string, { min?: number; max?: number }>; predicate?: (metadata) => boolean }`
- `predicate`: `(tool) => boolean` for custom filtering

Boolean groups:

- `and`: nested criteria that must all match
- `or`: nested criteria where at least one must match
- `not`: criteria or list of criteria to exclude

Selection and paging:

- `select`: `'tool' | 'name' | 'config' | 'summary'` (default: `tool`)
- `limit` / `offset`: pagination controls
- `includeSchema` / `includeToolConfig`: when `select: 'summary'`, include schema/config

Text query fields (`TextQueryField`) are `name`, `description`, `tags`, `schemaKeys`, and `metadataKeys`. Text queries are tokenized (camelCase, snake_case, and diacritics are normalized) and scores scale with the number of matched tokens. Fuzzy matching uses `threshold` (default `0.7`) to determine a match score.

If the registry was created with `embed`, text queries also use embeddings for semantic matches. Lexical matches still apply, so embeddings only broaden recall rather than replacing the existing behavior.

Embedding matches use cosine similarity over the returned vectors. Queries only consult embeddings when lexical matching fails, and `threshold` applies to the similarity score. You can also disable specific fields by setting their `text.weights` to `0`.

### Selecting Tools (Search)

Use `searchTools` to rank tools and optionally include match explanations:

```typescript
import { searchTools } from 'armorer/registry';

const matches = searchTools(armorer, {
  filter: { tags: { none: ['dangerous'] } },
  rank: {
    tags: ['summarize', 'fast'],
    tagWeights: { fast: 2 },
    text: { query: 'summarize meeting notes', mode: 'fuzzy', threshold: 0.6 },
  },
  explain: true,
  select: 'summary',
  limit: 5,
});

for (const match of matches) {
  console.log(match.tool.name, match.score, match.reasons);
}
```

If you mutate tool metadata or schemas after a search has been cached, refresh the index (this also re-embeds when `embed` is configured):

```typescript
import { reindexSearchIndex } from 'armorer/registry';

reindexSearchIndex(armorer);
```

#### Search Details

`searchTools(input, options?)` filters tools (via `options.filter`) and then ranks the remaining tools. It accepts the same input shapes as `queryTools`. Results are `ToolMatch` objects: `{ tool, score, reasons, matches? }`.

Ranking options:

- `rank.tags`: preferred tags that add weight to tools with matching tags
- `rank.tagWeights`: per-tag weight multipliers. Higher values increase the score contribution of matching tags. For example, `{ fast: 2 }` means tools with the `fast` tag get double the base tag weight added to their score.
- `rank.text`: text ranking query (same shape as `queryTools` text)
- `rank.weights`: `{ tags?: number; text?: number }` (default weights are `1`)

Text ranking scores accumulate across matched query tokens; use `text.weights` to emphasize name vs description vs tags.

When `embed` is configured, search also adds a semantic score from the best-matching text field using cosine similarity. The best field is chosen by highest weighted similarity (`text.weights`), with ties broken by the order of `text.fields`. `matches.embedding` reports the field and raw similarity, while `reasons` include `embedding:<field>:<score>`. Embeddings are treated as a soft ranking signal; use `filter.text` with a `threshold` if you want hard gating.

Explain matches:

- `explain: true` includes `matches` with `fields`, `tags`, `schemaKeys`, `metadataKeys`, and optional `embedding`
- `reasons` entries are strings like `tag:fast` or `text:schema-keys(logId)`

Custom ranking and tie-breaking:

- `ranker`: `(tool, context) => { score, reasons?, matches?, override?, exclude? } | number` for domain-specific scoring
- `tieBreaker`: `'name' | 'none' | ((a, b) => number)` to control order when scores tie

Selection and paging (same as query):

- `select`: `'tool' | 'name' | 'config' | 'summary'`
- `limit` / `offset`
- `includeSchema` / `includeToolConfig`

Example custom ranker:

```typescript
const matches = searchTools(armorer, {
  rank: { text: 'summarize' },
  ranker: (tool, context) => {
    if (tool.metadata?.tier === 'premium') {
      return { score: 5, reasons: ['tier:premium'] };
    }
    return { score: 0 };
  },
  tieBreaker: 'name',
  explain: true,
});
```

#### Embeddings

Provide an embedder to `createArmorer` to enrich text search with embeddings. The registry batches the searchable fields for each tool (name, description, tags, schema keys, metadata keys) and stores the resulting vectors on registration. Queries and searches then use embeddings alongside lexical matching when `text` is provided.

The embedder is called with a list of texts and must return a same-length list of numeric vectors; mismatched or invalid vectors are ignored. Embeddings are cached per tool and can be recomputed with `reindexSearchIndex`.

```typescript
const armorer = createArmorer([], {
  embed: async (texts) => embeddingsClient.embed(texts),
});
```

If the embedder is asynchronous, the first query may fall back to lexical matching until vectors are available; subsequent calls will use embeddings automatically.

#### Type Guards

You can use `isArmorer()` to check if an object is an Armorer registry:

```typescript
import { isArmorer, createArmorer } from 'armorer';

const registry = createArmorer();
if (isArmorer(registry)) {
  // TypeScript knows registry is Armorer here
  const tools = registry.tools();
  const inspection = registry.inspect();
}
```

This is useful when working with functions that accept multiple types and you need to determine the type at runtime.

#### Middleware

You can transform tool configurations during registration using middleware. Middleware functions receive a tool configuration and return a (possibly modified) configuration. Middleware is applied in order before the tool is built.

```typescript
import { createArmorer, createMiddleware } from 'armorer';

// Create middleware to add metadata
const addSourceMetadata = createMiddleware((config) => ({
  ...config,
  metadata: { ...config.metadata, source: 'middleware' },
}));

// Create middleware to validate configurations
const validateConfig = createMiddleware((config) => {
  if (!config.name || config.name.length < 3) {
    throw new Error('Tool name must be at least 3 characters');
  }
  return config;
});

const armorer = createArmorer([], {
  middleware: [validateConfig, addSourceMetadata],
});

// All registered tools will have the middleware applied
armorer.register(myTool);
```

#### getTool() for Deserialization

When deserializing an armorer (loading from JSON), tool configurations may not have execute functions. Use `getTool()` to provide execute functions dynamically. The resolver must be synchronous.

```typescript
const armorer = createArmorer(serializedConfigs, {
  getTool: (config) => {
    // Map to a preloaded execute function based on config.name
    return toolMap[config.name];
  },
});
```

#### Pre-computed Embeddings in Metadata

You can also store pre-computed embeddings directly on tool metadata to skip embedding computation during registration. This is useful when you already have embeddings from another source or want to pre-compute them offline.

```typescript
const tool = createTool({
  name: 'pre-embedded-tool',
  description: 'A tool with pre-computed embeddings',
  schema: z.object({ input: z.string() }),
  metadata: {
    // Store embeddings as an array of EmbeddingEntry objects
    embeddings: [
      { field: 'name', text: 'pre-embedded-tool', vector: [0.1, 0.2, ...], magnitude: 1.0 },
      { field: 'description', text: 'A tool with pre-computed embeddings', vector: [0.3, 0.4, ...], magnitude: 1.0 },
    ],
    // Or as a single embedding property (alternative format)
    embedding: {
      name: [0.1, 0.2, ...],
      description: [0.3, 0.4, ...],
    },
  },
  async execute({ input }) {
    return input.toUpperCase();
  },
});

// When registering with an armorer that has an embedder,
// tools with pre-computed embeddings will skip embedding computation
const armorer = createArmorer([tool], {
  embed: async (texts) => {
    // This won't be called for tools that already have embeddings in metadata
    return embeddingsClient.embed(texts);
  },
});
```

The armorer will automatically detect and use embeddings from `metadata.embeddings` (array format) or `metadata.embedding` (object format) if present, avoiding redundant embedding computation.

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

`armorer.inspect()` returns a snapshot of the registry for logging, diagnostics, or UI inventory screens. It reports counts plus a list of tool inspections. Detail levels control how much schema and metadata information is included: `summary` returns only name/description/tags, `standard` (default) adds schema keys and metadata flags, and `full` adds a simplified schema shape for each tool. Inspection is side-effect free and returns copies so you can safely log or mutate the output.

```typescript
const inspection = armorer.inspect(); // 'standard' detail level
const summary = armorer.inspect('summary'); // Less detail
const full = armorer.inspect('full'); // Full schema shapes

console.log(inspection.counts.total); // Number of registered tools
console.log(inspection.tools); // Array of tool inspections
```

Example shape (standard detail):

```typescript
const inspection = armorer.inspect();

console.log(inspection.counts); // { total, withTags, withMetadata }
console.log(inspection.tools[0]);
// {
//   name: 'fetch-weather',
//   description: 'Get current weather for a location',
//   tags: ['weather', 'api', 'external'],
//   schema: { keys: ['city', 'units'] },
//   metadata: { hasCustomMetadata: true, capabilities: ['read'], effort: 'low' }
// }
```

### Serialization

```typescript
// Export for storage/transmission
const serialized = armorer.toJSON();

// Rehydrate from serialized state
const restored = createArmorer(serialized);
```

`SerializedArmorer` is a `ToolConfig[]` that includes execute functions, so it is meant for in-process cloning. Functions are not JSON-serializable, so `JSON.stringify(armorer.toJSON())` will drop them. If you need cross-process persistence, store your own manifest (name, schema, metadata, module path) and rebuild configs at startup, typically using `lazy(() => import(...))` for the execute function.

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

Chain and specialize tools with `pipe()`, `compose()`, `bind()`, `tap()`, `when()`, `parallel()`, and `retry()`. The output of each tool flows as input to the next, with full TypeScript type inference preserved across the chain. Composition helpers are exported from `armorer/utilities` to keep the core export small.

Pipelines are first-class tools. The result of `pipe()` or `compose()` is an `ArmorerTool`, so you can register it, query it via registry helpers, serialize it, and export it to provider adapters just like any other tool.

### pipe()

Chains tools left-to-right (data flows forward):

```typescript
import { createTool } from 'armorer';
import { pipe } from 'armorer/utilities';
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
import { compose } from 'armorer/utilities';

// compose(c, b, a) is equivalent to pipe(a, b, c)
const pipeline = compose(stringify, double, parseNumber);

const result = await pipeline({ str: '21' });
console.log(result); // "Result: 42"
```

### bind()

Bind some or all parameters of a tool and get back a new tool that only needs the remaining inputs. Bound keys are removed from the new tool's schema; any provided values for those keys are ignored in favor of the bound values.

Optional third argument: `{ name?: string; description?: string }`.

```typescript
import { createTool } from 'armorer';
import { bind } from 'armorer/utilities';

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

### tap()

Run a side effect after a tool and pass through its output unchanged.

```typescript
import { tap } from 'armorer/utilities';

const loggedFetch = tap(fetchUser, (user) => {
  console.log('Fetched user', user.id);
});

const user = await loggedFetch({ id: 'user-123' });
```

### when()

Branch between tools based on a predicate. If no else tool is provided, the input is returned unchanged.

```typescript
import { when } from 'armorer/utilities';

const route = when(({ severity }) => severity === 'high', sendAlert, logTicket);

await route({ severity: 'high' });
```

### parallel()

Run multiple tools with the same input concurrently and return their outputs in order.

```typescript
import { parallel } from 'armorer/utilities';

const fanout = parallel(fetchUser, fetchOrders, fetchUsage);
const [user, orders, usage] = await fanout({ id: 'user-123' });
```

### retry()

Retry a tool on failure with configurable attempts and backoff.

```typescript
import { retry } from 'armorer/utilities';

const reliableFetch = retry(fetchUser, {
  attempts: 3,
  delayMs: 200,
  backoff: 'exponential',
});

const user = await reliableFetch({ id: 'user-123' });
```

### preprocess()

Transform inputs before they're passed to a tool. Useful for normalizing, validating, or enriching input data.

```typescript
import { preprocess } from 'armorer/utilities';

const addNumbers = createTool({
  name: 'add-numbers',
  schema: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => a + b,
});

// Preprocess to convert string numbers to actual numbers
const addNumbersWithPreprocessing = preprocess(
  addNumbers,
  async (input: { a: string; b: string }) => ({
    a: Number(input.a),
    b: Number(input.b),
  }),
);

// Now accepts string inputs
const result = await addNumbersWithPreprocessing({ a: '5', b: '3' });
console.log(result); // 8
```

### postprocess()

Transform outputs after a tool executes. Useful for formatting, enriching, or normalizing output data.

```typescript
import { postprocess } from 'armorer/utilities';

const fetchUser = createTool({
  name: 'fetch-user',
  schema: z.object({ id: z.string() }),
  execute: async ({ id }) => ({ userId: id, name: 'John' }),
});

// Postprocess to format the output
const fetchUserFormatted = postprocess(fetchUser, async (output) => ({
  ...output,
  displayName: `${output.name} (${output.userId})`,
}));

// Returns enriched output
const result = await fetchUserFormatted({ id: '123' });
// { userId: '123', name: 'John', displayName: 'John (123)' }
```

### Composed Tools are Tools

Pipelines created with `pipe()` or `compose()`, as well as tools created with `bind()`, `tap()`, `when()`, `parallel()`, `retry()`, `preprocess()`, and `postprocess()`, are valid tools in their own right. They implement the full `ArmorerTool` interface (and pass `isTool()`), so you can register, query via registry helpers, serialize, and adapt them just like any other tool.

```typescript
import { isTool } from 'armorer';
import { pipe } from 'armorer/utilities';

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
import { PipelineError } from 'armorer/utilities';

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

#### `createArmorer(serialized?, options?)`

Creates a registry of tools. `serialized` can be a `SerializedArmorer` created by `armorer.toJSON()`.

Options (`ArmorerOptions`):

- `signal?`: `MinimalAbortSignal` used to clear listeners on abort
- `context?`: `ArmorerContext` merged into tool execution context
- `embed?`: `(texts: string[]) => number[][] | Promise<number[][]>` for semantic search
- `toolFactory?`: `(configuration, { dispatchEvent, baseContext, buildDefaultTool }) => ArmorerTool`
- `getTool?`: `(configuration: Omit<ToolConfig, 'execute'>) => ToolConfig['execute']` - Called when a tool configuration doesn't have an execute method (typically when deserializing)
- `middleware?`: Array of `ToolMiddleware` functions to transform tool configurations during registration (must be synchronous when deserializing)

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
- `Embedder`: `(texts: string[]) => number[][] | Promise<number[][]>`
- `EmbeddingVector`: numeric vector returned by `Embedder`
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

### Subpath export: `armorer/openai`

- `toOpenAI(input)`: converts a tool, tool array, or `Armorer` to OpenAI Chat Completions tools (`OpenAITool` or `OpenAITool[]`)
- Types: `JSONSchema`, `OpenAIFunction`, `OpenAITool`

### Subpath export: `armorer/anthropic`

- `toAnthropic(input)`: converts a tool, tool array, or `Armorer` to Anthropic Messages tools (`AnthropicTool` or `AnthropicTool[]`)
- Types: `AnthropicInputSchema`, `AnthropicTool`, `JSONSchemaProperty`

### Subpath export: `armorer/gemini`

- `toGemini(input)`: converts a tool, tool array, or `Armorer` to Gemini function declarations (`GeminiFunctionDeclaration` or array)
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
