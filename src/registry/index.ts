import type { EmissionEvent } from 'event-emission';

import type {
  ArmorerTool,
  ToolConfig,
  ToolMetadata,
  ToolParametersSchema,
} from '../is-tool';
import { isTool } from '../is-tool';
import {
  buildTextSearchIndex,
  type NormalizedTextQuery,
  normalizeTextQuery,
  scoreTextMatchFromIndex,
  type TextQuery,
  type TextQueryField,
  type TextSearchIndex,
  type ToolPredicate,
} from '../query-predicates';
import { getSchemaKeys, schemasLooselyMatch } from '../schema-utilities';
import {
  type Embedder,
  type EmbeddingVector,
  getQueryEmbedding,
  getRegistryEmbedder,
  getToolEmbeddings,
  warmToolEmbeddings,
} from './embeddings';

/**
 * Tag filtering for tool queries.
 */
export type TagFilter = {
  /** Match any of these tags (OR). */
  any?: readonly string[];
  /** Require all of these tags (AND). */
  all?: readonly string[];
  /** Exclude tools with any of these tags. */
  none?: readonly string[];
};

export type SchemaFilter = {
  /** Require schema to contain these keys. */
  keys?: readonly string[];
  /** Loosely match a schema shape. */
  matches?: ToolParametersSchema;
};

export type MetadataPrimitive = string | number | boolean | null;

export type MetadataRange = {
  min?: number;
  max?: number;
};

export type MetadataFilter = {
  /** Require metadata to include these keys. */
  has?: readonly string[];
  /** Require metadata values to equal these fields. */
  eq?: Record<string, unknown>;
  /** Require metadata values to contain these substrings or values. */
  contains?: Record<string, MetadataPrimitive | readonly MetadataPrimitive[]>;
  /** Require metadata values to start with these strings. */
  startsWith?: Record<string, string>;
  /** Require metadata numeric values to fall within ranges. */
  range?: Record<string, MetadataRange>;
  /** Custom metadata predicate. */
  predicate?: (metadata: ToolMetadata | undefined) => boolean;
};

export type ToolQuerySelect = 'tool' | 'name' | 'config' | 'summary';

export type ToolSummary = {
  name: string;
  description: string;
  tags?: readonly string[];
  schemaKeys?: readonly string[];
  metadata?: ToolMetadata;
  schema?: ToolParametersSchema;
  configuration?: ToolConfig;
};

/**
 * Criteria for querying tools.
 *
 * All criteria are combined with AND logic.
 */
export type ToolQueryCriteria = {
  /** Tag-based filtering. */
  tags?: TagFilter;
  /** Fuzzy text search across name, description, tags, schema keys, and metadata keys. */
  text?: TextQuery;
  /** Schema filtering by keys or shape. */
  schema?: SchemaFilter;
  /** Metadata filtering. */
  metadata?: MetadataFilter;
  /** Custom predicate over the full tool. */
  predicate?: ToolPredicate<ArmorerTool>;
  /** Require all nested criteria to match. */
  and?: ToolQueryCriteria[];
  /** Require at least one nested criterion to match. */
  or?: ToolQueryCriteria[];
  /** Exclude tools that match the nested criteria. */
  not?: ToolQueryCriteria | ToolQueryCriteria[];
};

export type ToolQueryOptions = {
  /** Limit the number of results returned. */
  limit?: number;
  /** Skip a number of results before applying limit. */
  offset?: number;
  /** Select a lighter result shape. */
  select?: ToolQuerySelect;
  /** Include the tool configuration on summary results. */
  includeToolConfig?: boolean;
  /** Include the tool schema on summary results. */
  includeSchema?: boolean;
};

export type ToolQuery = ToolQueryCriteria & ToolQueryOptions;

export type QueryResult = ArmorerTool[];

export type QuerySelectionResult =
  | ArmorerTool[]
  | string[]
  | ToolConfig[]
  | ToolSummary[];

export type ToolSearchRank = {
  /** Prefer tools with these tags. */
  tags?: readonly string[];
  /** Boost scores for specific tags. */
  tagBoosts?: Record<string, number>;
  /** Prefer tools that match this text. */
  text?: TextQuery;
  /** Optional ranking weights. */
  weights?: {
    tags?: number;
    text?: number;
  };
};

