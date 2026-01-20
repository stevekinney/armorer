import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { defineTool } from '../src/core';

describe('defineTool', () => {
  it('defaults inputSchema to an empty object', () => {
    const tool = defineTool({
      name: 'default-schema',
      description: 'defaults schema',
    });

    expect(tool.inputSchema.parse({})).toEqual({});
  });

  it('accepts object shapes as inputSchema', () => {
    const tool = defineTool({
      name: 'shape-schema',
      description: 'shape schema',
      inputSchema: { foo: z.string() },
    });

    expect(tool.inputSchema.parse({ foo: 'bar' })).toEqual({ foo: 'bar' });
  });

  it('rejects non-object Zod schemas', () => {
    expect(() =>
      defineTool({
        name: 'string-schema',
        description: 'invalid schema',
        inputSchema: z.string(),
      }),
    ).toThrow('Tool schema must be a Zod object schema');
  });

  it('rejects invalid schema values', () => {
    expect(() =>
      defineTool({
        name: 'invalid-schema',
        description: 'invalid schema',
        inputSchema: 123 as unknown as z.ZodTypeAny,
      }),
    ).toThrow('Tool schema must be a Zod object schema or an object of Zod schemas');
  });
});
