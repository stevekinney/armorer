import type { ServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  Implementation,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
  ToolExecution,
} from '@modelcontextprotocol/sdk/types.js';

import type { Armorer } from '../create-armorer';
import type { ArmorerTool } from '../is-tool';
import type { ToolResult } from '../types';

export type MCPToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: AnySchema;
  outputSchema?: AnySchema;
  annotations?: ToolAnnotations;
  execution?: ToolExecution;
  meta?: Record<string, unknown>;
};

export type MCPResourceRegistrar = (server: McpServer) => void;
export type MCPPromptRegistrar = (server: McpServer) => void;

export type CreateMCPOptions = ServerOptions & {
  serverInfo?: Implementation;
  toolConfig?: (tool: ArmorerTool) => MCPToolConfig;
  formatResult?: (result: ToolResult) => CallToolResult;
  resources?: MCPResourceRegistrar | MCPResourceRegistrar[];
  prompts?: MCPPromptRegistrar | MCPPromptRegistrar[];
};

const DEFAULT_SERVER_INFO: Implementation = {
  name: 'armorer',
  version: '0.0.0',
};

export function createMCP(armorer: Armorer, options: CreateMCPOptions = {}): McpServer {
  const { serverInfo, toolConfig, formatResult, resources, prompts, ...serverOptions } =
    options;
  const server = new McpServer(serverInfo ?? DEFAULT_SERVER_INFO, serverOptions);
  const registered = new Map<string, RegisteredTool>();

  const registerTool = (tool: ArmorerTool) => {
    const metadataConfig = toolConfigFromMetadata(tool);
    const config = { ...metadataConfig, ...(toolConfig?.(tool) ?? {}) };
    const meta = config?.meta ?? tool.metadata;
    const readOnlyHint = tool.metadata?.readOnly === true;
    const annotations = readOnlyHint
      ? {
          ...(config?.annotations ?? {}),
          ...(config?.annotations?.readOnlyHint === undefined
            ? { readOnlyHint: true }
            : {}),
        }
      : config?.annotations;
    const registeredConfig: {
      title?: string;
      description?: string;
      inputSchema?: AnySchema;
      outputSchema?: AnySchema;
      annotations?: ToolAnnotations;
      execution?: ToolExecution;
      _meta?: Record<string, unknown>;
    } = {
      description: config?.description ?? tool.description,
      inputSchema: config?.inputSchema ?? tool.schema,
    };
    if (config?.title !== undefined) {
      registeredConfig.title = config.title;
    }
    if (annotations !== undefined) {
      registeredConfig.annotations = annotations;
    }
    if (config?.execution !== undefined) {
      registeredConfig.execution = config.execution;
    }
    if (config?.outputSchema) {
      registeredConfig.outputSchema = config.outputSchema;
    }
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      registeredConfig._meta = meta;
    }

    const existing = registered.get(tool.name);
    if (existing) {
      existing.remove();
    }

    const registeredTool = server.registerTool(
      tool.name,
      registeredConfig,
      async (
        args: unknown,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        const params = args ?? {};
        let result: ToolResult;
        try {
          result = await tool.executeWith({
            params,
            callId: String(extra.requestId),
            signal: extra.signal,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: toTextContent(message),
            isError: true,
          };
        }
        return formatResult ? formatResult(result) : toCallToolResult(result);
      },
    );

    registered.set(tool.name, registeredTool);
  };

  for (const tool of armorer.tools()) {
    registerTool(tool);
  }

  applyRegistrars(server, resources);
  applyRegistrars(server, prompts);

  armorer.addEventListener('registered', (event) => {
    registerTool(event.detail);
    if (server.isConnected()) {
      void server.sendToolListChanged();
    }
  });

  return server;
}

function toCallToolResult(result: ToolResult): CallToolResult {
  if (result.outcome === 'error') {
    const message = result.error ?? stringifyResult(result.content);
    return {
      content: toTextContent(message),
      isError: true,
    };
  }

  const text = stringifyResult(result.result);
  const content = toTextContent(text);
  const structured = toStructuredContent(result.result);

  if (structured) {
    return {
      content,
      structuredContent: structured,
    };
  }

  return { content };
}

function stringifyResult(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
}

function toStructuredContent(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function toTextContent(text: string): CallToolResult['content'] {
  if (!text.length) return [];
  return [{ type: 'text' as const, text }];
}

export function toolConfigFromMetadata(tool: ArmorerTool): MCPToolConfig | undefined {
  const metadata = tool.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const mcp = (metadata as Record<string, unknown>)['mcp'];
  if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) {
    return undefined;
  }
  const config = mcp as Partial<MCPToolConfig>;
  const resolved: MCPToolConfig = {};
  if (config.title !== undefined) resolved.title = config.title;
  if (config.description !== undefined) resolved.description = config.description;
  if (config.inputSchema !== undefined) resolved.inputSchema = config.inputSchema;
  if (config.outputSchema !== undefined) resolved.outputSchema = config.outputSchema;
  let annotations = config.annotations ? { ...config.annotations } : undefined;
  if (metadata.readOnly === true) {
    if (!annotations) {
      annotations = { readOnlyHint: true };
    } else if (annotations.readOnlyHint === undefined) {
      annotations.readOnlyHint = true;
    }
  }
  if (annotations) resolved.annotations = annotations;
  if (config.execution !== undefined) resolved.execution = config.execution;
  if (config.meta !== undefined) resolved.meta = config.meta;
  return resolved;
}

function applyRegistrars(
  server: McpServer,
  registrars:
    | MCPResourceRegistrar
    | MCPPromptRegistrar
    | Array<MCPResourceRegistrar | MCPPromptRegistrar>
    | undefined,
) {
  if (!registrars) return;
  if (Array.isArray(registrars)) {
    for (const registrar of registrars) {
      registrar(server);
    }
    return;
  }
  registrars(server);
}
