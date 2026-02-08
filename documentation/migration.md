# Migration Guide

This guide summarizes the core/runtime split and the new subpath exports.

## Entry Points

Before:

```ts
import { createToolbox, createTool } from 'armorer';
```

After (recommended):

```ts
import { createToolbox, createTool } from 'armorer';
```

The root import (`armorer`) still works for now, but new code should use the subpaths.

If you only need tool specs, registry/query, or serialization, use core:

```ts
import { defineTool, createRegistry, serializeToolDefinition } from 'armorer/core';
```

## Provider Adapters

Before:

```ts
import { toOpenAI } from 'armorer/openai';
```

After (recommended):

```ts
import { toOpenAI } from 'armorer/adapters/openai';
```

The legacy `armorer/openai`, `armorer/anthropic`, and `armorer/gemini` paths still work.

## MCP and Claude Agent SDK

These are now optional peer dependencies. Install them only if you use the integrations:

```bash
npm install @modelcontextprotocol/sdk @anthropic-ai/claude-agent-sdk
```

Imports remain the same:

```ts
import { createMCP } from 'armorer/mcp';
import { createClaudeAgentSdkServer } from 'armorer/claude-agent-sdk';
```

## ToolResult Model

`ToolResult.error` is now a structured object. The legacy `errorMessage` and `errorCategory` top-level fields have been **removed**.

```ts
const result = await tool.execute(call);
if (result.error) {
  console.log(result.error.message);
  console.log(result.error.category);
  console.log(result.error.retryable);
}
```

## Tool Definition Model

The `ToolDefinition` and `DefineToolOptions` types have been strictly enforced to remove legacy top-level fields.

| Before (Legacy) | After (Recommended)   |
| --------------- | --------------------- |
| `name`          | `identity.name`       |
| `description`   | `display.description` |
| `schema`        | `schema`              |

The `defineTool` and `createTool` functions now require these modern properties.

## Zod 4 Requirement

Toolbox now requires `zod@^4.0.0`. It utilizes the native `z.toJSONSchema` function for deterministic serialization.

## JSON Schema / Serialization

Provider-neutral serialization lives in core:

```ts
import { serializeToolDefinition } from 'armorer/core';
```

OpenAI-specific formatting is now in the adapter:

```ts
import { toOpenAI } from 'armorer/adapters/openai';
```

`toJSONSchema` (OpenAI-shaped) was removed from core; use `toOpenAI` for OpenAI-compatible tool formatting.
