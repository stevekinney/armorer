import type { z } from 'zod';

import type {
  DefaultToolEvents,
  QuartermasterTool,
  ToolEventsMap,
  ToolMetadata,
  ToolParametersSchema,
} from './is-tool';

/** Extract input type from a tool's schema */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InferToolInput<T> =
  T extends QuartermasterTool<infer S, any, any, any>
    ? S extends z.ZodType<infer I>
      ? I
      : never
    : never;

/** Extract output type from a tool */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InferToolOutput<T> =
  T extends QuartermasterTool<any, any, infer R, any> ? R : never;

/** Any tool (for constraint purposes) */
export type AnyTool = QuartermasterTool<
  ToolParametersSchema,
  ToolEventsMap,
  unknown,
  ToolMetadata | undefined
>;

/** Tool that accepts a specific input type */
export type ToolWithInput<I> = QuartermasterTool<
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

/** Composed tool result type - uses DefaultToolEvents for compatibility */
export type ComposedTool<TInput, TOutput> = QuartermasterTool<
  z.ZodType<TInput>,
  DefaultToolEvents,
  TOutput,
  undefined
>;
