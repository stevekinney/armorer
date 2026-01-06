import { z } from 'zod';

import type { ToolParametersSchema } from './is-tool';
import type { ToolConfiguration } from './types';

export function toJSONSchema<T extends ToolConfiguration<ToolParametersSchema>>(tool: T) {
  const params = z.toJSONSchema(tool.schema as z.ZodTypeAny, {
    override: (ctx) => {
      ctx.jsonSchema.additionalProperties = false;
      ctx.jsonSchema.required = Object.keys(ctx.jsonSchema.properties ?? []);
      delete (ctx.jsonSchema as Record<string, unknown>)['$schema'];
    },
  }) as Record<string, unknown>;

  if ('$schema' in params) {
    delete params['$schema'];
  }

  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    strict: true,
    parameters: params,
  };
}
