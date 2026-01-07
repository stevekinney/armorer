import type { ArmorerTool } from '../is-tool';
import type { TextQueryField } from '../query-predicates';
import { getSchemaKeys } from '../schema-utilities';

export type EmbeddingVector = number[];
export type Embedder = (
  texts: string[],
) => EmbeddingVector[] | Promise<EmbeddingVector[]>;

export type EmbeddingEntry = {
  field: TextQueryField;
  text: string;
  vector: EmbeddingVector;
};

type EmbeddingInput = {
  field: TextQueryField;
  text: string;
};

const registryEmbedders = new WeakMap<object, Embedder>();
const toolEmbeddings = new WeakMap<
  ArmorerTool,
  EmbeddingEntry[] | Promise<EmbeddingEntry[]>
>();
const queryEmbeddings = new WeakMap<
  Embedder,
  Map<string, EmbeddingVector | Promise<EmbeddingVector>>
>();

export function registerRegistryEmbedder(registry: object, embedder: Embedder): void {
  registryEmbedders.set(registry, embedder);
  if (!queryEmbeddings.has(embedder)) {
    queryEmbeddings.set(embedder, new Map());
  }
}

export function getRegistryEmbedder(registry: object): Embedder | undefined {
  return registryEmbedders.get(registry);
}

export function warmToolEmbeddings(tool: ArmorerTool, embedder: Embedder): void {
  const inputs = buildEmbeddingInputs(tool);
  if (!inputs.length) {
    toolEmbeddings.set(tool, []);
    return;
  }
  const texts = inputs.map((input) => input.text);
  const result = embedder(texts);
  if (isPromise(result)) {
    const pending = Promise.resolve(result)
      .then((vectors) => normalizeEmbeddingEntries(inputs, vectors))
      .then((entries) => {
        toolEmbeddings.set(tool, entries);
        return entries;
      })
      .catch(() => {
        toolEmbeddings.delete(tool);
        return [] as EmbeddingEntry[];
      });
    toolEmbeddings.set(tool, pending);
    return;
  }
  toolEmbeddings.set(tool, normalizeEmbeddingEntries(inputs, result));
}

export function getToolEmbeddings(tool: ArmorerTool): EmbeddingEntry[] | undefined {
  const cached = toolEmbeddings.get(tool);
  if (Array.isArray(cached)) {
    return cached;
  }
  return undefined;
}

export function getQueryEmbedding(
  embedder: Embedder,
  query: string,
): EmbeddingVector | undefined {
  const key = query.trim();
  if (!key) return undefined;
  const cache =
    queryEmbeddings.get(embedder) ??
    new Map<string, EmbeddingVector | Promise<EmbeddingVector>>();
  if (!queryEmbeddings.has(embedder)) {
    queryEmbeddings.set(embedder, cache);
  }
  const cached = cache.get(key);
  if (Array.isArray(cached)) {
    return cached;
  }
  if (cached) {
    return undefined;
  }
  const result = embedder([key]);
  if (isPromise(result)) {
    const emptyVector: EmbeddingVector = [];
    const pending = Promise.resolve(result)
      .then((vectors) => normalizeQueryEmbedding(vectors))
      .then((vector) => {
        if (vector) {
          cache.set(key, vector);
        } else {
          cache.delete(key);
        }
        return vector ?? emptyVector;
      })
      .catch(() => {
        cache.delete(key);
        return emptyVector;
      });
    cache.set(key, pending);
    return undefined;
  }
  const vector = normalizeQueryEmbedding(result);
  if (vector) {
    cache.set(key, vector);
  }
  return vector ?? undefined;
}

function buildEmbeddingInputs(tool: ArmorerTool): EmbeddingInput[] {
  const inputs: EmbeddingInput[] = [];
  const name = tool.name?.trim();
  if (name) {
    inputs.push({ field: 'name', text: name });
  }
  const description = tool.description?.trim();
  if (description) {
    inputs.push({ field: 'description', text: description });
  }
  if (tool.tags?.length) {
    const tagsText = tool.tags.filter(Boolean).join(' ').trim();
    if (tagsText) {
      inputs.push({ field: 'tags', text: tagsText });
    }
  }
  const schemaKeys = getSchemaKeys(tool.schema);
  if (schemaKeys.length) {
    inputs.push({ field: 'schemaKeys', text: schemaKeys.join(' ') });
  }
  const metadataKeys = Object.keys(tool.metadata ?? {});
  if (metadataKeys.length) {
    inputs.push({ field: 'metadataKeys', text: metadataKeys.join(' ') });
  }
  return inputs;
}

function normalizeEmbeddingEntries(
  inputs: EmbeddingInput[],
  vectors: EmbeddingVector[],
): EmbeddingEntry[] {
  if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
    return [];
  }
  const entries: EmbeddingEntry[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const vector = vectors[index];
    if (!input || !isVector(vector)) {
      return [];
    }
    entries.push({ field: input.field, text: input.text, vector });
  }
  return entries;
}

function normalizeQueryEmbedding(
  vectors: EmbeddingVector[],
): EmbeddingVector | undefined {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    return undefined;
  }
  const vector = vectors[0];
  if (!isVector(vector)) return undefined;
  return vector;
}

function isVector(value: unknown): value is EmbeddingVector {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

function isPromise<T>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as PromiseLike<T>).then === 'function'
  );
}
