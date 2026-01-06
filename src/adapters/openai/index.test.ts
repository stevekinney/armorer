import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createArmorer, createTool } from '../../index';
import { toOpenAI } from './index';

describe('toOpenAI', () => {
  const schema = z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().describe('Max results'),
  });

  const tool = createTool({
    name: 'search',
    description: 'Search for items',
    schema,
    execute: async () => [],
    tags: ['search', 'utility'],
  });

  describe('single tool conversion', () => {
    it('returns correct type', () => {
      const result = toOpenAI(tool);
      expect(result.type).toBe('function');
    });

    it('includes function name', () => {
      const result = toOpenAI(tool);
      expect(result.function.name).toBe('search');
    });

    it('includes function description', () => {
      const result = toOpenAI(tool);
      expect(result.function.description).toBe('Search for items');
    });

    it('includes strict mode', () => {
      const result = toOpenAI(tool);
      expect(result.function.strict).toBe(true);
    });

    it('includes parameters object', () => {
      const result = toOpenAI(tool);
      expect(result.function.parameters).toHaveProperty('type', 'object');
      expect(result.function.parameters).toHaveProperty('properties');
    });

    it('includes required fields', () => {
      const result = toOpenAI(tool);
      expect(result.function.parameters.required).toContain('query');
    });

    it('sets additionalProperties to false', () => {
      const result = toOpenAI(tool);
      expect(result.function.parameters.additionalProperties).toBe(false);
    });
  });

  describe('array conversion', () => {
    it('returns array for array input', () => {
      const result = toOpenAI([tool, tool]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it('returns array for empty array', () => {
      const result = toOpenAI([]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('registry conversion', () => {
    it('returns array for registry input', () => {
      const armorer = createArmorer().register(tool);
      const result = toOpenAI(armorer);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });

    it('returns empty array for empty registry', () => {
      const armorer = createArmorer();
      const result = toOpenAI(armorer);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('tool config conversion', () => {
    it('works with tool configuration', () => {
      const result = toOpenAI(tool.configuration);
      expect(result.type).toBe('function');
      expect(result.function.name).toBe('search');
    });
  });
});
