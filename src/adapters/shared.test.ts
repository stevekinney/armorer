import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createQuartermaster, createTool } from '../index';
import {
  isQuartermaster,
  isSingleInput,
  isToolConfig,
  normalizeToToolConfigs,
} from './shared';

describe('shared adapter utilities', () => {
  const testSchema = z.object({ message: z.string() });
  const testTool = createTool({
    name: 'test-tool',
    description: 'A test tool',
    schema: testSchema,
    execute: async () => 'result',
  });

  const testConfig = testTool.toolConfiguration;

  describe('isQuartermaster', () => {
    it('returns true for Quartermaster instance', () => {
      const qm = createQuartermaster();
      expect(isQuartermaster(qm)).toBe(true);
    });

    it('returns false for tools', () => {
      expect(isQuartermaster(testTool)).toBe(false);
    });

    it('returns false for tool configs', () => {
      expect(isQuartermaster(testConfig)).toBe(false);
    });

    it('returns false for arrays', () => {
      expect(isQuartermaster([testTool])).toBe(false);
    });

    it('returns false for null', () => {
      expect(isQuartermaster(null)).toBe(false);
    });
  });

  describe('isToolConfig', () => {
    it('returns true for ToolConfig', () => {
      expect(isToolConfig(testConfig)).toBe(true);
    });

    it('returns false for QuartermasterTool', () => {
      expect(isToolConfig(testTool)).toBe(false);
    });

    it('returns false for Quartermaster', () => {
      const qm = createQuartermaster();
      expect(isToolConfig(qm)).toBe(false);
    });
  });

  describe('normalizeToToolConfigs', () => {
    it('handles single tool', () => {
      const configs = normalizeToToolConfigs(testTool);
      expect(configs).toHaveLength(1);
      expect(configs[0]?.name).toBe('test-tool');
    });

    it('handles single config', () => {
      const configs = normalizeToToolConfigs(testConfig);
      expect(configs).toHaveLength(1);
      expect(configs[0]?.name).toBe('test-tool');
    });

    it('handles array of tools', () => {
      const configs = normalizeToToolConfigs([testTool, testTool]);
      expect(configs).toHaveLength(2);
    });

    it('handles array of configs', () => {
      const configs = normalizeToToolConfigs([testConfig, testConfig]);
      expect(configs).toHaveLength(2);
    });

    it('handles mixed array', () => {
      const configs = normalizeToToolConfigs([testTool, testConfig]);
      expect(configs).toHaveLength(2);
    });

    it('handles Quartermaster registry', () => {
      const qm = createQuartermaster().register(testConfig);
      const configs = normalizeToToolConfigs(qm);
      expect(configs).toHaveLength(1);
      expect(configs[0]?.name).toBe('test-tool');
    });

    it('handles empty registry', () => {
      const qm = createQuartermaster();
      const configs = normalizeToToolConfigs(qm);
      expect(configs).toHaveLength(0);
    });
  });

  describe('isSingleInput', () => {
    it('returns true for single tool', () => {
      expect(isSingleInput(testTool)).toBe(true);
    });

    it('returns true for single config', () => {
      expect(isSingleInput(testConfig)).toBe(true);
    });

    it('returns false for array', () => {
      expect(isSingleInput([testTool])).toBe(false);
    });

    it('returns false for registry', () => {
      const qm = createQuartermaster();
      expect(isSingleInput(qm)).toBe(false);
    });
  });
});
