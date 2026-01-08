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
  scoreTextMatchValueFromIndex,
  type TextQuery,
  type TextQueryField,
  type TextSearchIndex,
  type ToolPredicate,
} from '../query-predicates';
import { getSchemaKeys, schemasLooselyMatch } from '../schema-utilities';
import {
  type Embedder,
  type EmbeddingInfo,
  type EmbeddingVector,
  getQueryEmbeddingInfo,
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
const toolLookupCache = new WeakMap<ArmorerTool, ToolLookupCache>();
const registryInvertedIndex = new WeakMap<object, InvertedIndex>();
const registryTextIndex = new WeakMap<object, TextInvertedIndex>();
const registryEmbeddingIndex = new WeakMap<object, EmbeddingIndex>();
const BIGRAM_SIZE = 2;
const GRAM_SIZE = 3;
const EMBEDDING_SEED = 0x1a2b3c4d;

type ToolLookupCache = {
  tags: string[];
  tagsLower: string[];
  tagSet: Set<string>;
  schemaKeysLower: string[];
  schemaKeySet: Set<string>;
};

type InvertedIndex = {
  tagIndex: Map<string, Set<ArmorerTool>>;
  schemaKeyIndex: Map<string, Set<ArmorerTool>>;
  size: number;
};

type FieldTokenIndex = {
  map: Map<string, Set<ArmorerTool>>;
  tokens: string[];
  lengthMap: Map<number, Set<ArmorerTool>>;
  lengths: number[];
  charMap: Map<string, Set<ArmorerTool>>;
  bigramMap: Map<string, Set<ArmorerTool>>;
  gramMap: Map<string, Set<ArmorerTool>>;
};

type TextInvertedIndex = {
  fields: Record<TextQueryField, FieldTokenIndex>;
  size: number;
};

type EmbeddingBucketIndex = {
  dimension: number;
  hashBits: number;
  bandSize: number;
  bands: number;
  bucketSize: number;
  projections: number[][];
  buckets: Record<TextQueryField, Map<number, Set<ArmorerTool>>>;
};

type EmbeddingIndex = {
  dimensions: Map<number, EmbeddingBucketIndex>;
  missing: Set<ArmorerTool>;
  size: number;
};

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
    resolved.getInvertedIndex,
    resolved.getTextIndex,
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
    resolved.getInvertedIndex,
    resolved.getTextIndex,
    resolved.embedder,
  );
  const ranked = rankTools(
    tools,
    options,
    resolved.getIndex,
    resolved.embedder,
    resolved.getEmbeddingIndex,
  );
  const paged = applyPagination(ranked, options.limit, options.offset);
  const results = selectMatchResults(paged, options);
  emitSearch(resolved.dispatchEvent, options, results);
  return results;
}

export function reindexSearchIndex(input: ToolQueryInput): void {
  const resolved = resolveTools(input);
  const updateEmbeddingIndex =
    resolved.registry && resolved.embedder
      ? (tool: ArmorerTool) => {
          const registry = resolved.registry as ToolRegistryLike;
          const embeddingIndex = registryEmbeddingIndex.get(registry);
          if (!embeddingIndex) {
            return;
          }
          if (!isToolRegistered(registry, tool)) {
            return;
          }
          addToolToEmbeddingIndex(embeddingIndex, tool);
        }
      : undefined;
  for (const tool of resolved.tools) {
    searchIndex.set(tool, buildTextSearchIndex(tool));
    toolLookupCache.set(tool, buildToolLookup(tool));
    if (resolved.embedder) {
      warmToolEmbeddings(tool, resolved.embedder, updateEmbeddingIndex);
    }
  }
  if (resolved.registry) {
    registryInvertedIndex.set(resolved.registry, buildInvertedIndex(resolved.tools));
    registryTextIndex.set(
      resolved.registry,
      buildTextInvertedIndex(resolved.tools, resolved.getIndex),
    );
    if (resolved.embedder) {
      registryEmbeddingIndex.set(resolved.registry, buildEmbeddingIndex(resolved.tools));
    }
  }
}

export function registerToolIndexes(
  registry: object,
  tool: ArmorerTool,
  toolsCount?: number,
): void {
  const textIndex = buildTextSearchIndex(tool);
  searchIndex.set(tool, textIndex);
  toolLookupCache.set(tool, buildToolLookup(tool));

  const inverted = registryInvertedIndex.get(registry);
  if (inverted) {
    addToolToInvertedIndex(inverted, tool);
    if (typeof toolsCount === 'number') {
      inverted.size = toolsCount;
    } else {
      inverted.size += 1;
    }
  }

  const text = registryTextIndex.get(registry);
  if (text) {
    addToolToTextIndex(text, tool, textIndex);
    if (typeof toolsCount === 'number') {
      text.size = toolsCount;
    } else {
      text.size += 1;
    }
  }

  const embeddings = registryEmbeddingIndex.get(registry);
  if (embeddings) {
    addToolToEmbeddingIndex(embeddings, tool);
    if (typeof toolsCount === 'number') {
      embeddings.size = toolsCount;
    } else {
      embeddings.size += 1;
    }
  }
}

export function unregisterToolIndexes(
  registry: object,
  tool: ArmorerTool,
  toolsCount?: number,
): void {
  const cachedText = searchIndex.get(tool) ?? buildTextSearchIndex(tool);

  const inverted = registryInvertedIndex.get(registry);
  if (inverted) {
    removeToolFromInvertedIndex(inverted, tool);
    if (typeof toolsCount === 'number') {
      inverted.size = toolsCount;
    } else {
      inverted.size = Math.max(0, inverted.size - 1);
    }
  }

  const text = registryTextIndex.get(registry);
  if (text) {
    removeToolFromTextIndex(text, tool, cachedText);
    if (typeof toolsCount === 'number') {
      text.size = toolsCount;
    } else {
      text.size = Math.max(0, text.size - 1);
    }
  }

  const embeddings = registryEmbeddingIndex.get(registry);
  if (embeddings) {
    removeToolFromEmbeddingIndex(embeddings, tool);
    if (typeof toolsCount === 'number') {
      embeddings.size = toolsCount;
    } else {
      embeddings.size = Math.max(0, embeddings.size - 1);
    }
  }
}

