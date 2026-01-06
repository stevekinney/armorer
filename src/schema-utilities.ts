/**
 * Schema utilities for working with Zod schema internals.
 * These utilities intentionally work with untyped Zod internals (_def, shape, etc.)
 * which requires permissive type handling.
 */
import type { ToolParametersSchema } from './is-tool';

export function getSchemaKeys(schema: ToolParametersSchema): string[] {
  const shape = getSchemaShape(schema);
  return shape ? Object.keys(shape) : [];
}

export function getSchemaShape(
  schema: ToolParametersSchema,
): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  const candidate = unwrapSchema(schema);
  if (!candidate) return undefined;
  try {
    if (typeof candidate.shape === 'function') {
      return candidate.shape();
    }
    if (candidate.shape && typeof candidate.shape === 'object') {
      return candidate.shape;
    }
  } catch {
    return undefined;
  }
  const def = candidate?._def;
  if (def?.shape) {
    try {
      return typeof def.shape === 'function' ? def.shape() : def.shape;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function unwrapSchema(schema: ToolParametersSchema): any {
  let current: any = schema;
  const seen = new Set<any>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current?._def?.shape || current?.shape) {
      return current;
    }
    if (current?._def?.innerType) {
      current = current._def.innerType;
      continue;
    }
    if (current?._def?.schema) {
      current = current._def.schema;
      continue;
    }
    if (current?.def?.out) {
      current = current.def.out;
      continue;
    }
    break;
  }
  return current;
}

export function schemasLooselyMatch(
  target: ToolParametersSchema,
  incoming: ToolParametersSchema,
): boolean {
  const targetShape = getSchemaShape(target);
  const checkShape = getSchemaShape(incoming);
  if (!targetShape || !checkShape) return false;
  const keys = Object.keys(checkShape);
  if (!keys.length) return true;
  return keys.every((key) => key in targetShape);
}

export function isZodSchema(value: unknown): value is ToolParametersSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).safeParse === 'function'
  );
}

export function isZodObjectSchema(value: unknown): value is ToolParametersSchema {
  if (!isZodSchema(value)) return false;
  return getSchemaShape(value) !== undefined;
}
