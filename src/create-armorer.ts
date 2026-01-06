import {
  type AddEventListenerOptionsLike,
  type AsyncIteratorOptions,
  createEventTarget,
  type EmissionEvent,
  type MinimalAbortSignal,
  type ObservableLike,
  type Observer,
  type Subscription,
} from 'event-emission';
import { z } from 'zod';

import { createTool as createToolFactory, type CreateToolOptions } from './create-tool';
import {
  type InspectorDetailLevel,
  inspectRegistry,
  type RegistryInspection,
} from './inspect';
import type {
  ArmorerTool,
  DefaultToolEvents,
  ToolConfig,
  ToolEventsMap,
  ToolMetadata,
  ToolParametersSchema,
} from './is-tool';
import { isTool } from './is-tool';
import {
  schemaHasKeys,
  schemaMatches,
  tagsMatchAll,
  tagsMatchAny,
  tagsMatchNone,
  textMatches,
  type ToolPredicate,
} from './query-predicates';
import { getSchemaKeys, isZodObjectSchema, isZodSchema } from './schema-utilities';
import { assertKebabCaseTag, uniqTags } from './tag-utilities';
import type { ToolCall, ToolResult } from './types';

export type ArmorerContext = Record<string, unknown>;

export type ArmorerToolRuntimeContext<Ctx extends ArmorerContext = ArmorerContext> =
  Ctx & {
    dispatchEvent: ArmorerEventDispatcher;
    configuration: ToolConfig;
    toolCall: ToolCall;
  };

export type SerializedArmorer = readonly ToolConfig[];

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

export type MetadataFilter = {
  /** Require metadata to include these keys. */
  has?: readonly string[];
  /** Require metadata values to equal these fields. */
  eq?: Record<string, unknown>;
  /** Custom metadata predicate. */
  predicate?: (metadata: ToolMetadata | undefined) => boolean;
};

/**
 * Criteria for querying tools.
 *
 * All criteria are combined with AND logic.
 */
export type ToolQuery = {
  /** Tag-based filtering. */
  tags?: TagFilter;
  /** Fuzzy text search across name, description, tags, and schema keys. */
  text?: string;
  /** Schema filtering by keys or shape. */
  schema?: SchemaFilter;
  /** Metadata filtering. */
  metadata?: MetadataFilter;
  /** Custom predicate over the full tool. */
  predicate?: ToolPredicate<ArmorerTool>;
};

export type QueryResult = ArmorerTool[];

export type ToolSearchRank = {
  /** Prefer tools with these tags. */
  tags?: readonly string[];
  /** Prefer tools that match this text. */
  text?: string;
  /** Optional ranking weights. */
  weights?: {
    tags?: number;
    text?: number;
  };
};

export type ToolSearchOptions = {
  /** Filter tools before ranking. */
  filter?: ToolQuery;
  /** Ranking preferences. */
  rank?: ToolSearchRank;
  /** Limit the number of results returned. */
  limit?: number;
};

export type ToolMatch = {
  tool: ArmorerTool;
  score: number;
  reasons: string[];
};

export interface ArmorerOptions {
  signal?: MinimalAbortSignal;
  context?: ArmorerContext;
  toolFactory?: (
    configuration: ToolConfig,
    context: ArmorerToolFactoryContext,
  ) => ArmorerTool;
}

export interface ArmorerToolFactoryContext {
  dispatchEvent: ArmorerEventDispatcher;
  baseContext: ArmorerContext;
  buildDefaultTool: (configuration: ToolConfig) => ArmorerTool;
}

/**
 * Status update payload for tool progress reporting.
 */
export interface ToolStatusUpdate {
  callId: string;
  name: string;
  status: string;
  percent?: number;
  eta?: number;
  message?: string;
}

export interface ArmorerEvents {
  registering: ArmorerTool;
  registered: ArmorerTool;
  call: { tool: ArmorerTool; call: ToolCall };
  complete: { tool: ArmorerTool; result: ToolResult };
  error: { tool?: ArmorerTool; result: ToolResult };
  'not-found': ToolCall;
  query: { criteria?: ToolQuery; results: QueryResult };
  search: { options: ToolSearchOptions; results: ToolMatch[] };
  /** Tool status/progress updates for UI display */
  'status:update': ToolStatusUpdate;
}