function resolveTools(input: ToolQueryInput): {
  tools: ArmorerTool[];
  dispatchEvent?: ToolRegistryLike['dispatchEvent'];
  getIndex: (tool: ArmorerTool) => TextSearchIndex;
  getInvertedIndex?: () => InvertedIndex;
  getTextIndex: () => TextInvertedIndex;
  getEmbeddingIndex?: () => EmbeddingIndex;
  embedder?: Embedder;
  registry?: object;
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
    const tools = input.tools();
    const registry = input as object;
    const result = {
      tools,
      registry,
      dispatchEvent: input.dispatchEvent?.bind(input),
      getIndex,
      getInvertedIndex: () => getRegistryInvertedIndex(registry, tools),
      getTextIndex: () => getRegistryTextIndex(registry, tools, getIndex),
      getEmbeddingIndex: () => getRegistryEmbeddingIndex(registry, tools),
    };
    if (embedder) {
      return { ...result, embedder };
    }
    return result;
  }

  if (isTool(input)) {
    const tools = [input];
    return {
      tools,
      getIndex,
      getInvertedIndex: () => buildInvertedIndex(tools),
      getTextIndex: () => buildTextInvertedIndex(tools, getIndex),
    };
  }

  if (Array.isArray(input)) {
    const tools = input;
    return {
      tools,
      getIndex,
      getInvertedIndex: () => buildInvertedIndex(tools),
      getTextIndex: () => buildTextInvertedIndex(tools, getIndex),
    };
  }

  if (isIterable(input)) {
    const tools = Array.from(input);
    return {
      tools,
      getIndex,
      getInvertedIndex: () => buildInvertedIndex(tools),
      getTextIndex: () => buildTextInvertedIndex(tools, getIndex),
    };
  }

  throw new TypeError('queryTools expects a ToolQuery input');
}

function buildToolLookup(tool: ArmorerTool): ToolLookupCache {
  const tags = (tool.tags ?? [])
    .filter((tag): tag is string => Boolean(tag))
    .map((tag) => String(tag));
  const tagsLower = tags.map((tag) => tag.toLowerCase());
  const schemaKeysLower = getSchemaKeys(tool.schema).map((key) => key.toLowerCase());
  return {
    tags,
    tagsLower,
    tagSet: new Set(tagsLower),
    schemaKeysLower,
    schemaKeySet: new Set(schemaKeysLower),
  };
}

function getToolLookup(tool: ArmorerTool): ToolLookupCache {
  const cached = toolLookupCache.get(tool);
  if (cached) {
    return cached;
  }
  const lookup = buildToolLookup(tool);
  toolLookupCache.set(tool, lookup);
  return lookup;
}

function buildInvertedIndex(tools: ArmorerTool[]): InvertedIndex {
  const tagIndex = new Map<string, Set<ArmorerTool>>();
  const schemaKeyIndex = new Map<string, Set<ArmorerTool>>();
  for (const tool of tools) {
    const lookup = getToolLookup(tool);
    for (const tag of lookup.tagSet) {
      let bucket = tagIndex.get(tag);
      if (!bucket) {
        bucket = new Set();
        tagIndex.set(tag, bucket);
      }
      bucket.add(tool);
    }
    for (const key of lookup.schemaKeySet) {
      let bucket = schemaKeyIndex.get(key);
      if (!bucket) {
        bucket = new Set();
        schemaKeyIndex.set(key, bucket);
      }
      bucket.add(tool);
    }
  }
  return {
    tagIndex,
    schemaKeyIndex,
    size: tools.length,
  };
}

function buildTextInvertedIndex(
  tools: ArmorerTool[],
  getIndex: (tool: ArmorerTool) => TextSearchIndex,
): TextInvertedIndex {
  const fields: Record<TextQueryField, FieldTokenIndex> = {
    name: createFieldTokenIndex(),
    description: createFieldTokenIndex(),
    tags: createFieldTokenIndex(),
    schemaKeys: createFieldTokenIndex(),
    metadataKeys: createFieldTokenIndex(),
  };

  for (const tool of tools) {
    const index = getIndex(tool);
    addFieldTokens(fields.name, [index.name, ...(index.nameTokens ?? [])], tool);
    addFieldTokens(
      fields.description,
      [index.description, ...(index.descriptionTokens ?? [])],
      tool,
    );
    addFieldTokens(
      fields.tags,
      index.tags.map((token) => token.normalized),
      tool,
    );
    addFieldTokens(
      fields.schemaKeys,
      index.schemaKeys.map((token) => token.normalized),
      tool,
    );
    addFieldTokens(
      fields.metadataKeys,
      index.metadataKeys.map((token) => token.normalized),
      tool,
    );
  }

  return {
    fields,
    size: tools.length,
  };
}

function createFieldTokenIndex(): FieldTokenIndex {
  return {
    map: new Map(),
    tokens: [],
    lengthMap: new Map(),
    lengths: [],
    charMap: new Map(),
    bigramMap: new Map(),
    gramMap: new Map(),
  };
}

function getTokenCharacters(token: string): string[] {
  if (!token) {
    return [];
  }
  const chars = new Set<string>();
  for (const char of token) {
    chars.add(char);
  }
  return Array.from(chars);
}

