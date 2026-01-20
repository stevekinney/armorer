import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createRegistry, defineTool } from '../src/core';
import { createArmorer } from '../src/create-armorer';
import { createTool } from '../src/create-tool';
import { queryTools, reindexSearchIndex, searchTools } from '../src/registry';

const makeTool = (
  name: string,
  overrides: Partial<Parameters<typeof createTool>[0]> = {},
) =>
  createTool({
    name,
    description: `${name} tool`,
    schema: z.object({ value: z.number() }),
    execute: async ({ value }) => ({ value }),
    ...overrides,
  });

describe('registry helpers', () => {
  it('accepts tool, array, and iterable inputs', () => {
    const tool = makeTool('solo');

    expect(queryTools(tool).map((entry) => entry.name)).toEqual(['solo']);
    expect(queryTools([tool]).map((entry) => entry.name)).toEqual(['solo']);
    expect(queryTools(new Set([tool])).map((entry) => entry.name)).toEqual(['solo']);
  });

  it('throws on invalid query input', () => {
    expect(() => queryTools(123 as any)).toThrow('queryTools expects a ToolQuery input');
  });

  it('reindexes embeddings when configured', () => {
    let calls = 0;
    const embed = (texts: string[]) => {
      calls += 1;
      return texts.map(() => [1, 0]);
    };
    const armorer = createArmorer([], { embed });
    armorer.register(makeTool('reindex'));

    // Initial registration should have called the embedder
    expect(calls).toBe(1);

    // Reindexing with cached embeddings should not make additional calls
    // because the cached embedder returns stored results for the same texts
    reindexSearchIndex(armorer);
    expect(calls).toBe(1);

    // Register a new tool and verify embedder is called again for new content
    armorer.register(makeTool('new-tool'));
    expect(calls).toBe(2);
  });

  it('treats empty text queries as match-all', () => {
    const armorer = createArmorer();
    armorer.register(makeTool('alpha'), makeTool('beta'));

    const results = queryTools(armorer, { text: '   ' });
    expect(results.map((tool) => tool.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('supports AND query groups', () => {
    const armorer = createArmorer();
    armorer.register(
      makeTool('alpha', { tags: ['fast'] }),
      makeTool('beta', { tags: ['slow'] }),
    );

    const results = queryTools(armorer, {
      and: [{ tags: { any: ['fast'] } }, { text: 'alpha' }],
    });
    expect(results.map((tool) => tool.name)).toEqual(['alpha']);
  });

  it('supports config and summary selection', () => {
    const armorer = createArmorer();
    const tool = makeTool('meta', {
      tags: ['fast'],
      metadata: { tier: 'pro' },
    });
    armorer.register(tool);

    const configs = queryTools(armorer, { select: 'config' });
    expect(configs[0]?.name).toBe('meta');

    const summaries = queryTools(armorer, {
      select: 'summary',
      includeSchema: true,
      includeToolConfig: true,
    });
    expect(summaries[0]?.metadata).toEqual({ tier: 'pro' });
    expect(summaries[0]?.schema).toBe(tool.schema);
    expect(summaries[0]?.configuration?.name).toBe('meta');
  });

  it('supports name and config selections in search', () => {
    const armorer = createArmorer();
    armorer.register(makeTool('alpha'), makeTool('beta'));

    const names = searchTools(armorer, { select: 'name' });
    expect(typeof names[0]?.tool).toBe('string');

    const configs = searchTools(armorer, { select: 'config' });
    expect(configs[0]?.tool.name).toBeDefined();
  });

  it('includes tag matches in explain details', () => {
    const armorer = createArmorer();
    armorer.register(makeTool('tagged', { tags: ['fast'] }));

    const results = searchTools(armorer, {
      rank: { tags: ['fast'] },
      explain: true,
    });

    expect(results[0]?.matches?.tags).toEqual(['fast']);
  });

  it('supports ranker exclude and match merging', () => {
    const armorer = createArmorer();
    armorer.register(
      makeTool('keep', { tags: ['fast'], metadata: { tier: 'pro' } }),
      makeTool('skip'),
    );

    const results = searchTools(armorer, {
      rank: { tags: ['fast'], text: 'keep' },
      explain: true,
      ranker: (tool) => {
        if (tool.name === 'skip') {
          return { exclude: true };
        }
        return {
          score: 2,
          reasons: ['bonus'],
          matches: {
            fields: ['name'],
            tags: ['fast'],
            schemaKeys: ['value'],
            metadataKeys: ['tier'],
            embedding: { field: 'name', score: 0.8 },
          },
        };
      },
    });

    expect(results.map((match) => match.tool.name)).toEqual(['keep']);
    expect(results[0]?.matches?.tags).toContain('fast');
    expect(results[0]?.matches?.metadataKeys).toContain('tier');
  });

  it('supports numeric ranker scores and tieBreaker none', () => {
    const armorer = createArmorer();
    armorer.register(makeTool('alpha'), makeTool('beta'));

    const results = searchTools(armorer, {
      ranker: () => 1,
      tieBreaker: 'none',
    });

    expect(results).toHaveLength(2);
  });

  it('treats empty schema and tag filters as match-all', () => {
    const armorer = createArmorer();
    armorer.register(makeTool('alpha'), makeTool('beta'));

    const bySchema = queryTools(armorer, { schema: { keys: [''] } });
    expect(bySchema).toHaveLength(2);

    const byAnyTags = queryTools(armorer, { tags: { any: [''] } });
    expect(byAnyTags).toHaveLength(2);

    const byAllTags = queryTools(armorer, { tags: { all: [''] } });
    expect(byAllTags).toHaveLength(2);
  });

  it('handles metadata filter edge cases', () => {
    const armorer = createArmorer();
    armorer.register(
      makeTool('meta', {
        metadata: {
          flags: ['alpha', 'beta'],
          owner: 'team-core',
          score: 10,
          enabled: true,
          temp: 'hot',
        },
      }),
      makeTool('plain'),
    );

    const byFlags = queryTools(armorer, {
      metadata: { contains: { flags: ['alpha'] } },
    });
    expect(byFlags.map((tool) => tool.name)).toEqual(['meta']);

    const byBoolean = queryTools(armorer, {
      metadata: { contains: { enabled: 'yes' } },
    });
    expect(byBoolean).toHaveLength(0);

    const byStartsWith = queryTools(armorer, {
      metadata: { startsWith: { owner: 'team-' } },
    });
    expect(byStartsWith.map((tool) => tool.name)).toEqual(['meta']);

    const byRangeMax = queryTools(armorer, {
      metadata: { range: { score: { max: 5 } } },
    });
    expect(byRangeMax).toHaveLength(0);

    const byRangeNonNumber = queryTools(armorer, {
      metadata: { range: { temp: { min: 1 } } },
    });
    expect(byRangeNonNumber).toHaveLength(0);
  });

  it('handles embedding edge cases without crashing', () => {
    const embed = (texts: string[]) =>
      texts.map((text) => (text.includes('query') ? [1, 0] : [NaN]));
    const armorer = createArmorer([], { embed });
    armorer.register(makeTool('invalid-embedding'));

    const results = searchTools(armorer, { rank: { text: 'query' } });
    expect(results).toHaveLength(1);
  });

  it('skips embedding scores when vector lengths mismatch', () => {
    const embed = (texts: string[]) =>
      texts.map((text) => (text.includes('query') ? [1, 0, 0] : [1, 0]));
    const armorer = createArmorer([], { embed });
    armorer.register(makeTool('length-mismatch'));

    const results = searchTools(armorer, { rank: { text: 'query' } });
    expect(results).toHaveLength(1);
  });

  it('handles sparse embedding vectors', () => {
    const embed = (texts: string[]) => texts.map(() => Array(2) as number[]);
    const armorer = createArmorer([], { embed });
    armorer.register(makeTool('sparse'));

    const results = searchTools(armorer, { rank: { text: 'query' } });
    expect(results).toHaveLength(1);
  });

  describe('core registry versioning and aliases', () => {
    const makeDefinition = (name: string, version: string, deprecated = false) =>
      defineTool({
        name,
        version,
        description: `${name} tool`,
        inputSchema: z.object({ value: z.string() }),
        lifecycle: deprecated ? { deprecated: true } : undefined,
      });

    it('requires a version for get when using identity or string', () => {
      const registry = createRegistry();
      registry.register(makeDefinition('alpha', '1.0.0'));
      expect(() => registry.get({ name: 'alpha' })).toThrow(
        'Tool identity must include a version for get/unregister',
      );
      expect(() => registry.get('default:alpha')).toThrow(
        'Tool identity must include a version for get/unregister',
      );
    });

    it('resolves highest semver by default', () => {
      const registry = createRegistry();
      registry.register(makeDefinition('alpha', '1.0.0'));
      registry.register(makeDefinition('alpha', '2.1.0'));

      const resolved = registry.resolve({ name: 'alpha' });
      expect(resolved?.identity.version).toBe('2.1.0');
    });

    it('falls back to registration order for non-semver versions', () => {
      const registry = createRegistry();
      registry.register(makeDefinition('beta', 'alpha'));
      registry.register(makeDefinition('beta', 'beta'));

      const resolved = registry.resolve({ name: 'beta' });
      expect(resolved?.identity.version).toBe('beta');
    });

    it('skips deprecated tools unless allowDeprecated is true', () => {
      const registry = createRegistry();
      registry.register(makeDefinition('gamma', '1.0.0'));
      registry.register(makeDefinition('gamma', '2.0.0', true));

      const resolved = registry.resolve({ name: 'gamma' });
      expect(resolved?.identity.version).toBe('1.0.0');

      const resolvedAllow = registry.resolve(
        { name: 'gamma' },
        { allowDeprecated: true },
      );
      expect(resolvedAllow?.identity.version).toBe('2.0.0');
    });

    it('resolves aliases and detects cycles', () => {
      const registry = createRegistry();
      const primary = makeDefinition('delta', '1.0.0');
      registry.register(primary, { aliases: ['default:delta-alias@1.0.0'] });
      expect(registry.resolve('default:delta-alias@1.0.0')?.id).toBe(primary.id);

      const cycleRegistry = createRegistry();
      const aliasOwner = makeDefinition('alias', '1.0.0');
      cycleRegistry.register(primary, { aliases: [aliasOwner.id] });
      cycleRegistry.register(aliasOwner, { aliases: [primary.id] });
      expect(() => cycleRegistry.resolve(primary.id)).toThrow('Alias cycle detected');
    });
  });
});
