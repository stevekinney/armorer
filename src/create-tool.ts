import { createEventTarget } from 'event-emission';
import { z } from 'zod';

import { errorString, normalizeError } from './errors';
import type {
  ArmorerTool,
  DefaultToolEvents,
  MinimalAbortSignal,
  ToolCallWithArguments,
  ToolConfig,
  ToolContext,
  ToolDiagnostics,
  ToolEventsMap,
  ToolExecuteOptions,
  ToolExecuteWithOptions,
  ToolMetadata,
  ToolParametersSchema,
  ToolRepairHint,
  ToolValidationReport,
} from './is-tool';
import { isZodObjectSchema, isZodSchema } from './schema-utilities';
import { assertKebabCaseTag, type NormalizeTagsOption, uniqTags } from './tag-utilities';
import { toJSONSchema } from './to-json-schema';
import type { ToolCall, ToolResult } from './types';

/**
 * Options for creating a tool.
 *
 * TInput is inferred from the schema type. To minimize type computation:
 * - ToolContext and related types use type-erasure (unknown) for params
 * - Runtime schema validation provides actual type safety
 * - Only the execute function receives typed params
 */
export interface CreateToolOptions<
  TInput extends Record<string, unknown> = Record<string, never>,
  TOutput = unknown,
  E extends ToolEventsMap = DefaultToolEvents,
  Tags extends readonly string[] = readonly string[],
  M extends ToolMetadata | undefined = undefined,
> {
  name: string;
  description: string;
  schema?: z.ZodType<TInput> | z.ZodRawShape;
  execute:
    | ((params: TInput, context: ToolContext<E>) => Promise<TOutput>)
    | Promise<(params: TInput, context: ToolContext<E>) => Promise<TOutput>>;
  timeoutMs?: number;
  tags?: NormalizeTagsOption<Tags>;
  metadata?: M;
  diagnostics?: ToolDiagnostics;
}

export type WithContext<
  T extends Record<string, unknown> = Record<string, unknown>,
  E extends ToolEventsMap = DefaultToolEvents,
> = ToolContext<E> & T;

