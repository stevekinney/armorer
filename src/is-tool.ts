import type {
  AddEventListenerOptionsLike,
  AsyncIteratorOptions,
  EmissionEvent,
  MinimalAbortSignal,
  ObservableLike,
  Observer,
  Subscription,
} from 'event-emission';
import { z } from 'zod';

import type { ToolCall, ToolResult } from './types';

export type ToolParametersSchema = z.ZodSchema;
export type {
  AddEventListenerOptionsLike,
  AsyncIteratorOptions,
  MinimalAbortSignal,
  ObservableLike,
  Observer,
  Subscription,
} from 'event-emission';

/**
 * Unified tool configuration type.
 *
 * Uses `unknown` for execute params and context to prevent type explosion
 * from z.infer<T> while remaining compatible with all tool signatures.
 * Runtime schema validation provides actual type safety.
 */
export interface ToolConfig {
  name: string;
  description: string;
  schema: ToolParametersSchema;
  execute: (params: unknown, context?: unknown) => Promise<unknown>;
  tags?: readonly string[];
  metadata?: ToolMetadata;
}

export type ToolEventsMap = Record<string, unknown>;

/**
 * Tool call with parsed arguments.
 * Uses unknown to prevent type explosion from z.infer<T> in generic positions.
 * Runtime schema validation provides actual type safety.
 */
export type ToolCallWithArguments = ToolCall & {
  arguments: unknown;
};

export type ToolEventDetailContext = {
  toolCall: ToolCall;
  toolConfiguration: ToolConfig;
};

export type ToolMetadata = Record<string, unknown>;

export type DefaultToolEvents = {
  'status-update': { status: string };
  'execute-start': { params: unknown } & ToolEventDetailContext;
  'validate-success': { params: unknown; parsed: unknown } & ToolEventDetailContext;
  'validate-error': { params: unknown; error: unknown } & ToolEventDetailContext;
  'execute-success': { result: unknown } & ToolEventDetailContext;
  'execute-error': { error: unknown } & ToolEventDetailContext;
  settled: { result?: unknown; error?: unknown } & ToolEventDetailContext;
  progress: { percent: number; message?: string };
  'output-chunk': { chunk: unknown };
  log: { level: 'debug' | 'info' | 'warn' | 'error'; message: string; data?: unknown };
  cancelled: { reason?: string };
};

export type MergeEvents<Custom extends ToolEventsMap> = DefaultToolEvents & Custom;

export type ToolCustomEvent<Detail> = EmissionEvent<Detail>;

/**
 * Context passed to tool execute functions.
 */
export interface ToolContext<E extends ToolEventsMap = DefaultToolEvents> {
  dispatch: <K extends keyof E & string>(event: ToolCustomEvent<E[K]>) => boolean;
  meta?: { toolName: string; callId?: string };
  toolCall: ToolCallWithArguments;
  toolConfiguration: ToolConfig;
}

export interface ToolExecuteOptions {
  signal?: MinimalAbortSignal;
}

/**
 * Options for tool execution with parsed parameters.
 */
export type ToolExecuteWithOptions = ToolExecuteOptions & {
  params: unknown;
  callId?: string;
  timeoutMs?: number;
};

export function isTool(obj: unknown): obj is QuartermasterTool {
  return (
    typeof obj === 'function' &&
    'name' in obj &&
    'description' in obj &&
    'schema' in obj &&
    'execute' in obj
  );
}

/**
 * A tool that can be registered with Quartermaster and executed.
 *
 * Use with type parameters for compile-time safety on a specific tool:
 * ```ts
 * const myTool: QuartermasterTool<typeof mySchema> = createTool({...});
 * ```
 *
 * Use without type parameters for collections:
 * ```ts
 * const tools: QuartermasterTool[] = [tool1, tool2, tool3];
 * ```
 */
export type QuartermasterTool<
  T extends ToolParametersSchema = ToolParametersSchema,
  E extends ToolEventsMap = DefaultToolEvents,
  R = unknown,
  M extends ToolMetadata | undefined = ToolMetadata | undefined,
> = {
  name: string;
  description: string;
  schema: T;
  toolConfiguration: ToolConfig;
  tags?: readonly string[];
  metadata: M;
  (params: unknown): Promise<R>;

  // Event listener methods
  addEventListener: <K extends keyof E & string>(
    type: K,
    listener: (event: ToolCustomEvent<E[K]>) => void | Promise<void>,
    options?: AddEventListenerOptionsLike,
  ) => () => void;
  dispatchEvent: <K extends keyof E & string>(event: ToolCustomEvent<E[K]>) => boolean;

  // Observable-based event methods (new in event-emission 0.2.0)
  on: <K extends keyof E & string>(
    type: K,
    options?: AddEventListenerOptionsLike | boolean,
  ) => ObservableLike<ToolCustomEvent<E[K]>>;
  once: <K extends keyof E & string>(
    type: K,
    listener: (event: ToolCustomEvent<E[K]>) => void | Promise<void>,
    options?: Omit<AddEventListenerOptionsLike, 'once'>,
  ) => () => void;
  subscribe: <K extends keyof E & string>(
    type: K,
    observerOrNext?:
      | Observer<ToolCustomEvent<E[K]>>
      | ((value: ToolCustomEvent<E[K]>) => void),
    error?: (err: unknown) => void,
    complete?: () => void,
  ) => Subscription;
  toObservable: () => ObservableLike<ToolCustomEvent<E[keyof E]>>;

  // Async iteration (new in event-emission 0.2.0)
  events: <K extends keyof E & string>(
    type: K,
    options?: AsyncIteratorOptions,
  ) => AsyncIterableIterator<ToolCustomEvent<E[K]>>;

  // Lifecycle methods
  complete: () => void;
  readonly completed: boolean;

  // Tool execution methods
  execute: (
    call: ToolCallWithArguments,
    options?: ToolExecuteOptions,
  ) => Promise<ToolResult>;
  executeWith: (options: ToolExecuteWithOptions) => Promise<ToolResult>;
  rawExecute: (params: unknown, context: ToolContext<E>) => Promise<R>;
};
