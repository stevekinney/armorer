# Claude Agent SDK Adapter

## Overview

Integrate Armorer tools with the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). This adapter provides utilities to convert Armorer tools into Claude Agent SDK-compatible formats, create MCP servers, and implement tool gating for permission control.

## Prerequisites

Install the Claude Agent SDK as a runtime dependency:

```bash
bun add @anthropic-ai/claude-agent-sdk
```

## Converting Tools

Use `toClaudeAgentSdkTools` to convert Armorer tools to Claude Agent SDK tools:

```typescript
import { createArmorer, createTool } from 'armorer';
import { toClaudeAgentSdkTools } from 'armorer/claude-agent-sdk';
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

// Convert to Claude Agent SDK tools
const sdkTools = toClaudeAgentSdkTools(armorer);

// Or convert a single tool
const singleToolSdk = toClaudeAgentSdkTools(myTool);

// Or convert an array of tools
const toolsSdk = toClaudeAgentSdkTools([tool1, tool2]);
```

### Custom Tool Configuration

Override tool properties during conversion:

```typescript
const sdkTools = toClaudeAgentSdkTools(armorer, {
  toolConfig: (tool) => ({
    name: `custom_${tool.name}`,
    description: `Enhanced: ${tool.description}`,
  }),
  formatResult: (result) => ({
    content: [{ type: 'text', text: JSON.stringify(result.result) }],
  }),
});
```

## Creating an MCP Server

Use `createClaudeAgentSdkServer` to create a complete MCP server from your tools:

```typescript
import { createArmorer, createTool } from 'armorer';
import { createClaudeAgentSdkServer } from 'armorer/claude-agent-sdk';
import { z } from 'zod';

const armorer = createArmorer();
createTool(
  {
    name: 'write-file',
    description: 'writes a file',
    schema: z.object({ path: z.string(), content: z.string() }),
    metadata: { mutates: true },
    async execute({ path, content }) {
      // Write file logic
      return { success: true };
    },
  },
  armorer,
);

const { sdkServer, tools, toolNames, mutatingToolNames, dangerousToolNames } =
  createClaudeAgentSdkServer(armorer, {
    name: 'my-tools',
    version: '1.0.0',
  });

console.log('Tool names:', toolNames);
console.log('Mutating tools:', mutatingToolNames);
console.log('Dangerous tools:', dangerousToolNames);
```

The server result includes:

- `sdkServer`: The Claude Agent SDK MCP server instance
- `tools`: Array of converted SDK tools
- `toolNames`: All tool names
- `mutatingToolNames`: Tools marked as mutating via `metadata.mutates: true` or `tags: ['mutating']`
- `dangerousToolNames`: Tools marked as dangerous via `metadata.dangerous: true` or `tags: ['dangerous']`

## Tool Gating

Use `createClaudeToolGate` to implement permission-based tool access control. This is useful for CLI applications or agent systems that need to restrict tool usage based on flags like `--apply` or `--dangerous`.

```typescript
import { createArmorer, createTool } from 'armorer';
import { createClaudeToolGate } from 'armorer/claude-agent-sdk';
import { z } from 'zod';

const armorer = createArmorer();

createTool(
  {
    name: 'read-file',
    description: 'reads a file',
    schema: z.object({ path: z.string() }),
    metadata: { readOnly: true },
    async execute({ path }) {
      return { content: '...' };
    },
  },
  armorer,
);

createTool(
  {
    name: 'write-file',
    description: 'writes a file',
    schema: z.object({ path: z.string(), content: z.string() }),
    metadata: { mutates: true },
    async execute({ path, content }) {
      return { success: true };
    },
  },
  armorer,
);

createTool(
  {
    name: 'delete-file',
    description: 'deletes a file',
    schema: z.object({ path: z.string() }),
    metadata: { mutates: true, dangerous: true },
    async execute({ path }) {
      return { success: true };
    },
  },
  armorer,
);

// Create a gate function
const toolGate = createClaudeToolGate({
  registry: armorer,
  readOnly: false, // Set to true to deny all mutating tools
  allowMutation: true, // Allow mutating tools (overridden by readOnly)
  allowDangerous: false, // Deny dangerous tools
});

// Use the gate to check tool permissions
const readDecision = await toolGate('read-file');
console.log(readDecision); // { behavior: 'allow' }

const writeDecision = await toolGate('write-file');
console.log(writeDecision); // { behavior: 'allow' }

const deleteDecision = await toolGate('delete-file');
console.log(deleteDecision); // { behavior: 'deny', message: 'Use --dangerous to allow this tool.' }
```

### Gate Options

```typescript
type ClaudeToolGateOptions = {
  // The registry, tool, or array of tools to gate
  registry: Armorer | ArmorerTool | ArmorerTool[];

  // Enable read-only mode (denies all mutating tools)
  readOnly?: boolean;

  // Allow mutating tools (default: !readOnly)
  allowMutation?: boolean;

  // Allow dangerous tools (default: true)
  allowDangerous?: boolean;

  // Classify builtin tools that aren't in the registry
  builtin?: {
    readOnly?: string[];
    mutating?: string[];
    dangerous?: string[];
  };

  // Allow tools not in registry or builtin lists (default: false)
  allowUnknown?: boolean;

  // Custom tool configuration (for name overrides)
  toolConfig?: (tool: ArmorerTool) => ClaudeAgentSdkToolConfig;

  // Custom deny messages
  messages?: {
    mutating?: string;
    dangerous?: string;
    unknown?: (toolName: string) => string;
  };
};
```

### Handling Builtin Tools

When working with agent systems that have their own builtin tools (like file system access), use the `builtin` option to classify them:

```typescript
const toolGate = createClaudeToolGate({
  registry: armorer,
  readOnly: true,
  builtin: {
    readOnly: ['View', 'GlobTool', 'GrepTool', 'LS'],
    mutating: ['Edit', 'Replace', 'Write', 'Bash'],
    dangerous: ['Bash'],
  },
});

// Builtin read-only tools are allowed
const viewDecision = await toolGate('View');
console.log(viewDecision); // { behavior: 'allow' }

// Builtin mutating tools are denied in read-only mode
const editDecision = await toolGate('Edit');
console.log(editDecision); // { behavior: 'deny', message: '...' }
```

## Type Exports

The adapter exports the following types:

- `ClaudeAgentSdkTool`: Return type of Claude Agent SDK's `tool()` function
- `ClaudeAgentSdkServer`: Return type of `createSdkMcpServer()`
- `ClaudeAgentSdkToolConfig`: Tool configuration override options
- `ClaudeAgentSdkToolOptions`: Options for `toClaudeAgentSdkTools()`
- `CreateClaudeAgentSdkServerOptions`: Options for `createClaudeAgentSdkServer()`
- `ClaudeAgentSdkServerResult`: Return type of `createClaudeAgentSdkServer()`
- `ClaudeToolGateOptions`: Options for `createClaudeToolGate()`
- `ClaudeToolGateDecision`: Return type of the gate function (`{ behavior: 'allow' | 'deny', message?: string }`)