function isAsciiAlphaNumeric(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function getTokenGrams(token: string, size = GRAM_SIZE): string[] {
  if (!token || token.length < size) {
    return [];
  }
  const grams = new Set<string>();
  for (let i = 0; i <= token.length - size; i += 1) {
    const gram = token.slice(i, i + size);
    let valid = true;
    for (const char of gram) {
      if (!isAsciiAlphaNumeric(char)) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      continue;
    }
    grams.add(gram);
  }
  return Array.from(grams);
}

function addFieldTokens(
  fieldIndex: FieldTokenIndex,
  tokens: readonly string[],
  tool: ArmorerTool,
): void {
  for (const token of tokens) {
    if (!token) continue;
    let bucket = fieldIndex.map.get(token);
    if (!bucket) {
      bucket = new Set();
      fieldIndex.map.set(token, bucket);
      fieldIndex.tokens.push(token);
    }
    bucket.add(tool);

    const length = token.length;
    let lengthBucket = fieldIndex.lengthMap.get(length);
    if (!lengthBucket) {
      lengthBucket = new Set();
      fieldIndex.lengthMap.set(length, lengthBucket);
      fieldIndex.lengths.push(length);
    }
    lengthBucket.add(tool);

    for (const char of getTokenCharacters(token)) {
      let charBucket = fieldIndex.charMap.get(char);
      if (!charBucket) {
        charBucket = new Set();
        fieldIndex.charMap.set(char, charBucket);
      }
      charBucket.add(tool);
    }

    for (const gram of getTokenGrams(token, BIGRAM_SIZE)) {
      let gramBucket = fieldIndex.bigramMap.get(gram);
      if (!gramBucket) {
        gramBucket = new Set();
        fieldIndex.bigramMap.set(gram, gramBucket);
      }
      gramBucket.add(tool);
    }

    for (const gram of getTokenGrams(token)) {
      let gramBucket = fieldIndex.gramMap.get(gram);
      if (!gramBucket) {
        gramBucket = new Set();
        fieldIndex.gramMap.set(gram, gramBucket);
      }
      gramBucket.add(tool);
    }
  }
}

function addToolToInvertedIndex(index: InvertedIndex, tool: ArmorerTool): void {
  const lookup = getToolLookup(tool);
  for (const tag of lookup.tagSet) {
    let bucket = index.tagIndex.get(tag);
    if (!bucket) {
      bucket = new Set();
      index.tagIndex.set(tag, bucket);
    }
    bucket.add(tool);
  }
  for (const key of lookup.schemaKeySet) {
    let bucket = index.schemaKeyIndex.get(key);
    if (!bucket) {
      bucket = new Set();
      index.schemaKeyIndex.set(key, bucket);
    }
    bucket.add(tool);
  }
}

function removeToolFromInvertedIndex(index: InvertedIndex, tool: ArmorerTool): void {
  const lookup = getToolLookup(tool);
  for (const tag of lookup.tagSet) {
    const bucket = index.tagIndex.get(tag);
    if (!bucket) continue;
    bucket.delete(tool);
    if (!bucket.size) {
      index.tagIndex.delete(tag);
    }
  }
  for (const key of lookup.schemaKeySet) {
    const bucket = index.schemaKeyIndex.get(key);
    if (!bucket) continue;
    bucket.delete(tool);
    if (!bucket.size) {
      index.schemaKeyIndex.delete(key);
    }
  }
}

function addToolToTextIndex(
  textIndex: TextInvertedIndex,
  tool: ArmorerTool,
  index: TextSearchIndex,
): void {
  addFieldTokens(textIndex.fields.name, [index.name, ...(index.nameTokens ?? [])], tool);
  addFieldTokens(
    textIndex.fields.description,
    [index.description, ...(index.descriptionTokens ?? [])],
    tool,
  );
  addFieldTokens(
    textIndex.fields.tags,
    index.tags.map((token) => token.normalized),
    tool,
  );
  addFieldTokens(
    textIndex.fields.schemaKeys,
    index.schemaKeys.map((token) => token.normalized),
    tool,
  );
  addFieldTokens(
    textIndex.fields.metadataKeys,
    index.metadataKeys.map((token) => token.normalized),
    tool,
  );
}

function removeToolFromTextIndex(
  textIndex: TextInvertedIndex,
  tool: ArmorerTool,
  index: TextSearchIndex,
): void {
  removeFieldTokens(
    textIndex.fields.name,
    [index.name, ...(index.nameTokens ?? [])],
    tool,
  );
  removeFieldTokens(
    textIndex.fields.description,
    [index.description, ...(index.descriptionTokens ?? [])],
    tool,
  );
  removeFieldTokens(
    textIndex.fields.tags,
    index.tags.map((token) => token.normalized),
    tool,
  );
  removeFieldTokens(
    textIndex.fields.schemaKeys,
    index.schemaKeys.map((token) => token.normalized),
    tool,
  );
  removeFieldTokens(
    textIndex.fields.metadataKeys,
    index.metadataKeys.map((token) => token.normalized),
    tool,
  );
}

function removeFieldTokens(
  fieldIndex: FieldTokenIndex,
  tokens: readonly string[],
  tool: ArmorerTool,
): void {
  for (const token of tokens) {
    if (!token) continue;
    const bucket = fieldIndex.map.get(token);
    if (!bucket) continue;
    bucket.delete(tool);
    if (!bucket.size) {
      fieldIndex.map.delete(token);
      const index = fieldIndex.tokens.indexOf(token);
      if (index >= 0) {
        fieldIndex.tokens.splice(index, 1);
      }
    }

    const lengthBucket = fieldIndex.lengthMap.get(token.length);
    if (!lengthBucket) continue;
    lengthBucket.delete(tool);
    if (!lengthBucket.size) {
      fieldIndex.lengthMap.delete(token.length);
      const index = fieldIndex.lengths.indexOf(token.length);
      if (index >= 0) {
        fieldIndex.lengths.splice(index, 1);
      }
    }

    for (const char of getTokenCharacters(token)) {
      const charBucket = fieldIndex.charMap.get(char);
      if (!charBucket) continue;
      charBucket.delete(tool);
      if (!charBucket.size) {
        fieldIndex.charMap.delete(char);
      }
    }

    for (const gram of getTokenGrams(token, BIGRAM_SIZE)) {
      const gramBucket = fieldIndex.bigramMap.get(gram);
      if (!gramBucket) continue;
      gramBucket.delete(tool);
      if (!gramBucket.size) {
        fieldIndex.bigramMap.delete(gram);
      }
    }

    for (const gram of getTokenGrams(token)) {
      const gramBucket = fieldIndex.gramMap.get(gram);
      if (!gramBucket) continue;
      gramBucket.delete(tool);
      if (!gramBucket.size) {
        fieldIndex.gramMap.delete(gram);
      }
    }
  }
}

function buildEmbeddingIndex(tools: ArmorerTool[]): EmbeddingIndex {
  const index: EmbeddingIndex = {
    dimensions: new Map(),
    missing: new Set(),
    size: tools.length,
  };
  for (const tool of tools) {
    addToolToEmbeddingIndex(index, tool);
  }
  return index;
}

function getEmbeddingBucketIndex(
  index: EmbeddingIndex,
  dimension: number,
): EmbeddingBucketIndex {
  let bucketIndex = index.dimensions.get(dimension);
  if (!bucketIndex) {
    bucketIndex = createEmbeddingBucketIndex(dimension);
    index.dimensions.set(dimension, bucketIndex);
  }
  return bucketIndex;
}

function createEmbeddingBucketIndex(dimension: number): EmbeddingBucketIndex {
  const config = getEmbeddingConfig(dimension);
  return {
    dimension,
    hashBits: config.hashBits,
    bandSize: config.bandSize,
    bands: config.bands,
    bucketSize: config.bucketSize,
    projections: createProjectionMatrix(dimension, config.hashBits),
    buckets: {
      name: new Map(),
      description: new Map(),
      tags: new Map(),
      schemaKeys: new Map(),
      metadataKeys: new Map(),
    },
  };
}

function addToolToEmbeddingIndex(index: EmbeddingIndex, tool: ArmorerTool): void {
  const embeddings = getToolEmbeddings(tool);
  if (!embeddings?.length) {
    index.missing.add(tool);
    return;
  }
  index.missing.delete(tool);
  for (const entry of embeddings) {
    const dimension = entry.vector.length;
    if (!dimension) {
      continue;
    }
    const bucketIndex = getEmbeddingBucketIndex(index, dimension);
    const bits = getEmbeddingSignatureBits(bucketIndex.projections, entry.vector);
    if (!bits.length) {
      continue;
    }
    const keys = getEmbeddingBandKeys(bits, bucketIndex.bandSize);
    addEmbeddingBuckets(bucketIndex.buckets[entry.field], keys, tool);
  }
}

function removeToolFromEmbeddingIndex(index: EmbeddingIndex, tool: ArmorerTool): void {
  index.missing.delete(tool);
  const embeddings = getToolEmbeddings(tool);
  if (!embeddings?.length) {
    return;
  }
  for (const entry of embeddings) {
    const bucketIndex = index.dimensions.get(entry.vector.length);
    if (!bucketIndex) {
      continue;
    }
    const bits = getEmbeddingSignatureBits(bucketIndex.projections, entry.vector);
    if (!bits.length) {
      continue;
    }
    const keys = getEmbeddingBandKeys(bits, bucketIndex.bandSize);
    removeEmbeddingBuckets(bucketIndex.buckets[entry.field], keys, tool);
  }
}

function addEmbeddingBuckets(
  buckets: Map<number, Set<ArmorerTool>>,
  keys: number[],
  tool: ArmorerTool,
): void {
  for (const key of keys) {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = new Set();
      buckets.set(key, bucket);
    }
    bucket.add(tool);
  }
}

