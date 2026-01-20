import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { combineArmorers, createArmorer } from '../src/runtime';

describe('combineArmorers', () => {
  it('throws when no armorers are provided', () => {
    const combine = combineArmorers as unknown as () => ReturnType<typeof createArmorer>;
    expect(() => combine()).toThrow('combineArmorers() requires at least 1 Armorer');
  });

  it('combines tools from multiple armorers', async () => {
    const a = createArmorer();
    a.register({
      name: 'tool-a',
      description: 'tool a',
      schema: z.object({}),
      execute: async () => 'A',
    });

    const b = createArmorer();
    b.register({
      name: 'tool-b',
      description: 'tool b',
      schema: z.object({}),
      execute: async () => 'B',
    });

    const combined = combineArmorers(a, b);

    const resA = await combined.execute({ id: 'a-1', name: 'tool-a', arguments: {} });
    const resB = await combined.execute({ id: 'b-1', name: 'tool-b', arguments: {} });

    expect(resA.result).toBe('A');
    expect(resB.result).toBe('B');
  });

  it('prefers later armorers on name collisions', async () => {
    const first = createArmorer();
    first.register({
      name: 'echo',
      description: 'echo',
      schema: z.object({ value: z.string() }),
      execute: async ({ value }) => `first:${value}`,
    });

    const second = createArmorer();
    second.register({
      name: 'echo',
      description: 'echo',
      schema: z.object({ value: z.string() }),
      execute: async ({ value }) => `second:${value}`,
    });

    const combined = combineArmorers(first, second);
    const res = await combined.execute({
      id: 'echo-1',
      name: 'echo',
      arguments: { value: 'hi' },
    });

    expect(res.result).toBe('second:hi');
  });

  it('merges contexts from all armorers (last wins)', async () => {
    const a = createArmorer([], {
      context: { workspaceId: 'ws-1', shared: 'a' },
    });
    a.register({
      name: 'ctx',
      description: 'ctx',
      schema: z.object({}),
      execute: async (_params, context) => {
        const ctx = context as Record<string, unknown>;
        return {
          workspaceId: ctx.workspaceId,
          role: ctx.role,
          shared: ctx.shared,
        };
      },
    });

    const b = createArmorer([], {
      context: { role: 'admin', shared: 'b' },
    });

    const combined = combineArmorers(a, b);
    const res = await combined.execute({ id: 'ctx-1', name: 'ctx', arguments: {} });

    expect(res.result).toEqual({
      workspaceId: 'ws-1',
      role: 'admin',
      shared: 'b',
    });
  });
});
