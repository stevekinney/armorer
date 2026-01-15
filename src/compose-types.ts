import type { z } from 'zod';

import type {
  ArmorerTool,
  DefaultToolEvents,
  ToolEventsMap,
  ToolMetadata,
  ToolParametersSchema,
} from './is-tool';

/** Extract input type from a tool's schema */
export type InferToolInput<T> =
  T extends ArmorerTool<infer S, infer _E, infer _R, infer _M>
    ? Extract<z.infer<S>, object>
    : never;

/** Extract output type from a tool */
export type InferToolOutput<T> =
  T extends ArmorerTool<infer _S, infer _E, infer R, infer _M> ? R : never;

/** Any tool (for constraint purposes) */
export type AnyTool = ArmorerTool<
  ToolParametersSchema,
  ToolEventsMap,
  unknown,
  ToolMetadata | undefined
>;

/** Tool that accepts a specific input type */
export type ToolWithInput<I extends object> = ArmorerTool<
  z.ZodType<I>,
  ToolEventsMap,
  unknown,
  ToolMetadata | undefined
>;

/** Step event detail for composed tools */
export interface StepStartDetail {
  stepIndex: number;
  stepName: string;
  input: unknown;
}

export interface StepCompleteDetail {
  stepIndex: number;
  stepName: string;
  output: unknown;
}

export interface StepErrorDetail {
  stepIndex: number;
  stepName: string;
  error: unknown;
}

/** Events emitted by composed tools (extends default events with index signature) */
export type ComposedToolEvents = DefaultToolEvents & {
  'step-start': StepStartDetail;
  'step-complete': StepCompleteDetail;
  'step-error': StepErrorDetail;
  [key: string]: unknown;
};

/** Composed tool result type - uses DefaultToolEvents by default */
export type ComposedTool<TInput extends object, TOutput> = ArmorerTool<
  z.ZodType<TInput>,
  DefaultToolEvents,
  TOutput,
  undefined
>;