function removeEmbeddingBuckets(
  buckets: Map<number, Set<ArmorerTool>>,
  keys: number[],
  tool: ArmorerTool,
): void {
  for (const key of keys) {
    const bucket = buckets.get(key);
    if (!bucket) {
      continue;
    }
    bucket.delete(tool);
    if (!bucket.size) {
      buckets.delete(key);
    }
  }
}

function getEmbeddingSignatureBits(
  projections: number[][],
  vector: EmbeddingVector,
): number[] {
  if (!projections.length || vector.length !== projections[0]?.length) {
    return [];
  }
  const bits = new Array<number>(projections.length);
  for (let i = 0; i < projections.length; i += 1) {
    const projection = projections[i];
    if (!projection) {
      return [];
    }
    let dot = 0;
    for (let j = 0; j < vector.length; j += 1) {
      const pv = projection[j];
      const vv = vector[j];
      if (pv === undefined || vv === undefined) {
        return [];
      }
      dot += pv * vv;
    }
    bits[i] = dot >= 0 ? 1 : 0;
  }
  return bits;
}

function getEmbeddingBandKeys(bits: number[], bandSize: number): number[] {
  const bands = Math.ceil(bits.length / bandSize);
  const bucketSize = 1 << bandSize;
  const keys = new Array<number>(bands);
  for (let band = 0; band < bands; band += 1) {
    let bucket = 0;
    const offset = band * bandSize;
    for (let index = 0; index < bandSize; index += 1) {
      const bit = bits[offset + index] ?? 0;
      bucket = (bucket << 1) | (bit ? 1 : 0);
    }
    keys[band] = band * bucketSize + bucket;
  }
  return keys;
}

function createProjectionMatrix(dimension: number, hashBits: number): number[][] {
  if (!dimension) {
    return [];
  }
  const rng = createRng(EMBEDDING_SEED ^ dimension);
  const projections: number[][] = [];
  for (let i = 0; i < hashBits; i += 1) {
    const vector = new Array<number>(dimension);
    for (let j = 0; j < dimension; j += 1) {
      vector[j] = rng() * 2 - 1;
    }
    projections.push(vector);
  }
  return projections;
}

function getEmbeddingConfig(dimension: number): {
  hashBits: number;
  bandSize: number;
  bands: number;
  bucketSize: number;
} {
  let hashBits = 24;
  if (dimension <= 64) {
    hashBits = 16;
  } else if (dimension <= 192) {
    hashBits = 20;
  } else if (dimension > 512) {
    hashBits = 28;
  }
  const bandSize = 4;
  const bands = Math.ceil(hashBits / bandSize);
  const bucketSize = 1 << bandSize;
  return { hashBits, bandSize, bands, bucketSize };
}

function createRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function getRegistryInvertedIndex(registry: object, tools: ArmorerTool[]): InvertedIndex {
  const cached = registryInvertedIndex.get(registry);
  if (cached && cached.size === tools.length) {
    return cached;
  }
  const built = buildInvertedIndex(tools);
  registryInvertedIndex.set(registry, built);
  return built;
}

function getRegistryTextIndex(
  registry: object,
  tools: ArmorerTool[],
  getIndex: (tool: ArmorerTool) => TextSearchIndex,
): TextInvertedIndex {
  const cached = registryTextIndex.get(registry);
  if (cached && cached.size === tools.length) {
    return cached;
  }
  const built = buildTextInvertedIndex(tools, getIndex);
  registryTextIndex.set(registry, built);
  return built;
}

function getRegistryEmbeddingIndex(
  registry: object,
  tools: ArmorerTool[],
): EmbeddingIndex {
  const cached = registryEmbeddingIndex.get(registry);
  if (cached && cached.size === tools.length) {
    return cached;
  }
  const built = buildEmbeddingIndex(tools);
  registryEmbeddingIndex.set(registry, built);
  return built;
}

