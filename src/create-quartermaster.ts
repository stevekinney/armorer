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

import { createTool } from './create-tool';
import {
  type InspectorDetailLevel,
  inspectRegistry,
  type RegistryInspection,
} from './inspect';
import type {
  QuartermasterTool,
  ToolConfig,
  ToolMetadata,
  ToolParametersSchema,
} from './is-tool';
import {
  byForbiddenTags,
  bySchema,
  byTag,
  fuzzyText,
  rankByIntent,
  schemaContainsKeys,
  type ToolPredicate,
} from './query-predicates';
import { isZodSchema } from './schema-utilities';
import type { ToolCall, ToolResult } from './types';

export type QuartermasterContext = Record<string, unknown>;

export type QuartermasterToolRuntimeContext<
  Ctx extends QuartermasterContext = QuartermasterContext,
> = Ctx & {
  dispatchEvent: QuartermasterEventDispatcher;
  toolConfiguration: ToolConfig;
  toolCall: ToolCall;
};

export type SerializedQuartermaster = readonly ToolConfig[];

/**
 * Criteria for querying tools.
 *
 * All criteria are combined with AND logic except:
 * - `tag` and `tags` are combined into a single OR match
 * - `intentTags` are used for ranking, not filtering (soft match)
 */
export type QueryDescriptor = {
  /** Single tag to match (combined with tags using OR) */
  tag?: string;
  /** Multiple tags to match (OR match - tool must have at least one) */
  tags?: readonly string[] | string;
  /** Fuzzy text search across name, description, tags, and schema keys */
  text?: string;
  /** Schema must contain this key */
  argument?: string;
  /** Schema to loosely match against */
  schema?: ToolParametersSchema;
  /**
   * Intent tags for soft matching/ranking.
   * Tools matching intent tags are ranked higher in results but not excluded if they don't match.
   * Case-insensitive matching.
   */
  intentTags?: readonly string[];
  /**
   * Forbidden tags for hard exclusion.
   * Tools with ANY forbidden tag are completely excluded from results.
   * Case-insensitive matching.
   */
  forbiddenTags?: readonly string[];
  /**
   * Custom predicate for filtering by tool metadata.
   * Receives the tool's metadata object and returns true to include the tool.
   */
  metadata?: (metadata: ToolMetadata | undefined) => boolean;
};

export type QueryInput =
  | string
  | QueryDescriptor
  | ToolParametersSchema
  | ToolPredicate<QuartermasterTool>;
export type QueryResult = QuartermasterTool[];

export interface QuartermasterOptions {
  signal?: MinimalAbortSignal;
  context?: QuartermasterContext;
  toolFactory?: (
    configuration: ToolConfig,
    context: QuartermasterToolFactoryContext,
  ) => QuartermasterTool;
}

export interface QuartermasterToolFactoryContext {
  dispatchEvent: QuartermasterEventDispatcher;
  baseContext: QuartermasterContext;
  buildDefaultTool: (configuration: ToolConfig) => QuartermasterTool;
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

export interface QuartermasterEvents {
  registering: QuartermasterTool;
  registered: QuartermasterTool;
  call: { tool: QuartermasterTool; call: ToolCall };
  complete: { tool: QuartermasterTool; result: ToolResult };
  error: { tool?: QuartermasterTool; result: ToolResult };
  'not-found': ToolCall;
  query: { criteria?: QueryInput; results: QueryResult };
  /** Tool status/progress updates for UI display */
  'status:update': ToolStatusUpdate;
}

export type QuartermasterEventDispatcher = <K extends keyof QuartermasterEvents & string>(
  event: EmissionEvent<QuartermasterEvents[K]>,
) => boolean;

export interface Quartermaster {
  register: (...configurations: ToolConfig[]) => Quartermaster;
  execute(call: ToolCall & { name: string }): Promise<ToolResult>;
  execute(calls: (ToolCall & { name: string })[]): Promise<ToolResult[]>;
  query: (criteria?: QueryInput) => QueryResult | Promise<QueryResult>;
  getTool: (name: string) => QuartermasterTool | undefined;
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
  toJSON: () => SerializedQuartermaster;
  addEventListener: <K extends keyof QuartermasterEvents & string>(
    type: K,
    listener: (event: EmissionEvent<QuartermasterEvents[K]>) => void | Promise<void>,
    options?: AddEventListenerOptionsLike,
  ) => () => void;
  dispatchEvent: QuartermasterEventDispatcher;

