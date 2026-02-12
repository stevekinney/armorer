# Searching Tools

## Overview

Toolbox has two core APIs for tool discovery:

- `queryTools(...)`: filter tools by tags, text, schema, metadata, and custom predicates.
- `searchTools(...)`: rank tools by relevance (tags, text, embeddings) and return scores/reasons.

This page is about programmatic search in `armorer/registry`.

If you need an agent-callable tool named `search-tools`, see [Search Tool](search-tool.md).

## Quick Start

```typescript
import { createToolbox } from 'armorer';
import { queryTools, searchTools } from 'armorer/registry';

const toolbox = createToolbox();
// ... register tools

const filtered = queryTools(toolbox, { tags: { any: ['communication'] } });
const ranked = searchTools(toolbox, {
  rank: { text: { query: 'notify a user', mode: 'fuzzy' } },
  limit: 5,
});
```

## `queryTools`: Filter-First Search

Use `queryTools` when you want deterministic filtering.

```typescript
import { queryTools } from 'armorer/registry';
import { z } from 'zod';

// Tags
const safeTools = queryTools(toolbox, {
  tags: { none: ['dangerous', 'mutating'] },
});

// Text matching (name, description, tags, schema keys, metadata keys)
const byText = queryTools(toolbox, {
  text: { query: 'calendar event', mode: 'contains' },
});

// Schema matching
const withCityParam = queryTools(toolbox, {
  schema: { keys: ['city'] },
});
const bySchemaShape = queryTools(toolbox, {
  schema: { matches: z.object({ city: z.string() }) },
});

// Metadata
const premium = queryTools(toolbox, {
  metadata: { eq: { tier: 'premium' } },
});
```

### Boolean Criteria

```typescript
const results = queryTools(toolbox, {
  and: [{ tags: { any: ['communication'] } }, { not: { tags: { any: ['deprecated'] } } }],
  or: [{ text: 'email' }, { text: 'sms' }],
});
```

## `searchTools`: Ranked Search

Use `searchTools` when you need relevance ordering and optional explainability.

```typescript
import { searchTools } from 'armorer/registry';

const matches = searchTools(toolbox, {
  filter: { tags: { none: ['deprecated'] } },
  rank: {
    tags: ['communication', 'fast'],
    tagWeights: { fast: 2 },
    text: {
      query: 'notify team about outage',
      mode: 'fuzzy',
      threshold: 0.6,
    },
    weights: { tags: 1, text: 2 },
  },
  explain: true,
  limit: 10,
});

for (const match of matches) {
  console.log(match.tool.name, match.score, match.reasons);
}
```

### Custom Ranking

```typescript
const matches = searchTools(toolbox, {
  rank: { text: 'summarize incident' },
  ranker: (tool) => {
    if (tool.metadata?.tier === 'premium') {
      return { score: 5, reasons: ['tier:premium'] };
    }
    return { score: 0 };
  },
  tieBreaker: 'name',
  explain: true,
});
```

## Embeddings and Semantic Search

If the toolbox has an `embed` function, `queryTools` and `searchTools` can include embedding-based matching alongside lexical matching.

```typescript
const toolbox = createToolbox([], {
  embed: async (texts) => embeddingClient.embed(texts),
});
```

When tool metadata or schemas change and cached indices are stale, rebuild search state:

```typescript
import { reindexSearchIndex } from 'armorer/registry';

reindexSearchIndex(toolbox);
```

## Selection and Pagination

Both query and search support selection and pagination.

```typescript
const summaries = searchTools(toolbox, {
  rank: { text: 'send message' },
  select: 'summary',
  includeSchema: true,
  includeToolConfiguration: false,
  offset: 10,
  limit: 10,
});
```

Common `select` values:

- `tool`
- `name`
- `configuration`
- `summary`

## Events

When `queryTools` or `searchTools` is called with a toolbox instance, toolbox emits `query` and `search` events.

See [Eventing](eventing.md) for event subscription patterns.

## Related Documentation

- [Toolbox Registry](registry.md) - Registration, execution, and registry behavior
- [Search Tool](search-tool.md) - Agent-callable `search-tools` utility
- [Embeddings & Semantic Search](embeddings.md) - Embedding setup and semantic matching
- [Public API Reference](api-reference.md) - Full query/search type reference
