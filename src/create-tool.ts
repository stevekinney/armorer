import { createHash } from 'node:crypto';

import { createEventTarget } from 'event-emission';
import { z } from 'zod';

import type { Armorer } from './create-armorer';
import { errorString, normalizeError } from './errors';
import type {
  ArmorerTool,
  DefaultToolEvents,
  MinimalAbortSignal,
  OutputValidationMode,
  OutputValidationResult,
  ToolCallWithArguments,
  ToolConfig,
  ToolContext,
  ToolDiagnostics,
  ToolDigestOptions,
  ToolEventsMap,
  ToolExecuteOptions,
  ToolExecuteWithOptions,
  ToolMetadata,
  ToolParametersSchema,
  ToolPolicyAfterContext,
  ToolPolicyContext,
  ToolPolicyContextProvider,
  ToolPolicyDecision,
  ToolPolicyHooks,
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
  TInput extends object = Record<string, never>,
  TOutput = unknown,
  E extends ToolEventsMap = DefaultToolEvents,
  Tags extends readonly string[] = readonly string[],
  M extends ToolMetadata | undefined = undefined,
  TContext extends ToolContext<E> = ToolContext<E>,
  TParameters extends object = TInput,
  TReturn = TOutput,
> {
  name: string;
  description: string;
  schema?: z.ZodType<TParameters> | z.ZodRawShape | z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny;
  execute:
    | ((params: TParameters, context: TContext) => Promise<TReturn>)
    | Promise<(params: TParameters, context: TContext) => Promise<TReturn>>;
  timeoutMs?: number;
  tags?: NormalizeTagsOption<Tags>;
  metadata?: M;
  policy?: ToolPolicyHooks;
  policyContext?: ToolPolicyContextProvider;
  digests?: ToolDigestOptions;
  outputValidationMode?: OutputValidationMode;
  concurrency?: number;
  telemetry?: boolean;
  diagnostics?: ToolDiagnostics;
}

export type WithContext<
  T extends object = Record<string, unknown>,
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
  TInput extends object = Record<string, never>,
  TOutput = unknown,
  E extends ToolEventsMap = DefaultToolEvents,
  Tags extends readonly string[] = readonly string[],
  M extends ToolMetadata | undefined = undefined,
  TContext extends ToolContext<E> = ToolContext<E>,
  TParameters extends object = TInput,
  TReturn = TOutput,
>(
  options: CreateToolOptions<TInput, TOutput, E, Tags, M, TContext, TParameters, TReturn>,
  armorer?: Armorer,
): ArmorerTool<z.ZodType<TInput>, E, TReturn, M>;
export function createTool<
  TInput extends object = Record<string, never>,
  TOutput = unknown,
  E extends ToolEventsMap = DefaultToolEvents,
  Tags extends readonly string[] = readonly string[],
  M extends ToolMetadata | undefined = undefined,
  TContext extends ToolContext<E> = ToolContext<E>,
  TParameters extends object = TInput,
  TReturn = TOutput,
>(
  {
    name,
    description,
    schema: toolSchema,
    outputSchema,
    execute: fn,
    timeoutMs,
    tags,
    metadata: customMetadata,
    policy,
    policyContext,
    digests,
    outputValidationMode,
    concurrency,
    telemetry,
    diagnostics,
  }: CreateToolOptions<TInput, TOutput, E, Tags, M, TContext, TParameters, TReturn>,
  armorer?: Armorer,
): ArmorerTool<z.ZodType<TInput>, E, TReturn, M> {
  const normalizedSchema = normalizeSchema(toolSchema);
  const schema = normalizedSchema as unknown as ToolParametersSchema;
  const typedSchema = normalizedSchema as unknown as z.ZodType<TParameters>;

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

  const metadataValue = customMetadata ?? (undefined as M);
  const normalizedTags = normalizeTagsWithMetadata(tags, metadataValue, name);
  const telemetryEnabled = telemetry === true;
  const digestOptions = normalizeDigestOptions(digests);
  const resolvedOutputValidationMode = outputValidationMode ?? 'report';
  const concurrencyLimit = normalizeConcurrency(
    typeof metadataValue?.concurrency === 'number'
      ? metadataValue.concurrency
      : concurrency,
  );
  const limiter = createConcurrencyLimiter(concurrencyLimit);
  const runWithConcurrency = <T>(task: () => Promise<T>) =>
    limiter ? limiter.run(task) : task();

  let configuration!: ToolConfig;

  const resolveExecute = createLazyExecuteResolver(fn);
  const policyHooks = policy;
  const policyContextProvider = policyContext;

  const buildPolicyContext = (
    toolCall: ToolCall,
    params: unknown,
    inputDigest?: string,
  ): ToolPolicyContext => {
    const context: ToolPolicyContext = {
      toolName: name,
      toolCall,
      params,
      configuration,
    };
    if (inputDigest !== undefined) {
      context.inputDigest = inputDigest;
    }
    if (normalizedTags.length) {
      context.tags = normalizedTags;
    }
    if (metadataValue !== undefined) {
      context.metadata = metadataValue;
    }
    return context;
  };

  const resolvePolicyDecision = async (
    context: ToolPolicyContext,
  ): Promise<ToolPolicyDecision | undefined> => {
    if (!policyHooks?.beforeExecute) {
      return undefined;
    }
    const decision = await policyHooks.beforeExecute(context);
    if (decision === undefined) {
      return undefined;
    }
    if (typeof decision === 'boolean') {
      return { allow: decision };
    }
    return decision;
  };

  const runPolicyAfter = async (context: ToolPolicyAfterContext): Promise<void> => {
    if (!policyHooks?.afterExecute) {
      return;
    }
    try {
      await policyHooks.afterExecute(context);
    } catch (error) {
      emit('log', {
        level: 'warn',
        message: 'policy afterExecute failed',
        data: error,
      });
    }
  };

  const executeCall = async (
    toolCall: ToolCallWithArguments,
    options?: ToolExecuteOptions,
  ): Promise<ToolResult> => {
    const resolvedTimeoutMs = options?.timeoutMs ?? timeoutMs;
    const executeOptions =
      options?.signal || resolvedTimeoutMs !== undefined
        ? {
            ...(options?.signal ? { signal: options.signal } : {}),
            ...(resolvedTimeoutMs !== undefined ? { timeoutMs: resolvedTimeoutMs } : {}),
          }
        : undefined;
    return runWithConcurrency(() =>
      executeInner(normalizeToolCall(toolCall), executeOptions),
    );
  };

  const executeParams = async (
    params: TParameters,
    options?: ToolExecuteOptions,
  ): Promise<TReturn> => {
    const toolCall = createToolCall<TParameters>(name, params);
    const result = await executeCall(toolCall, options);
    if (result.error) {
      throw new Error(result.error);
    }
    return result.result as TReturn;
  };

  const execute = (
    input: ToolCallWithArguments | TParameters,
    options?: ToolExecuteOptions,
  ): Promise<ToolResult | TReturn> => {
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
    const startedAt = telemetryEnabled ? Date.now() : 0;
    const inputDigest = digestOptions.input
      ? computeDigest(toolCall.arguments, digestOptions.algorithm)
      : undefined;

    const finishTelemetry = (
      status: 'success' | 'error' | 'denied' | 'cancelled',
      details: {
        result?: unknown;
        error?: unknown;
        reason?: string;
        errorCategory?: 'denied' | 'failed' | 'transient';
        inputDigest?: string;
        outputDigest?: string;
        outputValidation?: OutputValidationResult;
      } = {},
    ) => {
      if (!telemetryEnabled) return;
      const finishedAt = Date.now();
      emit('tool.finished', {
        ...baseDetail,
        status,
        durationMs: finishedAt - startedAt,
        startedAt,
        finishedAt,
        ...details,
      });
    };

    if (telemetryEnabled) {
      emit('tool.started', {
        ...baseDetail,
        params: toolCall.arguments,
        startedAt,
        inputDigest,
      });
    }

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
      const cancelledDetails: {
        error?: unknown;
        inputDigest?: string;
      } = { error: errorObj };
      if (inputDigest !== undefined) {
        cancelledDetails.inputDigest = inputDigest;
      }
      finishTelemetry('cancelled', cancelledDetails);
      const callId = toolCall.id;
      return {
        callId,
        outcome: 'error',
        content: message,
        toolCallId: callId,
        toolName: name,
        result: undefined,
        error: message,
        errorCategory: 'failed',
        inputDigest,
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
      const parsed = schema.parse(toolCall.arguments) as TParameters;
      const typedToolCall = { ...toolCall, arguments: parsed } as ToolCallWithArguments;
      const parsedDetail = { toolCall: typedToolCall, configuration };
      emit('validate-success', { ...parsedDetail, params: toolCall.arguments, parsed });
      if (options.signal?.aborted) {
        return handleCancellation(options.signal.reason);
      }
      const policyContext = buildPolicyContext(typedToolCall, parsed, inputDigest);
      if (policyContextProvider) {
        const injected = await policyContextProvider(policyContext);
        if (injected && typeof injected === 'object' && !Array.isArray(injected)) {
          policyContext.policyContext = injected;
        }
      }
      const decision = await resolvePolicyDecision(policyContext);
      if (decision?.allow === false) {
        const reason = decision.reason ?? 'Policy denied';
        emit('policy-denied', { ...parsedDetail, params: parsed, reason });
        const errorObj = new Error(reason);
        emit('execute-error', { ...parsedDetail, error: errorObj });
        emit('settled', { ...parsedDetail, error: errorObj });
        await runPolicyAfter({
          ...policyContext,
          outcome: 'denied',
          errorCategory: 'denied',
          reason,
        });
        const deniedDetails: {
          reason?: string;
          errorCategory?: 'denied';
          inputDigest?: string;
        } = { reason, errorCategory: 'denied' };
        if (inputDigest !== undefined) {
          deniedDetails.inputDigest = inputDigest;
        }
        finishTelemetry('denied', deniedDetails);
        const callId = typedToolCall.id;
        return {
          callId,
          outcome: 'error',
          content: reason,
          toolCallId: callId,
          toolName: name,
          result: undefined,
          error: reason,
          errorCategory: 'denied',
          inputDigest,
        } as ToolResult;
      }
      const meta: { toolName: string; callId?: string } = { toolName: name };
      if (typedToolCall.id) {
        meta.callId = typedToolCall.id;
      }
      const resolvedExecute = await resolveExecute();
      if (options.signal?.aborted) {
        return handleCancellation(options.signal.reason);
      }
      // Merge armorer context if tool was created with an armorer that has context
      const armorerContext = armorer?.getContext?.();

      const toolContext: ToolContext<E> = {
        dispatch: dispatchEvent,
        meta,
        toolCall: typedToolCall,
        configuration,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(armorerContext || {}),
      };

      // `TContext` may be a subtype of `ToolContext<E>` (e.g. with extra fields).
      // At runtime we can only guarantee the base ToolContext shape plus any armorer context,
      // so we cast to avoid `exactOptionalPropertyTypes` assignability issues.
      const runner = resolvedExecute(parsed, toolContext as unknown as TContext);
      const timed =
        typeof options.timeoutMs === 'number'
          ? withTimeout(runner, options.timeoutMs)
          : runner;
      const value = await raceWithSignal(timed, options.signal);
      const outputValidation = validateOutput(
        outputSchema,
        value,
        resolvedOutputValidationMode,
      );
      if (outputValidation) {
        if (outputValidation.success) {
          emit('output-validate-success', { ...parsedDetail, result: value });
        } else {
          emit('output-validate-error', {
            ...parsedDetail,
            result: value,
            error: outputValidation.error,
          });
          if (resolvedOutputValidationMode === 'throw') {
            throw outputValidation.error;
          }
        }
      }
      const outputDigest = digestOptions.output
        ? computeDigest(value, digestOptions.algorithm)
        : undefined;
      emit('execute-success', { ...parsedDetail, result: value });
      emit('settled', { ...parsedDetail, result: value });
      const policyAfter: ToolPolicyAfterContext = {
        ...policyContext,
        outcome: 'success',
        result: value,
      };
      if (outputDigest !== undefined) {
        policyAfter.outputDigest = outputDigest;
      }
      if (outputValidation !== undefined) {
        policyAfter.outputValidation = outputValidation;
      }
      await runPolicyAfter(policyAfter);
      const successDetails: {
        result?: unknown;
        inputDigest?: string;
        outputDigest?: string;
        outputValidation?: OutputValidationResult;
      } = { result: value };
      if (inputDigest !== undefined) {
        successDetails.inputDigest = inputDigest;
      }
      if (outputDigest !== undefined) {
        successDetails.outputDigest = outputDigest;
      }
      if (outputValidation !== undefined) {
        successDetails.outputValidation = outputValidation;
      }
      finishTelemetry('success', successDetails);
      const callId = typedToolCall.id;
      return {
        callId,
        outcome: 'success',
        content: value,
        toolCallId: callId,
        toolName: name,
        result: value,
        inputDigest,
        outputDigest,
        outputValidation: outputValidation
          ? {
              success: outputValidation.success,
              error: outputValidation.error
                ? errorString(normalizeError(outputValidation.error))
                : undefined,
            }
          : undefined,
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
      const errorCategory = classifyError(error);
      const errorPolicyContext = buildPolicyContext(
        toolCall,
        toolCall.arguments,
        inputDigest,
      );
      if (policyContextProvider) {
        const injected = await policyContextProvider(errorPolicyContext);
        if (injected && typeof injected === 'object' && !Array.isArray(injected)) {
          errorPolicyContext.policyContext = injected;
        }
      }
      await runPolicyAfter({
        ...errorPolicyContext,
        outcome: 'error',
        errorCategory,
        error,
      });
      const errorDetails: {
        error?: unknown;
        errorCategory?: 'failed' | 'transient' | 'denied';
        inputDigest?: string;
      } = { error, errorCategory };
      if (inputDigest !== undefined) {
        errorDetails.inputDigest = inputDigest;
      }
      finishTelemetry('error', errorDetails);
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
        errorCategory,
        inputDigest,
      } as ToolResult;
    }
  };

  const callable = async (params: unknown) => executeParams(params as TParameters);

  configuration = {
    name,
    description,
    schema: typedSchema,
    parameters: typedSchema,
    execute: async (params) => executeParams(params as TParameters),
  };
  if (outputSchema) {
    configuration.outputSchema = outputSchema;
  }
  if (normalizedTags.length) {
    configuration.tags = normalizedTags;
  }
  if (metadataValue !== undefined) {
    configuration.metadata = metadataValue;
  }
  if (policyHooks) {
    configuration.policy = policyHooks;
  }
  if (policyContextProvider) {
    configuration.policyContext = policyContextProvider;
  }
  if (digests !== undefined) {
    configuration.digests = digests;
  }
  if (outputValidationMode !== undefined) {
    configuration.outputValidationMode = outputValidationMode;
  }
  if (concurrencyLimit !== undefined) {
    configuration.concurrency = concurrencyLimit;
  }

  const toJSON = (() => {
    const json = toJSONSchema(configuration);
    return () => ({ ...json, tags: normalizedTags });
  })();

  // Build metadata bag for proxy lookup
  const bag: Record<PropertyKey, unknown> = {
    name,
    description,
    schema: typedSchema,
    parameters: typedSchema,
    outputSchema,
    execute,
    rawExecute: async (params: unknown, context: TContext) => {
      const resolved = await resolveExecute();
      return resolved(params as TParameters, context);
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
    tags: normalizedTags,
    metadata: metadataValue,
  };

  const tool = new Proxy(
    callable as unknown as ArmorerTool<z.ZodType<TInput>, E, TReturn, M>,
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
    const resolvedTimeoutMs = options.timeoutMs ?? timeoutMs;
    const executeOptions =
      options.signal || resolvedTimeoutMs !== undefined
        ? {
            ...(options.signal ? { signal: options.signal } : {}),
            ...(resolvedTimeoutMs !== undefined ? { timeoutMs: resolvedTimeoutMs } : {}),
          }
        : undefined;
    return runWithConcurrency(() => executeInner(toolCall, executeOptions));
  };

  const finalTool = tool as unknown as ArmorerTool<z.ZodType<TInput>, E, TReturn, M>;

  // Register with armorer if provided
  if (armorer) {
    armorer.register(finalTool as unknown as ArmorerTool);
  }

  return finalTool;

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
  TInput extends object,
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
): <TInput extends object, TOutput = unknown>(
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
  TInput extends object,
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

function normalizeDigestOptions(input?: ToolDigestOptions): {
  input: boolean;
  output: boolean;
  algorithm: 'sha256';
} {
  if (!input) {
    return { input: false, output: false, algorithm: 'sha256' };
  }
  if (input === true) {
    return { input: true, output: true, algorithm: 'sha256' };
  }
  return {
    input: input.input !== false,
    output: input.output !== false,
    algorithm: input.algorithm ?? 'sha256',
  };
}

function computeDigest(value: unknown, algorithm: 'sha256'): string {
  const serialized = stableStringify(value);
  return createHash(algorithm).update(serialized).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
    });
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function classifyError(error: unknown): 'failed' | 'transient' {
  const code = typeof (error as any)?.code === 'string' ? (error as any).code : undefined;
  const message =
    typeof (error as any)?.message === 'string'
      ? (error as any).message.toLowerCase()
      : '';
  const transientCodes = new Set([
    'ETIMEDOUT',
    'ECONNRESET',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ENETDOWN',
    'ENETUNREACH',
    'EHOSTUNREACH',
  ]);
  if (code && transientCodes.has(code)) {
    return 'transient';
  }
  if (message.includes('timeout') || message.includes('rate limit')) {
    return 'transient';
  }
  return 'failed';
}

function validateOutput(
  schema: z.ZodTypeAny | undefined,
  value: unknown,
  mode: OutputValidationMode,
): OutputValidationResult | undefined {
  if (!schema) {
    return undefined;
  }
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true };
  }
  if (mode === 'throw') {
    return { success: false, error: result.error };
  }
  return { success: false, error: result.error };
}