export type ToolMatchDetails = {
  fields?: TextQueryField[];
  tags?: string[];
  schemaKeys?: string[];
  metadataKeys?: string[];
  embedding?: EmbeddingMatch;
};

export type EmbeddingMatch = {
  field: TextQueryField;
  score: number;
};

export type ToolRankResult = {
  score: number;
  reasons?: string[];
  matches?: ToolMatchDetails;
  override?: boolean;
  exclude?: boolean;
};

export type ToolRankContext = {
  text?: NormalizedTextQuery | null;
  preferredTags: string[];
  tagBoosts: Record<string, number>;
  weights: {
    tags: number;
    text: number;
  };
  index: TextSearchIndex;
};

export type ToolRanker = (
  tool: ArmorerTool,
  context: ToolRankContext,
) => ToolRankResult | number | null | undefined;

export type ToolTieBreaker =
  | 'name'
  | 'none'
  | ((a: ToolMatch<ArmorerTool>, b: ToolMatch<ArmorerTool>) => number);

export type ToolSearchOptions = {
  /** Filter tools before ranking. */
  filter?: ToolQueryCriteria;
  /** Ranking preferences. */
  rank?: ToolSearchRank;
  /** Custom ranker for domain-specific scoring. */
  ranker?: ToolRanker;
  /** Deterministic tie-breaking for equal scores. */
  tieBreaker?: ToolTieBreaker;
  /** Limit the number of results returned. */
  limit?: number;
  /** Skip a number of results before applying limit. */
  offset?: number;
  /** Select a lighter result shape. */
  select?: ToolQuerySelect;
  /** Include the tool configuration on summary results. */
  includeToolConfig?: boolean;
  /** Include the tool schema on summary results. */
  includeSchema?: boolean;
  /** Include match details in results. */
  explain?: boolean;
};

export type ToolMatch<T = ArmorerTool> = {
  tool: T;
  score: number;
  reasons: string[];
  matches?: ToolMatchDetails;
};

export type ToolRegistryLike = {
  tools: () => ArmorerTool[];
  dispatchEvent?: (event: EmissionEvent<unknown>) => boolean;
};

export type ToolQueryInput =
  | ArmorerTool
  | ToolRegistryLike
  | Iterable<ArmorerTool>
  | ArmorerTool[];

export type { Embedder, EmbeddingVector };

export type QueryEvent = { criteria?: ToolQuery; results: QuerySelectionResult };
export type SearchEvent = { options: ToolSearchOptions; results: ToolMatch<unknown>[] };

const searchIndex = new WeakMap<ArmorerTool, TextSearchIndex>();

export function queryTools(input: ToolQueryInput): QueryResult;
export function queryTools(
  input: ToolQueryInput,
  criteria?: ToolQuery & { select?: 'tool' },
): QueryResult;
export function queryTools(
  input: ToolQueryInput,
  criteria: ToolQuery & { select: 'name' },
): string[];
export function queryTools(
  input: ToolQueryInput,
  criteria: ToolQuery & { select: 'config' },
): ToolConfig[];
export function queryTools(
  input: ToolQueryInput,
  criteria: ToolQuery & { select: 'summary' },
): ToolSummary[];
export function queryTools(
  input: ToolQueryInput,
  criteria?: ToolQuery,
): QuerySelectionResult {
  const resolved = resolveTools(input);
  const tools = filterTools(
    resolved.tools,
    criteria,
    resolved.getIndex,
    resolved.embedder,
  );
  const paged = applyPagination(tools, criteria?.limit, criteria?.offset);
  const results = selectQueryResults(paged, criteria);
  emitQuery(resolved.dispatchEvent, criteria, results);
  return results;
}

