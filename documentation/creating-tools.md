# Creating Tools

## Overview

Define tools with Zod schemas, validation, and typed execution contexts.

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