function filterTools(
  tools: ArmorerTool[],
  criteria: ToolQueryCriteria | undefined,
  getIndex: (tool: ArmorerTool) => TextSearchIndex,
  getInvertedIndex: (() => InvertedIndex) | undefined,
  getTextIndex: () => TextInvertedIndex,
  embedder?: Embedder,
): ArmorerTool[] {
  if (criteria === undefined) {
    return tools;
  }
  if (!isPlainObject(criteria)) {
    throw new TypeError('query expects a ToolQuery object');
  }
  const options = embedder ? { getIndex, embedder } : { getIndex };
  const predicate = compileCriteria(criteria, options);
  const candidates = selectCandidateTools(
    tools,
    criteria,
    getInvertedIndex,
    getTextIndex,
    embedder,
  );
  return candidates.filter(predicate);
}

function selectCandidateTools(
  tools: ArmorerTool[],
  criteria: ToolQueryCriteria,
  getInvertedIndex: (() => InvertedIndex) | undefined,
  getTextIndex: () => TextInvertedIndex,
  embedder?: Embedder,
): ArmorerTool[] {
  const tags = criteria.tags;
  const anyTags = normalizeTags(tags?.any ?? []);
  const allTags = normalizeTags(tags?.all ?? []);
  const schemaKeys = normalizeSchemaKeys(criteria.schema?.keys ?? []);
  const normalizedText = criteria.text ? normalizeTextQuery(criteria.text) : null;
  if (!anyTags.length && !allTags.length && !schemaKeys.length && !normalizedText) {
    return tools;
  }
  const index = getInvertedIndex ? getInvertedIndex() : buildInvertedIndex(tools);
  let candidateSet: Set<ArmorerTool> | null = null;

  const tagCandidates = collectTagCandidates(index.tagIndex, anyTags, allTags);
  if (tagCandidates) {
    candidateSet = tagCandidates;
  }

  const schemaCandidates = collectSchemaCandidates(index.schemaKeyIndex, schemaKeys);
  if (schemaCandidates) {
    candidateSet = candidateSet
      ? intersectSets(candidateSet, schemaCandidates)
      : schemaCandidates;
  }

  if (normalizedText && !embedder) {
    const textCandidates = selectTextCandidates(getTextIndex(), normalizedText);
    if (textCandidates) {
      candidateSet = candidateSet
        ? intersectSets(candidateSet, textCandidates)
        : textCandidates;
    }
  }

  if (!candidateSet) {
    return tools;
  }
  if (!candidateSet.size) {
    return [];
  }
  return tools.filter((tool) => candidateSet.has(tool));
}

function selectTextCandidates(
  textIndex: TextInvertedIndex,
  normalized: NormalizedTextQuery,
): Set<ArmorerTool> | null {
  if (!normalized.tokens.length) {
    return null;
  }
  if (normalized.mode === 'fuzzy') {
    if (normalized.threshold <= 0) {
      return null;
    }
    const candidates = new Set<ArmorerTool>();
    let matchedAny = false;
    for (const field of normalized.fields) {
      const fieldIndex = textIndex.fields[field];
      if (!fieldIndex) continue;
      for (const queryToken of normalized.tokens) {
        if (!queryToken) continue;
        const length = queryToken.length;
        const minLen = Math.ceil(length * normalized.threshold);
        const maxLen = Math.floor(length / normalized.threshold);
        if (!Number.isFinite(minLen) || !Number.isFinite(maxLen)) {
          return null;
        }
        const lengthCandidates = collectLengthCandidates(fieldIndex, minLen, maxLen);
        if (!lengthCandidates?.size) {
          continue;
        }
        const charCandidates = collectCharCandidates(fieldIndex, queryToken);
        if (!charCandidates?.size) {
          continue;
        }
        const tokenCandidates = intersectSets(lengthCandidates, charCandidates);
        if (!tokenCandidates.size) {
          continue;
        }
        matchedAny = true;
        for (const tool of tokenCandidates) {
          candidates.add(tool);
        }
      }
    }
    return matchedAny ? candidates : new Set();
  }

  const candidates = new Set<ArmorerTool>();
  let matchedAny = false;
  for (const field of normalized.fields) {
    const fieldIndex = textIndex.fields[field];
    if (!fieldIndex) continue;
    if (normalized.mode === 'exact') {
      for (const token of normalized.tokens) {
        const bucket = fieldIndex.map.get(token);
        if (!bucket) {
          continue;
        }
        matchedAny = true;
        for (const tool of bucket) {
          candidates.add(tool);
        }
      }
      continue;
    }
    for (const queryToken of normalized.tokens) {
      if (!queryToken) continue;
      let tokenCandidates: Set<ArmorerTool> | null = null;
      if (queryToken.length >= GRAM_SIZE) {
        tokenCandidates = collectGramCandidates(
          fieldIndex.gramMap,
          queryToken,
          GRAM_SIZE,
        );
        if (!tokenCandidates) {
          tokenCandidates = collectCharIntersectionCandidates(fieldIndex, queryToken);
        }
      } else if (queryToken.length === BIGRAM_SIZE) {
        tokenCandidates = collectGramCandidates(
          fieldIndex.bigramMap,
          queryToken,
          BIGRAM_SIZE,
        );
        if (!tokenCandidates) {
          tokenCandidates = collectCharIntersectionCandidates(fieldIndex, queryToken);
        }
      } else {
        tokenCandidates = collectCharIntersectionCandidates(fieldIndex, queryToken);
      }
      if (!tokenCandidates?.size) {
        continue;
      }
      matchedAny = true;
      for (const tool of tokenCandidates) {
        candidates.add(tool);
      }
    }
  }

  return matchedAny ? candidates : new Set();
}