function normalizeTagsWithMetadata(
  tags: NormalizeTagsOption<readonly string[]> | undefined,
  metadata: ToolMetadata | undefined,
  toolName: string,
): string[] {
  const baseTags = Array.isArray(tags)
    ? uniqTags(tags.map((tag) => assertKebabCaseTag(tag, `Tool "${toolName}"`)))
    : [];
  const merged = new Set(baseTags);
  if (metadata?.mutates === true) {
    merged.add('mutating');
  }
  if (metadata?.readOnly === true) {
    merged.add('readonly');
  }
  if (metadata?.dangerous === true) {
    merged.add('dangerous');
  }
  return Array.from(merged);
}

function normalizeConcurrency(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const floored = Math.floor(value);
  if (floored <= 0) {
    return undefined;
  }
  return floored;
}

type ConcurrencyLimiter = {
  run: <T>(task: () => Promise<T>) => Promise<T>;
};

function createConcurrencyLimiter(limit?: number): ConcurrencyLimiter | undefined {
  const resolved = normalizeConcurrency(limit);
  if (resolved === undefined) {
    return undefined;
  }
  let active = 0;
  const queue: Array<() => void> = [];
  const run = async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= resolved) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      const next = queue.shift();
      if (next) {
        next();
      }
    }
  };
  return { run };
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