export type ArmorerEventDispatcher = <K extends keyof ArmorerEvents & string>(
  event: EmissionEvent<ArmorerEvents[K]>,
) => boolean;

export interface Armorer {
  register: (...entries: (ToolConfig | ArmorerTool)[]) => Armorer;
  createTool: <
    TInput extends Record<string, unknown> = Record<string, never>,
    TOutput = unknown,
    E extends ToolEventsMap = DefaultToolEvents,
    Tags extends readonly string[] = readonly string[],
    M extends ToolMetadata | undefined = undefined,
  >(
    options: CreateToolOptions<TInput, TOutput, E, Tags, M>,
  ) => ArmorerTool;
  execute(call: ToolCall & { name: string }): Promise<ToolResult>;
  execute(calls: (ToolCall & { name: string })[]): Promise<ToolResult[]>;
  query: (criteria?: ToolQuery) => QueryResult;
  search: (options?: ToolSearchOptions) => ToolMatch[];
  getTool: (name: string) => ArmorerTool | undefined;
  /**
   * Returns names of tools that are not registered.
   * Useful for fail-soft agent gating.
   */
  getMissingTools: (names: string[]) => string[];
  /**
   * Checks if all specified tools are registered.
   */
  hasAllTools: (names: string[]) => boolean;
  /**
   * Inspects the registry and returns a typed JSON summary of all registered tools.
   * Useful for debugging and logging which tools are available before model calls.
   *
   * @param detailLevel - Level of detail to include:
   *   - `summary`: Names, descriptions, tags, and counts only
   *   - `standard`: Adds schema keys and metadata flags (default)
   *   - `full`: Includes complete schema shape details
   */
  inspect: (detailLevel?: InspectorDetailLevel) => RegistryInspection;
  toJSON: () => SerializedArmorer;
  addEventListener: <K extends keyof ArmorerEvents & string>(
    type: K,
    listener: (event: EmissionEvent<ArmorerEvents[K]>) => void | Promise<void>,
    options?: AddEventListenerOptionsLike,
  ) => () => void;
  dispatchEvent: ArmorerEventDispatcher;

  // Observable-based event methods (event-emission 0.2.0)
  on: <K extends keyof ArmorerEvents & string>(
    type: K,
    options?: AddEventListenerOptionsLike | boolean,
  ) => ObservableLike<EmissionEvent<ArmorerEvents[K]>>;
  once: <K extends keyof ArmorerEvents & string>(
    type: K,
    listener: (event: EmissionEvent<ArmorerEvents[K]>) => void | Promise<void>,
    options?: Omit<AddEventListenerOptionsLike, 'once'>,
  ) => () => void;
  subscribe: <K extends keyof ArmorerEvents & string>(
    type: K,
    observerOrNext?:
      | Observer<EmissionEvent<ArmorerEvents[K]>>
      | ((value: EmissionEvent<ArmorerEvents[K]>) => void),
    error?: (err: unknown) => void,
    complete?: () => void,
  ) => Subscription;
  toObservable: () => ObservableLike<EmissionEvent<ArmorerEvents[keyof ArmorerEvents]>>;

  // Async iteration (event-emission 0.2.0)
  events: <K extends keyof ArmorerEvents & string>(
    type: K,
    options?: AsyncIteratorOptions,
  ) => AsyncIterableIterator<EmissionEvent<ArmorerEvents[K]>>;

  // Lifecycle methods
  complete: () => void;
  readonly completed: boolean;
}