  // Observable-based event methods (event-emission 0.2.0)
  on: <K extends keyof QuartermasterEvents & string>(
    type: K,
    options?: AddEventListenerOptionsLike | boolean,
  ) => ObservableLike<EmissionEvent<QuartermasterEvents[K]>>;
  once: <K extends keyof QuartermasterEvents & string>(
    type: K,
    listener: (event: EmissionEvent<QuartermasterEvents[K]>) => void | Promise<void>,
    options?: Omit<AddEventListenerOptionsLike, 'once'>,
  ) => () => void;
  subscribe: <K extends keyof QuartermasterEvents & string>(
    type: K,
    observerOrNext?:
      | Observer<EmissionEvent<QuartermasterEvents[K]>>
      | ((value: EmissionEvent<QuartermasterEvents[K]>) => void),
    error?: (err: unknown) => void,
    complete?: () => void,
  ) => Subscription;
  toObservable: () => ObservableLike<
    EmissionEvent<QuartermasterEvents[keyof QuartermasterEvents]>
  >;

  // Async iteration (event-emission 0.2.0)
  events: <K extends keyof QuartermasterEvents & string>(
    type: K,
    options?: AsyncIteratorOptions,
  ) => AsyncIterableIterator<EmissionEvent<QuartermasterEvents[K]>>;