export function lazy<TExecute extends (...args: any[]) => Promise<any>>(
  loader: () => PromiseLike<TExecute> | TExecute,
): TExecute {
  let resolved: TExecute | undefined;
  let pending: Promise<TExecute> | undefined;

  const load = async () => {
    if (resolved) return resolved;
    if (!pending) {
      pending = Promise.resolve()
        .then(() => loader())
        .then((value) => {
          if (typeof value !== 'function') {
            throw new TypeError('lazy loader must resolve to a function');
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

  return (async (...args: Parameters<TExecute>) => {
    const execute = await load();
    return execute(...args);
  }) as TExecute;
}

/**
 * Creates a tool with explicit input/output types.
 *
 * Usage:
 * ```ts
 * interface MyInput { foo: string; bar: number; }
 * interface MyOutput { result: string; }
 *
 * const tool = createTool<MyInput, MyOutput>({
 *   name: 'myTool',
 *   schema: z.object({ foo: z.string(), bar: z.number() }),
 *   execute: async (params) => {
 *     // params is MyInput - properly typed!
 *     return { result: params.foo };
 *   }
 * });
 * ```
 */
export function createTool<
  TInput extends Record<string, unknown> = Record<string, never>,
  TOutput = unknown,
  E extends ToolEventsMap = DefaultToolEvents,
  Tags extends readonly string[] = readonly string[],
  M extends ToolMetadata | undefined = undefined,
>({
  name,
  description,
  schema: toolSchema,
  execute: fn,
  tags,
  metadata: customMetadata,
  diagnostics,
}: CreateToolOptions<TInput, TOutput, E, Tags, M>): ArmorerTool {
  const normalizedSchema = normalizeSchema(toolSchema);
  const schema = normalizedSchema as unknown as ToolParametersSchema;
  const typedSchema = normalizedSchema as unknown as z.ZodType<TInput>;

  const hub = createEventTarget<E>();
  const {
    addEventListener,
    dispatchEvent,
    on,
    once,
    subscribe,
    toObservable,
    events,
    complete,
  } = hub;

  // Helper to emit events with proper typing (event-emission accepts partial events at runtime)
  const emit = (type: string, detail: unknown) =>
    dispatchEvent({ type, detail } as Parameters<typeof dispatchEvent>[0]);

  let configuration!: ToolConfig;

  const resolveExecute = createLazyExecuteResolver(fn);

  const executeCall = async (
    toolCall: ToolCallWithArguments,
    options?: ToolExecuteOptions,
  ): Promise<ToolResult> => {
    const executeOptions: { timeoutMs?: number; signal?: MinimalAbortSignal } = {};
    if (options?.signal) {
      executeOptions.signal = options.signal;
    }
    return executeInner(normalizeToolCall(toolCall), executeOptions);
  };

  const executeParams = async (
    params: TInput,
    options?: ToolExecuteOptions,
  ): Promise<TOutput> => {
    const toolCall = createToolCall<TInput>(name, params);
    const result = await executeCall(toolCall, options);
    if (result.error) {
      throw new Error(result.error);
    }
    return result.result as TOutput;
  };

  const execute = (
    input: ToolCallWithArguments | TInput,
    options?: ToolExecuteOptions,
  ): Promise<ToolResult | TOutput> => {
    if (looksLikeToolCall(input, name)) {
      return executeCall(input, options);
    }
    return executeParams(input, options);
  };

  const executeInner = async (
    toolCall: ToolCall & { arguments: unknown },
    options: { timeoutMs?: number; signal?: MinimalAbortSignal } = {},
  ): Promise<ToolResult> => {
    const baseDetail = { toolCall, configuration };

    const handleCancellation = (reason?: unknown): ToolResult => {
      let message: string;
      if (reason === undefined || reason === null) message = 'Cancelled';
      else if (typeof reason === 'string') message = reason || 'Cancelled';
      else if (reason instanceof Error) message = reason.message || 'Cancelled';
      else {
        try {
          const text =
            typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
          message = text ? `Cancelled: ${text}` : 'Cancelled';
        } catch {
          message = 'Cancelled';
        }
      }
      const errorObj = new Error(message);
      emit('execute-error', { ...baseDetail, error: errorObj });
      emit('settled', { ...baseDetail, error: errorObj });
      const callId = toolCall.id;
      return {
        callId,
        outcome: 'error',
        content: message,
        toolCallId: callId,
        toolName: name,
        result: undefined,
        error: message,
      } as ToolResult;
    };

    if (options.signal?.aborted) {
      return handleCancellation(options.signal.reason);
    }

    try {
      emit('execute-start', { ...baseDetail, params: toolCall.arguments });
      if (options.signal?.aborted) {
        return handleCancellation(options.signal.reason);
      }
      const parsed = schema.parse(toolCall.arguments) as TInput;
      const typedToolCall = { ...toolCall, arguments: parsed } as ToolCallWithArguments;
      const parsedDetail = { toolCall: typedToolCall, configuration };
      emit('validate-success', { ...parsedDetail, params: toolCall.arguments, parsed });
      if (options.signal?.aborted) {
        return handleCancellation(options.signal.reason);
      }
      const meta: { toolName: string; callId?: string } = { toolName: name };
      if (typedToolCall.id) {
        meta.callId = typedToolCall.id;
      }
      const resolvedExecute = await resolveExecute();
      if (options.signal?.aborted) {
        return handleCancellation(options.signal.reason);
      }
      const runner = resolvedExecute(parsed, {
        dispatch: dispatchEvent,
        meta,
        toolCall: typedToolCall,
        configuration,
      });
      const timed =
        typeof options.timeoutMs === 'number'
          ? withTimeout(runner, options.timeoutMs)
          : runner;
      const value = await raceWithSignal(timed, options.signal);
      emit('execute-success', { ...parsedDetail, result: value });
      emit('settled', { ...parsedDetail, result: value });
      const callId = typedToolCall.id;
      return {
        callId,
        outcome: 'success',
        content: value,
        toolCallId: callId,
        toolName: name,
        result: value,
      } as ToolResult;
    } catch (error) {
      if (isAbortRejection(error)) {
        return handleCancellation(error.reason);
      }
      const isZod = (error as any)?.name === 'ZodError';
      if (isZod) {
        let report: ToolValidationReport | undefined;
        let repairHints: ToolRepairHint[] | undefined;

        if (diagnostics?.safeParseWithReport) {
          try {
            const diagnosticsSchema =
              (schema as any)?._def?.out ?? (schema as any)?._def?.schema ?? schema;
            const diagnosticsResult = diagnostics.safeParseWithReport(
              diagnosticsSchema,
              toolCall.arguments,
            );
            report = diagnosticsResult.report;
            if (diagnostics?.createRepairHints) {
              const hintError = diagnosticsResult.success
                ? error
                : diagnosticsResult.error;
              repairHints = diagnostics.createRepairHints(hintError, {
                rootLabel: 'arguments',
              });
            }
          } catch {
            // Ignore diagnostics failures
          }
        }

        if (!repairHints && diagnostics?.createRepairHints) {
          try {
            repairHints = diagnostics.createRepairHints(error, {
              rootLabel: 'arguments',
            });
          } catch {
            // Ignore diagnostics failures
          }
        }

        emit('validate-error', {
          ...baseDetail,
          params: toolCall.arguments,
          error,
          report,
          repairHints,
        });
      } else {
        emit('execute-error', { ...baseDetail, error });
      }
      emit('settled', { ...baseDetail, error });
      const callId = toolCall.id;
      const message = errorString(
        normalizeError(
          error,
          (error as any)?.message === 'TIMEOUT' ? { code: 'TIMEOUT' } : undefined,
        ),
      );
      return {
        callId,
        outcome: 'error',
        content: message,
        toolCallId: callId,
        toolName: name,
        result: undefined,
        error: message,
      } as ToolResult;
    }
  };

  const normalizedTags = Array.isArray(tags)
    ? uniqTags(
        (tags as readonly string[]).map((tag) =>
          assertKebabCaseTag(tag, `Tool "${name}"`),
        ),
      )
    : undefined;

  const callable = async (params: unknown) => executeParams(params as TInput);

  configuration = {
    name,
    description,
    schema: typedSchema,
    parameters: typedSchema,
    execute: async (params) => executeParams(params as TInput),
  };
  if (normalizedTags) {
    configuration.tags = normalizedTags;
  }
  if (customMetadata !== undefined) {
    configuration.metadata = customMetadata;
  }

  const toJSON = (() => {
    const json = toJSONSchema(configuration);
    return () => ({ ...json, tags: normalizedTags ?? [] });
  })();

  const metadataValue = customMetadata ?? (undefined as M);

  // Build metadata bag for proxy lookup
  const bag: Record<PropertyKey, unknown> = {
    name,
    description,
    schema: typedSchema,
    parameters: typedSchema,
    execute,
    rawExecute: async (params: unknown, context: ToolContext<E>) => {
      const resolved = await resolveExecute();
      return resolved(params as TInput, context);
    },
    configuration,
    // Event listener methods
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
    toJSON,
    toString: () => `**${name}**: ${description}`,
    [Symbol.toPrimitive]: () => name,
    tags: normalizedTags ?? [],
    metadata: metadataValue,
  };

  const tool = new Proxy(
    callable as unknown as ArmorerTool<z.ZodType<TInput>, E, TOutput, M>,
    {
      get(target, prop, receiver) {
        if (prop in bag) return (bag as any)[prop];
        return Reflect.get(target as object, prop, receiver as unknown as object);
      },
      has(_target, prop) {
        if (prop in bag) return true;
        return Reflect.has(callable as unknown as object, prop);
      },
      apply(_target, _thisArg, argArray) {
        return (callable as any)(argArray[0]);
      },
      // Optional: cleanup on dispose
      getOwnPropertyDescriptor(_target, prop) {
        if (prop in bag) {
          return {
            configurable: true,
            enumerable: true,
            writable: false,
            value: (bag as any)[prop],
          };
        }
        return Object.getOwnPropertyDescriptor(callable as any, prop);
      },
    },
  );

  // Provide [Symbol.dispose] to complete the event target (clears listeners and marks complete)
  (bag as any)[Symbol.dispose] = () => {
    complete();
  };

  (bag as any).executeWith = (options: ToolExecuteWithOptions) => {
    const toolCall = createToolCall(name, options.params, options.callId);
    const executeOptions: { timeoutMs?: number; signal?: MinimalAbortSignal } = {};
    if (typeof options.timeoutMs === 'number') {
      executeOptions.timeoutMs = options.timeoutMs;
    }
    if (options.signal) {
      executeOptions.signal = options.signal;
    }
    return executeInner(toolCall, executeOptions);
  };

  return tool as unknown as ArmorerTool;

  function withTimeout<TP>(promise: Promise<TP>, timeoutMs: number): Promise<TP> {
    return new Promise<TP>((resolve, reject) => {
      const id = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
      promise.then(
        (v) => {
          clearTimeout(id);
          resolve(v);
        },
        (e) => {
          clearTimeout(id);
          reject(e);
        },
      );
    });
  }

  function raceWithSignal<TP>(
    promise: Promise<TP>,
    signal?: MinimalAbortSignal,
  ): Promise<TP> {
    if (!signal) return promise;
    if (signal.aborted) {
      return Promise.reject(createAbortRejection(signal.reason));
    }
    return new Promise<TP>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(createAbortRejection(signal.reason));
      };
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };
      signal.addEventListener('abort', onAbort, { once: true } as any);
      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  function createAbortRejection(reason?: unknown) {
    return { [ABORT_REJECTION_SYMBOL]: true, reason };
  }

  function isAbortRejection(error: unknown): error is { reason?: unknown } {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as any)[ABORT_REJECTION_SYMBOL] === true
    );
  }
}

/**
 * Options for creating a tool with additional context.
 * TInput is the input interface type - the schema validates it at runtime.
 */
type CreateToolWithContextOptions<
  Ctx extends Record<string, unknown>,
  TInput extends Record<string, unknown>,
  TOutput,
  E extends ToolEventsMap,
  Tags extends readonly string[],
  M extends ToolMetadata | undefined,
> = Omit<CreateToolOptions<TInput, TOutput, E, Tags, M>, 'execute'> & {
  execute:
    | ((params: TInput, context: ToolContext<E> & Ctx) => Promise<TOutput>)
    | Promise<(params: TInput, context: ToolContext<E> & Ctx) => Promise<TOutput>>;
};

export function withContext<Ctx extends Record<string, unknown>>(
  context: Ctx,
): <TInput extends Record<string, unknown>, TOutput = unknown>(
  options: CreateToolWithContextOptions<
    Ctx,
    TInput,
    TOutput,
    DefaultToolEvents,
    readonly string[],
    undefined
  >,
) => ArmorerTool;
export function withContext<
  Ctx extends Record<string, unknown>,
  TInput extends Record<string, unknown>,
  TOutput = unknown,
>(
  context: Ctx,
  options: CreateToolWithContextOptions<
    Ctx,
    TInput,
    TOutput,
    DefaultToolEvents,
    readonly string[],
    undefined
  >,
): ArmorerTool;
export function withContext<Ctx extends Record<string, unknown>>(
  context: Ctx,
  options?: CreateToolWithContextOptions<Ctx, any, any, any, any, any>,
):
  | ArmorerTool
  | ((
      options: CreateToolWithContextOptions<Ctx, any, any, any, any, any>,
    ) => ArmorerTool) {
  const build = (opts: CreateToolWithContextOptions<Ctx, any, any, any, any, any>) => {
    const { execute, ...rest } = opts;
    const resolveExecute = createLazyExecuteResolver(execute);
    return createTool({
      ...rest,
      async execute(params, toolContext) {
        const extended = Object.assign({}, toolContext, context);
        const resolved = await resolveExecute();
        return resolved(params, extended);
      },
    } as CreateToolOptions<any, any, any, any, any>);
  };
  if (options) {
    return build(options);
  }
  return build;
}

const ABORT_REJECTION_SYMBOL = Symbol('armorer.abort');

export function createToolCall<Args>(
  toolName: string,
  args: Args,
  id?: string,
): ToolCall & { arguments: Args } {
  return {
    id: id ?? crypto.randomUUID(),
    name: toolName,
    arguments: args,
  };
}

const TOOL_CALL_KEYS = new Set(['id', 'name', 'arguments']);

function normalizeToolCall<T extends ToolCallWithArguments>(toolCall: T): T {
  if (toolCall.id) return toolCall;
  return { ...toolCall, id: crypto.randomUUID() };
}

function looksLikeToolCall(
  value: unknown,
  toolName: string,
): value is ToolCallWithArguments {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['name'] !== 'string') return false;
  if (candidate['name'] !== toolName) return false;
  if (typeof candidate['id'] !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(candidate, 'arguments')) return false;
  return Object.keys(candidate).every((key) => TOOL_CALL_KEYS.has(key));
}

function normalizeSchema(schema: unknown): z.ZodTypeAny {
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

type ToolExecute<TInput, TOutput, TContext> = (
  params: TInput,
  context: TContext,
) => Promise<TOutput>;

type LazyToolExecute<TInput, TOutput, TContext> =
  | ToolExecute<TInput, TOutput, TContext>
  | Promise<ToolExecute<TInput, TOutput, TContext>>;

function createLazyExecuteResolver<TInput, TOutput, TContext>(
  execute: LazyToolExecute<TInput, TOutput, TContext>,
): () => Promise<ToolExecute<TInput, TOutput, TContext>> {
  if (!isExecutable(execute)) {
    throw new TypeError(
      'execute must be a function or a promise that resolves to a function',
    );
  }
  if (typeof execute === 'function') {
    const fn = execute;
    return () => Promise.resolve(fn);
  }
  let resolved: ToolExecute<TInput, TOutput, TContext> | undefined;
  let pending: Promise<ToolExecute<TInput, TOutput, TContext>> | undefined;

  return async () => {
    if (resolved) return resolved;
    if (!pending) {
      pending = Promise.resolve(execute)
        .then((value) => {
          if (typeof value !== 'function') {
            throw new TypeError(
              'execute must be a function or a promise that resolves to a function',
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

function isExecutable<TInput, TOutput, TContext>(
  execute: LazyToolExecute<TInput, TOutput, TContext>,
): boolean {
  return (
    typeof execute === 'function' ||
    (typeof execute === 'object' &&
      execute !== null &&
      'then' in execute &&
      typeof (execute as PromiseLike<unknown>).then === 'function')
  );
}
