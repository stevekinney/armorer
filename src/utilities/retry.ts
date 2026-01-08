import { z } from 'zod';

import type {
  AnyTool,
  ComposedTool,
  InferToolInput,
  InferToolOutput,
} from '../compose-types';
import { createTool } from '../create-tool';
import type { DefaultToolEvents, ToolContext } from '../is-tool';

type RetryBackoff = 'fixed' | 'exponential';

type RetryHookDetail = {
  attempt: number;
  error: unknown;
  context: ToolContext<DefaultToolEvents>;
};

type RetryOptions = {
  attempts?: number;
  delayMs?: number;
  backoff?: RetryBackoff;
  maxDelayMs?: number;
  shouldRetry?: (detail: RetryHookDetail) => boolean | Promise<boolean>;
  onRetry?: (detail: RetryHookDetail) => void | Promise<void>;
};

export function retry<TTool extends AnyTool>(
  tool: TTool,
  options: RetryOptions = {},
): ComposedTool<InferToolInput<TTool>, InferToolOutput<TTool>> {
  const attempts = options.attempts ?? 3;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError('retry() expects attempts to be a positive integer');
  }

  const delayMs = options.delayMs ?? 0;
  if (delayMs < 0) {
    throw new RangeError('retry() expects delayMs to be at least 0');
  }

  const maxDelayMs = options.maxDelayMs;
  if (maxDelayMs !== undefined && maxDelayMs < 0) {
    throw new RangeError('retry() expects maxDelayMs to be at least 0');
  }

  const backoff = options.backoff ?? 'fixed';
  const { shouldRetry, onRetry } = options;
  const name = `retry(${tool.name})`;
  const description = `Retry tool: ${tool.description}`;
  const tags = tool.tags && tool.tags.length ? tool.tags : undefined;

  const toolOptions: Parameters<typeof createTool>[0] = {
    name,
    description,
    schema: tool.schema as z.ZodType<InferToolInput<TTool>>,
    async execute(params, context) {
      const input = params as InferToolInput<TTool>;
      let attempt = 0;
      let lastError: unknown;
      let rethrowOriginal = false;

      while (attempt < attempts) {
        attempt += 1;
        try {
          return await tool(input);
        } catch (error) {
          lastError = error;
          if (attempt >= attempts) break;

          if (shouldRetry) {
            const allowed = await shouldRetry({ attempt, error, context });
            if (!allowed) {
              rethrowOriginal = true;
              break;
            }
          }

          if (onRetry) {
            await onRetry({ attempt, error, context });
          }

          const waitMs = resolveRetryDelay(attempt, delayMs, backoff, maxDelayMs);
          if (waitMs > 0) {
            await wait(waitMs);
          }
        }
      }

      if (rethrowOriginal) {
        throw lastError;
      }
      throw toError(lastError ?? new Error('retry() failed without an error'));
    },
  };
  if (tags) {
    toolOptions.tags = tags;
  }
  if (tool.metadata !== undefined) {
    toolOptions.metadata = tool.metadata;
  }
  return createTool(toolOptions) as ComposedTool<
    InferToolInput<TTool>,
    InferToolOutput<TTool>
  >;
}

function resolveRetryDelay(
  attempt: number,
  delayMs: number,
  backoff: RetryBackoff,
  maxDelayMs?: number,
): number {
  if (delayMs <= 0) return 0;
  const multiplier = backoff === 'exponential' ? Math.pow(2, attempt - 1) : 1;
  const calculated = delayMs * multiplier;
  if (maxDelayMs === undefined) return calculated;
  return Math.min(calculated, maxDelayMs);
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