export function searchTools(input: ToolQueryInput): ToolMatch[];
export function searchTools(
  input: ToolQueryInput,
  options?: ToolSearchOptions & { select?: 'tool' },
): ToolMatch[];
export function searchTools(
  input: ToolQueryInput,
  options: ToolSearchOptions & { select: 'name' },
): ToolMatch<string>[];
export function searchTools(
  input: ToolQueryInput,
  options: ToolSearchOptions & { select: 'config' },
): ToolMatch<ToolConfig>[];
export function searchTools(
  input: ToolQueryInput,
  options: ToolSearchOptions & { select: 'summary' },
): ToolMatch<ToolSummary>[];
export function searchTools(
  input: ToolQueryInput,
  options: ToolSearchOptions = {},
): ToolMatch<unknown>[] {
  if (!isPlainObject(options)) {
    throw new TypeError('search expects a ToolSearchOptions object');
  }
  const resolved = resolveTools(input);
  const tools = filterTools(
    resolved.tools,
    options.filter,
    resolved.getIndex,
    resolved.embedder,
  );
  const ranked = rankTools(tools, options, resolved.getIndex, resolved.embedder);
  const paged = applyPagination(ranked, options.limit, options.offset);
  const results = selectMatchResults(paged, options);
  emitSearch(resolved.dispatchEvent, options, results);
  return results;
}

export function reindexSearchIndex(input: ToolQueryInput): void {
  const resolved = resolveTools(input);
  for (const tool of resolved.tools) {
    searchIndex.set(tool, buildTextSearchIndex(tool));
    if (resolved.embedder) {
      warmToolEmbeddings(tool, resolved.embedder);
    }
  }
}

function resolveTools(input: ToolQueryInput): {
  tools: ArmorerTool[];
  dispatchEvent?: ToolRegistryLike['dispatchEvent'];
  getIndex: (tool: ArmorerTool) => TextSearchIndex;
  embedder?: Embedder;
} {
  const getIndex = (tool: ArmorerTool) => {
    const cached = searchIndex.get(tool);
    if (cached) return cached;
    const index = buildTextSearchIndex(tool);
    searchIndex.set(tool, index);
    return index;
  };

  if (isToolRegistry(input)) {
    const embedder = getRegistryEmbedder(input as object);
    const result = {
      tools: input.tools(),
      dispatchEvent: input.dispatchEvent?.bind(input),
      getIndex,
    };
    if (embedder) {
      return { ...result, embedder };
    }
    return result;
  }

  if (isTool(input)) {
    return { tools: [input], getIndex };
  }

  if (Array.isArray(input)) {
    return { tools: input, getIndex };
  }

  if (isIterable(input)) {
    return { tools: Array.from(input), getIndex };
  }

  throw new TypeError('queryTools expects a ToolQuery input');
}

function filterTools(
  tools: ArmorerTool[],
  criteria: ToolQueryCriteria | undefined,
  getIndex: (tool: ArmorerTool) => TextSearchIndex,
  embedder?: Embedder,
): ArmorerTool[] {
  if (criteria === undefined) {
    return tools;
  }
  if (!isPlainObject(criteria)) {
    throw new TypeError('query expects a ToolQuery object');
  }
  const options = embedder ? { getIndex, embedder } : { getIndex };
  return tools.filter((tool) => matchesQuery(tool, criteria, options));
}

function matchesQuery(
  tool: ArmorerTool,
  criteria: ToolQueryCriteria,
  options?: { getIndex?: (tool: ArmorerTool) => TextSearchIndex; embedder?: Embedder },
): boolean {
  const predicates = buildPredicates(criteria, options);
  if (predicates.length && !evaluatePredicates(tool, predicates)) {
    return false;
  }

  if (criteria.and?.length) {
    if (!criteria.and.every((entry) => matchesQuery(tool, entry, options))) {
      return false;
    }
  }

  if (criteria.or?.length) {
    if (!criteria.or.some((entry) => matchesQuery(tool, entry, options))) {
      return false;
    }
  }

  if (criteria.not) {
    const exclusions = Array.isArray(criteria.not) ? criteria.not : [criteria.not];
    if (exclusions.some((entry) => matchesQuery(tool, entry, options))) {
      return false;
    }
  }

  return true;
}

