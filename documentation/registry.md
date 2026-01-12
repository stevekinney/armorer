# Armorer Registry

## Overview

Register tools, execute tool calls, and query or search the registry.

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
