# Roadmap

This document outlines potential future enhancements for Armorer. These features are organized by priority and category based on community feedback and common use cases.

## Next Up

- Make `Toolbox` immutable so that we can have type safety. We'll provide and/or a `combineToolbox` utility and a `.extend()` method for composing toolboxes.
- Take a closer look at how we handle searching and querying.
- Additional adapters: tRPC router, REST API.

## High Priority

### Streaming Response Support

Native support for streaming responses from tools, particularly useful for:

- LLM token streaming
- Large file transfers
- Real-time data feeds
- Server-Sent Events (SSE)

**Implementation approach:**

- Extend `ToolResult` to support async iterators
- Add streaming event types to tool event system
- Update provider adapters to handle streaming responses
- Add examples for SSE and WebSocket patterns

**Related**: See patterns documentation for current workarounds using progress events

---

### Circuit Breaker Pattern (Built-in)

While the patterns documentation shows how to implement circuit breakers with middleware, a built-in implementation would provide:

- Standardized circuit breaker behavior
- Pre-configured failure thresholds and timeouts
- Integration with OpenTelemetry metrics
- Dashboard/monitoring support

**Considerations:**

- May add complexity to core library
- Current middleware approach is flexible
- Need to validate demand from community

**Related**: `documentation/patterns/circuit-breaker.md`

---

### Request Batching & Backpressure

Advanced execution strategies beyond current parallel/sequential modes:

- Batch tools into configurable chunks
- Backpressure handling when toolbox is overloaded
- Priority queues for tool execution
- Rate limiting across all tools (not just per-tool)

**Use cases:**

- High-throughput agent systems
- Resource-constrained environments
- Fair resource allocation among users

---

## Medium Priority

### Built-in Metrics & Analytics

Extend OpenTelemetry instrumentation with built-in metrics:

- Invocation counts per tool
- Latency percentiles (p50, p95, p99)
- Error rates and categories
- Cost tracking integration
- Usage quotas and alerts

**Implementation approach:**

- Extend `armorer/instrumentation` module
- Add optional metrics exporters
- Provide dashboard templates (Grafana, etc.)
- Keep it opt-in to minimize bundle size

**Related**: See cost tracking pattern in documentation

---

### Tool DAG Execution

Support for complex workflows beyond linear pipelines:

- Directed Acyclic Graph (DAG) execution
- Conditional branching based on results
- Fan-out/fan-in patterns
- Dynamic workflow generation

**Proposed API:**

```typescript
const workflow = createWorkflow({
  nodes: {
    auth: authenticateTool,
    fetchData: fetchDataTool,
    processA: processATool,
    processB: processBTool,
    combine: combineTool,
  },
  edges: [
    { from: 'auth', to: 'fetchData' },
    { from: 'fetchData', to: 'processA' },
    { from: 'fetchData', to: 'processB' },
    { from: ['processA', 'processB'], to: 'combine' },
  ],
});
```

**Related**: `pipe`, `compose`, `parallel` utilities

---

### Resource Lifecycle Management

Standardized resource management for tools:

- Connection pooling for databases, APIs
- Automatic cleanup on toolbox disposal
- Resource health checks
- Graceful shutdown support

**Proposed API:**

```typescript
const pool = createResourcePool({
  factory: () => createDbConnection(),
  max: 10,
  healthCheck: (conn) => conn.ping(),
});

const toolbox = createToolbox([], {
  resources: { db: pool },
  onShutdown: async () => {
    await pool.drain();
  },
});
```

**Related**: See resource pooling pattern in documentation

---

### State Management & Persistence

Built-in state management for multi-turn conversations:

- Session state persistence
- Conversation history tracking
- State hydration/dehydration
- Memory backends (Redis, PostgreSQL, etc.)

**Use cases:**

- Chatbots with conversation context
- Multi-step workflows requiring state
- Agent memory across sessions

**Related**: See state management pattern in documentation

### Visual Tool Graph Builder

Developer tooling for building and debugging tool workflows:

- Web-based tool graph visualization
- Drag-and-drop workflow builder
- Real-time execution monitoring
- Debug mode with step-through

**Considerations:**

- Large scope, potentially separate package
- Would benefit from DAG execution feature
- Lower priority than core functionality

---

### CLI for Tool Management

Command-line interface for common operations:

```bash
toolbox list                    # List registered tools
toolbox test <tool-name>        # Test a tool interactively
toolbox validate <configuration-file>  # Validate tool configurations
toolbox export --provider openai # Export to provider format
```

**Considerations:**

- Useful for development workflows
- Could be separate package (`@armorer/cli`)
- Need to validate demand

---

### Multi-tenancy Support

Built-in tenant isolation for SaaS applications:

- Per-tenant tool filtering
- Tenant-specific quotas and rate limits
- Isolated execution contexts
- Tenant-level metrics

**Considerations:**

- Can be implemented with current context and middleware
- Built-in support would standardize patterns
- May add complexity to API surface

---

## Schema & Type Safety

### Schema Evolution & Migration

Tools for managing schema changes over time:

- Schema compatibility checking (backward/forward)
- Automated migration helpers
- Version negotiation
- Deprecation warnings

**Use cases:**

- Long-running agent systems
- Breaking schema changes
- Multi-version tool support

---

### Branded Types for Tool IDs

Stronger type safety for tool identifiers:

```typescript
type ToolId = string & { __brand: 'ToolId' };
```

**Considerations:**

- Improves type safety
- May complicate API usage
- Need to assess value vs complexity

---

## Performance

### Response Compression

Automatic compression of large tool outputs:

- Configurable compression (gzip, brotli)
- Size threshold triggers
- Transparent decompression
- Provider adapter support

**Use cases:**

- Large JSON responses
- Binary data transfer
- Network-constrained environments

---

### Advanced Caching Strategies

Extend caching middleware with:

- Cache invalidation strategies (TTL, LRU, LFU)
- Distributed caching (Redis, Memcached)
- Conditional caching based on metadata
- Cache warming

**Related**: `createCacheMiddleware` in `armorer/middleware`

---

### Vector Database Integrations

Extend embedding support beyond current LanceDB and Chroma:

- **Qdrant** (Requested)
- **Weaviate** (Under Consideration)
- **Milvus** (Future)

---

### Performance Profiling Tools

Developer tools for performance optimization:

- Built-in profiler for tool execution
- Bottleneck identification
- Memory usage tracking
- Cost analysis reports
