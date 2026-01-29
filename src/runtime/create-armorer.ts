import {
  type AddEventListenerOptionsLike,
  type AsyncIteratorOptions,
  createEventTarget,
  type EmissionEvent,
  type ObservableLike,
  type Observer,
  type Subscription,
} from 'event-emission';
import { z } from 'zod';

import type { ToolError, ToolErrorCategory } from '../core/errors';
import {
  type InspectorDetailLevel,
  inspectRegistry,
  type RegistryInspection,
} from '../core/inspect';
import type {
  QuerySelectionResult,
  ToolMatch,
  ToolQuery,
  ToolSearchOptions,
} from '../core/registry';
import { registerToolIndexes } from '../core/registry';
import type { Embedder, EmbeddingVector } from '../core/registry/embeddings';
import {
  registerRegistryEmbedder,
  warmToolEmbeddings,
} from '../core/registry/embeddings';
import type { ToolRisk } from '../core/risk';
import { isZodObjectSchema, isZodSchema } from '../core/schema-utilities';
import { assertKebabCaseTag, uniqTags } from '../core/tag-utilities';
import type { AnyToolDefinition } from '../core/tool-definition';
import { defineTool } from '../core/tool-definition';
import { createConcurrencyLimiter, normalizeConcurrency } from './concurrency';
import {
  createTool as createToolFactory,
  createToolCall,
  type CreateToolOptions,
} from './create-tool';
import type {
  ArmorerTool,
  DefaultToolEvents,
  MinimalAbortSignal,
  OutputValidationMode,
  ToolCallWithArguments,
  ToolConfig,
  ToolDigestOptions,
  ToolEventsMap,
  ToolExecuteOptions,
  ToolMetadata,
  ToolParametersSchema,
  ToolPolicyContext,
  ToolPolicyContextProvider,
  ToolPolicyDecision,
  ToolPolicyHooks,
} from './is-tool';
import { isTool } from './is-tool';
import type { ToolCall, ToolCallInput, ToolResult } from './types';

export type ArmorerContext = Record<string, unknown>;

export type ArmorerToolRuntimeContext<Ctx extends ArmorerContext = ArmorerContext> =
  Ctx & {
    dispatchEvent: ArmorerEventDispatcher;
    configuration: ToolConfig;
    toolCall: ToolCall;
    signal?: MinimalAbortSignal;
    timeoutMs?: number;
  };

export type SerializedArmorer = readonly ToolConfig[];

export type ToolMiddleware = (configuration: ToolConfig) => ToolConfig;

/**
 * Type-safe helper for creating middleware functions.
 *
 * @example
 * ```ts
 * const addMetadata = createMiddleware((config) => ({
 *   ...config,
 *   metadata: { ...config.metadata, source: 'middleware' },
 * }));
 *
 * const armorer = createArmorer([], {
 *   middleware: [addMetadata],
 * });
 * ```
 */
export function createMiddleware(
  fn: (configuration: ToolConfig) => ToolConfig,
): ToolMiddleware {
  return fn;
}