export function createArmorer(
  serialized: SerializedArmorer = [],
  options: ArmorerOptions = {},
): Armorer {
  const registry = new Map<string, ArmorerTool>();
  const storedConfigurations = new Map<string, ToolConfig>();
  const hub = createEventTarget<ArmorerEvents>();
  const {
    addEventListener,
    dispatchEvent,
    clear,
    on,
    once,
    subscribe,
    toObservable,
    events,
    complete,
  } = hub;

  // Helper to emit events with proper typing (event-emission accepts partial events at runtime)
  const emit = <K extends keyof ArmorerEvents & string>(
    type: K,
    detail: ArmorerEvents[K],
  ) => dispatchEvent({ type, detail } as EmissionEvent<ArmorerEvents[K]>);
  const baseContext = options.context ? { ...options.context } : {};
  const buildTool =
    typeof options.toolFactory === 'function'
      ? (configuration: ToolConfig) =>
          options.toolFactory!(configuration, {
            dispatchEvent,
            baseContext,
            buildDefaultTool,
          })
      : buildDefaultTool;

  if (options.signal) {
    const signal = options.signal;
    const onAbort = () => {
      clear();
      signal.removeEventListener('abort', onAbort);
    };
    if (signal.aborted) {
      clear();
    } else {
      signal.addEventListener('abort', onAbort, { once: true } as any);
    }
  }

  function register(...entries: (ToolConfig | ArmorerTool)[]): Armorer {
    for (const entry of entries) {
      const configuration = normalizeRegistration(entry);
      const tool = buildTool(configuration);
      emit('registering', tool);
      storedConfigurations.set(configuration.name, configuration);
      registry.set(tool.name, tool);
      emit('registered', tool);
    }
    return api;
  }

  function createTool<
    TInput extends Record<string, unknown> = Record<string, never>,
    TOutput = unknown,
    E extends ToolEventsMap = DefaultToolEvents,
    Tags extends readonly string[] = readonly string[],
    M extends ToolMetadata | undefined = undefined,
  >(options: CreateToolOptions<TInput, TOutput, E, Tags, M>): ArmorerTool {
    const schema = normalizeToolSchema(options.schema);
    const normalizedTags = Array.isArray(options.tags)
      ? uniqTags(
          (options.tags as readonly string[]).map((tag) =>
            assertKebabCaseTag(tag, `Tool "${options.name}"`),
          ),
        )
      : undefined;
    if (typeof options.execute !== 'function' && !isPromise(options.execute)) {
      throw new TypeError(
        'execute must be a function or a promise that resolves to a function',
      );
    }
    const configuration: ToolConfig = {
      name: options.name,
      description: options.description,
      schema,
      execute: options.execute as ToolConfig['execute'],
    };
    if (normalizedTags) {
      configuration.tags = normalizedTags;
    }
    if (options.metadata !== undefined) {
      configuration.metadata = options.metadata;
    }
    register(configuration);
    const tool = registry.get(configuration.name);
    if (!tool) {
      throw new Error(`Failed to register tool: ${configuration.name}`);
    }
    return tool;
  }

  async function execute(call: ToolCall & { name: string }): Promise<ToolResult>;
  async function execute(calls: (ToolCall & { name: string })[]): Promise<ToolResult[]>;
  async function execute(
    input: (ToolCall & { name: string }) | (ToolCall & { name: string })[],
  ): Promise<ToolResult | ToolResult[]> {
    const calls = Array.isArray(input) ? input : [input];
    const results: ToolResult[] = [];
    for (const call of calls) {
      const tool = registry.get(call.name);
      if (!tool) {
        const notFound: ToolResult = {
          toolCallId: call.id ?? '',
          toolName: call.name,
          result: undefined,
          error: `Tool not found: ${call.name}`,
        };
        results.push(notFound);
        emit('not-found', call);
        continue;
      }

      emit('call', { tool, call });
      try {
        const toolCall = Object.prototype.hasOwnProperty.call(call, 'arguments')
          ? call
          : { ...call, arguments: undefined };
        const result = (await tool.execute(toolCall as any)) as ToolResult;
        results.push(result);
        if (result.error) {
          emit('error', { tool, result });
        } else {
          emit('complete', { tool, result });
        }
      } catch (error) {
        const errResult: ToolResult = {
          toolCallId: call.id ?? '',
          toolName: tool.name,
          result: undefined,
          error: error instanceof Error ? error.message : String(error),
        };
        results.push(errResult);
        emit('error', { tool, result: errResult });
      }
    }
    return Array.isArray(input) ? results : results[0]!;
  }

  function query(criteria?: ToolQuery): QueryResult {
    const tools = Array.from(registry.values());
    if (criteria === undefined) {
      emit('query', { results: tools });
      return tools;
    }
    if (!isPlainObject(criteria)) {
      throw new TypeError('query expects a ToolQuery object');
    }
    const predicates = buildPredicates(criteria);
    const results = predicates.length
      ? tools.filter((tool) => evaluatePredicates(tool, predicates))
      : tools;
    emit('query', { criteria, results });
    return results;
  }

  function search(options: ToolSearchOptions = {}): ToolMatch[] {
    if (!isPlainObject(options)) {
      throw new TypeError('search expects a ToolSearchOptions object');
    }
    const filter = options.filter;
    const tools = filter ? query(filter) : query();
    const ranked = rankTools(tools, options.rank);
    const results = applyLimit(ranked, options.limit);
    emit('search', { options, results });
    return results;
  }

  function getTool(name: string): ArmorerTool | undefined {
    return registry.get(name);
  }

  function getMissingTools(names: string[]): string[] {
    return names.filter((name) => !registry.has(name));
  }

  function hasAllTools(names: string[]): boolean {
    return names.every((name) => registry.has(name));
  }

  function inspect(detailLevel: InspectorDetailLevel = 'standard'): RegistryInspection {
    const tools = Array.from(registry.values());
    return inspectRegistry(tools, detailLevel);
  }

  function toJSON(): SerializedArmorer {
    return Array.from(storedConfigurations.values()).map((configuration) => {
      const result: ToolConfig = {
        name: configuration.name,
        description: configuration.description,
        schema: configuration.schema,
        execute: configuration.execute,
      };
      if (configuration.tags) {
        result.tags = [...configuration.tags];
      }
      if (configuration.metadata) {
        result.metadata = configuration.metadata;
      }
      return result;
    });
  }

  const api: Armorer = {
    register,
    createTool,
    execute,
    query,
    search,
    getTool,
    getMissingTools,
    hasAllTools,
    inspect,
    toJSON,
    addEventListener,
    dispatchEvent,
    // Observable-based event methods (event-emission 0.2.0)
    on,
    once,
    subscribe,
    toObservable,
    // Async iteration (event-emission 0.2.0)
    events,
    // Lifecycle methods
    complete,
    get completed() {
      return hub.completed;
    },
  };

  if (serialized.length) {
    register(...serialized);
  }

  return api;

  function buildDefaultTool(configuration: ToolConfig): ArmorerTool {
    const resolveExecute = createLazyExecuteResolver(configuration.execute);
    const options: Parameters<typeof createToolFactory>[0] = {
      name: configuration.name,
      description: configuration.description,
      schema: configuration.schema,
      async execute(params, toolContext) {
        const executeFn = await resolveExecute();
        return executeFn(params as any, {
          ...baseContext,
          dispatchEvent,
          configuration: toolContext.configuration,
          toolCall: toolContext.toolCall,
        });
      },
    };
    if (configuration.tags) {
      options.tags = configuration.tags;
    }
    if (configuration.metadata) {
      options.metadata = configuration.metadata;
    }
    return createToolFactory(options);
  }

  function normalizeConfiguration(configuration: ToolConfig): ToolConfig {
    if (!configuration || typeof configuration !== 'object') {
      throw new TypeError('register expects ToolConfig objects');
    }
    if (typeof configuration.name !== 'string' || !configuration.name.trim()) {
      throw new TypeError('register expects ToolConfig objects');
    }
    if (typeof configuration.description !== 'string') {
      throw new TypeError('register expects ToolConfig objects');
    }
    if (!configuration.schema) {
      throw new TypeError('register expects ToolConfig objects');
    }
    if (
      typeof configuration.execute !== 'function' &&
      !isPromise(configuration.execute)
    ) {
      throw new TypeError('register expects ToolConfig objects');
    }
    const normalizedSchema = normalizeToolSchema(configuration.schema);
    const result: ToolConfig = {
      name: configuration.name,
      description: configuration.description,
      schema: normalizedSchema,
      execute: configuration.execute,
    };
    if (configuration.tags) {
      result.tags = [...configuration.tags];
    }
    if (configuration.metadata) {
      result.metadata = configuration.metadata;
    }
    return result;
  }

  function normalizeRegistration(entry: ToolConfig | ArmorerTool): ToolConfig {
    if (isTool(entry)) {
      return normalizeConfiguration(entry.configuration);
    }
    return normalizeConfiguration(entry);
  }
}