function evaluatePredicates(
  tool: ArmorerTool,
  predicates: ToolPredicate<ArmorerTool>[],
): boolean {
  for (const predicate of predicates) {
    try {
      if (!predicate(tool)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function buildPredicates(
  criteria: ToolQueryCriteria,
  options?: { getIndex?: (tool: ArmorerTool) => TextSearchIndex; embedder?: Embedder },
): ToolPredicate<ArmorerTool>[] {
  const predicates: ToolPredicate<ArmorerTool>[] = [];

  if (criteria.tags) {
    const { any, all, none } = criteria.tags;
    if (any?.length) {
      predicates.push(tagsMatchAny(any));
    }
    if (all?.length) {
      predicates.push(tagsMatchAll(all));
    }
    if (none?.length) {
      predicates.push(tagsMatchNone(none));
    }
  }

  if (criteria.text !== undefined) {
    predicates.push(buildTextPredicate(criteria.text, options));
  }

  if (criteria.schema) {
    const { keys, matches } = criteria.schema;
    if (keys?.length) {
      predicates.push(schemaHasKeys(keys));
    }
    if (matches) {
      predicates.push(schemaMatches(matches));
    }
  }

  if (criteria.metadata) {
    const { has, eq, contains, startsWith, range, predicate } = criteria.metadata;
    if (has?.length) {
      predicates.push((tool) => metadataHasKeys(tool.metadata, has));
    }
    if (eq && Object.keys(eq).length) {
      predicates.push((tool) => metadataEquals(tool.metadata, eq));
    }
    if (contains && Object.keys(contains).length) {
      predicates.push((tool) => metadataContains(tool.metadata, contains));
    }
    if (startsWith && Object.keys(startsWith).length) {
      predicates.push((tool) => metadataStartsWith(tool.metadata, startsWith));
    }
    if (range && Object.keys(range).length) {
      predicates.push((tool) => metadataInRange(tool.metadata, range));
    }
    if (predicate) {
      predicates.push((tool) => predicate(tool.metadata));
    }
  }

  if (criteria.predicate) {
    predicates.push(criteria.predicate);
  }

  return predicates;
}

function buildTextPredicate(
  query: TextQuery,
  options?: { getIndex?: (tool: ArmorerTool) => TextSearchIndex; embedder?: Embedder },
): ToolPredicate<ArmorerTool> {
  const normalized = normalizeTextQuery(query);
  if (!normalized) {
    return () => true;
  }
  const getIndex = options?.getIndex ?? buildTextSearchIndex;
  const embedder = options?.embedder;
  const queryVector =
    embedder && normalized.raw ? getQueryEmbedding(embedder, normalized.raw) : undefined;

  return (tool) => {
    const textScore = scoreTextMatchFromIndex(getIndex(tool), normalized);
    if (textScore.score > 0) {
      return true;
    }
    if (!queryVector) {
      return false;
    }
    const embeddingScore = scoreEmbeddingMatch(
      tool,
      normalized,
      queryVector,
      'similarity',
    );
    if (!embeddingScore) {
      return false;
    }
    return embeddingScore.similarity >= normalized.threshold;
  };
}

function applyPagination<T>(items: T[], limit?: number, offset?: number): T[] {
  const start = normalizeOffset(offset);
  const max = normalizeLimit(limit);
  if (max === undefined) {
    return items.slice(start);
  }
  return items.slice(start, start + max);
}

function rankTools(
  tools: QueryResult,
  options: ToolSearchOptions = {},
  getIndex?: (tool: ArmorerTool) => TextSearchIndex,
  embedder?: Embedder,
): ToolMatch[] {
  const rank = options.rank;
  const preferredTags = normalizeTags(rank?.tags ?? []);
  const tagBoosts = normalizeTagBoosts(rank?.tagBoosts);
  const tagWeight = normalizeWeight(rank?.weights?.tags);
  const textWeight = normalizeWeight(rank?.weights?.text);
  const normalizedText = rank?.text !== undefined ? normalizeTextQuery(rank.text) : null;
  const queryVector =
    embedder && normalizedText?.raw
      ? getQueryEmbedding(embedder, normalizedText.raw)
      : undefined;
  const tagSet = buildTagSet(preferredTags, tagBoosts);
  const explain = Boolean(options.explain);
  const ranker = options.ranker;
  const resolveIndex = (tool: ArmorerTool) =>
    getIndex ? getIndex(tool) : buildTextSearchIndex(tool);

  const ranked = tools
    .map((tool) => {
      let cachedIndex: TextSearchIndex | undefined;
      const ensureIndex = () => {
        if (!cachedIndex) {
          cachedIndex = resolveIndex(tool);
        }
        return cachedIndex;
      };
      let score = 0;
      const reasons: string[] = [];
      const matches: ToolMatchDetails | undefined = explain ? {} : undefined;

      if (tagSet.size) {
        const tagMatches = collectTagMatches(tool.tags, tagSet);
        if (tagMatches.length) {
          score += scoreTagMatches(tagMatches, tagWeight, tagBoosts);
          reasons.push(...tagMatches.map((tag) => `tag:${tag}`));
          if (matches) {
            matches.tags = mergeUnique(matches.tags, tagMatches);
          }
        }
      }

      if (normalizedText) {
        const textScore = scoreTextMatchFromIndex(ensureIndex(), normalizedText);
        if (textScore.score) {
          score += textScore.score * textWeight;
          reasons.push(...textScore.reasons.map((reason) => `text:${reason}`));
          if (matches) {
            matches.fields = mergeUnique(matches.fields, textScore.fields);
            matches.tags = mergeUnique(matches.tags, textScore.tagMatches);
            matches.schemaKeys = mergeUnique(matches.schemaKeys, textScore.schemaMatches);
            matches.metadataKeys = mergeUnique(
              matches.metadataKeys,
              textScore.metadataMatches,
            );
          }
        }
        if (queryVector) {
          const embeddingScore = scoreEmbeddingMatch(
            tool,
            normalizedText,
            queryVector,
            'score',
          );
          if (embeddingScore) {
            score += embeddingScore.score * textWeight;
            reasons.push(
              `embedding:${embeddingScore.field}:${embeddingScore.similarity.toFixed(2)}`,
            );
            if (matches) {
              matches.embedding = {
                field: embeddingScore.field,
                score: embeddingScore.similarity,
              };
            }
          }
        }
      }

      if (ranker) {
        const rankResult = ranker(tool, {
          text: normalizedText,
          preferredTags,
          tagBoosts,
          weights: { tags: tagWeight, text: textWeight },
          index: ensureIndex(),
        });
        if (rankResult && typeof rankResult === 'object') {
          if (rankResult.exclude) {
            return null;
          }
          score = rankResult.override ? rankResult.score : score + rankResult.score;
          if (rankResult.reasons?.length) {
            reasons.push(...rankResult.reasons);
          }
          if (matches && rankResult.matches) {
            mergeMatchDetails(matches, rankResult.matches);
          }
        } else if (typeof rankResult === 'number') {
          score += rankResult;
        }
      }

      const entry: ToolMatch<ArmorerTool> = matches
        ? { tool, score, reasons, matches }
        : { tool, score, reasons };
      return entry;
    })
    .filter((entry): entry is ToolMatch<ArmorerTool> => entry !== null);

  const tieBreaker = options.tieBreaker ?? 'name';
  ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (tieBreaker === 'none') {
      return 0;
    }
    if (typeof tieBreaker === 'function') {
      return tieBreaker(a, b);
    }
    return a.tool.name.localeCompare(b.tool.name);
  });

  return ranked;
}

function selectQueryResults(
  tools: ArmorerTool[],
  options?: ToolQueryOptions,
): QuerySelectionResult {
  const selection = options?.select ?? 'tool';
  if (selection === 'name') {
    return tools.map((tool) => tool.name);
  }
  if (selection === 'config') {
    return tools.map((tool) => tool.configuration);
  }
  if (selection === 'summary') {
    return tools.map((tool) => createToolSummary(tool, options));
  }
  return tools;
}

function selectMatchResults(
  matches: ToolMatch<ArmorerTool>[],
  options?: ToolSearchOptions,
): ToolMatch<unknown>[] {
  const selection = options?.select ?? 'tool';
  if (selection === 'tool') {
    return matches;
  }
  return matches.map((match) => {
    const tool = match.tool;
    if (selection === 'name') {
      return { ...match, tool: tool.name } as ToolMatch<string>;
    }
    if (selection === 'config') {
      return { ...match, tool: tool.configuration } as ToolMatch<ToolConfig>;
    }
    return {
      ...match,
      tool: createToolSummary(tool, options),
    } as ToolMatch<ToolSummary>;
  });
}

function collectTagMatches(
  toolTags: readonly string[] | undefined,
  tagSet: Set<string>,
): string[] {
  if (!toolTags?.length || !tagSet.size) {
    return [];
  }
  const matches = toolTags.filter((tag) => tagSet.has(tag.toLowerCase()));
  return Array.from(new Set(matches));
}

function buildTagSet(
  preferredTags: readonly string[],
  tagBoosts: Record<string, number>,
): Set<string> {
  const set = new Set(preferredTags);
  for (const tag of Object.keys(tagBoosts)) {
    set.add(tag);
  }
  return set;
}

function normalizeTagBoosts(
  boosts: Record<string, number> | undefined,
): Record<string, number> {
  if (!boosts) return {};
  const normalized: Record<string, number> = {};
  for (const [tag, weight] of Object.entries(boosts)) {
    if (!Number.isFinite(weight)) continue;
    const key = String(tag).toLowerCase();
    normalized[key] = weight;
  }
  return normalized;
}

function scoreTagMatches(
  matches: string[],
  baseWeight: number,
  tagBoosts: Record<string, number>,
): number {
  return matches.reduce((total, tag) => {
    const boost = tagBoosts[tag.toLowerCase()] ?? 0;
    return total + baseWeight + boost;
  }, 0);
}

type EmbeddingScore = {
  score: number;
  similarity: number;
  field: TextQueryField;
};

type EmbeddingScoreMode = 'similarity' | 'score';

function scoreEmbeddingMatch(
  tool: ArmorerTool,
  query: NormalizedTextQuery,
  queryVector: EmbeddingVector,
  mode: EmbeddingScoreMode = 'similarity',
): EmbeddingScore | null {
  const embeddings = getToolEmbeddings(tool);
  if (!embeddings?.length) {
    return null;
  }
  const fieldOrder = new Map<TextQueryField, number>();
  query.fields.forEach((field, index) => {
    fieldOrder.set(field, index);
  });

  let bestSimilarity = 0;
  let bestScore = 0;
  let bestField: TextQueryField | null = null;
  let bestOrder = Number.POSITIVE_INFINITY;
  for (const entry of embeddings) {
    const order = fieldOrder.get(entry.field);
    if (order === undefined) {
      continue;
    }
    const weight = query.weights[entry.field] ?? 1;
    if (weight <= 0) {
      continue;
    }
    const similarity = cosineSimilarity(queryVector, entry.vector);
    if (similarity <= 0) {
      continue;
    }
    const score = similarity * weight;
    if (mode === 'similarity') {
      if (
        similarity > bestSimilarity ||
        (similarity === bestSimilarity && order < bestOrder)
      ) {
        bestSimilarity = similarity;
        bestScore = score;
        bestField = entry.field;
        bestOrder = order;
      }
      continue;
    }
    if (
      score > bestScore ||
      (score === bestScore &&
        (similarity > bestSimilarity ||
          (similarity === bestSimilarity && order < bestOrder)))
    ) {
      bestSimilarity = similarity;
      bestScore = score;
      bestField = entry.field;
      bestOrder = order;
    }
  }
  if (!bestField || bestSimilarity <= 0) {
    return null;
  }
  return {
    field: bestField,
    similarity: bestSimilarity,
    score: bestScore,
  };
}

function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) {
      return 0;
    }
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA === 0 || magB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function mergeUnique<T extends string>(
  existing: T[] | undefined,
  additions: readonly T[],
): T[] {
  if (!additions.length) {
    return existing ? [...existing] : [];
  }
  const merged = new Set<string>(existing ?? []);
  for (const item of additions) {
    merged.add(item);
  }
  return Array.from(merged) as T[];
}

function mergeMatchDetails(target: ToolMatchDetails, source: ToolMatchDetails): void {
  if (source.fields?.length) {
    target.fields = mergeUnique(target.fields, source.fields);
  }
  if (source.tags?.length) {
    target.tags = mergeUnique(target.tags, source.tags);
  }
  if (source.schemaKeys?.length) {
    target.schemaKeys = mergeUnique(target.schemaKeys, source.schemaKeys);
  }
  if (source.metadataKeys?.length) {
    target.metadataKeys = mergeUnique(target.metadataKeys, source.metadataKeys);
  }
  if (source.embedding) {
    target.embedding = source.embedding;
  }
}

function normalizeOffset(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function createToolSummary(
  tool: ArmorerTool,
  options?: { includeToolConfig?: boolean; includeSchema?: boolean },
): ToolSummary {
  const summary: ToolSummary = {
    name: tool.name,
    description: tool.description,
  };
  if (tool.tags?.length) {
    summary.tags = tool.tags;
  }
  const schemaKeys = getSchemaKeys(tool.schema);
  if (schemaKeys.length) {
    summary.schemaKeys = schemaKeys;
  }
  if (tool.metadata !== undefined) {
    summary.metadata = tool.metadata;
  }
  if (options?.includeSchema) {
    summary.schema = tool.schema;
  }
  if (options?.includeToolConfig) {
    summary.configuration = tool.configuration;
  }
  return summary;
}

function metadataHasKeys(metadata: ToolMetadata | undefined, keys: readonly string[]) {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return keys.every((key) => key in metadata);
}

function metadataEquals(
  metadata: ToolMetadata | undefined,
  expected: Record<string, unknown>,
): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  const entries = Object.entries(expected);
  return entries.every(([key, value]) => metadata[key] === value);
}

function metadataContains(
  metadata: ToolMetadata | undefined,
  expected: Record<string, MetadataPrimitive | readonly MetadataPrimitive[]>,
): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Object.entries(expected).every(([key, needle]) => {
    const value = metadata[key];
    if (typeof value === 'string' && typeof needle === 'string') {
      return value.includes(needle);
    }
    if (Array.isArray(value)) {
      const targets = Array.isArray(needle) ? needle : [needle];
      return targets.every((item) => value.includes(item));
    }
    return false;
  });
}

