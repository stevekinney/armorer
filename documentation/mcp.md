# MCP Server

## Overview

Expose an Armorer registry as an MCP server, with tools, resources, and prompts.
Armorer handles tool registration; MCP handles transport and protocol details.

## Prerequisites

- Install the MCP SDK as a runtime dependency (Armorer does not ship transports).
- Have a registry created with `createArmorer()` and tools registered into it.

## Quick start (stdio transport)

```typescript
import { createArmorer, createTool } from 'armorer/runtime';
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

## Streamable HTTP transport (Node.js)

Use the Streamable HTTP server transport to expose MCP over HTTP.

```typescript
import { createMCP } from 'armorer/mcp';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const mcp = createMCP(armorer, {
  serverInfo: { name: 'armorer-tools', version: '0.1.0' },
});

// Create an HTTP transport and hand requests to it.
const transport = new StreamableHTTPServerTransport();

// In your HTTP handler:
// const response = await transport.handleRequest(req);
// res.writeHead(response.status, response.headers);
// res.end(await response.text());

await mcp.connect(transport);
```

If you're running in a web-standard environment (Cloudflare Workers, Deno, Bun),
use the web-standard transport from the MCP SDK instead.

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

#### Tool config precedence

`toolConfigFromMetadata` reads `tool.metadata.mcp`, then `toolConfig` overrides
any overlapping fields. The effective MCP tool config is:

1. `metadata.mcp` (if present and valid)
2. `toolConfig(tool)` (overrides any fields from metadata)
3. Runtime defaults: `description` and `schema` fall back to the tool definition

If `meta` is set by either config, it is exposed as `_meta`. When no `meta` is set,
the tool's `metadata` object is used as `_meta` (if it's a plain object).

### Result formatting

By default, tool results are returned as:

- `content`: text (stringified result)
- `structuredContent`: only when the tool returns a plain object

You can customize this with `formatResult`:

```typescript
const mcp = createMCP(armorer, {
  formatResult: (result) => {
    if (result.outcome === 'error') {
      return {
        content: [{ type: 'text', text: result.error ?? 'Error' }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { data: result.result },
    };
  },
});
```

Thrown exceptions from tool execution are converted into MCP errors with a text payload.
Client aborts are respected via the MCP `signal` that is passed into tool execution.

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

You can pass a single registrar or an array of registrars:

```typescript
const mcp = createMCP(armorer, {
  resources: [registerDocs, registerSchemas],
  prompts: [registerAssistantPrompts],
});
```

### Tool updates

When tools are re-registered in the Armorer registry, the MCP server refreshes
the tool definitions and notifies connected clients with `toolListChanged`.

## Agent SDK integrations

### OpenAI Agents SDK (`@openai/agents`)

#### stdio (local subprocess)

Run an Armorer MCP server as a local process and let the agent SDK spawn it.

```typescript
// mcp-server.ts
import { createArmorer, createTool } from 'armorer/runtime';
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

```typescript
// agent.ts
import { Agent, MCPServerStdio, run } from '@openai/agents';

const server = new MCPServerStdio({
  name: 'armorer-tools',
  command: 'node',
  args: ['dist/mcp-server.js'],
});

const agent = new Agent({
  name: 'Assistant',
  instructions: 'Use MCP tools to answer the question.',
  mcpServers: [server],
});

const result = await run(agent, 'Add 7 and 22.');
console.log(result.finalOutput);
```

#### Streamable HTTP

Expose Armorer over HTTP and connect via the Streamable HTTP MCP server.

```typescript
import { Agent, MCPServerStreamableHttp, run } from '@openai/agents';

const server = new MCPServerStreamableHttp({
  url: 'http://localhost:8000/mcp',
  name: 'armorer-tools',
  requestInit: {
    headers: { Authorization: `Bearer ${process.env.MCP_SERVER_TOKEN}` },
  },
  cacheToolsList: true,
});

const agent = new Agent({
  name: 'Assistant',
  instructions: 'Use MCP tools to answer the question.',
  mcpServers: [server],
});

const result = await run(agent, 'Add 7 and 22.');
console.log(result.finalOutput);
```

### Anthropic Agent SDK (`@anthropic-ai/claude-agent-sdk`)

Use the in-process MCP server instance with the SDK `mcpServers` config.

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createArmorer, createTool } from 'armorer/runtime';
import { createMCP } from 'armorer/mcp';
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

const result = await query({
  prompt: 'Add 7 and 22.',
  options: {
    mcpServers: {
      armorer: {
        type: 'sdk',
        name: 'armorer-tools',
        instance: mcp,
      },
    },
  },
});

for await (const event of result) {
  if (event.type === 'result') {
    console.log(event.result);
  }
}
```
