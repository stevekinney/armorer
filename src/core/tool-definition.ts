import { z } from 'zod';

import {
  formatToolId,
  normalizeIdentity,
  type ToolId,
  type ToolIdentity,
} from './identity';
import { type ToolRisk } from './risk';
import { isZodObjectSchema, isZodSchema } from './schema-utilities';
import type { JsonObject } from './serialization/json';
import { assertKebabCaseTag, type NormalizeTagsOption, uniqTags } from './tag-utilities';

export type ToolDisplay = {
  title?: string;
  description: string;
  examples?: readonly string[];
};

export type ToolLifecycle = {
  deprecated?: boolean;
  message?: string;
  replacedBy?: ToolId;
};

export type ToolDefinition<
  TInput extends object = Record<string, unknown>,
  TOutput = unknown,
> = {
  identity: ToolIdentity;
  id: ToolId;
  display: ToolDisplay;
  name: string;
  description: string;
  tags?: readonly string[] | undefined;
  metadata?: JsonObject | undefined;
  risk?: ToolRisk | undefined;
  lifecycle?: ToolLifecycle | undefined;
  parameters?: z.ZodTypeAny;
  schema: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny | undefined;
  dryRun?: ((params: TInput, context: unknown) => Promise<unknown>) | undefined;
  /** @internal Type marker for inference. */
  __types?: { input: TInput; output: TOutput } | undefined;
};

export type AnyToolDefinition = ToolDefinition<Record<string, unknown>, unknown>;

export type DefineToolOptions<
  TInput extends object = Record<string, unknown>,
  TOutput = unknown,
  Tags extends readonly string[] = readonly string[],
> = {
  name: string;
  description: string;
  namespace?: string;
  version?: string;
  title?: string;
  examples?: readonly string[];
  tags?: NormalizeTagsOption<Tags>;
  metadata?: JsonObject;
  risk?: ToolRisk;
  lifecycle?: ToolLifecycle;
  parameters?: z.ZodType<TInput> | z.ZodRawShape | z.ZodTypeAny;
  /** @deprecated Use `parameters` instead. */
  schema?: z.ZodType<TInput> | z.ZodRawShape | z.ZodTypeAny;
  outputSchema?: z.ZodType<TOutput>;
  dryRun?: (params: TInput, context: unknown) => Promise<unknown>;
};

export function defineTool<
  TInput extends object = Record<string, unknown>,
  TOutput = unknown,
  Tags extends readonly string[] = readonly string[],
>(options: DefineToolOptions<TInput, TOutput, Tags>): ToolDefinition<TInput, TOutput> {
  const {
    name,
    description,
    namespace,
    version,
    title,
    examples,
    tags,
    metadata,
    risk,
    lifecycle,
    parameters,
    schema,
    outputSchema,
    dryRun,
  } = options;

  const normalizedIdentity = normalizeIdentity({
    name,
    ...(namespace !== undefined ? { namespace } : {}),
    ...(version !== undefined ? { version } : {}),
  });
  const normalizedSchema = normalizeSchema(parameters ?? schema);
  const resolvedTags = normalizeTags(tags, name);
  const display: ToolDisplay = {
    title: title ?? name,
    description,
    ...(examples?.length ? { examples: [...examples] } : {}),
  };

  const id = formatToolId(normalizedIdentity);

  return {
    identity: normalizedIdentity,
    id,
    display,
    name: normalizedIdentity.name,
    description,
    ...(resolvedTags.length ? { tags: resolvedTags } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(risk !== undefined ? { risk } : {}),
    ...(lifecycle !== undefined ? { lifecycle } : {}),
    parameters: normalizedSchema as z.ZodType<TInput>,
    schema: normalizedSchema as z.ZodType<TInput>,
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    ...(dryRun ? { dryRun } : {}),
  };
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

function normalizeTags(
  tags: NormalizeTagsOption<readonly string[]> | undefined,
  toolName: string,
): string[] {
  if (!Array.isArray(tags)) return [];
  if (!isStringArray(tags)) {
    throw new Error(`Tool "${toolName}": tag must be a string`);
  }
  return uniqTags(tags.map((tag) => assertKebabCaseTag(tag, `Tool "${toolName}"`)));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
