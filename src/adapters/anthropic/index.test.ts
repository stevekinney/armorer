import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createQuartermaster, createTool } from '../../index';
import { toAnthropic } from './index';

describe('toAnthropic', () => {
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
    it('includes tool name', () => {
      const result = toAnthropic(tool);
      expect(result.name).toBe('search');
    });

    it('includes tool description', () => {
      const result = toAnthropic(tool);
      expect(result.description).toBe('Search for items');
    });

    it('includes input_schema with type object', () => {
      const result = toAnthropic(tool);
      expect(result.input_schema.type).toBe('object');
    });

    it('includes properties in input_schema', () => {
      const result = toAnthropic(tool);
      expect(result.input_schema.properties).toHaveProperty('query');
      expect(result.input_schema.properties).toHaveProperty('limit');
    });

    it('includes required fields', () => {
      const result = toAnthropic(tool);
      expect(result.input_schema.required).toContain('query');
    });

    it('sets additionalProperties to false', () => {
      const result = toAnthropic(tool);
      expect(result.input_schema.additionalProperties).toBe(false);
    });

    it('does not include type wrapper', () => {
      const result = toAnthropic(tool);
      expect(result).not.toHaveProperty('type');
    });
  });

  describe('array conversion', () => {
    it('returns array for array input', () => {
      const result = toAnthropic([tool, tool]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it('returns array for empty array', () => {
      const result = toAnthropic([]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('registry conversion', () => {
    it('returns array for registry input', () => {
      const qm = createQuartermaster().register(tool.toolConfiguration);
      const result = toAnthropic(qm);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });

    it('returns empty array for empty registry', () => {
      const qm = createQuartermaster();
      const result = toAnthropic(qm);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('tool config conversion', () => {
    it('works with tool configuration', () => {
      const result = toAnthropic(tool.toolConfiguration);
      expect(result.name).toBe('search');
      expect(result.input_schema.type).toBe('object');
    });
  });
});
