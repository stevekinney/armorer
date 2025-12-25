import { createEventTarget } from 'event-emission';
import { z } from 'zod';

import { errorString, normalizeError } from './errors';
import type {
  DefaultToolEvents,
  MinimalAbortSignal,
  QuartermasterTool,
  ToolCallWithArguments,
  ToolConfig,
  ToolContext,
  ToolEventsMap,
  ToolExecuteOptions,
  ToolExecuteWithOptions,
  ToolMetadata,
  ToolParametersSchema,
} from './is-tool';
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
  TInput,
  TOutput,
  E extends ToolEventsMap = DefaultToolEvents,
  Tags extends readonly string[] = readonly string[],
  M extends ToolMetadata | undefined = undefined,
> {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  execute: (params: TInput, context: ToolContext<E>) => Promise<TOutput>;
  timeoutMs?: number;
  tags?: NormalizeTagsOption<Tags>;
  metadata?: M;
}

export type WithContext<
  T extends Record<string, unknown> = Record<string, unknown>,
  E extends ToolEventsMap = DefaultToolEvents,
> = ToolContext<E> & T;

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
  TInput,
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
}: CreateToolOptions<TInput, TOutput, E, Tags, M>): QuartermasterTool {
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

  let toolConfiguration!: ToolConfig;

  const execute = async (
    toolCall: ToolCallWithArguments,
    options?: ToolExecuteOptions,
  ): Promise<ToolResult> => {
    const executeOptions: { timeoutMs?: number; signal?: MinimalAbortSignal } = {};
    if (options?.signal) {
      executeOptions.signal = options.signal;
    }
    return executeInner(toolCall, executeOptions);
  };

  const executeInner = async (
    toolCall: ToolCall & { arguments: unknown },
    options: { timeoutMs?: number; signal?: MinimalAbortSignal } = {},
  ): Promise<ToolResult> => {
    const baseDetail = { toolCall, toolConfiguration };

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
      return {
        toolCallId: toolCall.id ?? '',
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
      const parsedDetail = { toolCall: typedToolCall, toolConfiguration };
      emit('validate-success', { ...parsedDetail, params: toolCall.arguments, parsed });
      if (options.signal?.aborted) {
        return handleCancellation(options.signal.reason);
      }
      const meta: { toolName: string; callId?: string } = { toolName: name };
      if (typedToolCall.id) {
        meta.callId = typedToolCall.id;
      }
      const runner = fn(parsed, {
        dispatch: dispatchEvent,
        meta,
        toolCall: typedToolCall,
        toolConfiguration,
      });
      const timed =
        typeof options.timeoutMs === 'number'
          ? withTimeout(runner, options.timeoutMs)
          : runner;
      const value = await raceWithSignal(timed, options.signal);
      emit('execute-success', { ...parsedDetail, result: value });
      emit('settled', { ...parsedDetail, result: value });
      return {
        toolCallId: typedToolCall.id ?? '',
        toolName: name,
        result: value,
      } as ToolResult;
    } catch (error) {
      if (isAbortRejection(error)) {
        return handleCancellation(error.reason);
      }
      const isZod = (error as any)?.name === 'ZodError';
      if (isZod) {
        emit('validate-error', { ...baseDetail, params: toolCall.arguments, error });
      } else {
        emit('execute-error', { ...baseDetail, error });
      }
      emit('settled', { ...baseDetail, error });
      return {
        toolCallId: toolCall.id ?? '',
        toolName: name,
        result: undefined,
        error: errorString(
          normalizeError(
            error,
            (error as any)?.message === 'TIMEOUT' ? { code: 'TIMEOUT' } : undefined,
          ),
        ),
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

  const callable = async (params: unknown) => {
    const toolCall = createToolCall<TInput>(name, params as TInput);
    const result = await execute(toolCall);
    if (result.error) {
      throw new Error(result.error);
    }
    return result.result as TOutput;
  };

  toolConfiguration = {
    name,
    description,
    schema: typedSchema,
    execute: async (params) => callable(params),
  };
  if (normalizedTags) {
    toolConfiguration.tags = normalizedTags;
  }

  const toJSON = (() => {
    const json = toJSONSchema(toolConfiguration);
    return () => ({ ...json, tags: normalizedTags ?? [] });
  })();

  const metadataValue = customMetadata ?? (undefined as M);

  // Build metadata bag for proxy lookup
  const bag: Record<PropertyKey, unknown> = {
    name,
    description,
    schema: typedSchema,
    execute,
    rawExecute: fn, // Expose the original user function for testing
    toolConfiguration,
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
    callable as unknown as QuartermasterTool<z.ZodType<TInput>, E, TOutput, M>,
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

  return tool as unknown as QuartermasterTool;

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
  TInput,
  TOutput,
  E extends ToolEventsMap,
  Tags extends readonly string[],
  M extends ToolMetadata | undefined,
> = Omit<CreateToolOptions<TInput, TOutput, E, Tags, M>, 'execute'> & {
  execute: (params: TInput, context: ToolContext<E> & Ctx) => Promise<TOutput>;
};

export function withContext<Ctx extends Record<string, unknown>>(
  context: Ctx,
): <TInput, TOutput = unknown>(
  options: CreateToolWithContextOptions<
    Ctx,
    TInput,
    TOutput,
    DefaultToolEvents,
    readonly string[],
    undefined
  >,
) => QuartermasterTool;
export function withContext<
  Ctx extends Record<string, unknown>,
  TInput,
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
): QuartermasterTool;
export function withContext<Ctx extends Record<string, unknown>>(
  context: Ctx,
  options?: CreateToolWithContextOptions<Ctx, any, any, any, any, any>,
):
  | QuartermasterTool
  | ((
      options: CreateToolWithContextOptions<Ctx, any, any, any, any, any>,
    ) => QuartermasterTool) {
  const build = (opts: CreateToolWithContextOptions<Ctx, any, any, any, any, any>) => {
    const { execute, ...rest } = opts;
    return createTool({
      ...rest,
      async execute(params, toolContext) {
        const extended = Object.assign({}, toolContext, context);
        return execute(params, extended);
      },
    } as CreateToolOptions<any, any, any, any, any>);
  };
  if (options) {
    return build(options);
  }
  return build;
}

const ABORT_REJECTION_SYMBOL = Symbol('quartermaster.abort');

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

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return (
    !!value &&
    typeof (value as any)._def === 'object' &&
    typeof (value as any).parse === 'function'
  );
}

function normalizeSchema(schema: unknown): z.ZodTypeAny {
  if (isZodSchema(schema)) {
    return schema;
  }
  if (schema && typeof schema === 'object') {
    return z.object(schema as Record<string, z.ZodTypeAny>);
  }
  throw new Error('Tool schema must be a Zod schema or an object of Zod schemas');
}
