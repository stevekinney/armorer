import { describe, expect,it } from 'bun:test';
import { z } from 'zod';

import { toJSONSchema } from '../src/to-json-schema';

describe('toJSONSchema', () => {
  it('converts a simple Zod schema to JSON Schema', () => {
    const tool = {
      name: 'greet',
      description: 'Greet someone',
      schema: z.object({
        name: z.string(),
        age: z.number().optional(),
      }),
    };

    const result = toJSONSchema(tool);
    const required = (result.parameters as any).required as string[] | undefined;

    expect(result.type).toBe('function');
    expect(result.name).toBe('greet');
    expect(result.description).toBe('Greet someone');
    expect(result.strict).toBe(true);
    expect(result.parameters).toBeDefined();
    expect((result.parameters as any).type).toBe('object');
    expect(required).toEqual(['name']);
  });

  it('removes $schema from the output', () => {
    const tool = {
      name: 'test',
      description: 'Test tool',
      schema: z.object({ value: z.string() }),
    };

    const result = toJSONSchema(tool);

    expect(result.parameters).not.toHaveProperty('$schema');
  });

  it('sets additionalProperties to false', () => {
    const tool = {
      name: 'test',
      description: 'Test tool',
      schema: z.object({ value: z.string() }),
    };

    const result = toJSONSchema(tool);

    expect((result.parameters as any).additionalProperties).toBe(false);
  });

  it('includes all properties in required array', () => {
    const tool = {
      name: 'test',
      description: 'Test tool',
      schema: z.object({
        name: z.string(),
        count: z.number(),
      }),
    };

    const result = toJSONSchema(tool);

    expect((result.parameters as any).required).toEqual(['name', 'count']);
  });

});
