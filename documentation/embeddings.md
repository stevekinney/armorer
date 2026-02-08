# Embeddings and Semantic Search

## Overview

Toolbox supports semantic search for tools using vector embeddings. When you provide an `embed` function to `createToolbox`, the registry generates embeddings for each tool's name, description, tags, schema keys, and metadata keys. These embeddings enable fuzzy, meaning-based searches that go beyond exact text matching.

## Basic Embedding Integration

The `embed` option accepts a function that takes an array of strings and returns an array of numeric vectors:

```typescript
import { createToolbox } from 'armorer';

const armorer = createToolbox([], {
  embed: async (texts: string[]): Promise<number[][]> => {
    // Return embeddings for each text
    return texts.map((text) => generateEmbedding(text));
  },
});
```

## Using OpenAI Embeddings

The most common approach is to use OpenAI's embedding API:

```typescript
import { createToolbox, createTool } from 'armorer';
import { searchTools } from 'armorer/registry';
import OpenAI from 'openai';
import { z } from 'zod';

const openai = new OpenAI();

const armorer = createToolbox([], {
  embed: async (texts: string[]): Promise<number[][]> => {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    return response.data.map((item) => item.embedding);
  },
});

// Register tools - embeddings are generated automatically
createTool(
  {
    name: 'send-email',
    description: 'Send an email to a recipient',
    schema: z.object({
      to: z.string().email(),
      subject: z.string(),
      body: z.string(),
    }),
    tags: ['communication', 'email', 'messaging'],
    async execute({ to, subject, body }) {
      return { sent: true, to };
    },
  },
  armorer,
);

createTool(
  {
    name: 'create-calendar-event',
    description: 'Schedule a meeting or event on the calendar',
    schema: z.object({
      title: z.string(),
      startTime: z.string(),
      attendees: z.array(z.string().email()),
    }),
    tags: ['calendar', 'scheduling', 'meetings'],
    async execute({ title, startTime, attendees }) {
      return { created: true, title };
    },
  },
  armorer,
);

// Semantic search - finds "send-email" even though "notify" isn't in the name
const results = searchTools(armorer, {
  rank: {
    text: { query: 'notify someone about something', mode: 'fuzzy' },
  },
  explain: true,
});

console.log(results[0].tool.name); // 'send-email'
console.log(results[0].reasons); // Includes embedding match scores
```

## Using Pinecone for Persistent Embeddings

For production systems with many tools, you may want to store embeddings in a vector database like Pinecone. This enables faster queries and persistence across restarts.

### Setup

First, install the required dependencies:

```bash
bun add @pinecone-database/pinecone openai
```

### Creating a Pinecone-backed Toolbox

```typescript
import { createToolbox, createTool } from 'armorer';
import { queryTools, searchTools } from 'armorer/registry';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { z } from 'zod';

// Initialize clients
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const openai = new OpenAI();

// Get or create the index
const index = pinecone.index('armorer-tools');

// Create an embedder that uses OpenAI
async function embed(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data.map((item) => item.embedding);
}

// Create the armorer with embedding support
const armorer = createToolbox([], { embed });

// Helper to upsert tool embeddings to Pinecone
async function syncToolToPinecone(toolName: string): Promise<void> {
  const tool = armorer.getTool(toolName);
  if (!tool) return;

  // Generate embeddings for the tool's searchable fields
  const fields = [
    { field: 'name', text: tool.name },
    { field: 'description', text: tool.description },
    { field: 'tags', text: tool.tags?.join(' ') ?? '' },
  ].filter((f) => f.text);

  const embeddings = await embed(fields.map((f) => f.text));

  // Upsert to Pinecone with metadata
  const vectors = fields.map((field, i) => ({
    id: `${toolName}:${field.field}`,
    values: embeddings[i],
    metadata: {
      toolName,
      field: field.field,
      text: field.text,
    },
  }));

  await index.upsert(vectors);
}

// Register tools and sync to Pinecone
armorer.addEventListener('registered', async (event) => {
  await syncToolToPinecone(event.detail.name);
});
```

### Querying Tools via Pinecone

You can query Pinecone directly for semantic search across a large tool corpus:

```typescript
async function findToolsBySemanticQuery(
  query: string,
  topK: number = 5,
): Promise<string[]> {
  // Generate embedding for the query
  const [queryEmbedding] = await embed([query]);

  // Query Pinecone
  const results = await index.query({
    vector: queryEmbedding,
    topK,
    includeMetadata: true,
  });

  // Extract unique tool names, preserving score order
  const toolNames = new Set<string>();
  for (const match of results.matches ?? []) {
    const toolName = match.metadata?.toolName as string;
    if (toolName) {
      toolNames.add(toolName);
    }
  }

  return Array.from(toolNames);
}

// Usage
const toolNames = await findToolsBySemanticQuery('send a message to someone');
console.log(toolNames); // ['send-email', 'send-sms', ...]

// Get the actual tools from the armorer
const tools = toolNames.map((name) => armorer.getTool(name)).filter(Boolean);
```

### Hybrid Search: Combining Pinecone with Toolbox Queries

For the best results, combine Pinecone's semantic search with Toolbox's built-in filtering:

```typescript
import { queryTools } from 'armorer/registry';

async function hybridToolSearch(
  query: string,
  filters?: { tags?: string[]; metadata?: Record<string, unknown> },
): Promise<Tool[]> {
  // Step 1: Get semantically similar tools from Pinecone
  const [queryEmbedding] = await embed([query]);
  const pineconeResults = await index.query({
    vector: queryEmbedding,
    topK: 20, // Get more candidates for filtering
    includeMetadata: true,
  });

  const candidateNames = new Set<string>();
  for (const match of pineconeResults.matches ?? []) {
    const toolName = match.metadata?.toolName as string;
    if (toolName) {
      candidateNames.add(toolName);
    }
  }

  // Step 2: Filter with Toolbox's query system
  const candidates = Array.from(candidateNames)
    .map((name) => armorer.getTool(name))
    .filter(Boolean);

  if (!filters) {
    return candidates;
  }

  // Apply additional filters using Toolbox's query system
  return queryTools(candidates, {
    tags: filters.tags ? { all: filters.tags } : undefined,
    metadata: filters.metadata ? { eq: filters.metadata } : undefined,
  });
}

// Usage: Find communication tools that are read-only
const tools = await hybridToolSearch('notify user', {
  tags: ['communication'],
  metadata: { readOnly: true },
});
```

### Pre-computing Embeddings

For faster startup, you can pre-compute embeddings and store them in tool metadata:

```typescript
// Pre-compute embeddings offline and store in metadata
const toolWithEmbeddings = createTool({
  name: 'send-email',
  description: 'Send an email to a recipient',
  schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  metadata: {
    // Pre-computed embeddings from Pinecone or OpenAI
    embeddings: [
      {
        field: 'name',
        text: 'send-email',
        vector: [0.1, 0.2, 0.3 /* ... 1536 dimensions */],
        magnitude: 1.0,
      },
      {
        field: 'description',
        text: 'Send an email to a recipient',
        vector: [0.2, 0.3, 0.4 /* ... 1536 dimensions */],
        magnitude: 1.0,
      },
    ],
  },
  async execute({ to, subject, body }) {
    return { sent: true };
  },
});

// When registered, Toolbox uses the pre-computed embeddings
// instead of calling the embed function
armorer.register(toolWithEmbeddings);
```

### Full Example: Pinecone-backed Tool Registry

Here's a complete example of a production-ready tool registry with Pinecone:

```typescript
import { createToolbox, createTool, type Tool } from 'armorer';
import { searchTools } from 'armorer/registry';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { z } from 'zod';

// Configuration
const PINECONE_INDEX = 'armorer-tools';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Initialize clients
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const openai = new OpenAI();

// Embedding function
async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

// Create Pinecone index if it doesn't exist
async function ensureIndex(): Promise<void> {
  const indexes = await pinecone.listIndexes();
  const exists = indexes.indexes?.some((idx) => idx.name === PINECONE_INDEX);

  if (!exists) {
    await pinecone.createIndex({
      name: PINECONE_INDEX,
      dimension: EMBEDDING_DIMENSIONS,
      metric: 'cosine',
      spec: {
        serverless: {
          cloud: 'aws',
          region: 'us-east-1',
        },
      },
    });

    // Wait for index to be ready
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// Main setup
async function createPineconeToolbox() {
  await ensureIndex();

  const index = pinecone.index(PINECONE_INDEX);
  const armorer = createToolbox([], { embed });

  // Sync tools to Pinecone on registration
  armorer.addEventListener('registered', async (event) => {
    const tool = event.detail;
    const fields = [
      { field: 'name', text: tool.name },
      { field: 'description', text: tool.description },
      { field: 'tags', text: tool.tags?.join(' ') ?? '' },
    ].filter((f) => f.text);

    const embeddings = await embed(fields.map((f) => f.text));

    await index.upsert(
      fields.map((field, i) => ({
        id: `${tool.name}:${field.field}`,
        values: embeddings[i],
        metadata: {
          toolName: tool.name,
          field: field.field,
          text: field.text,
          tags: tool.tags ?? [],
        },
      })),
    );
  });

  return {
    armorer,
    index,

    // Semantic search via Pinecone
    async search(query: string, limit = 10): Promise<Tool[]> {
      const [queryEmbedding] = await embed([query]);

      const results = await index.query({
        vector: queryEmbedding,
        topK: limit * 3, // Get extra for deduplication
        includeMetadata: true,
      });

      const seen = new Set<string>();
      const tools: Tool[] = [];

      for (const match of results.matches ?? []) {
        const toolName = match.metadata?.toolName as string;
        if (toolName && !seen.has(toolName)) {
          seen.add(toolName);
          const tool = armorer.getTool(toolName);
          if (tool) {
            tools.push(tool);
          }
          if (tools.length >= limit) break;
        }
      }

      return tools;
    },

    // Delete tool from Pinecone
    async deleteTool(toolName: string): Promise<void> {
      await index.deleteMany({
        filter: { toolName: { $eq: toolName } },
      });
    },
  };
}

// Usage
const { armorer, search } = await createPineconeToolbox();

// Register tools
createTool(
  {
    name: 'send-email',
    description: 'Send an email message to one or more recipients',
    schema: z.object({
      to: z.array(z.string().email()),
      subject: z.string(),
      body: z.string(),
    }),
    tags: ['communication', 'email'],
    async execute({ to, subject, body }) {
      console.log(`Sending email to ${to.join(', ')}`);
      return { sent: true, recipients: to.length };
    },
  },
  armorer,
);

createTool(
  {
    name: 'schedule-meeting',
    description: 'Create a calendar event and invite attendees',
    schema: z.object({
      title: z.string(),
      startTime: z.string().datetime(),
      duration: z.number().describe('Duration in minutes'),
      attendees: z.array(z.string().email()),
    }),
    tags: ['calendar', 'scheduling'],
    async execute({ title, startTime, duration, attendees }) {
      console.log(`Scheduling: ${title}`);
      return { scheduled: true, eventId: 'evt_123' };
    },
  },
  armorer,
);

// Semantic search
const tools = await search('I need to contact my team');
console.log(
  'Found tools:',
  tools.map((t) => t.name),
);
// Output: ['send-email', 'schedule-meeting']
```

## Embedding Best Practices

1. **Choose the right model**: `text-embedding-3-small` is a good balance of quality and cost. Use `text-embedding-3-large` for higher accuracy.

2. **Batch embedding requests**: When registering many tools, batch your embedding calls to reduce API latency.

3. **Cache embeddings**: Store pre-computed embeddings in tool metadata for faster startup.

4. **Use hybrid search**: Combine semantic search with Toolbox's tag and metadata filters for precise results.

5. **Index management**: Periodically reindex tools if their descriptions or metadata change using `reindexSearchIndex()`.

```typescript
import { reindexSearchIndex } from 'armorer/registry';

// Rebuild embeddings after updating tool metadata
reindexSearchIndex(armorer);
```

## Alternative Vector Databases

### LanceDB

For a serverless vector database that can run embedded (no separate server required), see the [LanceDB Integration](lancedb.md) guide. LanceDB is ideal for:

- Local development without cloud dependencies
- Desktop or edge applications
- Privacy-focused deployments with local embedding models

### Chroma

For an open-source embedding database with built-in embedding functions, see the [Chroma Integration](chroma.md) guide. Chroma is ideal for:

- Projects that want open-source flexibility
- Built-in support for OpenAI, Cohere, and HuggingFace embeddings
- Flexible deployment (embedded or client-server)
- Document content filtering alongside metadata filtering

## Comparison

| Feature             | Pinecone          | LanceDB        | Chroma          |
| ------------------- | ----------------- | -------------- | --------------- |
| Deployment          | Cloud only        | Embedded/Cloud | Embedded/Server |
| Open Source         | No                | Yes            | Yes             |
| Built-in embeddings | No                | No             | Yes             |
| Local development   | Requires internet | Native         | Native          |
| Managed scaling     | Yes               | No             | No              |

## Related Documentation

- [LanceDB Integration](lancedb.md) - Serverless vector database guide
- [Chroma Integration](chroma.md) - Open-source embedding database guide
- [Toolbox Registry](registry.md) - Querying and searching tools
- [API Reference](api-reference.md) - Complete type definitions for embeddings
