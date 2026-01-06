import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import {
  schemaHasKeys,
  schemaMatches,
  tagsMatchAll,
  tagsMatchAny,
  tagsMatchNone,
  textMatches,
} from '../src/query-predicates';

const baseTool = {
  name: 'alpha-sum',
  description: 'Handles alpha computations',
  schema: z.object({
    fooId: z.string(),
    barValue: z.number().optional(),
  }),
  tags: ['alpha', 'primary'],
} as const;

describe('tagsMatchAny', () => {
  it('matches any provided tags and falls back to match-all when empty', () => {
    expect(tagsMatchAny(['alpha'])(baseTool as any)).toBe(true);
    expect(tagsMatchAny(['beta'])(baseTool as any)).toBe(false);
    expect(tagsMatchAny([])(baseTool as any)).toBe(true);
  });

  it('performs case-insensitive matching', () => {
    expect(tagsMatchAny(['ALPHA'])(baseTool as any)).toBe(true);
    expect(tagsMatchAny(['PRIMARY'])(baseTool as any)).toBe(true);
  });
});

describe('tagsMatchAll', () => {
  it('requires all tags to be present', () => {
    expect(tagsMatchAll(['alpha', 'primary'])(baseTool as any)).toBe(true);
    expect(tagsMatchAll(['alpha', 'missing'])(baseTool as any)).toBe(false);
  });

  it('returns match-all when tag list is empty', () => {
    expect(tagsMatchAll([])(baseTool as any)).toBe(true);
  });
});

describe('tagsMatchNone', () => {
  it('excludes tools that contain any of the tags', () => {
    expect(tagsMatchNone(['alpha'])(baseTool as any)).toBe(false);
    expect(tagsMatchNone(['beta'])(baseTool as any)).toBe(true);
  });

  it('handles tools without tags', () => {
    const noTagsTool = { ...baseTool, tags: undefined };
    expect(tagsMatchNone(['alpha'])(noTagsTool as any)).toBe(true);
  });

  it('returns match-all when tag list is empty', () => {
    expect(tagsMatchNone([])(baseTool as any)).toBe(true);
  });
});

describe('textMatches', () => {
  it('matches fuzzy text across name, description, tags, and schema keys', () => {
    expect(textMatches('alpha')(baseTool as any)).toBe(true);
    expect(textMatches('handles')(baseTool as any)).toBe(true);
    expect(textMatches('primary')(baseTool as any)).toBe(true);
    expect(textMatches('fooId')(baseTool as any)).toBe(true);
    expect(textMatches('missing')(baseTool as any)).toBe(false);
  });

  it('returns match-all when query is empty', () => {
    expect(textMatches('   ')(baseTool as any)).toBe(true);
  });
});

describe('schemaMatches', () => {
  it('performs loose schema comparisons', () => {
    const matching = schemaMatches(z.object({ fooId: z.string() }));
    const nonMatching = schemaMatches(z.object({ baz: z.string() }));
    expect(matching(baseTool as any)).toBe(true);
    expect(nonMatching(baseTool as any)).toBe(false);
  });
});

describe('schemaHasKeys', () => {
  it('requires all provided keys', () => {
    const predicate = schemaHasKeys(['fooId', 'barValue']);
    expect(predicate(baseTool as any)).toBe(true);
    expect(schemaHasKeys(['unknown'])(baseTool as any)).toBe(false);
  });

  it('returns match-all for empty keys', () => {
    expect(schemaHasKeys([])(baseTool as any)).toBe(true);
  });
});
