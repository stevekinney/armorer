# Armorer

A lightweight, type-safe registry for validated AI tools. Build tools with Zod schemas and metadata, register them in an armorer, execute them, and query/rank them with registry helpers and event hooks.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Core vs Runtime](#core-vs-runtime)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Safety, Policy, and Metadata](#safety-policy-and-metadata)
- [Creating Tools](#creating-tools)
- [TypeScript](#typescript)
- [Documentation](#documentation)
- [Migration Guide](#migration-guide)
- [License](#license)

## Overview

Armorer turns tool calling into a structured, observable, and searchable workflow. Define schemas once, validate at runtime, and export tools to popular providers without rewriting adapters.

## Features

- Zod-powered schema validation with TypeScript inference
- Central tool registry with execution, policy, and event hooks
- Query + search helpers with scoring and metadata filters
- Semantic search with vector embeddings (OpenAI, Pinecone, etc.)
- Provider adapters for OpenAI, Anthropic, and Gemini
- Tool composition utilities (pipe/compose/bind/when/parallel/retry)
- **Dry Run Support**: Preview tool effects before execution
- **OpenTelemetry Instrumentation**: Native tracing for agentic loops
- **Built-in Middleware**: Caching, Rate Limiting, and Timeouts
- **Testing Utilities**: Mock tools and test registries for easy verification
- MCP server integration for exposing tools over MCP
- Claude Agent SDK and OpenAI Agents SDK integrations with tool gating
- Concurrency controls and execution tracing hooks
- Pre-configured search tool for semantic tool discovery in agentic workflows

## Core vs Runtime

Armorer splits tool definitions from execution so you can import only what you need:

- `armorer/core`: tool specs, registry/search, ToolError model, serialization, and minimal context types
- `armorer/runtime`: execution, policies, createTool/createArmorer, composition utilities (pipe/parallel/retry)
- `armorer/instrumentation`: OpenTelemetry auto-instrumentation
- `armorer/middleware`: standard middleware (cache, rate-limit, timeout)
- `armorer/test`: testing utilities (mock tools, test registry)
- `armorer/adapters/*`: provider formatting (OpenAI/Anthropic/Gemini)
- `armorer/mcp`, `armorer/claude-agent-sdk`, and `armorer/openai-agents-sdk`: optional integrations

```typescript
import { defineTool, createRegistry } from 'armorer/core';
import { createArmorer, createTool } from 'armorer/runtime';
import { instrument } from 'armorer/instrumentation';
import { createCacheMiddleware } from 'armorer/middleware';
```

## Quick Start

```typescript
import { createArmorer, createTool } from 'armorer/runtime';
import { z } from 'zod';

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

const armorer = createArmorer();
armorer.register(addNumbers);

const toolCall = await armorer.execute({
  id: 'call-123',
  name: 'add-numbers',
  arguments: { a: 5, b: 3 },
});

console.log(toolCall.result); // 8
```

## Safety and Dry Run

Armorer supports `dryRun` to preview the effects of a tool without executing it.

```ts
const deleteFile = createTool({
  name: 'fs.delete',
  description: 'Delete a file',
  schema: z.object({ path: z.string() }),
  async execute({ path }) {
    await fs.unlink(path);
    return { deleted: true };
  },
  async dryRun({ path }) {
    return { effect: `Would delete file at ${path}` };
  },
});

const result = await deleteFile.execute({ path: 'log.txt' }, { dryRun: true });
console.log(result.dryRun); // true
console.log(result.content); // { effect: "Would delete file at log.txt" }
```

## Observability (OpenTelemetry)

Native instrumentation for distributed tracing.

```ts
import { createArmorer } from 'armorer/runtime';
import { instrument } from 'armorer/instrumentation';

const armorer = createArmorer();
instrument(armorer); // Auto-wires all tool calls to OTel Spans
```

## Middleware

Batteries-included middleware for production needs.

```ts
import { createArmorer } from 'armorer/runtime';
import { createCacheMiddleware, createRateLimitMiddleware } from 'armorer/middleware';

const armorer = createArmorer([], {
  middleware: [
    createCacheMiddleware({ ttlMs: 60000 }),
    createRateLimitMiddleware({ limit: 100, windowMs: 60000 }),
  ],
});
```

## Testing

Utilities for testing tools and agent logic.

```ts
import { createMockTool, createTestRegistry } from 'armorer/test';

const mock = createMockTool({ name: 'weather' });
mock.mockResolve({ temp: 72 });

const armorer = createTestRegistry();
armorer.register(mock);

await armorer.execute({ name: 'weather', arguments: {} });
console.log(armorer.history[0].call.name); // 'weather'
```

## Safety, Policy, and Metadata

Armorer supports registry-level policy hooks and per-tool policy for centralized guardrails.
You can also tag tools as mutating or read-only and enforce those tags at the registry. See the [Registry documentation](documentation/registry.md) for details on querying, searching, and middleware.

```ts
import { createArmorer, createTool } from 'armorer/runtime';
import { z } from 'zod';

const armorer = createArmorer([], {
  readOnly: true,
  policy: {
    beforeExecute({ toolName, metadata }) {
      if (metadata?.mutates) {
        return { allow: false, reason: `${toolName} is mutating` };
      }
    },
  },
  telemetry: true,
});

const writeFile = createTool({
  name: 'fs.write',
  description: 'Write a file',
  schema: z.object({ path: z.string(), content: z.string() }),
  metadata: { mutates: true },
  async execute() {
    return { ok: true };
  },
});

armorer.register(writeFile);
```

Metadata keys with built-in enforcement:

- `metadata.mutates: true` marks a tool as mutating
- `metadata.readOnly: true` marks a tool as read-only
- `metadata.dangerous: true` marks a tool as dangerous
- `metadata.concurrency: number` sets a per-tool concurrency limit

Registry options for enforcement:

- `readOnly: true` denies mutating tools automatically
- `allowMutation: false` denies mutating tools automatically
- `allowDangerous: false` denies dangerous tools automatically

Execution tracing events (opt-in via `telemetry: true`):

- `tool.started` with `startedAt`
- `tool.finished` with `status` and `durationMs`

Per-tool concurrency:

```ts
createTool({
  name: 'git.status',
  description: 'status',
  metadata: { concurrency: 1 },
  schema: z.object({}),
  async execute() {
    return { ok: true };
  },
});
```

## Creating Tools

### Overview

Define tools with Zod schemas, validation, and typed execution contexts. For advanced patterns like chaining tools together, see [Tool Composition](documentation/composition.md).

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
import { isTool, createTool } from 'armorer/runtime';

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

## Search Tool for Agentic Workflows

Armorer includes a pre-configured search tool that lets agents discover available tools dynamically. This is useful when you have many tools and want the LLM to find the right one for a task.

```typescript
import { createArmorer, createTool } from 'armorer/runtime';
import { createSearchTool } from 'armorer/tools';
import { z } from 'zod';

const armorer = createArmorer();

// Install the search tool - it auto-registers with the armorer
createSearchTool(armorer);

// Register your tools (can be done before or after the search tool)
createTool(
  {
    name: 'send-email',
    description: 'Send an email to recipients',
    schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
    tags: ['communication'],
    async execute({ to, subject, body }) {
      return { sent: true };
    },
  },
  armorer,
);

// Agents can now search for tools via armorer.execute()
const result = await armorer.execute({
  name: 'search-tools',
  arguments: { query: 'contact someone' },
});

console.log(result.result);
// [{ name: 'send-email', description: '...', tags: ['communication'], score: 1.5 }]
```

The search tool:

- **Auto-registers** with the armorer when created
- **Discovers tools dynamically** - finds tools registered before or after it
- **Works with provider adapters** - included in `toOpenAI(armorer)`, etc.
- **Supports semantic search** when embeddings are configured on the armorer

See [Search Tool documentation](documentation/search-tools.md) for filtering by tags, configuration options, and agentic workflow examples.

## TypeScript

### Overview

TypeScript inference guidance and type-level patterns. For a complete list of exported types, see the [API Reference](documentation/api-reference.md).

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

## Documentation

Longer-form docs live in `documentation/`:

- [Armorer Registry](documentation/registry.md) - Registration, execution, querying, searching, middleware, and serialization
- [Tool Composition](documentation/composition.md) - `pipe`, `compose`, `bind`, `tap`, `when`, `parallel`, `retry`, `preprocess`, `postprocess`
- [Embeddings & Semantic Search](documentation/embeddings.md) - Vector embeddings with OpenAI and Pinecone
- [LanceDB Integration](documentation/lancedb.md) - Serverless vector database for local and cloud deployments
- [Chroma Integration](documentation/chroma.md) - Open-source embedding database with built-in embedding functions
- [Search Tools Tool](documentation/search-tools.md) - Pre-configured tool for semantic tool discovery in agentic workflows
- [AbortSignal Support](documentation/about-signal.md) - Cancellation and timeout handling
- [JSON Schema Output](documentation/json-schema.md) - Export tools as JSON Schema
- [Provider Adapters](documentation/provider-adapters.md) - OpenAI, Anthropic, and Gemini integrations
- [MCP Server](documentation/mcp.md) - Expose tools over Model Context Protocol
- [Claude Agent SDK](documentation/claude-agent-sdk.md) - Integration with `@anthropic-ai/claude-agent-sdk` including tool gating
- [OpenAI Agents SDK](documentation/openai-agents-sdk.md) - Integration with `@openai/agents` including tool gating
- [Public API Reference](documentation/api-reference.md) - Complete API reference with all exports and types
- [Migration Guide](documentation/migration.md) - Upgrade notes and import changes for core/runtime split
- [Development](documentation/development.md) - Local development workflows

## Migration Guide

See `documentation/migration.md` for before/after import examples, error model updates, and adapter path changes.

## License

MIT. See `LICENSE`.
