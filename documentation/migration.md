# Migration Guide

This guide summarizes the core/runtime split and the new subpath exports.

## Entry Points

Before:

```ts
import { createArmorer, createTool } from 'armorer';
```

After (recommended):

```ts
import { createArmorer, createTool } from 'armorer/runtime';
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

## ToolError Model

`ToolResult.error` is now a structured object:

```ts
const result = await tool.execute(call);
if (result.error) {
  console.log(result.error.message);
  console.log(result.error.category);
  console.log(result.error.retryable);
}
```

The `errorMessage` and `errorCategory` fields remain for compatibility, but are deprecated.

## Tool IDs and Registry Resolution

Core now provides canonical ToolId helpers:

```ts
import { formatToolId, parseToolId, normalizeIdentity } from 'armorer/core';
```

`registry.get()` requires a fully qualified ToolId (with version). Use `registry.resolve()` when you want version/alias selection.

## JSON Schema / Serialization

Provider-neutral serialization lives in core:

```ts
import { serializeToolDefinition } from 'armorer/core';
```

OpenAI-specific formatting is now in the adapter:

```ts
import { toOpenAI } from 'armorer/adapters/openai';
```

`toClaudeAgentSdkTools` and `createClaudeAgentSdkServer` are now async to allow lazy SDK loading.

`toJSONSchema` was removed; use `serializeToolDefinition` for provider-neutral output or `toOpenAI` for OpenAI tool formatting.
