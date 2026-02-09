# Common Patterns

Advanced patterns you can implement using Armorer's existing primitives.

## Table of Contents

- [Circuit Breaker](#circuit-breaker)
- [Session Management](#session-management)
- [Request Deduplication](#request-deduplication)
- [Resource Pooling](#resource-pooling)
- [Fallback Tools](#fallback-tools)
- [Tool Dependencies](#tool-dependencies)
- [Audit Trails](#audit-trails)
- [Cost Tracking](#cost-tracking)
- [Conditional Execution](#conditional-execution)
- [State Management](#state-management)
- [Logging Middleware](#logging-middleware)
- [Streaming Responses](#streaming-responses)

## Circuit Breaker

Prevent cascading failures by tracking error rates and temporarily disabling failing tools.

```typescript
import { createToolbox, createMiddleware } from 'armorer';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  resetTimeout: number; // Time in ms before attempting recovery
  halfOpenRequests: number; // Requests to try in half-open state
}

function createCircuitBreaker(config: CircuitBreakerConfig) {
  const { failureThreshold = 5, resetTimeout = 60000, halfOpenRequests = 3 } = config;

  const circuits = new Map<
    string,
    {
      state: CircuitState;
      failures: number;
      lastFailureTime: number;
      halfOpenAttempts: number;
    }
  >();

  return createMiddleware((toolConfig) => {
    const toolName = toolConfig.identity.name;
    const originalExecute = toolConfig.execute;

    return {
      ...toolConfig,
      async execute(params: unknown, context: unknown) {
        // Initialize circuit for this tool
        if (!circuits.has(toolName)) {
          circuits.set(toolName, {
            state: 'closed',
            failures: 0,
            lastFailureTime: 0,
            halfOpenAttempts: 0,
          });
        }

        const circuit = circuits.get(toolName)!;
        const now = Date.now();

        // Check if circuit should transition from open to half-open
        if (circuit.state === 'open' && now - circuit.lastFailureTime > resetTimeout) {
          circuit.state = 'half-open';
          circuit.halfOpenAttempts = 0;
        }

        // Reject if circuit is open
        if (circuit.state === 'open') {
          throw new Error(
            `Circuit breaker is OPEN for tool "${toolName}". Service temporarily unavailable.`,
          );
        }

        // Limit requests in half-open state
        if (circuit.state === 'half-open') {
          if (circuit.halfOpenAttempts >= halfOpenRequests) {
            throw new Error(
              `Circuit breaker is HALF-OPEN for tool "${toolName}". Maximum concurrent attempts reached.`,
            );
          }
          circuit.halfOpenAttempts++;
        }

        try {
          // Resolve execute function if lazy
          const executeFn =
            typeof originalExecute === 'function'
              ? originalExecute
              : await originalExecute;

          const result = await executeFn(params, context);

          // Success - reset circuit if it was half-open
          if (circuit.state === 'half-open') {
            circuit.state = 'closed';
            circuit.failures = 0;
            circuit.halfOpenAttempts = 0;
          }

          return result;
        } catch (error) {
          // Failure - track and potentially open circuit
          circuit.failures++;
          circuit.lastFailureTime = now;

          if (circuit.state === 'half-open') {
            // Failed during recovery - reopen circuit
            circuit.state = 'open';
            circuit.halfOpenAttempts = 0;
          } else if (circuit.failures >= failureThreshold) {
            // Too many failures - open circuit
            circuit.state = 'open';
          }

          throw error;
        }
      },
    };
  });
}

// Usage
const toolbox = createToolbox([], {
  middleware: [
    createCircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 30000, // 30 seconds
      halfOpenRequests: 2,
    }),
  ],
});
```

### Circuit Breaker with Monitoring

Add observability to track circuit state changes:

```typescript
function createCircuitBreakerWithEvents(config: CircuitBreakerConfig) {
  const middleware = createCircuitBreaker(config);
  const eventTarget = new EventTarget();

  // Wrap the middleware to emit events
  return {
    middleware,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      eventTarget.addEventListener(type, listener);
    },
  };
}

// Usage
const breaker = createCircuitBreakerWithEvents({
  failureThreshold: 5,
  resetTimeout: 60000,
});

breaker.addEventListener('circuit-opened', (event) => {
  console.log('Circuit opened for tool:', event.detail.toolName);
});

const toolbox = createToolbox([], {
  middleware: [breaker.middleware],
});
```

## Session Management

Maintain conversation context and user sessions across tool executions.

```typescript
import { createToolbox, createTool, withContext } from 'armorer';
import { z } from 'zod';

// Session store interface
interface Session {
  id: string;
  userId: string;
  conversationHistory: Array<{ role: string; content: string }>;
  toolInvocations: Array<{ name: string; timestamp: number }>;
  metadata: Record<string, unknown>;
}

class SessionManager {
  private sessions = new Map<string, Session>();

  createSession(userId: string): Session {
    const session: Session = {
      id: crypto.randomUUID(),
      userId,
      conversationHistory: [],
      toolInvocations: [],
      metadata: {},
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  updateSession(sessionId: string, updates: Partial<Session>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
    }
  }

  addMessage(sessionId: string, role: string, content: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.conversationHistory.push({ role, content });
    }
  }

  trackToolInvocation(sessionId: string, toolName: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.toolInvocations.push({ name: toolName, timestamp: Date.now() });
    }
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

// Create session-aware toolbox
const sessionManager = new SessionManager();

const toolbox = createToolbox([], {
  context: { sessionManager },
  policy: {
    async beforeExecute(context) {
      const sessionId = context.params?.sessionId;
      if (!sessionId) {
        return { allow: false, reason: 'Missing sessionId' };
      }

      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return { allow: false, reason: 'Invalid session' };
      }

      // Track tool invocation
      sessionManager.trackToolInvocation(sessionId, context.toolName);
      return { allow: true };
    },
  },
});

// Create session-aware tool
const getUserPreferences = createTool(
  {
    name: 'get-user-preferences',
    description: 'Get user preferences from session',
    schema: z.object({ sessionId: z.string() }),
    async execute({ sessionId }, context) {
      const { sessionManager } = context as { sessionManager: SessionManager };
      const session = sessionManager.getSession(sessionId);
      return session?.metadata.preferences ?? {};
    },
  },
  toolbox,
);

// Usage
const session = sessionManager.createSession('user-123');
session.metadata.preferences = { theme: 'dark', language: 'en' };

const result = await toolbox.execute({
  name: 'get-user-preferences',
  arguments: { sessionId: session.id },
});
```

### Session Middleware

Automatically inject session context into all tools:

```typescript
function createSessionMiddleware(sessionManager: SessionManager) {
  return createMiddleware((toolConfig) => {
    const originalExecute = toolConfig.execute;

    return {
      ...toolConfig,
      async execute(params: any, context: any) {
        // Extract session ID from params
        const sessionId = params?.sessionId;
        if (!sessionId) {
          throw new Error('Session ID required');
        }

        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error('Invalid session');
        }

        // Inject session into context
        const enhancedContext = {
          ...context,
          session,
        };

        const executeFn =
          typeof originalExecute === 'function' ? originalExecute : await originalExecute;

        return executeFn(params, enhancedContext);
      },
    };
  });
}

// Usage
const toolbox = createToolbox([], {
  middleware: [createSessionMiddleware(sessionManager)],
});

const tool = createTool(
  {
    name: 'session-aware-tool',
    description: 'Access session automatically',
    schema: z.object({
      sessionId: z.string(),
      action: z.string(),
    }),
    async execute({ action }, context) {
      const { session } = context as { session: Session };
      console.log(`User ${session.userId} performed: ${action}`);
      return { success: true };
    },
  },
  toolbox,
);
```

## Request Deduplication

Prevent duplicate requests from executing simultaneously using cache middleware.

```typescript
import { createCacheMiddleware } from 'armorer/middleware';

// Create a deduplication middleware that holds in-flight requests
function createDeduplicationMiddleware() {
  const inFlight = new Map<string, Map<string, Promise<unknown>>>();

  return createMiddleware((toolConfig) => {
    const toolName = toolConfig.identity.name;
    const originalExecute = toolConfig.execute;

    return {
      ...toolConfig,
      async execute(params: unknown, context: unknown) {
        // Generate request key
        const requestKey = JSON.stringify(params);

        // Initialize map for this tool
        if (!inFlight.has(toolName)) {
          inFlight.set(toolName, new Map());
        }
        const toolRequests = inFlight.get(toolName)!;

        // Check if request is already in-flight
        if (toolRequests.has(requestKey)) {
          return toolRequests.get(requestKey)!;
        }

        // Execute request and store promise
        const executeFn =
          typeof originalExecute === 'function' ? originalExecute : await originalExecute;

        const promise = executeFn(params, context).finally(() => {
          // Remove from in-flight when complete
          toolRequests.delete(requestKey);
        });

        toolRequests.set(requestKey, promise);
        return promise;
      },
    };
  });
}

// Combine with caching for complete deduplication + persistence
const toolbox = createToolbox([], {
  middleware: [
    createDeduplicationMiddleware(), // Dedupe concurrent requests
    createCacheMiddleware({ ttlMs: 60000 }), // Cache results
  ],
});
```

## Resource Pooling

Manage shared resources like database connections or API clients.

```typescript
import { createTool } from 'armorer';
import { z } from 'zod';

// Generic resource pool
class ResourcePool<T> {
  private available: T[] = [];
  private inUse = new Set<T>();
  private waiting: Array<(resource: T) => void> = [];

  constructor(
    private factory: () => Promise<T>,
    private maxSize: number,
  ) {}

  async acquire(): Promise<T> {
    // Try to get available resource
    if (this.available.length > 0) {
      const resource = this.available.pop()!;
      this.inUse.add(resource);
      return resource;
    }

    // Create new resource if under limit
    if (this.inUse.size < this.maxSize) {
      const resource = await this.factory();
      this.inUse.add(resource);
      return resource;
    }

    // Wait for resource to become available
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(resource: T): void {
    this.inUse.delete(resource);

    // Give to waiting consumer if any
    const waiter = this.waiting.shift();
    if (waiter) {
      this.inUse.add(resource);
      waiter(resource);
    } else {
      this.available.push(resource);
    }
  }

  async dispose(): Promise<void> {
    // Clean up all resources
    this.available = [];
    this.inUse.clear();
    this.waiting = [];
  }
}

// Example: Database connection pool
interface DbConnection {
  query: (sql: string) => Promise<any>;
  close: () => Promise<void>;
}

const dbPool = new ResourcePool<DbConnection>(
  async () => {
    // Create connection (example)
    return {
      query: async (sql: string) => {
        /* ... */
      },
      close: async () => {
        /* ... */
      },
    };
  },
  10, // max 10 connections
);

// Create tools that use the pool
const queryDatabase = createTool({
  name: 'query-database',
  description: 'Execute a database query',
  schema: z.object({ sql: z.string() }),
  async execute({ sql }, context) {
    const { dbPool } = context as { dbPool: ResourcePool<DbConnection> };
    const connection = await dbPool.acquire();

    try {
      return await connection.query(sql);
    } finally {
      dbPool.release(connection);
    }
  },
});

// Pass pool via context
const toolbox = createToolbox([queryDatabase.configuration], {
  context: { dbPool },
});

// Cleanup on shutdown
process.on('SIGTERM', async () => {
  await dbPool.dispose();
});
```

### Resource Cleanup with Tool Lifecycle

```typescript
// Create a tool with cleanup logic
function createResourceTool<TInput extends object, TOutput>(config: {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  setup: () => Promise<unknown>;
  execute: (params: TInput, resource: unknown) => Promise<TOutput>;
  teardown: (resource: unknown) => Promise<void>;
}) {
  let resource: unknown;
  let setupPromise: Promise<void> | undefined;

  const tool = createTool({
    name: config.name,
    description: config.description,
    schema: config.schema,
    async execute(params) {
      // Lazy setup on first use
      if (!resource && !setupPromise) {
        setupPromise = config.setup().then((r) => {
          resource = r;
        });
      }
      if (setupPromise) {
        await setupPromise;
      }

      return config.execute(params, resource);
    },
  });

  // Add cleanup method
  (tool as any).cleanup = async () => {
    if (resource) {
      await config.teardown(resource);
      resource = undefined;
      setupPromise = undefined;
    }
  };

  return tool;
}

// Usage
const dbTool = createResourceTool({
  name: 'database-tool',
  description: 'Tool with database connection',
  schema: z.object({ query: z.string() }),
  setup: async () => {
    console.log('Opening database connection...');
    return {
      /* connection */
    };
  },
  execute: async ({ query }, connection) => {
    // Use connection
    return { result: 'data' };
  },
  teardown: async (connection) => {
    console.log('Closing database connection...');
    // Close connection
  },
});

// Cleanup
await (dbTool as any).cleanup();
```

## Fallback Tools

Implement graceful degradation with fallback tools.

```typescript
import { createTool, createMiddleware } from 'armorer';
import { when } from 'armorer/runtime';
import { z } from 'zod';

// Create a fallback middleware
function createFallbackMiddleware(fallbacks: Map<string, string>) {
  return createMiddleware((toolConfig) => {
    const toolName = toolConfig.identity.name;
    const originalExecute = toolConfig.execute;

    return {
      ...toolConfig,
      async execute(params: unknown, context: any) {
        try {
          const executeFn =
            typeof originalExecute === 'function'
              ? originalExecute
              : await originalExecute;

          return await executeFn(params, context);
        } catch (error) {
          // Check for fallback
          const fallbackName = fallbacks.get(toolName);
          if (fallbackName && context.toolbox) {
            console.warn(`Tool "${toolName}" failed, trying fallback "${fallbackName}"`);
            return context.toolbox.execute({
              name: fallbackName,
              arguments: params,
            });
          }
          throw error;
        }
      },
    };
  });
}

// Define primary and fallback tools
const fetchFromApi = createTool({
  name: 'fetch-from-api',
  description: 'Fetch data from external API',
  schema: z.object({ endpoint: z.string() }),
  async execute({ endpoint }) {
    // Might fail due to network issues
    const response = await fetch(endpoint);
    return response.json();
  },
});

const fetchFromCache = createTool({
  name: 'fetch-from-cache',
  description: 'Fetch data from cache',
  schema: z.object({ endpoint: z.string() }),
  async execute({ endpoint }) {
    // Fallback to cached data
    return { cached: true, data: {} };
  },
});

// Configure fallbacks
const toolbox = createToolbox(
  [fetchFromApi.configuration, fetchFromCache.configuration],
  {
    middleware: [
      createFallbackMiddleware(new Map([['fetch-from-api', 'fetch-from-cache']])),
    ],
  },
);
```

### Fallback Chain with `when`

```typescript
import { when } from 'armorer/runtime';

// Create a tool that tries primary, falls back to secondary
const resilientFetch = when(
  async (params) => {
    try {
      return await fetchFromApi(params);
    } catch {
      return undefined; // Signal to use fallback
    }
  },
  fetchFromApi,
  fetchFromCache, // Used if condition returns falsy
);

// Usage
const result = await resilientFetch({ endpoint: '/api/data' });
```

## Tool Dependencies

Manage tool dependencies and execution order.

```typescript
import { createToolbox, createTool } from 'armorer';
import { z } from 'zod';

// Dependency graph
type DependencyGraph = Map<string, string[]>;

function createDependencyMiddleware(dependencies: DependencyGraph) {
  // Track completed tools per execution context
  const executionContexts = new WeakMap<any, Set<string>>();

  return createMiddleware((toolConfig) => {
    const toolName = toolConfig.identity.name;
    const originalExecute = toolConfig.execute;

    return {
      ...toolConfig,
      async execute(params: unknown, context: any) {
        // Get or create execution context
        if (!executionContexts.has(context)) {
          executionContexts.set(context, new Set());
        }
        const completed = executionContexts.get(context)!;

        // Check dependencies
        const deps = dependencies.get(toolName) ?? [];
        const missing = deps.filter((dep) => !completed.has(dep));

        if (missing.length > 0) {
          throw new Error(
            `Tool "${toolName}" requires dependencies: ${missing.join(', ')}`,
          );
        }

        // Execute
        const executeFn =
          typeof originalExecute === 'function' ? originalExecute : await originalExecute;

        const result = await executeFn(params, context);

        // Mark as completed
        completed.add(toolName);

        return result;
      },
    };
  });
}

// Define tools with dependencies
const authenticate = createTool({
  name: 'authenticate',
  description: 'Authenticate user',
  schema: z.object({ username: z.string(), password: z.string() }),
  async execute({ username, password }) {
    return { token: 'abc123' };
  },
});

const fetchUserData = createTool({
  name: 'fetch-user-data',
  description: 'Fetch user data (requires auth)',
  schema: z.object({ userId: z.string() }),
  async execute({ userId }) {
    return { id: userId, name: 'John Doe' };
  },
});

// Configure dependencies
const deps: DependencyGraph = new Map([
  ['fetch-user-data', ['authenticate']], // fetch-user-data depends on authenticate
]);

const toolbox = createToolbox([authenticate.configuration, fetchUserData.configuration], {
  middleware: [createDependencyMiddleware(deps)],
});

// Usage - must authenticate first
const sharedContext = {};
await toolbox.execute({
  name: 'authenticate',
  arguments: { username: 'user', password: 'pass' },
});
await toolbox.execute({
  name: 'fetch-user-data',
  arguments: { userId: '123' },
});
```

### Automatic Dependency Resolution

```typescript
async function executeDependencyChain(
  toolbox: Toolbox,
  toolName: string,
  params: unknown,
  dependencies: DependencyGraph,
  completed: Set<string> = new Set(),
): Promise<unknown> {
  // Already executed
  if (completed.has(toolName)) {
    return;
  }

  // Execute dependencies first
  const deps = dependencies.get(toolName) ?? [];
  for (const dep of deps) {
    await executeDependencyChain(toolbox, dep, {}, dependencies, completed);
  }

  // Execute this tool
  const result = await toolbox.execute({
    name: toolName,
    arguments: params,
  });
  completed.add(toolName);

  return result;
}

// Usage
const result = await executeDependencyChain(
  toolbox,
  'fetch-user-data',
  { userId: '123' },
  deps,
);
```

## Audit Trails

Track all tool executions for compliance and debugging.

```typescript
import { createToolbox } from 'armorer';

interface AuditEntry {
  timestamp: number;
  toolName: string;
  params: unknown;
  result?: unknown;
  error?: string;
  userId?: string;
  sessionId?: string;
  durationMs: number;
}

class AuditLog {
  private entries: AuditEntry[] = [];

  log(entry: AuditEntry): void {
    this.entries.push(entry);
    // Optionally persist to database
  }

  getEntries(filter?: Partial<AuditEntry>): AuditEntry[] {
    if (!filter) return this.entries;

    return this.entries.filter((entry) => {
      return Object.entries(filter).every(
        ([key, value]) => entry[key as keyof AuditEntry] === value,
      );
    });
  }

  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}

// Create audit middleware
function createAuditMiddleware(auditLog: AuditLog) {
  return createMiddleware((toolConfig) => {
    const toolName = toolConfig.identity.name;
    const originalExecute = toolConfig.execute;

    return {
      ...toolConfig,
      async execute(params: unknown, context: any) {
        const startTime = Date.now();
        const entry: Partial<AuditEntry> = {
          timestamp: startTime,
          toolName,
          params,
          userId: context.userId,
          sessionId: context.sessionId,
        };

        try {
          const executeFn =
            typeof originalExecute === 'function'
              ? originalExecute
              : await originalExecute;

          const result = await executeFn(params, context);

          entry.result = result;
          entry.durationMs = Date.now() - startTime;
          auditLog.log(entry as AuditEntry);

          return result;
        } catch (error) {
          entry.error = error instanceof Error ? error.message : String(error);
          entry.durationMs = Date.now() - startTime;
          auditLog.log(entry as AuditEntry);

          throw error;
        }
      },
    };
  });
}

// Usage
const auditLog = new AuditLog();

const toolbox = createToolbox([], {
  middleware: [createAuditMiddleware(auditLog)],
  context: {
    userId: 'user-123',
    sessionId: 'session-456',
  },
});

// Query audit log
const userActions = auditLog.getEntries({ userId: 'user-123' });
console.log(`User performed ${userActions.length} actions`);

// Export for compliance
const exportedLog = auditLog.export();
```

### Audit Trail with Events

```typescript
// Use toolbox events for audit trail
const auditLog = new AuditLog();

toolbox.addEventListener('tool.started', (event) => {
  const { toolName, toolCall } = event.detail;
  console.log(`[AUDIT] Started: ${toolName}`);
});

toolbox.addEventListener('tool.finished', (event) => {
  const { toolName, toolCall, result, error, status, durationMs } = event.detail;

  auditLog.log({
    timestamp: Date.now(),
    toolName,
    params: toolCall.arguments,
    result: status === 'success' ? result : undefined,
    error: error ? (error instanceof Error ? error.message : String(error)) : undefined,
    durationMs,
  } as AuditEntry);
});
```

## Cost Tracking

Monitor API costs and usage quotas.

```typescript
import { createToolbox, createMiddleware } from 'armorer';

interface CostEntry {
  toolName: string;
  timestamp: number;
  cost: number;
  units: number;
  metadata?: Record<string, unknown>;
}

class CostTracker {
  private entries: CostEntry[] = [];
  private totalCost = 0;

  addCost(entry: CostEntry): void {
    this.entries.push(entry);
    this.totalCost += entry.cost;
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getCostByTool(toolName: string): number {
    return this.entries
      .filter((e) => e.toolName === toolName)
      .reduce((sum, e) => sum + e.cost, 0);
  }

  getUsageStats(): Record<string, { calls: number; cost: number; units: number }> {
    const stats: Record<string, { calls: number; cost: number; units: number }> = {};

    for (const entry of this.entries) {
      if (!stats[entry.toolName]) {
        stats[entry.toolName] = { calls: 0, cost: 0, units: 0 };
      }
      stats[entry.toolName].calls++;
      stats[entry.toolName].cost += entry.cost;
      stats[entry.toolName].units += entry.units;
    }

    return stats;
  }
}

// Cost calculator function type
type CostCalculator = (
  params: unknown,
  result: unknown,
) => {
  cost: number;
  units: number;
};

// Create cost tracking middleware
function createCostTrackingMiddleware(
  tracker: CostTracker,
  costCalculators: Map<string, CostCalculator>,
) {
  return createMiddleware((toolConfig) => {
    const toolName = toolConfig.identity.name;
    const originalExecute = toolConfig.execute;
    const calculator = costCalculators.get(toolName);

    return {
      ...toolConfig,
      async execute(params: unknown, context: unknown) {
        const executeFn =
          typeof originalExecute === 'function' ? originalExecute : await originalExecute;

        const result = await executeFn(params, context);

        // Calculate and track cost
        if (calculator) {
          const { cost, units } = calculator(params, result);
          tracker.addCost({
            toolName,
            timestamp: Date.now(),
            cost,
            units,
          });
        }

        return result;
      },
    };
  });
}

// Example: OpenAI GPT-4 cost calculator
const costCalculators = new Map<string, CostCalculator>([
  [
    'openai-completion',
    (params: any, result: any) => {
      // GPT-4 pricing: $0.03/1K input tokens, $0.06/1K output tokens
      const inputTokens = result.usage?.prompt_tokens ?? 0;
      const outputTokens = result.usage?.completion_tokens ?? 0;

      const inputCost = (inputTokens / 1000) * 0.03;
      const outputCost = (outputTokens / 1000) * 0.06;

      return {
        cost: inputCost + outputCost,
        units: inputTokens + outputTokens,
      };
    },
  ],
]);

const costTracker = new CostTracker();

const toolbox = createToolbox([], {
  middleware: [createCostTrackingMiddleware(costTracker, costCalculators)],
});

// Check costs
console.log('Total cost:', costTracker.getTotalCost());
console.log('Usage stats:', costTracker.getUsageStats());

// Alert on high costs
if (costTracker.getTotalCost() > 10.0) {
  console.warn('Cost threshold exceeded!');
}
```

### Per-User Cost Quotas

```typescript
class QuotaManager {
  private usage = new Map<string, number>();

  constructor(private quotas: Map<string, number>) {}

  checkQuota(userId: string, cost: number): boolean {
    const used = this.usage.get(userId) ?? 0;
    const quota = this.quotas.get(userId) ?? 0;
    return used + cost <= quota;
  }

  addUsage(userId: string, cost: number): void {
    const used = this.usage.get(userId) ?? 0;
    this.usage.set(userId, used + cost);
  }

  getRemainingQuota(userId: string): number {
    const used = this.usage.get(userId) ?? 0;
    const quota = this.quotas.get(userId) ?? 0;
    return Math.max(0, quota - used);
  }
}

function createQuotaMiddleware(
  quotaManager: QuotaManager,
  costCalculators: Map<string, CostCalculator>,
) {
  return createMiddleware((toolConfig) => {
    const toolName = toolConfig.identity.name;
    const originalExecute = toolConfig.execute;
    const calculator = costCalculators.get(toolName);

    return {
      ...toolConfig,
      async execute(params: unknown, context: any) {
        const userId = context.userId;
        if (!userId) {
          throw new Error('User ID required for quota enforcement');
        }

        // Estimate cost (simplified - actual cost checked after execution)
        const estimatedCost = 0.1; // Could be more sophisticated
        if (!quotaManager.checkQuota(userId, estimatedCost)) {
          throw new Error(
            `Quota exceeded for user ${userId}. Remaining: ${quotaManager.getRemainingQuota(userId)}`,
          );
        }

        const executeFn =
          typeof originalExecute === 'function' ? originalExecute : await originalExecute;

        const result = await executeFn(params, context);

        // Track actual cost
        if (calculator) {
          const { cost } = calculator(params, result);
          quotaManager.addUsage(userId, cost);
        }

        return result;
      },
    };
  });
}

// Usage
const quotas = new Map([
  ['user-123', 100.0], // $100 quota
  ['user-456', 50.0], // $50 quota
]);

const quotaManager = new QuotaManager(quotas);

const toolbox = createToolbox([], {
  middleware: [createQuotaMiddleware(quotaManager, costCalculators)],
  context: { userId: 'user-123' },
});
```

## Conditional Execution

Execute tools based on runtime conditions.

```typescript
import { when, compose } from 'armorer/runtime';
import { createTool } from 'armorer';
import { z } from 'zod';

// Conditional execution with `when`
const checkCache = createTool({
  name: 'check-cache',
  description: 'Check if data is cached',
  schema: z.object({ key: z.string() }),
  async execute({ key }) {
    const cache = new Map();
    return cache.get(key);
  },
});

const fetchFromApi = createTool({
  name: 'fetch-from-api',
  description: 'Fetch from API',
  schema: z.object({ key: z.string() }),
  async execute({ key }) {
    return { data: 'fresh-data' };
  },
});

// Use cache if available, otherwise fetch
const getData = when(
  async (params) => {
    const cached = await checkCache(params);
    return cached !== undefined;
  },
  checkCache,
  fetchFromApi,
);

// Usage
const result = await getData({ key: 'user-data' });
```

### Multi-way Branching

```typescript
async function branch<TInput extends object, TOutput>(
  params: TInput,
  branches: Array<{
    condition: (params: TInput) => boolean | Promise<boolean>;
    tool: (params: TInput) => Promise<TOutput>;
  }>,
  defaultTool?: (params: TInput) => Promise<TOutput>,
): Promise<TOutput> {
  for (const { condition, tool } of branches) {
    if (await condition(params)) {
      return tool(params);
    }
  }

  if (defaultTool) {
    return defaultTool(params);
  }

  throw new Error('No matching branch found');
}

// Usage
const result = await branch(
  { amount: 1000 },
  [
    {
      condition: (p) => p.amount > 10000,
      tool: async (p) => processLargeTransaction(p),
    },
    {
      condition: (p) => p.amount > 1000,
      tool: async (p) => processMediumTransaction(p),
    },
  ],
  async (p) => processSmallTransaction(p), // default
);
```

## State Management

Maintain persistent state across tool executions.

```typescript
import { createToolbox, createTool } from 'armorer';
import { z } from 'zod';

// State store
class StateStore {
  private state = new Map<string, any>();

  get<T>(key: string): T | undefined {
    return this.state.get(key);
  }

  set<T>(key: string, value: T): void {
    this.state.set(key, value);
  }

  update<T>(key: string, updater: (current: T | undefined) => T): void {
    const current = this.state.get(key);
    this.state.set(key, updater(current));
  }

  delete(key: string): void {
    this.state.delete(key);
  }

  clear(): void {
    this.state.clear();
  }

  toJSON(): Record<string, any> {
    return Object.fromEntries(this.state);
  }

  fromJSON(data: Record<string, any>): void {
    this.state = new Map(Object.entries(data));
  }
}

// Create stateful tools
const stateStore = new StateStore();

const setCounter = createTool({
  name: 'set-counter',
  description: 'Set counter value',
  schema: z.object({ value: z.number() }),
  async execute({ value }, context) {
    const { stateStore } = context as { stateStore: StateStore };
    stateStore.set('counter', value);
    return { counter: value };
  },
});

const incrementCounter = createTool({
  name: 'increment-counter',
  description: 'Increment counter',
  schema: z.object({ by: z.number().optional() }),
  async execute({ by = 1 }, context) {
    const { stateStore } = context as { stateStore: StateStore };
    stateStore.update<number>('counter', (current = 0) => current + by);
    return { counter: stateStore.get('counter') };
  },
});

const getCounter = createTool({
  name: 'get-counter',
  description: 'Get counter value',
  schema: z.object({}),
  async execute(_params, context) {
    const { stateStore } = context as { stateStore: StateStore };
    return { counter: stateStore.get('counter') ?? 0 };
  },
});

// Create toolbox with state
const toolbox = createToolbox(
  [setCounter.configuration, incrementCounter.configuration, getCounter.configuration],
  {
    context: { stateStore },
  },
);

// Usage
await toolbox.execute({ name: 'set-counter', arguments: { value: 10 } });
await toolbox.execute({ name: 'increment-counter', arguments: { by: 5 } });
const result = await toolbox.execute({ name: 'get-counter', arguments: {} });
console.log(result.result); // { counter: 15 }

// Persist state
const snapshot = stateStore.toJSON();
// ... save to file or database

// Restore state
stateStore.fromJSON(snapshot);
```

### State Middleware with Auto-Persistence

```typescript
function createStatePersistenceMiddleware(
  stateStore: StateStore,
  persistFn: (state: Record<string, any>) => Promise<void>,
  debounceMs = 1000,
) {
  let timer: NodeJS.Timeout | undefined;

  const schedulePersist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      await persistFn(stateStore.toJSON());
    }, debounceMs);
  };

  return createMiddleware((toolConfig) => {
    const originalExecute = toolConfig.execute;

    return {
      ...toolConfig,
      async execute(params: unknown, context: unknown) {
        const executeFn =
          typeof originalExecute === 'function' ? originalExecute : await originalExecute;

        const result = await executeFn(params, context);

        // Schedule persistence after state change
        schedulePersist();

        return result;
      },
    };
  });
}

// Usage with file persistence
const toolbox = createToolbox([], {
  middleware: [
    createStatePersistenceMiddleware(
      stateStore,
      async (state) => {
        await Bun.write('state.json', JSON.stringify(state));
      },
      5000, // persist every 5 seconds after changes
    ),
  ],
});
```

## Logging Middleware

Add structured logging to all tool executions.

```typescript
import { createMiddleware } from 'armorer';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  toolName: string;
  message: string;
  data?: unknown;
}

class Logger {
  private entries: LogEntry[] = [];

  log(level: LogLevel, toolName: string, message: string, data?: unknown): void {
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      toolName,
      message,
      data,
    };

    this.entries.push(entry);

    // Also log to console
    const logFn = console[level] ?? console.log;
    logFn(
      `[${entry.timestamp}] [${level.toUpperCase()}] [${toolName}] ${message}`,
      data ?? '',
    );
  }

  getEntries(filter?: { level?: LogLevel; toolName?: string }): LogEntry[] {
    if (!filter) return this.entries;

    return this.entries.filter((entry) => {
      if (filter.level && entry.level !== filter.level) return false;
      if (filter.toolName && entry.toolName !== filter.toolName) return false;
      return true;
    });
  }

  clear(): void {
    this.entries = [];
  }
}

function createLoggingMiddleware(logger: Logger, logLevel: LogLevel = 'info') {
  const shouldLog = (level: LogLevel): boolean => {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(logLevel);
  };

  return createMiddleware((toolConfig) => {
    const toolName = toolConfig.identity.name;
    const originalExecute = toolConfig.execute;

    return {
      ...toolConfig,
      async execute(params: unknown, context: unknown) {
        if (shouldLog('debug')) {
          logger.log('debug', toolName, 'Executing with params', params);
        }

        const startTime = Date.now();

        try {
          const executeFn =
            typeof originalExecute === 'function'
              ? originalExecute
              : await originalExecute;

          const result = await executeFn(params, context);
          const duration = Date.now() - startTime;

          if (shouldLog('info')) {
            logger.log('info', toolName, `Completed in ${duration}ms`, {
              duration,
              result: typeof result === 'object' ? '<object>' : result,
            });
          }

          return result;
        } catch (error) {
          const duration = Date.now() - startTime;

          if (shouldLog('error')) {
            logger.log('error', toolName, `Failed after ${duration}ms`, {
              duration,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          throw error;
        }
      },
    };
  });
}

// Usage
const logger = new Logger();

const toolbox = createToolbox([], {
  middleware: [createLoggingMiddleware(logger, 'debug')],
});

// Query logs
const errorLogs = logger.getEntries({ level: 'error' });
console.log(`Found ${errorLogs.length} errors`);
```

## Streaming Responses

Implement streaming for large or real-time data.

```typescript
import { createTool } from 'armorer';
import { z } from 'zod';

// Streaming using async generators
const streamData = createTool({
  name: 'stream-data',
  description: 'Stream data in chunks',
  schema: z.object({ query: z.string() }),
  async execute({ query }, { dispatch }) {
    // Simulate streaming
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Emit progress events for each chunk
      dispatch({
        type: 'progress',
        detail: {
          percent: (i + 1) * 10,
          message: `Chunk ${i + 1}/10`,
        },
      });

      // Emit custom event with chunk data
      dispatch({
        type: 'chunk',
        detail: { index: i, data: `Chunk ${i}` },
      });
    }

    return { complete: true, chunks: 10 };
  },
});

// Listen to streaming events
streamData.addEventListener('chunk', (event) => {
  console.log('Received chunk:', event.detail);
});

streamData.addEventListener('progress', (event) => {
  console.log(`Progress: ${event.detail.percent}%`);
});

// Execute
const result = await streamData({ query: 'test' });
```

### Server-Sent Events Pattern

```typescript
import { createTool } from 'armorer';
import { z } from 'zod';

// Tool that returns an async iterator
const streamSSE = createTool({
  name: 'stream-sse',
  description: 'Stream data as SSE',
  schema: z.object({ topic: z.string() }),
  async execute({ topic }) {
    // Return an async iterable
    return {
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          yield { event: 'message', data: `Event ${i} for ${topic}` };
        }
      },
    };
  },
});

// Consume the stream
const stream = await streamSSE({ topic: 'updates' });

if (stream && Symbol.asyncIterator in stream) {
  for await (const event of stream) {
    console.log('SSE Event:', event);
  }
}
```

### Observable Pattern

```typescript
import { createTool } from 'armorer';
import { z } from 'zod';

// Tool that returns an observable-like object
const observeData = createTool({
  name: 'observe-data',
  description: 'Observe data changes',
  schema: z.object({ source: z.string() }),
  async execute({ source }) {
    return {
      subscribe: (observer: {
        next?: (value: any) => void;
        error?: (error: any) => void;
        complete?: () => void;
      }) => {
        let count = 0;
        const interval = setInterval(() => {
          count++;
          observer.next?.({ count, source });

          if (count >= 5) {
            clearInterval(interval);
            observer.complete?.();
          }
        }, 200);

        return {
          unsubscribe: () => clearInterval(interval),
        };
      },
    };
  },
});

// Subscribe to the observable
const observable = await observeData({ source: 'sensor-1' });

const subscription = observable.subscribe({
  next: (value) => console.log('Value:', value),
  complete: () => console.log('Complete!'),
});

// Unsubscribe after 2 seconds
setTimeout(() => subscription.unsubscribe(), 2000);
```

---

## Summary

These patterns demonstrate how to build advanced functionality using Armorer's existing primitives:

- **Circuit Breaker**: Use middleware to track failures and implement circuit breaker logic
- **Session Management**: Use context and middleware to inject session data
- **Request Deduplication**: Use middleware to track in-flight requests
- **Resource Pooling**: Use context to share resource pools across tools
- **Fallback Tools**: Use middleware or `when` for graceful degradation
- **Tool Dependencies**: Use middleware to enforce execution order
- **Audit Trails**: Use events or middleware to track all executions
- **Cost Tracking**: Use middleware to calculate and track costs
- **Conditional Execution**: Use `when` and composition for branching
- **State Management**: Use context to share state stores
- **Logging**: Use middleware for structured logging
- **Streaming**: Use events and async iterators for streaming data

All patterns are built on top of Armorer's core features: middleware, events, context, and composition utilities.
