import type { ArmorerTool, ToolParametersSchema } from './is-tool';
import { getSchemaKeys, schemasLooselyMatch } from './schema-utilities';

type AnyTool = ArmorerTool;

export type ToolPredicate<T extends AnyTool = AnyTool> = (tool: T) => boolean;

/**
 * Matches tools that have ANY of the provided tags (OR logic).
 * Returns a match-all predicate if tags array is empty.
 *
 * Tag matching is case-insensitive.
 */
export function tagsMatchAny(tags: readonly string[]): ToolPredicate {
  const normalized = normalizeTags(tags);
  if (!normalized.length) {
    return () => true;
  }
  const tagSet = new Set(normalized);
  return (tool) => {
    const toolTags = tool.tags ?? [];
    return toolTags.some((tag) => tagSet.has(tag.toLowerCase()));
  };
}

/**
 * Matches tools that have ALL of the provided tags (AND logic).
 * Returns a match-all predicate if tags array is empty.
 *
 * Tag matching is case-insensitive.
 */
export function tagsMatchAll(tags: readonly string[]): ToolPredicate {
  const normalized = normalizeTags(tags);
  if (!normalized.length) {
    return () => true;
  }
  return (tool) => {
    const toolTags = tool.tags ?? [];
    const lowerTags = toolTags.map((tag) => tag.toLowerCase());
    return normalized.every((tag) => lowerTags.includes(tag));
  };
}

/**
 * Matches tools that have NONE of the provided tags (exclusion).
 * Returns a match-all predicate if tags array is empty.
 *
 * Tag matching is case-insensitive.
 */
export function tagsMatchNone(tags: readonly string[]): ToolPredicate {
  const normalized = normalizeTags(tags);
  if (!normalized.length) {
    return () => true;
  }
  const forbiddenSet = new Set(normalized);
  return (tool) => {
    const toolTags = tool.tags ?? [];
    return !toolTags.some((tag) => forbiddenSet.has(tag.toLowerCase()));
  };
}

export function schemaMatches(schema: ToolParametersSchema): ToolPredicate {
  return (tool) => schemasLooselyMatch(tool.schema, schema);
}

export function textMatches(query: string): ToolPredicate {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return () => true;
  }
  return (tool) => {
    if (tool.name.toLowerCase().includes(needle)) return true;
    if (tool.description?.toLowerCase().includes(needle)) return true;
    if ((tool.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))) return true;
    return getSchemaKeys(tool.schema).some((key) => key.toLowerCase().includes(needle));
  };
}

export function schemaHasKeys(keys: readonly string[]): ToolPredicate {
  const normalized = keys
    .map((key) => key.toLowerCase())
    .filter((key): key is string => Boolean(key));
  if (!normalized.length) {
    return () => true;
  }
  return (tool) => {
    const schemaKeys = getSchemaKeys(tool.schema).map((key) => key.toLowerCase());
    if (!schemaKeys.length) return false;
    return normalized.every((needle) => schemaKeys.includes(needle));
  };
}

function normalizeTags(tags: readonly string[]): string[] {
  return tags.filter(Boolean).map((tag) => String(tag).toLowerCase());
}
