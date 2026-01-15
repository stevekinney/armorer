# Armorer

A lightweight, type-safe registry for validated AI tools. Build tools with Zod schemas and metadata, register them in an armorer, execute them, and query/rank them with registry helpers and event hooks.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [License](#license)

## Overview

Armorer turns tool calling into a structured, observable, and searchable workflow. Define schemas once, validate at runtime, and export tools to popular providers without rewriting adapters.

## Features

- Zod-powered schema validation with TypeScript inference
- Central tool registry with execution, policy, and event hooks
- Query + search helpers with scoring and metadata filters
- Provider adapters for OpenAI, Anthropic, and Gemini
- Tool composition utilities (pipe/compose/bind/when/parallel/retry)
- MCP server integration for exposing tools over MCP
- Concurrency controls and execution tracing hooks

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

## Safety, Policy, and Metadata

Armorer supports registry-level policy hooks and per-tool policy for centralized guardrails.
You can also tag tools as mutating or read-only and enforce those tags at the registry.

```ts
import { createArmorer, createTool } from 'armorer';
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
- `metadata.concurrency: number` sets a per-tool concurrency limit

Registry options for enforcement:

- `readOnly: true` denies mutating tools automatically
- `allowMutation: false` denies mutating tools automatically

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

## Documentation

Longer-form docs live in `documentation/`:

- [Documentation index](documentation/index.md)
- [Creating Tools](documentation/creating-tools.md)
- [Armorer Registry](documentation/registry.md)
- [Provider Adapters](documentation/provider-adapters.md)
- [MCP Server](documentation/mcp.md)
- [Tool Composition](documentation/tool-composition.md)
- [Public API Reference](documentation/api-reference.md)

## License

MIT. See `LICENSE`.
