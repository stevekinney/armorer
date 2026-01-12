# MCP Server

## Overview

Expose an Armorer registry as an MCP server and register tools/resources/prompts.

Expose an Armorer registry as an MCP server.

```typescript
import { createArmorer, createTool } from 'armorer';
import { createMCP } from 'armorer/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const armorer = createArmorer();
createTool(
  {
    name: 'sum',
    description: 'adds two numbers',
    schema: z.object({ a: z.number(), b: z.number() }),
    async execute({ a, b }) {
      return a + b;
    },
  },
  armorer,
);

const mcp = createMCP(armorer, {
  serverInfo: { name: 'armorer-tools', version: '0.1.0' },
});

await mcp.connect(new StdioServerTransport());
```

### Tool metadata mapping

You can declare MCP-specific metadata on tools. `createMCP` reads `metadata.mcp` by default.

```typescript
createTool(
  {
    name: 'status',
    description: 'reports status',
    schema: z.object({}),
    metadata: {
      mcp: {
        title: 'Status Tool',
        outputSchema: z.object({ ok: z.boolean() }),
        annotations: { readOnlyHint: true },
        execution: { taskSupport: 'optional' },
        meta: { source: 'armorer' },
      },
    },
    async execute() {
      return { ok: true };
    },
  },
  armorer,
);
```

You can override or extend this with `toolConfig`:

```typescript
const mcp = createMCP(armorer, {
  toolConfig: (tool) => ({
    title: tool.name.toUpperCase(),
  }),
});
```

### Resources and prompts

Register additional MCP resources and prompts via registrars:

```typescript
const mcp = createMCP(armorer, {
  resources: (server) => {
    server.registerResource(
      'readme',
      'armorer://readme',
      { title: 'README' },
      async () => ({
        contents: [{ uri: 'armorer://readme', text: 'hello' }],
      }),
    );
  },
  prompts: (server) => {
    server.registerPrompt('hello', { description: 'say hello' }, async () => ({
      messages: [{ role: 'assistant', content: { type: 'text', text: 'hello' } }],
    }));
  },
});
```