function selectEmbeddingCandidates(
  embeddingIndex: EmbeddingIndex,
  queryEmbedding: EmbeddingInfo,
  query: NormalizedTextQuery,
): Set<ArmorerTool> | null {
  if (!queryEmbedding.vector.length) {
    return null;
  }
  const bucketIndex = embeddingIndex.dimensions.get(queryEmbedding.vector.length);
  if (!bucketIndex) {
    return embeddingIndex.missing.size ? new Set(embeddingIndex.missing) : null;
  }
  const fields = query.fields.filter((field) => (query.weights[field] ?? 1) > 0);
  if (!fields.length) {
    return null;
  }
  const bits = getEmbeddingSignatureBits(bucketIndex.projections, queryEmbedding.vector);
  if (!bits.length) {
    return null;
  }
  const bandKeys = getEmbeddingBandKeys(bits, bucketIndex.bandSize);
  let candidates: Set<ArmorerTool> | null = null;
  let matchedAny = false;
  for (const field of fields) {
    const buckets = bucketIndex.buckets[field];
    if (!buckets) {
      continue;
    }
    for (const key of bandKeys) {
      const bucket = buckets.get(key);
      if (!bucket) {
        continue;
      }
      matchedAny = true;
      if (!candidates) {
        candidates = new Set(bucket);
        continue;
      }
      for (const tool of bucket) {
        candidates.add(tool);
      }
    }
  }
  if (embeddingIndex.missing.size) {
    if (!candidates) {
      candidates = new Set();
    }
    for (const tool of embeddingIndex.missing) {
      candidates.add(tool);
    }
  }
  if (!matchedAny && !embeddingIndex.missing.size) {
    return null;
  }
  return candidates ?? null;
}

function collectGramCandidates(
  index: Map<string, Set<ArmorerTool>>,
  token: string,
  size: number,
): Set<ArmorerTool> | null {
  const grams = getTokenGrams(token, size);
  if (!grams.length) {
    return null;
  }
  return intersectFromIndex(index, grams);
}

function collectLengthCandidates(
  fieldIndex: FieldTokenIndex,
  minLen: number,
  maxLen: number,
): Set<ArmorerTool> | null {
  let result: Set<ArmorerTool> | null = null;
  for (const tokenLength of fieldIndex.lengths) {
    if (tokenLength < minLen || tokenLength > maxLen) {
      continue;
    }
    const bucket = fieldIndex.lengthMap.get(tokenLength);
    if (!bucket) {
      continue;
    }
    if (!result) {
      result = new Set(bucket);
      continue;
    }
    for (const tool of bucket) {
      result.add(tool);
    }
  }
  return result;
}

function collectCharCandidates(
  fieldIndex: FieldTokenIndex,
  token: string,
): Set<ArmorerTool> | null {
  let result: Set<ArmorerTool> | null = null;
  for (const char of getTokenCharacters(token)) {
    const bucket = fieldIndex.charMap.get(char);
    if (!bucket) {
      continue;
    }
    if (!result) {
      result = new Set(bucket);
      continue;
    }
    for (const tool of bucket) {
      result.add(tool);
    }
  }
  return result;
}

function collectCharIntersectionCandidates(
  fieldIndex: FieldTokenIndex,
  token: string,
): Set<ArmorerTool> | null {
  const chars = getTokenCharacters(token);
  if (!chars.length) {
    return null;
  }
  return intersectFromIndex(fieldIndex.charMap, chars);
}

function collectTagCandidates(
  tagIndex: Map<string, Set<ArmorerTool>>,
  anyTags: string[],
  allTags: string[],
): Set<ArmorerTool> | null {
  if (!anyTags.length && !allTags.length) {
    return null;
  }
  let candidateSet: Set<ArmorerTool> | null = null;
  if (allTags.length) {
    candidateSet = intersectFromIndex(tagIndex, allTags);
  }
  if (anyTags.length) {
    const anySet = unionFromIndex(tagIndex, anyTags);
    candidateSet = candidateSet ? intersectSets(candidateSet, anySet) : anySet;
  }
  return candidateSet;
}

function collectSchemaCandidates(
  schemaIndex: Map<string, Set<ArmorerTool>>,
  keys: string[],
): Set<ArmorerTool> | null {
  if (!keys.length) {
    return null;
  }
  return intersectFromIndex(schemaIndex, keys);
}

function unionFromIndex(
  index: Map<string, Set<ArmorerTool>>,
  keys: string[],
): Set<ArmorerTool> {
  const result = new Set<ArmorerTool>();
  for (const key of keys) {
    const bucket = index.get(key);
    if (!bucket) {
      continue;
    }
    for (const tool of bucket) {
      result.add(tool);
    }
  }
  return result;
}

function intersectFromIndex(
  index: Map<string, Set<ArmorerTool>>,
  keys: string[],
): Set<ArmorerTool> {
  const first = keys[0];
  if (!first) {
    return new Set();
  }
  const initial = index.get(first);
  if (!initial) {
    return new Set();
  }
  let result = new Set<ArmorerTool>(initial);
  for (let i = 1; i < keys.length; i += 1) {
    const key = keys[i];
    if (!key) {
      continue;
    }
    const bucket = index.get(key);
    if (!bucket) {
      return new Set();
    }
    result = intersectSets(result, bucket);
    if (!result.size) {
      return result;
    }
  }
  return result;
}

function intersectSets<T>(left: Set<T>, right: Set<T>): Set<T> {
  const result = new Set<T>();
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const item of small) {
    if (large.has(item)) {
      result.add(item);
    }
  }
  return result;
}

