# Roadmap

This document outlines potential future enhancements for Armorer. These features are organized by priority and category based on community feedback and common use cases.

## Status Legend

- 🟢 **Planned**: Scheduled for an upcoming release
- 🟡 **Under Consideration**: Evaluating feasibility and demand
- 🔵 **Community Request**: Requested by users, awaiting prioritization
- ⚪ **Future**: Good idea but not currently prioritized

---

## High Priority

### 🟢 Streaming Response Support

**Status**: Planned for 0.8.0

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

### 🟡 Circuit Breaker Pattern (Built-in)

**Status**: Under Consideration

While the patterns documentation shows how to implement circuit breakers with middleware, a built-in implementation would provide:

- Standardized circuit breaker behavior
- Pre-configured failure thresholds and timeouts
- Integration with OpenTelemetry metrics
- Dashboard/monitoring support

**Considerations:**

- May add complexity to core library
- Current middleware approach is flexible
- Need to validate demand from community

**Related**: `documentation/patterns.md#circuit-breaker`

---

### 🟡 Request Batching & Backpressure

**Status**: Under Consideration

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

### 🔵 Built-in Metrics & Analytics

**Status**: Community Request

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

### 🔵 Tool DAG Execution

**Status**: Community Request

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

### 🟡 Resource Lifecycle Management

**Status**: Under Consideration

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

### 🟡 State Management & Persistence

**Status**: Under Consideration

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

---

## Low Priority

### ⚪ Sandboxing & Security

Enhanced security features for tool execution:

- Execution sandboxing (VM, containers)
- Resource limits (CPU, memory, time)
- Input sanitization helpers
- Security audit logs

**Considerations:**

- Complex to implement across platforms
- May require platform-specific solutions
- Policy hooks provide some protection already

---

### ⚪ Visual Tool Graph Builder

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

### ⚪ CLI for Tool Management

Command-line interface for common operations:

```bash
armorer list                    # List registered tools
armorer test <tool-name>        # Test a tool interactively
armorer validate <config-file>  # Validate tool configurations
armorer export --provider openai # Export to provider format
```

**Considerations:**

- Useful for development workflows
- Could be separate package (`@armorer/cli`)
- Need to validate demand

---

### ⚪ Multi-tenancy Support

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

### 🟡 Schema Evolution & Migration

**Status**: Under Consideration

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

### ⚪ Branded Types for Tool IDs

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

### 🟡 Response Compression

**Status**: Under Consideration

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

### 🟡 Advanced Caching Strategies

**Status**: Under Consideration

Extend caching middleware with:

- Cache invalidation strategies (TTL, LRU, LFU)
- Distributed caching (Redis, Memcached)
- Conditional caching based on metadata
- Cache warming

**Related**: `createCacheMiddleware` in `armorer/middleware`

---

## Integration & Ecosystem

### 🟢 Additional Provider Adapters

**Status**: Planned

Support for more LLM providers:

- **Mistral AI** (🟢 Planned for 0.8.0)
- **Cohere** (🟡 Under Consideration)
- **AWS Bedrock** (🟡 Under Consideration)
- **Azure OpenAI** (🔵 Community Request)

---

### 🔵 Vector Database Integrations

**Status**: Community Request

Extend embedding support beyond current LanceDB and Chroma:

- **Pinecone** (🔵 Requested)
- **Qdrant** (🔵 Requested)
- **Weaviate** (🟡 Under Consideration)
- **Milvus** (⚪ Future)

---

### ⚪ Observability Platform Integrations

Pre-built integrations for popular observability platforms:

- Datadog APM
- New Relic
- Honeycomb
- Sentry error tracking

**Considerations:**

- OpenTelemetry already provides foundation
- Platform-specific features may add value
- Could be community packages

---

## Documentation & Developer Experience

### 🟢 Interactive Examples

**Status**: Planned for 0.8.0

- CodeSandbox/StackBlitz templates
- Interactive playground on documentation site
- Video tutorials for common patterns
- Real-world example applications

---

### 🟡 Migration Tools

**Status**: Under Consideration

Automated migration for major version upgrades:

- Codemod scripts for breaking changes
- CLI migration helper
- Deprecation warnings with fix suggestions

---

### ⚪ Performance Profiling Tools

Developer tools for performance optimization:

- Built-in profiler for tool execution
- Bottleneck identification
- Memory usage tracking
- Cost analysis reports

---

## Community Contributions

We welcome community contributions for any of these features! If you're interested in working on something:

1. Check the [issues page](https://github.com/stevekinney/armorer/issues) for related discussions
2. Create a proposal issue describing your approach
3. Wait for maintainer feedback before investing significant effort
4. Submit a PR with tests and documentation

---

## Requesting Features

Have an idea not listed here? We'd love to hear it!

1. Check existing [issues](https://github.com/stevekinney/armorer/issues) first
2. Create a feature request issue with:
   - Clear use case description
   - How it would improve your workflow
   - Why existing features don't solve it
   - Example API you'd like to see

Features with clear use cases and community support will be prioritized.

---

## Version Goals

### 0.8.0 (Q2 2026)

- Streaming response support
- Mistral AI adapter
- Interactive examples
- Performance improvements

### 0.9.0 (Q3 2026)

- DAG execution (if validated)
- Built-in metrics module
- Schema evolution tools
- Additional vector DB integrations

### 1.0.0 (Q4 2026)

- API stabilization
- Comprehensive documentation
- Production-ready guarantees
- Long-term support plan

---

_Last updated: 2026-02-09_
