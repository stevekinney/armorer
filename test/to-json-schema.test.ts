import { describe, expect,it } from 'bun:test';
import { z } from 'zod';

import { toJSONSchema } from '../src/to-json-schema';

// Create a mock schema that will cause z.toJSONSchema to throw
const createMockSchemaWithBrokenJSONSchema = () => {
  const schema = z.object({ key: z.string() });
  // Modify the schema in a way that breaks z.toJSONSchema
  const broken = Object.create(schema);
  // Override to make toJSONSchema fail
  Object.defineProperty(broken, '_def', {
    get() {
      throw new Error('Simulated schema conversion error');
    },
    configurable: true,
  });
  // But keep shape accessible for fallback
  broken.shape = { key: z.string() };
  return broken;
};

// Create a schema-like object with _def.shape for fallback extraction
const createSchemaWithDefShape = () => {
  return {
    _def: {
      shape: { name: z.string(), count: z.number() },
    },
  };
};

// Create a schema-like object with _def.shape as a function
const createSchemaWithDefShapeFunction = () => {
  return {
    _def: {
      shape: () => ({ city: z.string(), population: z.number() }),
    },
  };
};

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

    expect(result.type).toBe('function');
    expect(result.name).toBe('greet');
    expect(result.description).toBe('Greet someone');
    expect(result.strict).toBe(true);
    expect(result.parameters).toBeDefined();
    expect((result.parameters as any).type).toBe('object');
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

  describe('fallback behavior', () => {
    it('falls back to extractShapeKeys when z.toJSONSchema throws', () => {
      const tool = {
        name: 'fallback-test',
        description: 'Test fallback',
        schema: createSchemaWithDefShape() as any,
      };

      const result = toJSONSchema(tool);

      expect(result.type).toBe('function');
      expect(result.name).toBe('fallback-test');
      expect((result.parameters as any).type).toBe('object');
      expect((result.parameters as any).required).toEqual(['name', 'count']);
      expect((result.parameters as any).additionalProperties).toBe(false);
    });

    it('handles _def.shape as a function in fallback', () => {
      const tool = {
        name: 'shape-fn-test',
        description: 'Test shape function',
        schema: createSchemaWithDefShapeFunction() as any,
      };

      const result = toJSONSchema(tool);

      expect((result.parameters as any).required).toEqual(['city', 'population']);
    });

    it('returns empty properties when schema has no extractable shape', () => {
      const tool = {
        name: 'no-shape',
        description: 'No shape',
        schema: {} as any,
      };

      const result = toJSONSchema(tool);

      expect((result.parameters as any).required).toEqual([]);
      expect((result.parameters as any).properties).toEqual({});
    });

    it('handles undefined _def in fallback', () => {
      const tool = {
        name: 'undef-def',
        description: 'Undefined def',
        schema: { _def: undefined } as any,
      };

      const result = toJSONSchema(tool);

      expect((result.parameters as any).required).toEqual([]);
    });
  });
});
