import { describe, expect,it } from 'bun:test';
import { z } from 'zod';

import {
  byForbiddenTags,
  bySchema,
  byTag,
  fuzzyText,
  matchesIntentTags,
  rankByIntent,
  schemaContainsKeys,
  scoreIntentMatch,
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

describe('query predicates', () => {
  it('matches tags when provided and falls back to match-all when empty', () => {
    const tagged = byTag(['alpha']);
    const none = byTag([]);
    expect(tagged(baseTool as any)).toBe(true);
    expect(byTag(['beta'])(baseTool as any)).toBe(false);
    expect(none(baseTool as any)).toBe(true);
  });

  it('byTag performs case-insensitive matching', () => {
    expect(byTag(['ALPHA'])(baseTool as any)).toBe(true);
    expect(byTag(['PRIMARY'])(baseTool as any)).toBe(true);
    expect(byTag(['Alpha', 'Primary'])(baseTool as any)).toBe(true);
  });

  it('matches fuzzy text across name, description, tags, and schema keys', () => {
    expect(fuzzyText('alpha')(baseTool as any)).toBe(true);
    expect(fuzzyText('handles')(baseTool as any)).toBe(true);
    expect(fuzzyText('primary')(baseTool as any)).toBe(true);
    expect(fuzzyText('fooId')(baseTool as any)).toBe(true);
    expect(fuzzyText('missing')(baseTool as any)).toBe(false);
    expect(fuzzyText('   ')(baseTool as any)).toBe(true);
  });

  it('ensures provided schema keys are present while tolerating empty input', () => {
    const predicate = schemaContainsKeys(['fooId', 'barValue']);
    expect(predicate(baseTool as any)).toBe(true);
    expect(schemaContainsKeys(['unknown'])(baseTool as any)).toBe(false);
    expect(schemaContainsKeys([])(baseTool as any)).toBe(true);
  });

  it('performs loose schema comparisons', () => {
    const matching = bySchema(z.object({ fooId: z.string() }));
    const nonMatching = bySchema(z.object({ baz: z.string() }));
    expect(matching(baseTool as any)).toBe(true);
    expect(nonMatching(baseTool as any)).toBe(false);
  });
});

describe('byForbiddenTags', () => {
  it('excludes tools with any forbidden tag', () => {
    const predicate = byForbiddenTags(['alpha']);
    expect(predicate(baseTool as any)).toBe(false);
  });

  it('includes tools without forbidden tags', () => {
    const predicate = byForbiddenTags(['beta', 'gamma']);
    expect(predicate(baseTool as any)).toBe(true);
  });

  it('returns match-all when forbidden tags is empty', () => {
    const predicate = byForbiddenTags([]);
    expect(predicate(baseTool as any)).toBe(true);
  });

  it('performs case-insensitive matching', () => {
    const predicate = byForbiddenTags(['ALPHA', 'PRIMARY']);
    expect(predicate(baseTool as any)).toBe(false);
  });

  it('handles tools with no tags', () => {
    const noTagsTool = { ...baseTool, tags: undefined };
    const predicate = byForbiddenTags(['alpha']);
    expect(predicate(noTagsTool as any)).toBe(true);
  });
});

describe('matchesIntentTags', () => {
  it('returns true if tool has any matching intent tag', () => {
    expect(matchesIntentTags(baseTool as any, ['alpha'])).toBe(true);
    expect(matchesIntentTags(baseTool as any, ['primary'])).toBe(true);
    expect(matchesIntentTags(baseTool as any, ['alpha', 'beta'])).toBe(true);
  });

  it('returns false if tool has no matching intent tag', () => {
    expect(matchesIntentTags(baseTool as any, ['beta'])).toBe(false);
    expect(matchesIntentTags(baseTool as any, ['gamma', 'delta'])).toBe(false);
  });

  it('returns true for empty or undefined intent tags', () => {
    expect(matchesIntentTags(baseTool as any, [])).toBe(true);
    expect(matchesIntentTags(baseTool as any, undefined)).toBe(true);
  });

  it('performs case-insensitive matching', () => {
    expect(matchesIntentTags(baseTool as any, ['ALPHA'])).toBe(true);
    expect(matchesIntentTags(baseTool as any, ['PRIMARY'])).toBe(true);
  });

  it('returns false for tools with no tags when intent tags are specified', () => {
    const noTagsTool = { ...baseTool, tags: undefined };
    expect(matchesIntentTags(noTagsTool as any, ['alpha'])).toBe(false);
  });
});

describe('scoreIntentMatch', () => {
  it('scores based on number of matching tags', () => {
    expect(scoreIntentMatch(baseTool as any, ['alpha'])).toBe(1);
    expect(scoreIntentMatch(baseTool as any, ['alpha', 'primary'])).toBe(2);
    expect(scoreIntentMatch(baseTool as any, ['alpha', 'primary', 'beta'])).toBe(2);
  });

  it('returns 0 for no matches', () => {
    expect(scoreIntentMatch(baseTool as any, ['beta'])).toBe(0);
    expect(scoreIntentMatch(baseTool as any, ['gamma', 'delta'])).toBe(0);
  });

  it('returns 0 for empty or undefined intent tags', () => {
    expect(scoreIntentMatch(baseTool as any, [])).toBe(0);
    expect(scoreIntentMatch(baseTool as any, undefined)).toBe(0);
  });

  it('performs case-insensitive matching', () => {
    expect(scoreIntentMatch(baseTool as any, ['ALPHA', 'PRIMARY'])).toBe(2);
  });

  it('returns 0 for tools with no tags when intent tags are specified', () => {
    const noTagsTool = { ...baseTool, tags: undefined };
    expect(scoreIntentMatch(noTagsTool as any, ['alpha'])).toBe(0);
  });

  it('does not inflate score for duplicate tool tags', () => {
    const duplicateTagsTool = { ...baseTool, tags: ['alpha', 'alpha', 'primary'] };
    expect(scoreIntentMatch(duplicateTagsTool as any, ['alpha'])).toBe(1);
    expect(scoreIntentMatch(duplicateTagsTool as any, ['alpha', 'primary'])).toBe(2);
  });

  it('does not inflate score for duplicate intent tags', () => {
    expect(scoreIntentMatch(baseTool as any, ['alpha', 'alpha'])).toBe(1);
    expect(scoreIntentMatch(baseTool as any, ['alpha', 'ALPHA', 'primary'])).toBe(2);
    expect(scoreIntentMatch(baseTool as any, ['alpha', 'alpha', 'alpha'])).toBe(1);
  });
});

describe('rankByIntent', () => {
  const tools = [
    { name: 'tool-a', tags: ['beta'] },
    { name: 'tool-b', tags: ['alpha', 'primary'] },
    { name: 'tool-c', tags: ['alpha'] },
    { name: 'tool-d', tags: [] },
  ] as any[];

  it('ranks tools by intent score descending', () => {
    const ranked = rankByIntent(tools, ['alpha', 'primary']);
    expect(ranked.map((t) => t.name)).toEqual(['tool-b', 'tool-c', 'tool-a', 'tool-d']);
  });

  it('returns tools unchanged for empty intent tags', () => {
    const ranked = rankByIntent(tools, []);
    expect(ranked.map((t) => t.name)).toEqual(['tool-a', 'tool-b', 'tool-c', 'tool-d']);
  });

  it('returns tools unchanged for undefined intent tags', () => {
    const ranked = rankByIntent(tools, undefined);
    expect(ranked.map((t) => t.name)).toEqual(['tool-a', 'tool-b', 'tool-c', 'tool-d']);
  });

  it('preserves original array', () => {
    const original = [...tools];
    rankByIntent(tools, ['alpha']);
    expect(tools.map((t) => t.name)).toEqual(original.map((t) => t.name));
  });
});
