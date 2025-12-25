import { z } from 'zod';

import type { ToolParametersSchema } from './is-tool';
import type { ToolConfiguration } from './types';

export function toJSONSchema<T extends ToolConfiguration<ToolParametersSchema>>(tool: T) {
  const buildParameters = () => {
    try {
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

      return params;
    } catch {
      const shapeKeys = extractShapeKeys(tool.schema);
      const properties = Object.fromEntries(shapeKeys.map((key) => [key, {}]));
      return {
        type: 'object',
        properties,
        required: shapeKeys,
        additionalProperties: false,
      };
    }
  };

  const params = buildParameters();

  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    strict: true,
    parameters: params,
  };
}

function extractShapeKeys(schema: unknown): string[] {
  const schemaObj = schema as Record<string, unknown> | undefined;
  const def = schemaObj?.['_def'] as
    | { shape?: Record<string, unknown> | (() => Record<string, unknown>) }
    | undefined;

  const shape = typeof def?.shape === 'function' ? def.shape() : def?.shape;
  return shape ? Object.keys(shape) : [];
}
