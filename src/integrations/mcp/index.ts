import { createRequire } from 'node:module';

import type { ServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
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
import { z } from 'zod';

import { isZodSchema } from '../../core/schema-utilities';
import type { Toolbox } from '../../runtime/create-armorer';
import type { ToolboxTool, ToolExecuteWithOptions } from '../../runtime/is-tool';
import type { ToolResult } from '../../runtime/types';

export type MCPToolConfig = {
  title?: string;
  description?: string;
  schema?: AnySchema;
  outputSchema?: AnySchema;
  annotations?: ToolAnnotations;
  execution?: ToolExecution;
  meta?: Record<string, unknown>;
};

export type MCPResourceRegistrar = (server: McpServer) => void;
export type MCPPromptRegistrar = (server: McpServer) => void;

export type CreateMCPOptions = ServerOptions & {
  serverInfo?: Implementation;
  toolConfig?: (tool: ToolboxTool) => MCPToolConfig;
  formatResult?: (result: ToolResult) => CallToolResult;
  resources?: MCPResourceRegistrar | MCPResourceRegistrar[];
  prompts?: MCPPromptRegistrar | MCPPromptRegistrar[];
};

const DEFAULT_SERVER_INFO: Implementation = {
  name: 'armorer',
  version: '0.0.0',
};

export function createMCP(armorer: Toolbox, options: CreateMCPOptions = {}): McpServer {
  const { serverInfo, toolConfig, formatResult, resources, prompts, ...serverOptions } =
    options;
  const { McpServer: McpServerClass } = requireMcp();
  const server = new McpServerClass(serverInfo ?? DEFAULT_SERVER_INFO, serverOptions);
  const registered = new Map<string, RegisteredTool>();

  const registerTool = (tool: ToolboxTool) => {
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
    const resolvedInputSchema =
      resolveMcpSchema(config?.schema) ?? (tool.schema as AnySchema);
    const resolvedOutputSchema = resolveMcpSchema(config?.outputSchema);
    const registeredConfig: {
      title?: string;
      description?: string;
      inputSchema: AnySchema;
      outputSchema?: AnySchema;
      annotations?: ToolAnnotations;
      execution?: ToolExecution;
      _meta?: Record<string, unknown>;
    } = {
      description: config?.description ?? tool.description,
      inputSchema: resolvedInputSchema,
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
    if (resolvedOutputSchema) {
      registeredConfig.outputSchema = resolvedOutputSchema;
    }
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      registeredConfig._meta = meta;
    }

    const toolName = tool.name;
    const existing = registered.get(toolName);
    if (existing) {
      existing.remove();
    }

    const registeredTool = server.registerTool(
      toolName,
      registeredConfig,
      async (
        args: unknown,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        const params = args ?? {};
        let result: ToolResult;
        try {
          const runnable = tool as unknown as {
            executeWith: (options: ToolExecuteWithOptions) => Promise<ToolResult>;
          };
          result = await runnable.executeWith({
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

    registered.set(toolName, registeredTool);
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
    const message =
      result.error?.message ?? result.errorMessage ?? stringifyResult(result.content);
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

export function toolConfigFromMetadata(tool: ToolboxTool): MCPToolConfig | undefined {
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
  if (config.schema !== undefined) resolved.schema = config.schema;
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

type JsonSchemaObject = {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: unknown;
  items?: unknown;
  enum?: unknown[];
  const?: unknown;
  nullable?: boolean;
  additionalProperties?: boolean | Record<string, unknown>;
  anyOf?: unknown[];
  oneOf?: unknown[];
  allOf?: unknown[];
};

function resolveMcpSchema(schema: unknown): AnySchema | undefined {
  if (schema === undefined) return undefined;
  if (isZodSchema(schema)) return schema as AnySchema;
  if (isZodRawShape(schema)) {
    return z.object(schema);
  }
  const converted = jsonSchemaToZod(schema);
  return converted ? (converted as AnySchema) : undefined;
}

function isZodRawShape(value: unknown): value is Record<string, z.ZodTypeAny> {
  if (!isRecord(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((entry) => isZodSchema(entry));
}

function jsonSchemaToZod(schema: unknown): z.ZodTypeAny | undefined {
  if (!isRecord(schema)) return undefined;
  const definition = schema as JsonSchemaObject;

  if (Array.isArray(definition.anyOf)) {
    return applyNullable(unionSchemas(definition.anyOf.map(jsonSchemaToZod)), definition);
  }

  if (Array.isArray(definition.oneOf)) {
    return applyNullable(unionSchemas(definition.oneOf.map(jsonSchemaToZod)), definition);
  }

  if (Array.isArray(definition.allOf)) {
    return applyNullable(
      intersectSchemas(definition.allOf.map(jsonSchemaToZod)),
      definition,
    );
  }

  if (Array.isArray(definition.enum)) {
    return applyNullable(enumToZod(definition.enum), definition);
  }

  if (Object.prototype.hasOwnProperty.call(definition, 'const')) {
    return applyNullable(literalSchema(definition.const), definition);
  }

  const schemaType = definition.type;
  let base: z.ZodTypeAny | undefined;

  if (Array.isArray(schemaType)) {
    base = unionSchemas(schemaType.map((type) => schemaFromType(definition, type)));
  } else if (typeof schemaType === 'string') {
    base = schemaFromType(definition, schemaType);
  } else if (definition.properties || definition.additionalProperties !== undefined) {
    base = objectSchema(definition);
  }

  return applyNullable(base, definition);
}

function schemaFromType(
  definition: JsonSchemaObject,
  schemaType: string,
): z.ZodTypeAny | undefined {
  switch (schemaType) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array':
      return arraySchema(definition);
    case 'object':
      return objectSchema(definition);
    default:
      return undefined;
  }
}

function arraySchema(definition: JsonSchemaObject): z.ZodTypeAny {
  const { items } = definition;
  if (Array.isArray(items)) {
    const itemSchema = unionSchemas(items.map(jsonSchemaToZod)) ?? z.any();
    return z.array(itemSchema);
  }
  const itemSchema = jsonSchemaToZod(items) ?? z.any();
  return z.array(itemSchema);
}

function objectSchema(definition: JsonSchemaObject): z.ZodTypeAny {
  const properties = isRecord(definition.properties) ? definition.properties : {};
  const required = new Set(
    Array.isArray(definition.required) ? definition.required.filter(isString) : [],
  );
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(properties)) {
    const schema = jsonSchemaToZod(value) ?? z.any();
    shape[key] = required.has(key) ? schema : schema.optional();
  }
  let objectSchema = z.object(shape);
  const additional = definition.additionalProperties;
  if (additional === false) {
    objectSchema = objectSchema.strict();
  } else if (isRecord(additional)) {
    const catchall = jsonSchemaToZod(additional) ?? z.any();
    objectSchema = objectSchema.catchall(catchall);
  } else {
    objectSchema = objectSchema.passthrough();
  }
  return objectSchema;
}

function enumToZod(values: unknown[]): z.ZodTypeAny | undefined {
  if (!values.length) {
    return z.never();
  }
  if (values.every((value) => typeof value === 'string')) {
    return z.enum(values as [string, ...string[]]);
  }
  const literals = values.map(literalSchema).filter(Boolean) as z.ZodTypeAny[];
  return unionSchemas(literals);
}

function literalSchema(value: unknown): z.ZodTypeAny | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return z.literal(value);
  }
  return undefined;
}

function unionSchemas(
  schemas: Array<z.ZodTypeAny | undefined>,
): z.ZodTypeAny | undefined {
  const filtered = schemas.filter(Boolean) as z.ZodTypeAny[];
  if (!filtered.length) return undefined;
  if (filtered.length === 1) return filtered[0];
  return z.union(filtered as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function intersectSchemas(
  schemas: Array<z.ZodTypeAny | undefined>,
): z.ZodTypeAny | undefined {
  const filtered = schemas.filter(Boolean) as z.ZodTypeAny[];
  if (!filtered.length) return undefined;
  return filtered.reduce((acc, schema) => z.intersection(acc, schema));
}

function applyNullable(
  schema: z.ZodTypeAny | undefined,
  definition: JsonSchemaObject,
): z.ZodTypeAny | undefined {
  if (!schema) return undefined;
  if (definition.nullable === true) {
    return z.union([schema, z.null()]);
  }
  return schema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

type McpSdk = typeof import('@modelcontextprotocol/sdk/server/mcp.js');

let cachedMcpSdk: McpSdk | undefined;

function requireMcp(): McpSdk {
  if (cachedMcpSdk) return cachedMcpSdk;
  const require = createRequire(import.meta.url);
  try {
    cachedMcpSdk = require('@modelcontextprotocol/sdk/server/mcp.js') as McpSdk;
    return cachedMcpSdk;
  } catch (error) {
    const hint =
      'Missing peer dependency "@modelcontextprotocol/sdk". Install it to use armorer/mcp.';
    const wrapped = error instanceof Error ? error : new Error(String(error));
    wrapped.message = `${hint}\n${wrapped.message}`;
    throw wrapped;
  }
}