export interface ArmorerOptions {
  signal?: MinimalAbortSignal;
  context?: ArmorerContext;
  embed?: Embedder;
  policy?: ToolPolicyHooks;
  policyContext?: ToolPolicyContextProvider | Record<string, unknown>;
  digests?: ToolDigestOptions;
  outputValidationMode?: OutputValidationMode;
  budget?: { maxCalls?: number; maxDurationMs?: number };
  concurrency?: number;
  telemetry?: boolean;
  readOnly?: boolean;
  allowMutation?: boolean;
  allowDangerous?: boolean;
  toolFactory?: (
    configuration: ToolConfig,
    context: ArmorerToolFactoryContext,
  ) => ArmorerTool;
  /**
   * Called when a tool configuration doesn't have an execute method.
   * This typically happens when deserializing an armorer.
   * Should return an execute function or a promise that resolves to one.
   */
  getTool?: (configuration: Omit<ToolConfig, 'execute'>) => ToolConfig['execute'];
  /**
   * Array of middleware functions to transform tool configurations during registration.
   * Middleware is applied in order before the tool is built.
   */
  middleware?: ToolMiddleware[];
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
  // Bubbled tool events (when executing multiple tools in parallel)
  'execute-start': { tool: ArmorerTool; call: ToolCall; params: unknown };
  'validate-success': {
    tool: ArmorerTool;
    call: ToolCall;
    params: unknown;
    parsed: unknown;
  };
  'validate-error': {
    tool: ArmorerTool;
    call: ToolCall;
    params: unknown;
    error: unknown;
  };
  'execute-success': { tool: ArmorerTool; call: ToolCall; result: unknown };
  'execute-error': { tool: ArmorerTool; call: ToolCall; error: unknown };
  'output-validate-success': { tool: ArmorerTool; call: ToolCall; result: unknown };
  'output-validate-error': {
    tool: ArmorerTool;
    call: ToolCall;
    result: unknown;
    error: unknown;
  };
  settled: { tool: ArmorerTool; call: ToolCall; result?: unknown; error?: unknown };
  'policy-denied': {
    tool: ArmorerTool;
    call: ToolCall;
    params: unknown;
    reason?: string;
  };
  'tool.started': {
    tool: ArmorerTool;
    call: ToolCall;
    // Original event properties
    toolCall: ToolCallWithArguments;
    configuration: ToolConfig;
    params: unknown;
    startedAt: number;
    inputDigest?: string;
    dryRun?: boolean;
  };
  'tool.finished': {
    tool: ArmorerTool;
    call: ToolCall;
    // Original event properties
    toolCall: ToolCallWithArguments;
    configuration: ToolConfig;
    status: 'success' | 'error' | 'denied' | 'cancelled' | 'paused';
    durationMs: number;
    startedAt: number;
    finishedAt: number;
    result?: unknown;
    error?: unknown;
    reason?: string;
    errorCategory?: ToolErrorCategory;
    inputDigest?: string;
    outputDigest?: string;
    outputValidation?: { success: boolean; error?: unknown };
    dryRun?: boolean;
  };
  'budget-exceeded': { tool: ArmorerTool; call: ToolCall; reason: string };
  progress: { tool: ArmorerTool; call: ToolCall; percent?: number; message?: string };
  'output-chunk': { tool: ArmorerTool; call: ToolCall; chunk: unknown };
  log: {
    tool: ArmorerTool;
    call: ToolCall;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  };
  cancelled: { tool: ArmorerTool; call: ToolCall; reason?: string };
}

type ArmorerEventType = Extract<keyof ArmorerEvents, string>;

export type ArmorerEventDispatcher = (
  event: EmissionEvent<ArmorerEvents[ArmorerEventType]>,
) => boolean;

export interface ArmorerExecuteOptions extends ToolExecuteOptions {
  concurrency?: number;
  mode?: 'parallel' | 'sequential';
  errorMode?: 'failFast' | 'collect';
}

export interface Armorer {
  register: (...entries: (ToolConfig | ArmorerTool)[]) => Armorer;
  createTool: <
    TInput extends object = Record<string, unknown>,
    TOutput = unknown,
    E extends ToolEventsMap = DefaultToolEvents,
    Tags extends readonly string[] = readonly string[],
    M extends ToolMetadata | undefined = undefined,
  >(
    options: CreateToolOptions<TInput, TOutput, E, Tags, M>,
  ) => ArmorerTool<z.ZodType<TInput>, E, TOutput, M>;
  execute(call: ToolCallInput, options?: ToolExecuteOptions): Promise<ToolResult>;
  execute(calls: ToolCallInput[], options?: ToolExecuteOptions): Promise<ToolResult[]>;
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
  addEventListener: <K extends ArmorerEventType>(
    type: K,
    listener: (event: EmissionEvent<ArmorerEvents[K]>) => void | Promise<void>,
    options?: AddEventListenerOptionsLike,
  ) => () => void;
  dispatchEvent: ArmorerEventDispatcher;

  // Observable-based event methods (event-emission 0.2.0)
  on: <K extends ArmorerEventType>(
    type: K,
    options?: AddEventListenerOptionsLike | boolean,
  ) => ObservableLike<EmissionEvent<ArmorerEvents[K]>>;
  once: <K extends ArmorerEventType>(
    type: K,
    listener: (event: EmissionEvent<ArmorerEvents[K]>) => void | Promise<void>,
    options?: Omit<AddEventListenerOptionsLike, 'once'>,
  ) => () => void;
  subscribe: <K extends ArmorerEventType>(
    type: K,
    observerOrNext?:
      | Observer<EmissionEvent<ArmorerEvents[K]>>
      | ((value: EmissionEvent<ArmorerEvents[K]>) => void),
    error?: (err: unknown) => void,
    complete?: () => void,
  ) => Subscription;
  toObservable: () => ObservableLike<EmissionEvent<ArmorerEvents[keyof ArmorerEvents]>>;

