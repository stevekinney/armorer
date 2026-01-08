import {
  type AddEventListenerOptionsLike,
  type AsyncIteratorOptions,
  createEventTarget,
  type EmissionEvent,
  type MinimalAbortSignal,
  type ObservableLike,
  type Observer,
  type Subscription,
} from 'event-emission';
import { z } from 'zod';

import {
  createTool as createToolFactory,
  createToolCall,
  type CreateToolOptions,
} from './create-tool';
import {
  type InspectorDetailLevel,
  inspectRegistry,
  type RegistryInspection,
} from './inspect';
import type {
  ArmorerTool,
  DefaultToolEvents,
  ToolConfig,
  ToolEventsMap,
  ToolMetadata,
  ToolParametersSchema,
} from './is-tool';
import { isTool } from './is-tool';
import type {
  QuerySelectionResult,
  ToolMatch,
  ToolQuery,
  ToolSearchOptions,
} from './registry';
import { registerToolIndexes, unregisterToolIndexes } from './registry';
import type { Embedder } from './registry/embeddings';
import { registerRegistryEmbedder, warmToolEmbeddings } from './registry/embeddings';
import { isZodObjectSchema, isZodSchema } from './schema-utilities';
import { assertKebabCaseTag, uniqTags } from './tag-utilities';
import type { ToolCall, ToolCallInput, ToolResult } from './types';

export type ArmorerContext = Record<string, unknown>;

export type ArmorerToolRuntimeContext<Ctx extends ArmorerContext = ArmorerContext> =
  Ctx & {
    dispatchEvent: ArmorerEventDispatcher;
    configuration: ToolConfig;
    toolCall: ToolCall;
  };

export type SerializedArmorer = readonly ToolConfig[];

export interface ArmorerOptions {
  signal?: MinimalAbortSignal;
  context?: ArmorerContext;
  embed?: Embedder;
  toolFactory?: (
    configuration: ToolConfig,
    context: ArmorerToolFactoryContext,
  ) => ArmorerTool;
}

export interface ArmorerToolFactoryContext {
  dispatchEvent: ArmorerEventDispatcher;
  baseContext: ArmorerContext;
  buildDefaultTool: (configuration: ToolConfig) => ArmorerTool;
}

/**
 * Status update payload for tool progress reporting.
 */
export interface ToolStatusUpdate {
  callId: string;
  name: string;
  status: string;
  percent?: number;
  eta?: number;
  message?: string;
}

export interface ArmorerEvents {
  registering: ArmorerTool;
  registered: ArmorerTool;
  call: { tool: ArmorerTool; call: ToolCall };
  complete: { tool: ArmorerTool; result: ToolResult };
  error: { tool?: ArmorerTool; result: ToolResult };
  'not-found': ToolCall;
  query: { criteria?: ToolQuery; results: QuerySelectionResult };
  search: { options: ToolSearchOptions; results: ToolMatch<unknown>[] };
  /** Tool status/progress updates for UI display */
  'status:update': ToolStatusUpdate;
}

export type ArmorerEventDispatcher = <K extends keyof ArmorerEvents & string>(
  event: EmissionEvent<ArmorerEvents[K]>,
) => boolean;

export interface Armorer {
  register: (...entries: (ToolConfig | ArmorerTool)[]) => Armorer;
  createTool: <
    TInput extends Record<string, unknown> = Record<string, never>,
    TOutput = unknown,
    E extends ToolEventsMap = DefaultToolEvents,
    Tags extends readonly string[] = readonly string[],
    M extends ToolMetadata | undefined = undefined,
  >(
    options: CreateToolOptions<TInput, TOutput, E, Tags, M>,
  ) => ArmorerTool;
  execute(call: ToolCallInput): Promise<ToolResult>;
  execute(calls: ToolCallInput[]): Promise<ToolResult[]>;
  tools: () => ArmorerTool[];
  getTool: (name: string) => ArmorerTool | undefined;
  /**
   * Returns names of tools that are not registered.
   * Useful for fail-soft agent gating.
   */
  getMissingTools: (names: string[]) => string[];
  /**
   * Checks if all specified tools are registered.
   */
  hasAllTools: (names: string[]) => boolean;
  /**
   * Inspects the registry and returns a typed JSON summary of all registered tools.
   * Useful for debugging and logging which tools are available before model calls.
   *
   * @param detailLevel - Level of detail to include:
   *   - `summary`: Names, descriptions, tags, and counts only
   *   - `standard`: Adds schema keys and metadata flags (default)
   *   - `full`: Includes complete schema shape details
   */
  inspect: (detailLevel?: InspectorDetailLevel) => RegistryInspection;
  toJSON: () => SerializedArmorer;
  addEventListener: <K extends keyof ArmorerEvents & string>(
    type: K,
    listener: (event: EmissionEvent<ArmorerEvents[K]>) => void | Promise<void>,
    options?: AddEventListenerOptionsLike,
  ) => () => void;
  dispatchEvent: ArmorerEventDispatcher;