function metadataStartsWith(
  metadata: ToolMetadata | undefined,
  expected: Record<string, string>,
): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Object.entries(expected).every(([key, prefix]) => {
    const value = metadata[key];
    return typeof value === 'string' ? value.startsWith(prefix) : false;
  });
}

function metadataInRange(
  metadata: ToolMetadata | undefined,
  ranges: Record<string, MetadataRange>,
): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Object.entries(ranges).every(([key, range]) => {
    const value = metadata[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return false;
    }
    if (typeof range.min === 'number' && value < range.min) {
      return false;
    }
    if (typeof range.max === 'number' && value > range.max) {
      return false;
    }
    return true;
  });
}

function normalizeTags(tags: readonly string[]): string[] {
  return tags.filter(Boolean).map((tag) => String(tag).toLowerCase());
}

function normalizeWeight(value: number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIterable(value: unknown): value is Iterable<ArmorerTool> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.iterator in (value as Record<string, unknown>)
  );
}

function isToolRegistry(value: unknown): value is ToolRegistryLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tools' in value &&
    typeof (value as ToolRegistryLike).tools === 'function'
  );
}

function emitQuery(
  dispatchEvent: ToolRegistryLike['dispatchEvent'] | undefined,
  criteria: ToolQuery | undefined,
  results: QuerySelectionResult,
): void {
  if (!dispatchEvent) return;
  dispatchEvent({
    type: 'query',
    detail: { criteria, results },
  } as EmissionEvent<QueryEvent>);
}

function emitSearch(
  dispatchEvent: ToolRegistryLike['dispatchEvent'] | undefined,
  options: ToolSearchOptions,
  results: ToolMatch<unknown>[],
): void {
  if (!dispatchEvent) return;
  dispatchEvent({
    type: 'search',
    detail: { options, results },
  } as EmissionEvent<SearchEvent>);
}

function schemaMatches(schema: ToolParametersSchema): ToolPredicate<ArmorerTool> {
  return (tool) => schemasLooselyMatch(tool.schema, schema);
}

function schemaHasKeys(keys: readonly string[]): ToolPredicate<ArmorerTool> {
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

function tagsMatchAny(tags: readonly string[]): ToolPredicate<ArmorerTool> {
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

function tagsMatchAll(tags: readonly string[]): ToolPredicate<ArmorerTool> {
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

function tagsMatchNone(tags: readonly string[]): ToolPredicate<ArmorerTool> {
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