  // Async iteration (event-emission 0.2.0)
  events: <K extends ArmorerEventType>(
    type: K,
    options?: AsyncIteratorOptions,
  ) => AsyncIterableIterator<EmissionEvent<ArmorerEvents[K]>>;

  // Lifecycle methods
  complete: () => void;
  readonly completed: boolean;

  // Internal method to get armorer context (for use by createTool)
  getContext?: () => ArmorerContext;
}

export function createArmorer(
  serialized: SerializedArmorer = [],
  options: ArmorerOptions = {},
): Armorer {
  const toolsById = new Map<string, ArmorerTool>();
  const toolsByName = new Map<string, ArmorerTool[]>();
  // Backward compat: registry acts as 'name' based lookup for simple cases
  // but we need to change how we access it.
  // const registry = new Map<string, ArmorerTool>();

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
  const emit = <K extends ArmorerEventType>(type: K, detail: ArmorerEvents[K]) =>
    dispatchEvent({ type, detail } as EmissionEvent<ArmorerEvents[K]>);
  const baseContext = options.context ? { ...options.context } : {};
  const readOnly = options.readOnly ?? false;
  const allowMutation = options.allowMutation ?? !readOnly;
  const allowDangerous = options.allowDangerous ?? true;
  const telemetryEnabled = options.telemetry === true;
  const registryPolicy = options.policy;
  const registryPolicyContext = options.policyContext;
  const registryDigests = options.digests;
  const registryOutputValidationMode = options.outputValidationMode;
  const registryConcurrency = options.concurrency;
  const budget = options.budget;
  const budgetStart = Date.now();
  let budgetCalls = 0;
  const embedder = options.embed ? createCachedEmbedder(options.embed) : undefined;
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
      signal.addEventListener('abort', onAbort);
    }
  }

  function register(...entries: (ToolConfig | ArmorerTool)[]): Armorer {
    for (const entry of entries) {
      let configuration = normalizeRegistration(entry);

      // Apply middleware if provided (synchronously if possible, otherwise queue)
      if (options.middleware && options.middleware.length > 0) {
        for (const middleware of options.middleware) {
          const result = middleware(configuration);
          if (isPromise(result)) {
            throw new Error(
              'Async middleware is not supported. Provide synchronous middleware only.',
            );
          }
          configuration = result;
        }
      }

      // If configuration doesn't have execute and getTool is provided, use it
      if (
        typeof configuration.execute !== 'function' &&
        !isPromise(configuration.execute) &&
        options.getTool
      ) {
        const execute = options.getTool(configuration as Omit<ToolConfig, 'execute'>);
        if (isPromise(execute)) {
          throw new Error(
            'Async getTool is not supported. Provide a synchronous execute resolver.',
          );
        }
        configuration = { ...configuration, execute };
      }

      registerConfiguration(configuration);
    }
    return api;
  }

  function createTool<
    TInput extends object = Record<string, unknown>,
    TOutput = unknown,
    E extends ToolEventsMap = DefaultToolEvents,
    Tags extends readonly string[] = readonly string[],
    M extends ToolMetadata | undefined = undefined,
  >(
    options: CreateToolOptions<TInput, TOutput, E, Tags, M>,
  ): ArmorerTool<z.ZodType<TInput>, E, TOutput, M> {
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
    const definition = defineTool({
      name: options.name,
      description: options.description,
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
      ...(options.version !== undefined ? { version: options.version } : {}),
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.examples !== undefined ? { examples: options.examples } : {}),
      ...(normalizedTags ? { tags: normalizedTags } : {}),
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
      ...(options.risk !== undefined ? { risk: options.risk } : {}),
      ...(options.lifecycle !== undefined ? { lifecycle: options.lifecycle } : {}),
      schema: schema,
      ...(options.outputSchema !== undefined
        ? { outputSchema: options.outputSchema }
        : {}),
    }) as AnyToolDefinition;

    const configuration = {
      ...definition,
      parameters: schema,
      execute: options.execute as ToolConfig['execute'],
    } as unknown as ToolConfig;
    if (options.policy) {
      configuration.policy = options.policy;
    }
    if (options.policyContext) {
      configuration.policyContext = options.policyContext;
    }
    if (options.digests !== undefined) {
      configuration.digests = options.digests;
    }
    if (options.outputValidationMode) {
      configuration.outputValidationMode = options.outputValidationMode;
    }
    if (options.concurrency !== undefined) {
      configuration.concurrency = options.concurrency;
    }
    register(configuration);
    const tool = getTool(configuration.id);
    if (!tool) {
      throw new Error(`Failed to register tool: ${configuration.identity.name}`);
    }
    return tool as unknown as ArmorerTool<z.ZodType<TInput>, E, TOutput, M>;
  }

  async function execute(
    call: ToolCallInput,
    options?: ArmorerExecuteOptions,
  ): Promise<ToolResult>;
  async function execute(
    calls: ToolCallInput[],
    options?: ArmorerExecuteOptions,
  ): Promise<ToolResult[]>;
  async function execute(
    input: ToolCallInput | ToolCallInput[],
    options?: ArmorerExecuteOptions,
  ): Promise<ToolResult | ToolResult[]> {
    const calls = Array.isArray(input) ? input : [input];
    const isMultiple = Array.isArray(input);
    const mode = options?.mode ?? 'parallel';
    const errorMode = options?.errorMode ?? 'collect';
    const globalConcurrency = options?.concurrency;

    // Resolve limiter
    const limit = mode === 'sequential' ? 1 : globalConcurrency;
    const limiter = createConcurrencyLimiter(limit);
    const runTask = <T>(task: () => Promise<T>) => (limiter ? limiter.run(task) : task());

    // Map calls to tasks
    const tasks = calls.map((call) => async () => {
      const toolCall = normalizeToolCall(call);
      const tool = getTool(toolCall.name); // toolCall.name might be ID
      if (!tool) {
        const toolError = createArmorerToolError(
          'not_found',
          `Tool not found: ${toolCall.name}`,
          'NOT_FOUND',
          false,
        );
        const notFound: ToolResult = {
          callId: toolCall.id,
          outcome: 'error',
          content: toolError.message,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: undefined,
          error: toolError,
          errorMessage: toolError.message,
          errorCategory: toolError.category,
        };
        emit('not-found', toolCall);
        if (errorMode === 'failFast') {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw toolError;
        }
        return notFound;
      }

      emit('call', { tool, call: toolCall });

      const budgetReason = checkBudget(budget, budgetStart, budgetCalls);
      if (budgetReason) {
        const toolError = createArmorerToolError(
          'conflict',
          budgetReason,
          'BUDGET_EXCEEDED',
          false,
        );
        const denied: ToolResult = {
          callId: toolCall.id,
          outcome: 'error',
          content: toolError.message,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: undefined,
          error: toolError,
          errorMessage: toolError.message,
          errorCategory: toolError.category,
        };
        emit('budget-exceeded', { tool, call: toolCall, reason: budgetReason });
        emit('error', { tool, result: denied });
        if (errorMode === 'failFast') {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw toolError;
        }
        return denied;
      }

      budgetCalls += 1;

      // Bubble up events
      const cleanup: (() => void)[] = [];
      // Always bubble up events for consistency
      const toolEventTypes: (keyof DefaultToolEvents)[] = [
        'tool.started',
        'tool.finished',
        'execute-start',
        'validate-success',
        'validate-error',
        'output-validate-success',
        'output-validate-error',
        'execute-success',
        'execute-error',
        'settled',
        'policy-denied',
        'progress',
        'output-chunk',
        'log',
        'cancelled',
        'status-update',
      ];
      for (const eventType of toolEventTypes) {
        const unsubscribe = tool.addEventListener(eventType, (toolEvent) => {
          // Bubble up the event with tool and call context
          const bubbledDetail = {
            ...toolEvent.detail,
            tool,
            call: toolCall,
          };
          // Use emit helper which handles the type conversion
          emit(
            eventType as keyof ArmorerEvents,
            bubbledDetail as ArmorerEvents[keyof ArmorerEvents],
          );
        });
        cleanup.push(unsubscribe);
      }

      try {
        const executeOptions: ToolExecuteOptions =
          options?.signal ||
          options?.timeoutMs !== undefined ||
          options?.dryRun !== undefined
            ? {
                ...(options?.signal ? { signal: options.signal } : {}),
                ...(options?.timeoutMs !== undefined
                  ? { timeoutMs: options.timeoutMs }
                  : {}),
                ...(options?.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
              }
            : {};

        const result = await tool.execute(
          toolCall as ToolCallWithArguments,
          executeOptions,
        );
        if (result.error) {
          emit('error', { tool, result });
          if (errorMode === 'failFast') {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw result.error;
          }
        } else {
          emit('complete', { tool, result });
        }
        cleanup.forEach((fn) => fn());
        return result;
      } catch (error) {
        cleanup.forEach((fn) => fn());
        if (errorMode === 'failFast') {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const toolError = createArmorerToolError(
          'internal',
          message,
          extractErrorCode(error) ?? 'EXECUTION_ERROR',
          false,
        );
        const errResult: ToolResult = {
          callId: toolCall.id,
          outcome: 'error',
          content: toolError.message,
          toolCallId: toolCall.id,
          toolName: tool.name,
          result: undefined,
          error: toolError,
          errorMessage: toolError.message,
          errorCategory: toolError.category,
        };
        emit('error', { tool, result: errResult });
        return errResult;
      }
    });

    const promises = tasks.map((task) => runTask(task));
    const results = await Promise.all(promises);
    return isMultiple ? results : results[0]!;
  }

  function normalizeToolCall(call: ToolCallInput): ToolCall {
    const args = Object.prototype.hasOwnProperty.call(call, 'arguments')
      ? call.arguments
      : {};
    const id = typeof call.id === 'string' && call.id.length ? call.id : undefined;
    return createToolCall(call.name, args, id);
  }

  function tools(): ArmorerTool[] {
    return Array.from(toolsById.values());
  }

  function getTool(nameOrId: string): ArmorerTool | undefined {
    if (toolsById.has(nameOrId)) return toolsById.get(nameOrId);
    const matches = toolsByName.get(nameOrId);
    if (matches && matches.length > 0) {
      // Return the last registered tool with this name (priority to latest)
      return matches[matches.length - 1];
    }
    return undefined;
  }

  function getMissingTools(names: string[]): string[] {
    return names.filter((name) => !getTool(name));
  }

  function hasAllTools(names: string[]): boolean {
    return names.every((name) => getTool(name));
  }

  function inspect(detailLevel: InspectorDetailLevel = 'standard'): RegistryInspection {
    const tools = Array.from(toolsById.values());
    return inspectRegistry(tools, detailLevel);
  }

  function toJSON(): SerializedArmorer {
    return Array.from(storedConfigurations.values());
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
    // Internal method to get armorer context
    getContext: () => baseContext,
  };

  if (embedder) {
    registerRegistryEmbedder(api, embedder);
  }

  if (serialized.length) {
    registerSerialized(serialized);
  }

  return api;

  function buildDefaultTool(configuration: ToolConfig): ArmorerTool {
    const resolveExecute = createLazyExecuteResolver(configuration.execute);
    const resolvedPolicy = mergePolicies(registryPolicy, configuration.policy, {
      readOnly,
      allowMutation,
      allowDangerous,
    });
    const resolvedPolicyContext = mergePolicyContexts(
      registryPolicyContext,
      configuration.policyContext,
    );
    const resolvedDigests = resolveToolDigests(configuration, registryDigests);
    const resolvedOutputValidationMode =
      configuration.outputValidationMode ?? registryOutputValidationMode;
    const resolvedConcurrency = resolveToolConcurrency(
      configuration,
      registryConcurrency,
    );
    const options: Parameters<typeof createToolFactory>[0] = {
      name: configuration.identity.name,
      description: configuration.display.description,
      ...(configuration.identity?.namespace !== undefined
        ? { namespace: configuration.identity.namespace }
        : {}),
      ...(configuration.identity?.version !== undefined
        ? { version: configuration.identity.version }
        : {}),
      ...(configuration.display?.title !== undefined
        ? { title: configuration.display.title }
        : {}),
      ...(configuration.display?.examples !== undefined
        ? { examples: configuration.display.examples }
        : {}),
      ...(configuration.risk !== undefined ? { risk: configuration.risk } : {}),
      ...(configuration.lifecycle !== undefined
        ? { lifecycle: configuration.lifecycle }
        : {}),
      schema: configuration.schema,
      async execute(params, toolContext) {
        const executeFn = await resolveExecute();
        return executeFn(params, {
          ...baseContext,
          dispatchEvent,
          configuration: toolContext.configuration,
          toolCall: toolContext.toolCall,
          signal: toolContext.signal,
          timeoutMs: toolContext.timeoutMs,
        });
      },
    };
    if (configuration.dryRun) {
      options.dryRun = configuration.dryRun as (
        params: unknown,
        context: unknown,
      ) => Promise<unknown>;
    }
    if (configuration.tags) {
      options.tags = configuration.tags;
    }
    if (configuration.metadata) {
      options.metadata = configuration.metadata;
    }
    if (configuration.outputSchema) {
      options.outputSchema = configuration.outputSchema;
    }
    if (resolvedPolicy) {
      options.policy = resolvedPolicy;
    }
    if (resolvedPolicyContext) {
      options.policyContext = resolvedPolicyContext;
    }
    if (resolvedDigests) {
      options.digests = resolvedDigests;
    }
    if (resolvedOutputValidationMode) {
      options.outputValidationMode = resolvedOutputValidationMode;
    }
    if (resolvedConcurrency !== undefined) {
      options.concurrency = resolvedConcurrency;
    }
    if (telemetryEnabled) {
      options.telemetry = true;
    }
    if (configuration.diagnostics) {
      options.diagnostics = configuration.diagnostics;
    }
    return createToolFactory(options) as unknown as ArmorerTool;
  }

  function normalizeConfiguration(configuration: ToolConfig): ToolConfig {
    if (!configuration || typeof configuration !== 'object') {
      throw new TypeError('register expects ToolConfig objects');
    }
    const candidate = configuration as unknown as Record<string, unknown>;
    const name =
      (candidate['name'] as string | undefined) ?? configuration.identity?.name;
    if (typeof name !== 'string' || !name.trim()) {
      throw new TypeError('register expects ToolConfig objects');
    }
    const rawSchema =
      configuration.schema ??
      configuration.parameters ??
      (candidate['inputSchema'] as z.ZodTypeAny | undefined);
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
    const description =
      (candidate['description'] as string | undefined) ??
      configuration.display?.description;
    if (typeof description !== 'string' || !description.trim()) {
      throw new TypeError('register expects ToolConfig objects');
    }
    const resolvedRisk =
      configuration.risk ?? deriveRiskFromMetadata(configuration.metadata);
    const definition = defineTool({
      name,
      description,
      ...(configuration.identity?.namespace !== undefined
        ? { namespace: configuration.identity.namespace }
        : {}),
      ...(configuration.identity?.version !== undefined
        ? { version: configuration.identity.version }
        : {}),
      ...(configuration.display?.title !== undefined
        ? { title: configuration.display.title }
        : {}),
      ...(configuration.display?.examples !== undefined
        ? { examples: configuration.display.examples }
        : {}),
      ...(configuration.tags ? { tags: configuration.tags } : {}),
      ...(configuration.metadata ? { metadata: configuration.metadata } : {}),
      ...(resolvedRisk !== undefined ? { risk: resolvedRisk } : {}),
      ...(configuration.lifecycle ? { lifecycle: configuration.lifecycle } : {}),
      schema: normalizedSchema,
      ...(configuration.outputSchema ? { outputSchema: configuration.outputSchema } : {}),
      ...(configuration.dryRun
        ? {
            dryRun: configuration.dryRun as (
              params: unknown,
              context: unknown,
            ) => Promise<unknown>,
          }
        : {}),
    }) as AnyToolDefinition;
    const result = {
      ...definition,
      parameters: normalizedSchema,
      execute: configuration.execute,
    } as unknown as ToolConfig;
    if (configuration.policy) {
      result.policy = configuration.policy;
    }
    if (configuration.policyContext) {
      result.policyContext = configuration.policyContext;
    }
    if (configuration.digests !== undefined) {
      result.digests = configuration.digests;
    }
    if (configuration.outputValidationMode) {
      result.outputValidationMode = configuration.outputValidationMode;
    }
    if (configuration.concurrency !== undefined) {
      result.concurrency = configuration.concurrency;
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

  function registerConfiguration(configuration: ToolConfig): void {
    const normalized = normalizeConfiguration(configuration);
    const tool = buildTool(normalized);
    // const existing = registry.get(tool.name);
    emit('registering', tool);
    storedConfigurations.set(normalized.identity.name, normalized); // This might need update if we store by ID

    // if (existing) {
    //   unregisterToolIndexes(api, existing, registry.size);
    // }
    // registry.set(tool.name, tool);

    toolsById.set(tool.id, tool);
    const byName = toolsByName.get(tool.name) || [];
    // Remove existing with same ID if any (update)
    const filtered = byName.filter((t) => t.id !== tool.id);
    filtered.push(tool);
    toolsByName.set(tool.name, filtered);

    registerToolIndexes(api, tool, toolsById.size);
    if (embedder) {
      warmToolEmbeddings(tool, embedder, (resolvedTool) => {
        if (toolsById.get(resolvedTool.id) !== resolvedTool) {
          return;
        }
        registerToolIndexes(api, resolvedTool, toolsById.size);
      });
    }
    emit('registered', tool);
  }

  function registerSerialized(configs: SerializedArmorer): void {
    for (let index = 0; index < configs.length; index += 1) {
      const config = configs[index]!;
      let configuration = normalizeConfiguration(config);

      if (options.middleware && options.middleware.length > 0) {
        for (const middleware of options.middleware) {
          const result = middleware(configuration);
          if (isPromise(result)) {
            throw new Error(
              'Async middleware is not supported when deserializing. Provide synchronous middleware only.',
            );
          }
          configuration = result;
        }
      }

      if (
        typeof configuration.execute !== 'function' &&
        !isPromise(configuration.execute) &&
        options.getTool
      ) {
        const execute = options.getTool(configuration as Omit<ToolConfig, 'execute'>);
        if (isPromise(execute)) {
          throw new Error(
            'Async getTool is not supported when deserializing. Provide a synchronous execute resolver.',
          );
        }
        configuration = { ...configuration, execute };
      }

      registerConfiguration(configuration);
    }
  }
}

function resolveToolConcurrency(
  configuration: ToolConfig,
  registryConcurrency?: number,
): number | undefined {
  const direct = normalizeConcurrency(configuration.concurrency);
  if (direct !== undefined) {
    return direct;
  }
  const metadataConcurrency = normalizeConcurrency(configuration.metadata?.concurrency);
  if (metadataConcurrency !== undefined) {
    return metadataConcurrency;
  }
  return normalizeConcurrency(registryConcurrency);
}

function resolveToolDigests(
  configuration: ToolConfig,
  registryDigests?: ToolDigestOptions,
): ToolDigestOptions | undefined {
  if (configuration.digests !== undefined) {
    return configuration.digests;
  }
  return registryDigests;
}

function mergePolicyContexts(
  registryContext?: ToolPolicyContextProvider | Record<string, unknown>,
  toolContext?: ToolPolicyContextProvider,
): ToolPolicyContextProvider | undefined {
  const registryProvider = toPolicyContextProvider(registryContext);
  const toolProvider = toPolicyContextProvider(toolContext);
  if (!registryProvider && !toolProvider) {
    return undefined;
  }
  return async (context) => {
    const base = registryProvider ? await registryProvider(context) : undefined;
    const next = toolProvider ? await toolProvider(context) : undefined;
    return {
      ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}),
      ...(next && typeof next === 'object' && !Array.isArray(next) ? next : {}),
    };
  };
}

function toPolicyContextProvider(
  input?: ToolPolicyContextProvider | Record<string, unknown>,
): ToolPolicyContextProvider | undefined {
  if (!input) return undefined;
  if (typeof input === 'function') return input;
  if (typeof input === 'object' && !Array.isArray(input)) {
    return () => input;
  }
  return undefined;
}

function mergePolicies(
  registryPolicy: ToolPolicyHooks | undefined,
  toolPolicy: ToolPolicyHooks | undefined,
  options: { readOnly: boolean; allowMutation: boolean; allowDangerous: boolean },
): ToolPolicyHooks | undefined {
  const enforceMutating = options.readOnly || !options.allowMutation;
  const enforceDangerous = !options.allowDangerous;
  const hasBefore =
    enforceMutating ||
    enforceDangerous ||
    registryPolicy?.beforeExecute !== undefined ||
    toolPolicy?.beforeExecute !== undefined;
  const hasAfter =
    registryPolicy?.afterExecute !== undefined || toolPolicy?.afterExecute !== undefined;
  if (!hasBefore && !hasAfter) {
    return undefined;
  }
  return {
    async beforeExecute(context) {
      if (enforceMutating && isMutatingToolContext(context)) {
        return {
          allow: false,
          reason: `Mutating tool "${context.toolName}" is not allowed`,
        } satisfies ToolPolicyDecision;
      }
      if (enforceDangerous && isDangerousToolContext(context)) {
        return {
          allow: false,
          reason: `Dangerous tool "${context.toolName}" is not allowed`,
        } satisfies ToolPolicyDecision;
      }
      const registryDecision = await resolvePolicyDecision(
        registryPolicy?.beforeExecute,
        context,
      );
      if (registryDecision?.allow === false) {
        return registryDecision;
      }
      const toolDecision = await resolvePolicyDecision(
        toolPolicy?.beforeExecute,
        context,
      );
      if (toolDecision?.allow === false) {
        return toolDecision;
      }
      return { allow: true } satisfies ToolPolicyDecision;
    },
    async afterExecute(context) {
      if (toolPolicy?.afterExecute) {
        await toolPolicy.afterExecute(context);
      }
      if (registryPolicy?.afterExecute) {
        await registryPolicy.afterExecute(context);
      }
    },
  };
}

async function resolvePolicyDecision(
  hook: ToolPolicyHooks['beforeExecute'] | undefined,
  context: ToolPolicyContext,
): Promise<ToolPolicyDecision | undefined> {
  if (!hook) {
    return undefined;
  }
  const decision = await hook(context);
  if (decision === undefined) {
    return undefined;
  }
  if (typeof decision === 'boolean') {
    return { allow: decision };
  }
  return decision;
}

function isMutatingToolContext(context: ToolPolicyContext): boolean {
  const tags = context.tags?.map((tag) => tag.toLowerCase()) ?? [];
  const tagSet = new Set(tags);
  const metadata = context.metadata;
  if (metadata?.mutates === true) {
    return true;
  }
  if (metadata?.readOnly === true) {
    return false;
  }
  if (tagSet.has('mutating')) {
    return true;
  }
  if (tagSet.has('readonly') || tagSet.has('read-only')) {
    return false;
  }
  return false;
}

function isDangerousToolContext(context: ToolPolicyContext): boolean {
  const tags = context.tags?.map((tag) => tag.toLowerCase()) ?? [];
  const tagSet = new Set(tags);
  const metadata = context.metadata;
  if (metadata?.dangerous === true) {
    return true;
  }
  if (tagSet.has('dangerous')) {
    return true;
  }
  return false;
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

function checkBudget(
  budget: ArmorerOptions['budget'] | undefined,
  startedAt: number,
  calls: number,
): string | undefined {
  if (!budget) return undefined;
  if (typeof budget.maxCalls === 'number' && calls >= budget.maxCalls) {
    return `Budget exceeded: max calls ${budget.maxCalls}`;
  }
  if (typeof budget.maxDurationMs === 'number') {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= budget.maxDurationMs) {
      return `Budget exceeded: max duration ${budget.maxDurationMs}ms`;
    }
  }
  return undefined;
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
  if (!value || typeof value !== 'object') return false;
  if (!('then' in value)) return false;
  const candidate = value as PromiseLike<unknown>;
  return typeof candidate.then === 'function';
}

function deriveRiskFromMetadata(metadata: ToolMetadata | undefined) {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const risk: ToolRisk = {};
  if (typeof metadata.mutates === 'boolean') {
    risk.mutates = metadata.mutates;
  }
  if (typeof metadata.readOnly === 'boolean') {
    risk.readOnly = metadata.readOnly;
  }
  if (typeof metadata.dangerous === 'boolean') {
    risk.dangerous = metadata.dangerous;
  }
  return Object.keys(risk).length ? risk : undefined;
}

function createArmorerToolError(
  category: ToolErrorCategory,
  message: string,
  code: string,
  retryable: boolean,
): ToolError {
  return { code, category, retryable, message };
}

function extractErrorCode(error: unknown): string | undefined {
  const code = getStringProperty(error, 'code');
  if (code) return code;
  const name = getStringProperty(error, 'name');
  if (name && name !== 'Error') return name;
  return undefined;
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return typeof record[key] === 'string' ? record[key] : undefined;
}

const embedderCache = new WeakMap<
  Embedder,
  Map<string, EmbeddingVector[] | Promise<EmbeddingVector[]>>
>();

function createCachedEmbedder(embedder: Embedder): Embedder {
  return (texts: string[]): EmbeddingVector[] | Promise<EmbeddingVector[]> => {
    // Create a cache key from the texts array
    const cacheKey = JSON.stringify(texts);

    // Get or create cache for this embedder
    let cache = embedderCache.get(embedder);
    if (!cache) {
      cache = new Map();
      embedderCache.set(embedder, cache);
    }

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Call embedder and cache result
    const result = embedder(texts);
    cache.set(cacheKey, result);

    // If result is a promise, handle rejection to avoid caching errors
    if (isPromise(result)) {
      result.catch(() => {
        // Remove from cache on error so we can retry
        cache.delete(cacheKey);
      });
    }

    return result;
  };
}

/**
 * Type guard to check if a value is an Armorer instance.
 */
export function isArmorer(value: unknown): value is Armorer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Armorer).register === 'function' &&
    typeof (value as Armorer).tools === 'function' &&
    typeof (value as Armorer).getTool === 'function' &&
    typeof (value as Armorer).execute === 'function' &&
    typeof (value as Armorer).toJSON === 'function'
  );
}