  // Observable-based event methods (event-emission 0.2.0)
  on: <K extends keyof ArmorerEvents & string>(
    type: K,
    options?: AddEventListenerOptionsLike | boolean,
  ) => ObservableLike<EmissionEvent<ArmorerEvents[K]>>;
  once: <K extends keyof ArmorerEvents & string>(
    type: K,
    listener: (event: EmissionEvent<ArmorerEvents[K]>) => void | Promise<void>,
    options?: Omit<AddEventListenerOptionsLike, 'once'>,
  ) => () => void;
  subscribe: <K extends keyof ArmorerEvents & string>(
    type: K,
    observerOrNext?:
      | Observer<EmissionEvent<ArmorerEvents[K]>>
      | ((value: EmissionEvent<ArmorerEvents[K]>) => void),
    error?: (err: unknown) => void,
    complete?: () => void,
  ) => Subscription;
  toObservable: () => ObservableLike<EmissionEvent<ArmorerEvents[keyof ArmorerEvents]>>;

  // Async iteration (event-emission 0.2.0)
  events: <K extends keyof ArmorerEvents & string>(
    type: K,
    options?: AsyncIteratorOptions,
  ) => AsyncIterableIterator<EmissionEvent<ArmorerEvents[K]>>;

  // Lifecycle methods
  complete: () => void;
  readonly completed: boolean;
}

