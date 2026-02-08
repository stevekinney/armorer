import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createToolbox } from '../../runtime/create-armorer';
import { createTool } from '../../runtime/create-tool';
import { formatToolResults, parseToolCalls, toOpenAI } from './index';

describe('toOpenAI', () => {
  const tool = createTool({
    name: 'test-tool',
    description: 'A test tool',
    schema: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results'),
    }),
    execute: async (params) => params,
  });

  describe('single tool conversion', () => {
    const openAI = toOpenAI(tool);

    it('returns correct type', () => {
      expect(openAI.type).toBe('function');
    });

    it('includes function name', () => {
      expect(openAI.function.name).toBe('test-tool');
    });

    it('includes function description', () => {
      expect(openAI.function.description).toBe('A test tool');
    });

    it('includes strict mode', () => {
      expect(openAI.function.strict).toBe(true);
    });

    it('includes parameters object', () => {
      expect(openAI.function.parameters).toHaveProperty('type', 'object');
      expect(openAI.function.parameters).toHaveProperty('properties');
    });

    it('includes required fields', () => {
      expect(openAI.function.parameters.required).toContain('query');
    });
  });

  describe('array conversion', () => {
    it('returns array for array input', () => {
      const openAI = toOpenAI([tool]);
      expect(Array.isArray(openAI)).toBe(true);
      expect(openAI).toHaveLength(1);
    });

    it('returns array for empty array', () => {
      const openAI = toOpenAI([]);
      expect(Array.isArray(openAI)).toBe(true);
      expect(openAI).toHaveLength(0);
    });
  });

  describe('registry conversion', () => {
    it('returns array for registry input', () => {
      const armorer = createToolbox();
      armorer.register(tool);
      const openAI = toOpenAI(armorer);
      expect(Array.isArray(openAI)).toBe(true);
      expect(openAI).toHaveLength(1);
      expect(openAI[0]?.function.name).toBe('test-tool');
    });

    it('returns empty array for empty registry', () => {
      const armorer = createToolbox();
      const openAI = toOpenAI(armorer);
      expect(Array.isArray(openAI)).toBe(true);
      expect(openAI).toHaveLength(0);
    });
  });
});

describe('parseToolCalls', () => {
  it('parses valid tool calls', () => {
    const calls = [
      {
        id: 'call_1',
        type: 'function' as const,
        function: {
          name: 'tool1',
          arguments: '{"foo": "bar"}',
        },
      },
    ];
    const parsed = parseToolCalls(calls);
    expect(parsed).toEqual([
      {
        id: 'call_1',
        name: 'tool1',
        arguments: { foo: 'bar' },
      },
    ]);
  });

  it('handles invalid JSON arguments', () => {
    const calls = [
      {
        id: 'call_1',
        type: 'function' as const,
        function: {
          name: 'tool1',
          arguments: '{invalid}',
        },
      },
    ];
    const parsed = parseToolCalls(calls);
    expect(parsed).toEqual([
      {
        id: 'call_1',
        name: 'tool1',
        arguments: {},
      },
    ]);
  });
});

describe('formatToolResults', () => {
  it('formats single result', () => {
    const result = {
      callId: 'call_1',
      outcome: 'success' as const,
      content: 'result',
      toolCallId: 'call_1',
      toolName: 'tool1',
      result: 'result',
    };
    const messages = formatToolResults(result);
    expect(messages).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'result',
      },
    ]);
  });

  it('formats multiple results', () => {
    const results = [
      {
        callId: 'call_1',
        outcome: 'success' as const,
        content: 'result1',
        toolCallId: 'call_1',
        toolName: 'tool1',
        result: 'result1',
      },
      {
        callId: 'call_2',
        outcome: 'success' as const,
        content: { foo: 'bar' },
        toolCallId: 'call_2',
        toolName: 'tool2',
        result: { foo: 'bar' },
      },
    ];
    const messages = formatToolResults(results);
    expect(messages).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'result1',
      },
      {
        role: 'tool',
        tool_call_id: 'call_2',
        content: '{"foo":"bar"}',
      },
    ]);
  });
});
