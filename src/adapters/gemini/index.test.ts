import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createArmorer, createTool } from '../../index';
import { toGemini } from './index';

describe('toGemini', () => {
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
    it('includes function name', () => {
      const result = toGemini(tool);
      expect(result.name).toBe('search');
    });

    it('includes function description', () => {
      const result = toGemini(tool);
      expect(result.description).toBe('Search for items');
    });

    it('includes parameters object', () => {
      const result = toGemini(tool);
      expect(result.parameters).toHaveProperty('type', 'object');
      expect(result.parameters).toHaveProperty('properties');
    });

    it('includes required fields', () => {
      const result = toGemini(tool);
      expect(result.parameters.required).toContain('query');
    });

    it('sets additionalProperties to false', () => {
      const result = toGemini(tool);
      expect(result.parameters['additionalProperties']).toBe(false);
    });

    it('does not include $schema property', () => {
      const result = toGemini(tool);
      expect(result.parameters).not.toHaveProperty('$schema');
    });
  });

  describe('array conversion', () => {
    it('returns array for array input', () => {
      const result = toGemini([tool, tool]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it('returns array for empty array', () => {
      const result = toGemini([]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('registry conversion', () => {
    it('returns array for registry input', () => {
      const armorer = createArmorer().register(tool);
      const result = toGemini(armorer);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });

    it('returns empty array for empty registry', () => {
      const armorer = createArmorer();
      const result = toGemini(armorer);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('tool config conversion', () => {
    it('works with tool configuration', () => {
      const result = toGemini(tool.configuration);
      expect(result.name).toBe('search');
      expect(result.parameters).toHaveProperty('type', 'object');
    });
  });

  describe('usage pattern', () => {
    it('can be wrapped in functionDeclarations', () => {
      const declarations = toGemini([tool]);
      const geminiTool = { functionDeclarations: declarations };

      expect(geminiTool.functionDeclarations).toHaveLength(1);
      expect(geminiTool.functionDeclarations[0]?.name).toBe('search');
    });
  });
});
