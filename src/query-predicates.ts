import type { QuartermasterTool, ToolParametersSchema } from './is-tool';
import { getSchemaKeys, schemasLooselyMatch } from './schema-utilities';

type AnyTool = QuartermasterTool;

export type ToolPredicate<T extends AnyTool = AnyTool> = (
  tool: T,
) => boolean | Promise<boolean>;

/**
 * Matches tools that have ANY of the provided tags (OR logic).
 * Returns a match-all predicate if tags array is empty.
 *
 * Tag matching is case-insensitive.
 */
export function byTag(tags: readonly string[]): ToolPredicate {
  const normalized = tags.filter(Boolean).map((tag) => String(tag).toLowerCase());
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
 * Excludes tools that have ANY of the provided forbidden tags.
 * Tools with forbidden tags are completely excluded from results.
 * Returns a match-all predicate if forbiddenTags array is empty.
 *
 * Tag matching is case-insensitive.
 */
export function byForbiddenTags(forbiddenTags: readonly string[]): ToolPredicate {
  const normalized = forbiddenTags
    .filter(Boolean)
    .map((tag) => String(tag).toLowerCase());
  if (!normalized.length) {
    return () => true;
  }
  const forbiddenSet = new Set(normalized);
  return (tool) => {
    const toolTags = tool.tags ?? [];
    // Return true if tool has NO forbidden tags (i.e., should be included)
    return !toolTags.some((tag) => forbiddenSet.has(tag.toLowerCase()));
  };
}

/**
 * Checks if a tool matches any of the provided intent tags.
 * Used for soft matching/prioritization rather than hard filtering.
 *
 * Tag matching is case-insensitive.
 *
 * @returns true if tool has at least one matching intent tag, or if intentTags is empty
 */
export function matchesIntentTags(
  tool: AnyTool,
  intentTags: readonly string[] | undefined,
): boolean {
  if (!intentTags?.length) {
    return true;
  }
  const intentSet = new Set(intentTags.map((tag) => tag.toLowerCase()));
  const toolTags = tool.tags ?? [];
  return toolTags.some((tag) => intentSet.has(tag.toLowerCase()));
}

/**
 * Scores a tool based on intent tag matches for ranking purposes.
 * Higher scores indicate better matches.
 *
 * Scoring logic:
 * - Base score of 0 for all tools
 * - +1 for each intent tag that matches a tool tag
 *
 * Note: Duplicate tags in the tool do not inflate the score. The score
 * represents the number of distinct intent tags that match.
 *
 * @returns numeric score (0 or higher)
 */
export function scoreIntentMatch(
  tool: AnyTool,
  intentTags: readonly string[] | undefined,
): number {
  if (!intentTags?.length) {
    return 0;
  }
  const toolTags = tool.tags ?? [];
  const toolTagSet = new Set(toolTags.map((tag) => tag.toLowerCase()));
  const intentTagSet = new Set(intentTags.map((tag) => tag.toLowerCase()));
  let score = 0;
  for (const intentTag of intentTagSet) {
    if (toolTagSet.has(intentTag)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Ranks tools by intent tag match score.
 * Tools with higher intent scores appear first.
 *
 * This is a lightweight ranking helper for agent-bureau integration.
 *
 * @param tools - Array of tools to rank
 * @param intentTags - Tags to match against for ranking
 * @returns Tools sorted by intent match score (descending)
 */
export function rankByIntent<T extends AnyTool>(
  tools: readonly T[],
  intentTags: readonly string[] | undefined,
): T[] {
  if (!intentTags?.length) {
    return [...tools];
  }

  const scored = tools.map((tool) => ({
    tool,
    score: scoreIntentMatch(tool, intentTags),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ tool }) => tool);
}

export function bySchema(schema: ToolParametersSchema): ToolPredicate {
  return (tool) => schemasLooselyMatch(tool.schema, schema);
}

export function fuzzyText(query: string): ToolPredicate {
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

export function schemaContainsKeys(keys: readonly string[]): ToolPredicate {
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