function normalizeToolSchema(schema: unknown): ToolParametersSchema {
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

function buildPredicates(criteria: ToolQuery): ToolPredicate<ArmorerTool>[] {
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
    predicates.push(textMatches(criteria.text));
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
    const { has, eq, predicate } = criteria.metadata;
    if (has?.length) {
      predicates.push((tool) => metadataHasKeys(tool.metadata, has));
    }
    if (eq && Object.keys(eq).length) {
      predicates.push((tool) => metadataEquals(tool.metadata, eq));
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

function applyLimit(matches: ToolMatch[], limit?: number): ToolMatch[] {
  if (limit === undefined) {
    return matches;
  }
  if (!Number.isFinite(limit)) {
    return matches;
  }
  const capped = Math.max(0, Math.floor(limit));
  return matches.slice(0, capped);
}

function rankTools(tools: QueryResult, rank?: ToolSearchRank): ToolMatch[] {
  const preferredTags = normalizeTags(rank?.tags ?? []);
  const textQuery = rank?.text ?? '';
  const tagWeight = normalizeWeight(rank?.weights?.tags);
  const textWeight = normalizeWeight(rank?.weights?.text);

  const ranked = tools.map((tool) => {
    let score = 0;
    const reasons: string[] = [];

    if (preferredTags.length) {
      const tagMatches = collectTagMatches(tool.tags, preferredTags);
      if (tagMatches.length) {
        score += tagMatches.length * tagWeight;
        reasons.push(...tagMatches.map((tag) => `tag:${tag}`));
      }
    }

    if (rank?.text !== undefined) {
      const { score: textScore, reasons: textReasons } = scoreTextMatch(tool, textQuery);
      if (textScore) {
        score += textScore * textWeight;
        reasons.push(...textReasons.map((reason) => `text:${reason}`));
      }
    }

    return { tool, score, reasons };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.tool.name.localeCompare(b.tool.name);
  });

  return ranked;
}

function collectTagMatches(
  toolTags: readonly string[] | undefined,
  preferredTags: readonly string[],
): string[] {
  if (!toolTags?.length || !preferredTags.length) {
    return [];
  }
  const preferred = new Set(preferredTags.map((tag) => tag.toLowerCase()));
  const matches = toolTags.filter((tag) => preferred.has(tag.toLowerCase()));
  return Array.from(new Set(matches));
}

function scoreTextMatch(
  tool: ArmorerTool,
  query: string,
): { score: number; reasons: string[] } {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return { score: 0, reasons: [] };
  }
  const reasons: string[] = [];
  let score = 0;

  if (tool.name.toLowerCase().includes(needle)) {
    score += 1;
    reasons.push('name');
  }
  if (tool.description?.toLowerCase().includes(needle)) {
    score += 1;
    reasons.push('description');
  }

  const tagMatches = (tool.tags ?? []).filter((tag) =>
    tag.toLowerCase().includes(needle),
  );
  if (tagMatches.length) {
    score += 1;
    reasons.push(`tags(${tagMatches.join(', ')})`);
  }

  const schemaMatches = getSchemaKeys(tool.schema).filter((key) =>
    key.toLowerCase().includes(needle),
  );
  if (schemaMatches.length) {
    score += 1;
    reasons.push(`schema-keys(${schemaMatches.join(', ')})`);
  }

  return { score, reasons };
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

function createLazyExecuteResolver(
  execute: ToolConfig['execute'],
): () => Promise<(params: unknown, context?: unknown) => Promise<unknown>> {
  if (typeof execute === 'function') {
    const fn = execute;
    return () => Promise.resolve(fn);
  }
  let resolved: ((params: unknown, context?: unknown) => Promise<unknown>) | undefined;
  let pending:
    | Promise<(params: unknown, context?: unknown) => Promise<unknown>>
    | undefined;

  return async () => {
    if (resolved) return resolved;
    if (!pending) {
      pending = Promise.resolve(execute)
        .then((value) => {
          if (typeof value !== 'function') {
            throw new TypeError(
              'ToolConfig.execute must be a function or a promise that resolves to a function',
            );
          }
          resolved = value;
          return value;
        })
        .catch((error) => {
          pending = undefined;
          throw error;
        });
    }
    return pending;
  };
}

function isPromise<T>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as any).then === 'function'
  );
}
