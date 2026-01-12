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

export type ToolParametersSchema = z.ZodType<Record<string, unknown>>;
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
  parameters?: ToolParametersSchema;
  execute:
    | ((params: unknown, context?: unknown) => Promise<unknown>)
    | Promise<(params: unknown, context?: unknown) => Promise<unknown>>;
  tags?: readonly string[];
  metadata?: ToolMetadata;
  diagnostics?: ToolDiagnostics;
}

export type ToolEventsMap = Record<string, unknown>;

export type ToolValidationWarning = {
  path: Array<string | number>;
  code: string;
  from: unknown;
  to: unknown;
  via: string;
};

export type ToolValidationReport = {
  warnings: ToolValidationWarning[];
  cost: number;
};

export type ToolRepairHint = {
  path: string;
  message: string;
  suggestion: string;
};

export type ToolDiagnosticsAdapter = {
  safeParseWithReport: (
    schema: unknown,
    value: unknown,
  ) =>
    | { success: true; data: unknown; report: ToolValidationReport }
    | { success: false; error: unknown; report: ToolValidationReport };
  createRepairHints: (
    error: unknown,
    options?: { rootLabel?: string },
  ) => ToolRepairHint[];
};

export type ToolDiagnostics = Partial<ToolDiagnosticsAdapter>;

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
  configuration: ToolConfig;
};

export type ToolMetadata = Record<string, unknown>;

export type DefaultToolEvents = {
  'status-update': { status: string };
  'execute-start': { params: unknown } & ToolEventDetailContext;
  'validate-success': { params: unknown; parsed: unknown } & ToolEventDetailContext;
  'validate-error': {
    params: unknown;
    error: unknown;
    report?: ToolValidationReport;
    repairHints?: ToolRepairHint[];
  } & ToolEventDetailContext;
  'execute-success': { result: unknown } & ToolEventDetailContext;
  'execute-error': { error: unknown } & ToolEventDetailContext;
  settled: { result?: unknown; error?: unknown } & ToolEventDetailContext;
  progress: { percent?: number; message?: string };
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
  configuration: ToolConfig;
  signal?: MinimalAbortSignal;
  timeoutMs?: number;
}

export interface ToolExecuteOptions {
  signal?: MinimalAbortSignal;
  timeoutMs?: number;
}

/**
 * Options for tool execution with parsed parameters.
 */
export type ToolExecuteWithOptions = ToolExecuteOptions & {
  params: unknown;
  callId?: string;
  timeoutMs?: number;
};

export function isTool(obj: unknown): obj is ArmorerTool {
  return (
    typeof obj === 'function' &&
    'name' in obj &&
    'description' in obj &&
    'schema' in obj &&
    'execute' in obj &&
    'configuration' in obj
  );
}

/**
 * A tool that can be registered with Armorer and executed.
 *
 * Use with type parameters for compile-time safety on a specific tool:
 * ```ts
 * const myTool: ArmorerTool<typeof mySchema> = createTool({...});
 * ```
 *
 * Use without type parameters for collections:
 * ```ts
 * const tools: ArmorerTool[] = [tool1, tool2, tool3];
 * ```
 */
export type ArmorerTool<
  T extends ToolParametersSchema = ToolParametersSchema,
  E extends ToolEventsMap = DefaultToolEvents,
  R = unknown,
  M extends ToolMetadata | undefined = ToolMetadata | undefined,
> = {
  name: string;
  description: string;
  schema: T;
  parameters: T;
  configuration: ToolConfig;
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
  execute: {
    (call: ToolCallWithArguments, options?: ToolExecuteOptions): Promise<ToolResult>;
    (params: unknown, options?: ToolExecuteOptions): Promise<R>;
  };
  executeWith: (options: ToolExecuteWithOptions) => Promise<ToolResult>;
  rawExecute: (params: unknown, context: ToolContext<E>) => Promise<R>;
};
