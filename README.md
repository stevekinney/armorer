# Quartermaster

A lightweight, type-safe registry for validated AI tools. Build tools with Zod schemas and metadata, register them in a quartermaster, and execute/query them with event hooks.

## Why Quartermaster?

AI tool-calling is often the "wild west" of your application. Managing a growing list of functions, validating LLM-generated arguments, and tracking execution across different providers can quickly become a maintenance nightmare.

**Quartermaster** transforms your tools from loose functions into a structured, observable, and searchable "armory."

- **Zod-Powered Type Safety**: Define your tool's schema once. Quartermaster handles validation and provides full TypeScript inference, so you never have to guess what's in your `params`.
- **Provider Agnostic**: Whether you're using OpenAI, Anthropic, Gemini, or a local Llama model, Quartermaster speaks their language by generating standard JSON Schemas.
- **Deep Observability**: With a built-in event system, you can hook into every stage of a tool's lifecycle—track progress, log errors, or update UIs in real-time as the LLM works.
- **Dynamic Discovery**: Don't just hardcode a list of tools. Use the powerful query system to find tools by tags, metadata, or schema shape, allowing your agent to discover the capabilities it needs on the fly.

## Features

- **Type-Safe Tools**: Define tools with Zod schemas for runtime validation and TypeScript inference
- **Tool Registry**: Register, query, and execute tools from a central registry
- **Event System**: Listen to tool lifecycle events (start, success, error, progress)
- **Query System**: Find tools by tags, schemas, text search, or custom predicates
- **AbortSignal Support**: Cancel tool execution with standard AbortController
- **Metadata Support**: Attach custom metadata to tools for filtering and categorization
- **Zero Dependencies on LLM Providers**: Works with any LLM that supports tool calling

## Installation

```bash
# npm
npm install quartermaster zod

# bun
bun add quartermaster zod

# pnpm
pnpm add quartermaster zod
```

## Quick Start

```typescript
import { createQuartermaster, createTool } from 'quartermaster';
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

// Create a quartermaster and register tools
const qm = createQuartermaster();
qm.register(addNumbers.toolConfiguration);

// Execute a tool call (as you'd receive from an LLM)
const result = await qm.execute({
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
const builder = withContext({ userId: 'user-123', apiKey: 'secret' });

const userTool = builder({
  name: 'get-user-data',
  description: 'Fetch user data',
  schema: z.object({}),
  async execute(_params, context) {
    // Access context.userId and context.apiKey
    return { userId: context.userId };
  },
});
```

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

## Quartermaster Registry

### Registration

```typescript
const qm = createQuartermaster();

// Register individual tools
qm.register(tool1.toolConfiguration);
qm.register(tool2.toolConfiguration, tool3.toolConfiguration);

// Or initialize with tools
const qm = createQuartermaster([tool1.toolConfiguration, tool2.toolConfiguration]);
```

### Execution

```typescript
// Execute a single tool call
const result = await qm.execute({
  id: 'call-id',
  name: 'tool-name',
  arguments: { key: 'value' },
});

// Execute multiple tool calls
const results = await qm.execute([
  { id: 'call-1', name: 'tool-a', arguments: { x: 1 } },
  { id: 'call-2', name: 'tool-b', arguments: { y: 2 } },
]);
```

### Querying Tools

```typescript
// Query by tag (fuzzy match)
const mathTools = await qm.query('math');

// Query by multiple tags (OR match)
const tools = await qm.query({ tags: ['math', 'utility'] });

// Query by text (searches name, description, tags, schema keys)
const tools = await qm.query({ text: 'weather' });

// Query by schema shape
const tools = await qm.query(z.object({ city: z.string() }));

// Query with forbidden tags (exclusion)
const safeTools = await qm.query({ forbiddenTags: ['destructive', 'dangerous'] });

// Query with intent tags (ranking)
const rankedTools = await qm.query({ intentTags: ['fast', 'reliable'] });

// Query by metadata predicate
const premiumTools = await qm.query({
  metadata: (meta) => meta?.tier === 'premium',
});

// Custom predicate
const tools = await qm.query((tool) => tool.tags?.includes('api'));
```

### Registry Events

```typescript
qm.addEventListener('registered', (event) => {
  console.log('Registered:', event.detail.name);
});

qm.addEventListener('call', (event) => {
  console.log('Calling:', event.detail.call.name);
});

qm.addEventListener('complete', (event) => {
  console.log('Completed:', event.detail.result);
});

qm.addEventListener('error', (event) => {
  console.error('Error:', event.detail.result.error);
});

qm.addEventListener('status:update', (event) => {
  console.log(`${event.detail.name}: ${event.detail.status}`);
});
```

### Context Injection

Pass shared context to all registered tools:

```typescript
const qm = createQuartermaster([], {
  context: {
    userId: 'user-123',
    sessionId: 'session-456',
  },
});

qm.register({
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
const inspection = qm.inspect(); // 'standard' detail level
const summary = qm.inspect('summary'); // Less detail
const full = qm.inspect('full'); // Full schema shapes

console.log(inspection.counts.total); // Number of registered tools
console.log(inspection.tools); // Array of tool inspections
```

### Serialization

```typescript
// Export for storage/transmission
const serialized = qm.toJSON();

// Rehydrate from serialized state
const restored = createQuartermaster(serialized);
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

## API Reference

### `createTool(options)`

Creates a new tool with validation and event support.

**Options:**

- `name`: Tool name (string)
- `description`: Tool description (string)
- `schema`: Zod schema for input validation
- `execute`: Async function that implements the tool
- `tags?`: Array of kebab-case tags
- `metadata?`: Custom metadata object

**Returns:** A callable tool with methods:

- `tool(params)`: Execute the tool directly
- `tool.execute(toolCall, options?)`: Execute with tool call format
- `tool.executeWith(options)`: Execute with extended options
- `tool.addEventListener(type, listener)`: Listen to events
- `tool.toJSON()`: Get JSON schema representation

### `createQuartermaster(tools?, options?)`

Creates a new tool registry.

**Options:**

- `signal?`: AbortSignal for cleanup
- `context?`: Shared context for all tools
- `toolFactory?`: Custom tool factory function

**Returns:** Registry with methods:

- `register(...configs)`: Register tool configurations
- `execute(call)`: Execute a tool call
- `query(criteria?)`: Query registered tools
- `getTool(name)`: Get a specific tool
- `getMissingTools(names)`: Get names of unregistered tools
- `hasAllTools(names)`: Check if all tools are registered
- `inspect(detailLevel?)`: Inspect the registry
- `toJSON()`: Serialize the registry
- `addEventListener(type, listener)`: Listen to events

### Query Predicates

Standalone functions for building custom queries:

```typescript
import {
  byTag,
  byForbiddenTags,
  bySchema,
  fuzzyText,
  schemaContainsKeys,
  rankByIntent,
} from 'quartermaster';
```

## TypeScript

Quartermaster is written in TypeScript and provides full type inference:

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