export function createArmorer(
  serialized: SerializedArmorer = [],
  options: ArmorerOptions = {},
): Armorer {
  const registry = new Map<string, ArmorerTool>();
  const storedConfigurations = new Map<string, ToolConfig>();
  const hub = createEventTarget<ArmorerEvents>();
  const {
    addEventListener,
    dispatchEvent,
    clear,
    on,
    once,
    subscribe,
    toObservable,
    events,
    complete,
  } = hub;

  // Helper to emit events with proper typing (event-emission accepts partial events at runtime)
  const emit = <K extends keyof ArmorerEvents & string>(
    type: K,
    detail: ArmorerEvents[K],
  ) => dispatchEvent({ type, detail } as EmissionEvent<ArmorerEvents[K]>);
  const baseContext = options.context ? { ...options.context } : {};
  const embedder = options.embed;
  const buildTool =
    typeof options.toolFactory === 'function'
      ? (configuration: ToolConfig) =>
          options.toolFactory!(configuration, {
            dispatchEvent,
            baseContext,
            buildDefaultTool,
          })
      : buildDefaultTool;

  if (options.signal) {
    const signal = options.signal;
    const onAbort = () => {
      clear();
      signal.removeEventListener('abort', onAbort);
    };
    if (signal.aborted) {
      clear();
    } else {
      signal.addEventListener('abort', onAbort, { once: true } as any);
    }
  }

  function register(...entries: (ToolConfig | ArmorerTool)[]): Armorer {
    for (const entry of entries) {
      const configuration = normalizeRegistration(entry);
      const tool = buildTool(configuration);
      const existing = registry.get(tool.name);
      emit('registering', tool);
      storedConfigurations.set(configuration.name, configuration);
      if (existing) {
        unregisterToolIndexes(api, existing, registry.size);
      }
      registry.set(tool.name, tool);
      registerToolIndexes(api, tool, registry.size);
      if (embedder) {
        warmToolEmbeddings(tool, embedder, (resolvedTool) => {
          if (registry.get(resolvedTool.name) !== resolvedTool) {
            return;
          }
          registerToolIndexes(api, resolvedTool, registry.size);
        });
      }
      emit('registered', tool);
    }
    return api;
  }

  function createTool<
    TInput extends Record<string, unknown> = Record<string, never>,
    TOutput = unknown,
    E extends ToolEventsMap = DefaultToolEvents,
    Tags extends readonly string[] = readonly string[],
    M extends ToolMetadata | undefined = undefined,
  >(options: CreateToolOptions<TInput, TOutput, E, Tags, M>): ArmorerTool {
    const schema = normalizeToolSchema(options.schema);
    const normalizedTags = Array.isArray(options.tags)
      ? uniqTags(
          (options.tags as readonly string[]).map((tag) =>
            assertKebabCaseTag(tag, `Tool "${options.name}"`),
          ),
        )
      : undefined;
    if (typeof options.execute !== 'function' && !isPromise(options.execute)) {
      throw new TypeError(
        'execute must be a function or a promise that resolves to a function',
      );
    }
    const configuration: ToolConfig = {
      name: options.name,
      description: options.description,
      schema,
      parameters: schema,
      execute: options.execute as ToolConfig['execute'],
    };
    if (normalizedTags) {
      configuration.tags = normalizedTags;
    }
    if (options.metadata !== undefined) {
      configuration.metadata = options.metadata;
    }
    register(configuration);
    const tool = registry.get(configuration.name);
    if (!tool) {
      throw new Error(`Failed to register tool: ${configuration.name}`);
    }
    return tool;
  }

  async function execute(call: ToolCallInput): Promise<ToolResult>;
  async function execute(calls: ToolCallInput[]): Promise<ToolResult[]>;
  async function execute(
    input: ToolCallInput | ToolCallInput[],
  ): Promise<ToolResult | ToolResult[]> {
    const calls = Array.isArray(input) ? input : [input];
    const results: ToolResult[] = [];
    for (const call of calls) {
      const toolCall = normalizeToolCall(call);
      const tool = registry.get(toolCall.name);
      if (!tool) {
        const notFound: ToolResult = {
          callId: toolCall.id,
          outcome: 'error',
          content: `Tool not found: ${toolCall.name}`,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: undefined,
          error: `Tool not found: ${toolCall.name}`,
        };
        results.push(notFound);
        emit('not-found', toolCall);
        continue;
      }

      emit('call', { tool, call: toolCall });
      try {
        const result = (await tool.execute(toolCall as any)) as ToolResult;
        results.push(result);
        if (result.error) {
          emit('error', { tool, result });
        } else {
          emit('complete', { tool, result });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errResult: ToolResult = {
          callId: toolCall.id,
          outcome: 'error',
          content: message,
          toolCallId: toolCall.id,
          toolName: tool.name,
          result: undefined,
          error: message,
        };
        results.push(errResult);
        emit('error', { tool, result: errResult });
      }
    }
    return Array.isArray(input) ? results : results[0]!;
  }

  function normalizeToolCall(call: ToolCallInput): ToolCall {
    const args = Object.prototype.hasOwnProperty.call(call, 'arguments')
      ? call.arguments
      : {};
    const id = typeof call.id === 'string' && call.id.length ? call.id : undefined;
    return createToolCall(call.name, args, id);
  }

  function tools(): ArmorerTool[] {
    return Array.from(registry.values());
  }

  function getTool(name: string): ArmorerTool | undefined {
    return registry.get(name);
  }

  function getMissingTools(names: string[]): string[] {
    return names.filter((name) => !registry.has(name));
  }

  function hasAllTools(names: string[]): boolean {
    return names.every((name) => registry.has(name));
  }

  function inspect(detailLevel: InspectorDetailLevel = 'standard'): RegistryInspection {
    const tools = Array.from(registry.values());
    return inspectRegistry(tools, detailLevel);
  }

  function toJSON(): SerializedArmorer {
    return Array.from(storedConfigurations.values()).map((configuration) => {
      const result: ToolConfig = {
        name: configuration.name,
        description: configuration.description,
        schema: configuration.schema,
        execute: configuration.execute,
      };
      if (configuration.tags) {
        result.tags = [...configuration.tags];
      }
      if (configuration.metadata) {
        result.metadata = configuration.metadata;
      }
      return result;
    });
  }

  const api: Armorer = {
    register,
    createTool,
    execute,
    tools,
    getTool,
    getMissingTools,
    hasAllTools,
    inspect,
    toJSON,
    addEventListener,
    dispatchEvent,
    // Observable-based event methods (event-emission 0.2.0)
    on,
    once,
    subscribe,
    toObservable,
    // Async iteration (event-emission 0.2.0)
    events,
    // Lifecycle methods
    complete,
    get completed() {
      return hub.completed;
    },
  };

  if (embedder) {
    registerRegistryEmbedder(api, embedder);
  }

  if (serialized.length) {
    register(...serialized);
  }

  return api;

  function buildDefaultTool(configuration: ToolConfig): ArmorerTool {
    const resolveExecute = createLazyExecuteResolver(configuration.execute);
    const options: Parameters<typeof createToolFactory>[0] = {
      name: configuration.name,
      description: configuration.description,
      schema: configuration.schema,
      async execute(params, toolContext) {
        const executeFn = await resolveExecute();
        return executeFn(params as any, {
          ...baseContext,
          dispatchEvent,
          configuration: toolContext.configuration,
          toolCall: toolContext.toolCall,
        });
      },
    };
    if (configuration.tags) {
      options.tags = configuration.tags;
    }
    if (configuration.metadata) {
      options.metadata = configuration.metadata;
    }
    if (configuration.diagnostics) {
      options.diagnostics = configuration.diagnostics;
    }
    return createToolFactory(options);
  }

  function normalizeConfiguration(configuration: ToolConfig): ToolConfig {
    if (!configuration || typeof configuration !== 'object') {
      throw new TypeError('register expects ToolConfig objects');
    }
    if (typeof configuration.name !== 'string' || !configuration.name.trim()) {
      throw new TypeError('register expects ToolConfig objects');
    }
    if (typeof configuration.description !== 'string') {
      throw new TypeError('register expects ToolConfig objects');
    }
    const rawSchema = configuration.schema ?? configuration.parameters;
    if (!rawSchema) {
      throw new TypeError('register expects ToolConfig objects');
    }
    if (
      typeof configuration.execute !== 'function' &&
      !isPromise(configuration.execute)
    ) {
      throw new TypeError('register expects ToolConfig objects');
    }
    const normalizedSchema = normalizeToolSchema(rawSchema);
    const result: ToolConfig = {
      name: configuration.name,
      description: configuration.description,
      schema: normalizedSchema,
      parameters: normalizedSchema,
      execute: configuration.execute,
    };
    if (configuration.tags) {
      result.tags = [...configuration.tags];
    }
    if (configuration.metadata) {
      result.metadata = configuration.metadata;
    }
    if (configuration.diagnostics) {
      result.diagnostics = configuration.diagnostics;
    }
    return result;
  }

  function normalizeRegistration(entry: ToolConfig | ArmorerTool): ToolConfig {
    if (isTool(entry)) {
      return normalizeConfiguration(entry.configuration);
    }
    return normalizeConfiguration(entry);
  }
}

function normalizeToolSchema(schema: unknown): ToolParametersSchema {
  if (schema === undefined) {
    return z.object({});
  }
  if (isZodObjectSchema(schema)) {
    return schema;
  }
  if (isZodSchema(schema)) {
    throw new Error('Tool schema must be a Zod object schema');
  }
  if (schema && typeof schema === 'object') {
    return z.object(schema as Record<string, z.ZodTypeAny>);
  }
  throw new Error('Tool schema must be a Zod object schema or an object of Zod schemas');
}

function createLazyExecuteResolver(
  execute: ToolConfig['execute'],
): () => Promise<(params: unknown, context?: unknown) => Promise<unknown>> {
  if (typeof execute === 'function') {
    const fn = execute;
    return () => Promise.resolve(fn);
  }
  let resolved: ((params: unknown, context?: unknown) => Promise<unknown>) | undefined;
  let pending:
    | Promise<(params: unknown, context?: unknown) => Promise<unknown>>
    | undefined;

  return async () => {
    if (resolved) return resolved;
    if (!pending) {
      pending = Promise.resolve(execute)
        .then((value) => {
          if (typeof value !== 'function') {
            throw new TypeError(
              'ToolConfig.execute must be a function or a promise that resolves to a function',
            );
          }
          resolved = value;
          return value;
        })
        .catch((error) => {
          pending = undefined;
          throw error;
        });
    }
    return pending;
  };
}

function isPromise<T>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as any).then === 'function'
  );
}