  // Lifecycle methods
  complete: () => void;
  readonly completed: boolean;
}

export function createQuartermaster(
  serialized: SerializedQuartermaster = [],
  options: QuartermasterOptions = {},
): Quartermaster {
  const registry = new Map<string, QuartermasterTool>();
  const storedConfigurations = new Map<string, ToolConfig>();
  const hub = createEventTarget<QuartermasterEvents>();
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
  const emit = <K extends keyof QuartermasterEvents & string>(
    type: K,
    detail: QuartermasterEvents[K],
  ) => dispatchEvent({ type, detail } as EmissionEvent<QuartermasterEvents[K]>);
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

  function register(...configurations: ToolConfig[]): Quartermaster {
    for (const configuration of configurations) {
      const normalized = normalizeConfiguration(configuration);
      const tool = buildTool(normalized);
      emit('registering', tool);
      storedConfigurations.set(normalized.name, normalized);
      registry.set(tool.name, tool);
      emit('registered', tool);
    }
    return api;
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
        const result = await tool.execute(call as any);
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

  function query(criteria?: QueryInput): QueryResult | Promise<QueryResult> {
    const tools = Array.from(registry.values());
    if (!criteria) {
      emit('query', { results: tools });
      return tools;
    }
    const predicates = buildPredicates(criteria);
    const intentTags = getIntentTags(criteria);

    // Apply ranking helper for results
    const applyRanking = (results: QueryResult): QueryResult => {
      if (intentTags?.length) {
        return rankByIntent(results, intentTags);
      }
      return results;
    };

    if (!predicates.length) {
      const results = applyRanking(tools);
      emit('query', { criteria, results });
      return results;
    }
    const combined = composePredicates(predicates);
    const filtered = filterWithPredicate(tools, combined);
    if (isPromise(filtered)) {
      return filtered.then((matches) => {
        const ranked = applyRanking(matches);
        emit('query', { criteria, results: ranked });
        return ranked;
      });
    }
    const ranked = applyRanking(filtered);
    emit('query', { criteria, results: ranked });
    return ranked;
  }

  function getTool(name: string): QuartermasterTool | undefined {
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

  function toJSON(): SerializedQuartermaster {
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

  const api: Quartermaster = {
    register,
    execute,
    query,
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

  function buildDefaultTool(configuration: ToolConfig): QuartermasterTool {
    const options: Parameters<typeof createTool>[0] = {
      name: configuration.name,
      description: configuration.description,
      schema: configuration.schema,
      async execute(params, toolContext) {
        return configuration.execute(params as any, {
          ...baseContext,
          dispatchEvent,
          toolConfiguration: toolContext.toolConfiguration,
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
    return createTool(options);
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
    if (typeof configuration.execute !== 'function') {
      throw new TypeError('register expects ToolConfig objects');
    }
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
  }
}

function filterWithPredicate(
  tools: QueryResult,
  predicate: ToolPredicate<QuartermasterTool>,
): QueryResult | Promise<QueryResult> {
  const matches: QueryResult = [];
  const pending: Promise<void>[] = [];
  for (const tool of tools) {
    try {
      const result = predicate(tool);
      if (isPromise(result)) {
        pending.push(
          Promise.resolve(result)
            .then((ok) => {
              if (ok) matches.push(tool);
            })
            .catch(() => {}),
        );
      } else if (result) {
        matches.push(tool);
      }
    } catch {
      // Ignore predicate errors.
    }
  }
  if (pending.length) {
    return Promise.all(pending).then(() => matches);
  }
  return matches;
}

function composePredicates(
  predicates: ToolPredicate<QuartermasterTool>[],
): ToolPredicate<QuartermasterTool> {
  return (tool) => evaluatePredicates(tool, predicates);
}

function evaluatePredicates(
  tool: QuartermasterTool,
  predicates: ToolPredicate<QuartermasterTool>[],
): boolean | Promise<boolean> {
  for (let idx = 0; idx < predicates.length; idx++) {
    const predicate = predicates[idx];
    if (!predicate) continue;
    const result = predicate(tool);
    if (isPromise(result)) {
      return Promise.resolve(result).then((ok) =>
        ok ? evaluatePredicates(tool, predicates.slice(idx + 1)) : false,
      );
    }
    if (!result) {
      return false;
    }
  }
  return true;
}

function buildPredicates(criteria: QueryInput): ToolPredicate<QuartermasterTool>[] {
  if (typeof criteria === 'function') {
    return [criteria];
  }
  if (isZodSchema(criteria)) {
    return [bySchema(criteria)];
  }
  if (typeof criteria === 'string') {
    return [fuzzyText(criteria)];
  }
  if (typeof criteria === 'object') {
    const descriptor = criteria;
    const predicates: ToolPredicate<QuartermasterTool>[] = [];

    // Forbidden tags filter first (hard exclusion)
    if (descriptor.forbiddenTags?.length) {
      predicates.push(byForbiddenTags(descriptor.forbiddenTags));
    }

    // Standard tag matching (OR)
    const descriptorTags = collectDescriptorTags(descriptor);
    if (descriptorTags.length) {
      predicates.push(byTag(descriptorTags));
    }

    // Text search
    if (descriptor.text) {
      predicates.push(fuzzyText(descriptor.text));
    }

    // Schema argument check
    if (descriptor.argument) {
      predicates.push(schemaContainsKeys([descriptor.argument]));
    }

    // Schema matching
    if (descriptor.schema) {
      predicates.push(bySchema(descriptor.schema));
    }

    // Metadata predicate
    if (typeof descriptor.metadata === 'function') {
      const metadataPredicate = descriptor.metadata;
      predicates.push((tool) => metadataPredicate(tool.metadata));
    }

    // Note: intentTags are handled in query() for ranking, not filtering
    return predicates;
  }
  return [];
}

/**
 * Extracts intentTags from criteria if present.
 */
function getIntentTags(criteria: QueryInput | undefined): readonly string[] | undefined {
  if (
    criteria &&
    typeof criteria === 'object' &&
    !isZodSchema(criteria) &&
    typeof criteria !== 'function' &&
    'intentTags' in criteria
  ) {
    return criteria.intentTags;
  }
  return undefined;
}

function collectDescriptorTags(descriptor: QueryDescriptor): string[] {
  const tags: string[] = [];
  if (descriptor.tag) tags.push(descriptor.tag);
  if (descriptor.tags) {
    const list = Array.isArray(descriptor.tags) ? descriptor.tags : [descriptor.tags];
    tags.push(...list);
  }
  return Array.from(new Set(tags));
}

function isPromise<T>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as any).then === 'function'
  );
}
