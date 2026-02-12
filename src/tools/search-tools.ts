import { z } from 'zod';

import {
  searchTools,
  type ToolQueryInput,
  type ToolSearchOptions,
} from '../core/registry';
import { createTool } from '../create-tool';
import type { Tool } from '../is-tool';

type SearchableToolbox = {
  tools: () => readonly Tool[];
};

/**
 * Options for configuring the search tool.
 */
export interface CreateSearchToolOptions {
  /**
   * Default maximum number of tools to return.
   * Can be overridden per-search.
   * @default 10
   */
  limit?: number;

  /**
   * Include matching reasons in results for debugging.
   * @default false
   */
  explain?: boolean;

  /**
   * Custom name for the tool.
   * @default 'search-tools'
   */
  name?: string;

  /**
   * Custom description for the tool.
   */
  description?: string;

  /**
   * Additional tags to add to the tool.
   */
  tags?: string[];
}

/**
 * Result of a tool search.
 */
export interface SearchToolsResult {
  /** Name of the tool */
  name: string;
  /** Description of what the tool does */
  description: string;
  /** Tags associated with the tool */
  tags?: readonly string[];
  /** Search relevance score (higher is more relevant) */
  score: number;
  /** Reasons for the match (when explain is enabled) */
  reasons?: string[];
}

/**
 * Input parameters for the search tools tool.
 */
export interface SearchToolsInput {
  /** The search query to find relevant tools */
  query: string;
  /** Maximum number of tools to return (overrides default) */
  limit?: number;
  /** Filter by tags (tools must have at least one of these tags) */
  tags?: string[];
}

/**
 * Creates a pre-configured tool that searches for other tools in a Toolbox instance.
 *
 * This tool enables semantic search when embeddings are configured on the toolbox,
 * or falls back to text-based fuzzy matching otherwise. It's useful for:
 * - Agentic workflows where the LLM needs to discover available tools
 * - Large tool registries where not all tools are passed in every request
 * - Building meta-tools that help users find the right tool for their task
 *
 * @example
 * ```typescript
 * import { createToolbox } from 'armorer';
 * import { createSearchTool } from 'armorer/tools';
 *
 * const toolbox = createToolbox();
 *
 * // Create the search tool
 * const searchTool = createSearchTool(toolbox);
 *
 * // Now the LLM can search for tools
 * const results = await searchTool({ query: 'send message to someone' });
 * // Returns: [{ name: 'send-email', description: '...', score: 0.85 }, ...]
 * ```
 *
 * @example With embeddings for semantic search
 * ```typescript
 * import { createToolbox } from 'armorer';
 * import { createSearchTool } from 'armorer/tools';
 * import OpenAI from 'openai';
 *
 * const openai = new OpenAI();
 *
 * const toolbox = createToolbox([], {
 *   embed: async (texts) => {
 *     const response = await openai.embeddings.create({
 *       model: 'text-embedding-3-small',
 *       input: texts,
 *     });
 *     return response.data.map((item) => item.embedding);
 *   },
 * });
 *
 * // With embeddings, searches are semantic
 * const searchTool = createSearchTool(toolbox);
 * const results = await searchTool({ query: 'notify user' });
 * // Finds 'send-email' even though 'notify' isn't in the name/description
 * ```
 *
 * @param toolbox - The Toolbox instance to search within
 * @param options - Configuration options
 * @returns A tool that can search for other tools
 */
export function createSearchTool(
  toolbox: SearchableToolbox,
  options: CreateSearchToolOptions = {},
): Tool {
  const {
    limit: defaultLimit = 10,
    explain = false,
    name = 'search-tools',
    description = 'Search for available tools by query. Returns tools that match the search query, using semantic search when embeddings are configured or text-based search otherwise.',
    tags: additionalTags = [],
  } = options;

  return createTool({
    name,
    description,
    schema: z.object({
      query: z.string().describe('The search query to find relevant tools'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum number of tools to return'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Filter by tags (tools must have at least one of these tags)'),
    }),
    tags: ['utility', 'search', 'readonly', ...additionalTags],
    metadata: { readOnly: true },
    async execute({ query, limit: queryLimit, tags }): Promise<SearchToolsResult[]> {
      const searchOptions: ToolSearchOptions & { select?: 'tool' } = {
        rank: {
          text: { query, mode: 'fuzzy' },
          ...(tags?.length ? { tags } : {}),
        },
        limit: queryLimit ?? defaultLimit,
        explain,
      };

      if (tags?.length) {
        searchOptions.filter = {
          tags: { any: tags },
        };
      }

      const results = await Promise.resolve(
        searchTools(toolbox as unknown as ToolQueryInput, searchOptions),
      );

      return results.map((match) => ({
        name: match.tool.identity.name,
        description: match.tool.display.description,
        ...(match.tool.tags?.length ? { tags: match.tool.tags } : {}),
        score: match.score,
        ...(explain && match.reasons.length ? { reasons: match.reasons } : {}),
      }));
    },
  });
}

/**
 * Type alias for the search tools tool.
 */
export type SearchTool = ReturnType<typeof createSearchTool>;