function compileCriteria(
  criteria: ToolQueryCriteria,
  options?: { getIndex?: (tool: ArmorerTool) => TextSearchIndex; embedder?: Embedder },
): ToolPredicate<ArmorerTool> {
  const predicates = buildPredicates(criteria, options);
  const andPredicates = criteria.and?.length
    ? criteria.and.map((entry) => compileCriteria(entry, options))
    : [];
  const orPredicates = criteria.or?.length
    ? criteria.or.map((entry) => compileCriteria(entry, options))
    : [];
  const notPredicates = criteria.not
    ? (Array.isArray(criteria.not) ? criteria.not : [criteria.not]).map((entry) =>
        compileCriteria(entry, options),
      )
    : [];

  return (tool) => {
    if (predicates.length && !evaluatePredicates(tool, predicates)) {
      return false;
    }

    if (andPredicates.length && !andPredicates.every((entry) => entry(tool))) {
      return false;
    }

    if (orPredicates.length && !orPredicates.some((entry) => entry(tool))) {
      return false;
    }

    if (notPredicates.length && notPredicates.some((entry) => entry(tool))) {
      return false;
    }

    return true;
  };
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
  const queryEmbedding =
    embedder && normalized.raw
      ? getQueryEmbeddingInfo(embedder, normalized.raw)
      : undefined;

  return (tool) => {
    const textScore = scoreTextMatchFromIndex(getIndex(tool), normalized);
    if (textScore.score > 0) {
      return true;
    }
    if (!queryEmbedding) {
      return false;
    }
    const embeddingScore = scoreEmbeddingMatch(
      tool,
      normalized,
      queryEmbedding,
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
  getEmbeddingIndex?: () => EmbeddingIndex,
): ToolMatch[] {
  const rank = options.rank;
  const preferredTags = normalizeTags(rank?.tags ?? []);
  const tagBoosts = normalizeTagBoosts(rank?.tagBoosts);
  const tagWeight = normalizeWeight(rank?.weights?.tags);
  const textWeight = normalizeWeight(rank?.weights?.text);
  const normalizedText = rank?.text !== undefined ? normalizeTextQuery(rank.text) : null;
  const queryEmbedding =
    embedder && normalizedText?.raw
      ? getQueryEmbeddingInfo(embedder, normalizedText.raw)
      : undefined;
  const embeddingCandidates =
    queryEmbedding && normalizedText && getEmbeddingIndex
      ? selectEmbeddingCandidates(getEmbeddingIndex(), queryEmbedding, normalizedText)
      : null;
  const tagSet = buildTagSet(preferredTags, tagBoosts);
  const explain = Boolean(options.explain);
  const ranker = options.ranker;
  const tieBreaker = options.tieBreaker ?? 'name';
  const compare = createMatchComparator(tieBreaker);
  const maxResults = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const topLimit = maxResults !== undefined ? maxResults + offset : undefined;
  const resolveIndex = (tool: ArmorerTool) =>
    getIndex ? getIndex(tool) : buildTextSearchIndex(tool);

  const canOptimize =
    topLimit !== undefined &&
    topLimit > 0 &&
    topLimit < tools.length &&
    !ranker &&
    (tieBreaker === 'name' || tieBreaker === 'none');
  if (canOptimize) {
    const scored = tools.map((tool) => ({
      tool,
      score: scoreToolMatchValue(tool, {
        tagSet,
        tagBoosts,
        tagWeight,
        textWeight,
        normalizedText,
        queryEmbedding,
        embeddingCandidates,
        resolveIndex,
      }),
      reasons: [],
    }));
    const top =
      topLimit !== undefined && scored.length > topLimit
        ? selectTopMatches(scored, topLimit, compare)
        : scored;
    const detailed = top
      .map((match) =>
        buildToolMatch(match.tool, {
          tagSet,
          tagBoosts,
          tagWeight,
          textWeight,
          normalizedText,
          queryEmbedding,
          embeddingCandidates,
          explain,
          ranker,
          preferredTags,
          resolveIndex,
        }),
      )
      .filter((entry): entry is ToolMatch<ArmorerTool> => entry !== null);
    detailed.sort(compare);
    return detailed;
  }

  const ranked = tools
    .map((tool) =>
      buildToolMatch(tool, {
        tagSet,
        tagBoosts,
        tagWeight,
        textWeight,
        normalizedText,
        queryEmbedding,
        embeddingCandidates,
        explain,
        ranker,
        preferredTags,
        resolveIndex,
      }),
    )
    .filter((entry): entry is ToolMatch<ArmorerTool> => entry !== null);

  if (topLimit !== undefined && ranked.length > topLimit) {
    const top = selectTopMatches(ranked, topLimit, compare);
    top.sort(compare);
    return top;
  }
  ranked.sort(compare);

  return ranked;
}

function scoreToolMatchValue(
  tool: ArmorerTool,
  context: {
    tagSet: Set<string>;
    tagBoosts: Record<string, number>;
    tagWeight: number;
    textWeight: number;
    normalizedText: NormalizedTextQuery | null;
    queryEmbedding: EmbeddingInfo | undefined;
    embeddingCandidates: Set<ArmorerTool> | null;
    resolveIndex: (tool: ArmorerTool) => TextSearchIndex;
  },
): number {
  const {
    tagSet,
    tagBoosts,
    tagWeight,
    textWeight,
    normalizedText,
    queryEmbedding,
    embeddingCandidates,
    resolveIndex,
  } = context;
  let score = 0;
  if (tagSet.size) {
    score += scoreTagMatchesValue(tool, tagSet, tagWeight, tagBoosts);
  }
  if (normalizedText && textWeight !== 0) {
    const textScore = scoreTextMatchValueFromIndex(resolveIndex(tool), normalizedText);
    if (textScore) {
      score += textScore * textWeight;
    }
    if (queryEmbedding && (!embeddingCandidates || embeddingCandidates.has(tool))) {
      const embeddingScore = scoreEmbeddingMatch(
        tool,
        normalizedText,
        queryEmbedding,
        'score',
      );
      if (embeddingScore) {
        score += embeddingScore.score * textWeight;
      }
    }
  }
  return score;
}

function buildToolMatch(
  tool: ArmorerTool,
  context: {
    tagSet: Set<string>;
    tagBoosts: Record<string, number>;
    tagWeight: number;
    textWeight: number;
    normalizedText: NormalizedTextQuery | null;
    queryEmbedding: EmbeddingInfo | undefined;
    embeddingCandidates: Set<ArmorerTool> | null;
    explain: boolean;
    ranker: ToolRanker | undefined;
    preferredTags: string[];
    resolveIndex: (tool: ArmorerTool) => TextSearchIndex;
  },
): ToolMatch<ArmorerTool> | null {
  const {
    tagSet,
    tagBoosts,
    tagWeight,
    textWeight,
    normalizedText,
    queryEmbedding,
    embeddingCandidates,
    explain,
    ranker,
    preferredTags,
    resolveIndex,
  } = context;
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
    const tagMatches = collectTagMatches(tool, tagSet);
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
    if (queryEmbedding && (!embeddingCandidates || embeddingCandidates.has(tool))) {
      const embeddingScore = scoreEmbeddingMatch(
        tool,
        normalizedText,
        queryEmbedding,
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

  return matches ? { tool, score, reasons, matches } : { tool, score, reasons };
}

function createMatchComparator(
  tieBreaker: ToolTieBreaker,
): (a: ToolMatch<ArmorerTool>, b: ToolMatch<ArmorerTool>) => number {
  if (tieBreaker === 'none') {
    return (a, b) => (b.score !== a.score ? b.score - a.score : 0);
  }
  if (typeof tieBreaker === 'function') {
    return (a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return tieBreaker(a, b);
    };
  }
  return (a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.tool.name.localeCompare(b.tool.name);
  };
}

function requireHeapItem<T>(heap: T[], index: number): T {
  const item = heap[index];
  if (item === undefined) {
    throw new Error('Heap invariant violated');
  }
  return item;
}

function swapHeap<T>(heap: T[], indexA: number, indexB: number): void {
  const itemA = requireHeapItem(heap, indexA);
  const itemB = requireHeapItem(heap, indexB);
  heap[indexA] = itemB;
  heap[indexB] = itemA;
}

function selectTopMatches(
  matches: ToolMatch<ArmorerTool>[],
  limit: number,
  compare: (a: ToolMatch<ArmorerTool>, b: ToolMatch<ArmorerTool>) => number,
): ToolMatch<ArmorerTool>[] {
  if (limit <= 0) {
    return [];
  }
  if (matches.length <= limit) {
    return matches.slice();
  }
  const heap: ToolMatch<ArmorerTool>[] = [];
  const compareHeap = (a: ToolMatch<ArmorerTool>, b: ToolMatch<ArmorerTool>) =>
    compare(b, a);

  for (const match of matches) {
    if (heap.length < limit) {
      heapPush(heap, match, compareHeap);
      continue;
    }
    if (compare(match, requireHeapItem(heap, 0)) < 0) {
      heapReplace(heap, match, compareHeap);
    }
  }

  return heap;
}

function heapPush<T>(heap: T[], item: T, compare: (a: T, b: T) => number): void {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compare(requireHeapItem(heap, index), requireHeapItem(heap, parent)) >= 0) {
      break;
    }
    swapHeap(heap, index, parent);
    index = parent;
  }
}

function heapReplace<T>(heap: T[], item: T, compare: (a: T, b: T) => number): void {
  heap[0] = item;
  let index = 0;
  const length = heap.length;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= length) {
      break;
    }
    let smallest = left;
    if (
      right < length &&
      compare(requireHeapItem(heap, right), requireHeapItem(heap, left)) < 0
    ) {
      smallest = right;
    }
    if (compare(requireHeapItem(heap, smallest), requireHeapItem(heap, index)) >= 0) {
      break;
    }
    swapHeap(heap, index, smallest);
    index = smallest;
  }
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

function collectTagMatches(tool: ArmorerTool, tagSet: Set<string>): string[] {
  if (!tagSet.size) {
    return [];
  }
  const { tags, tagsLower } = getToolLookup(tool);
  if (!tags.length) {
    return [];
  }
  const matches = new Set<string>();
  for (let index = 0; index < tagsLower.length; index += 1) {
    if (tagSet.has(tagsLower[index] ?? '')) {
      matches.add(tags[index] ?? '');
    }
  }
  return Array.from(matches);
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

function scoreTagMatchesValue(
  tool: ArmorerTool,
  tagSet: Set<string>,
  baseWeight: number,
  tagBoosts: Record<string, number>,
): number {
  if (!tagSet.size) {
    return 0;
  }
  const { tagsLower } = getToolLookup(tool);
  if (!tagsLower.length) {
    return 0;
  }
  const seen = new Set<string>();
  let score = 0;
  for (const tag of tagsLower) {
    if (!tag || !tagSet.has(tag) || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    score += baseWeight + (tagBoosts[tag] ?? 0);
  }
  return score;
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
  queryEmbedding: EmbeddingInfo,
  mode: EmbeddingScoreMode = 'similarity',
): EmbeddingScore | null {
  const embeddings = getToolEmbeddings(tool);
  if (!embeddings?.length) {
    return null;
  }
  if (queryEmbedding.magnitude === 0) {
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
    const similarity = cosineSimilarity(
      queryEmbedding.vector,
      queryEmbedding.magnitude,
      entry.vector,
      entry.magnitude,
    );
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

function cosineSimilarity(
  a: EmbeddingVector,
  aMagnitude: number,
  b: EmbeddingVector,
  bMagnitude: number,
): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  if (aMagnitude === 0 || bMagnitude === 0) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) {
      return 0;
    }
    dot += av * bv;
  }
  return dot / (aMagnitude * bMagnitude);
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

function normalizeSchemaKeys(keys: readonly string[]): string[] {
  return keys
    .map((key) => key.toLowerCase())
    .filter((key): key is string => Boolean(key));
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

function isToolRegistered(registry: ToolRegistryLike, tool: ArmorerTool): boolean {
  const registryWithGet = registry as ToolRegistryLike & {
    getTool?: (name: string) => ArmorerTool | undefined;
  };
  if (typeof registryWithGet.getTool === 'function') {
    return registryWithGet.getTool(tool.name) === tool;
  }
  return registry.tools().includes(tool);
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
    const { schemaKeySet } = getToolLookup(tool);
    if (!schemaKeySet.size) return false;
    return normalized.every((needle) => schemaKeySet.has(needle));
  };
}

function tagsMatchAny(tags: readonly string[]): ToolPredicate<ArmorerTool> {
  const normalized = normalizeTags(tags);
  if (!normalized.length) {
    return () => true;
  }
  const tagSet = new Set(normalized);
  return (tool) => {
    const { tagsLower } = getToolLookup(tool);
    return tagsLower.some((tag) => tagSet.has(tag));
  };
}

function tagsMatchAll(tags: readonly string[]): ToolPredicate<ArmorerTool> {
  const normalized = normalizeTags(tags);
  if (!normalized.length) {
    return () => true;
  }
  return (tool) => {
    const { tagSet } = getToolLookup(tool);
    return normalized.every((tag) => tagSet.has(tag));
  };
}

function tagsMatchNone(tags: readonly string[]): ToolPredicate<ArmorerTool> {
  const normalized = normalizeTags(tags);
  if (!normalized.length) {
    return () => true;
  }
  const forbiddenSet = new Set(normalized);
  return (tool) => {
    const { tagsLower } = getToolLookup(tool);
    return !tagsLower.some((tag) => forbiddenSet.has(tag));
  };
}
