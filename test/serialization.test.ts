import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import {
  createRegistry,
  defineTool,
  type JsonValue,
  serializeRegistry,
  serializeToolDefinition,
  stableStringifyJson,
} from '../src/core';

describe('serialization', () => {
  const schema = z.object({
    query: z.string(),
    limit: z.number().optional(),
  });

  it('rejects non-JSON metadata with a precise path', () => {
    const tool = defineTool({
      name: 'bad-meta',
      description: 'bad metadata',
      inputSchema: schema,
      metadata: { when: new Date() } as unknown as Record<string, unknown>,
    });

    expect(() => serializeToolDefinition(tool)).toThrow(
      'Non-plain object is not valid JSON at metadata.when',
    );
  });

  it('rejects undefined values with a precise path', () => {
    const tool = defineTool({
      name: 'bad-undefined',
      description: 'bad undefined',
      inputSchema: schema,
      metadata: { nested: { value: undefined } } as unknown as Record<string, unknown>,
    });

    expect(() => serializeToolDefinition(tool)).toThrow(
      'Undefined is not valid JSON at metadata.nested.value',
    );
  });

  it('produces provider-neutral JSON schema output', () => {
    const tool = defineTool({
      name: 'search',
      description: 'search tool',
      inputSchema: schema,
    });
    const serialized = serializeToolDefinition(tool);

    expect(serialized.schemaVersion).toBe('2020-12');
    expect(serialized.inputSchema).toHaveProperty('type', 'object');
    expect((serialized.inputSchema as Record<string, unknown>).safeParse).toBeUndefined();
  });

  it('keeps serialized metadata deterministic', () => {
    const toolA = defineTool({
      name: 'sorted',
      description: 'sorted tool',
      inputSchema: schema,
      metadata: { z: 1, a: 2 },
    });
    const toolB = defineTool({
      name: 'sorted',
      description: 'sorted tool',
      inputSchema: schema,
      metadata: { a: 2, z: 1 },
    });

    const jsonA = stableStringifyJson(
      serializeToolDefinition(toolA) as unknown as JsonValue,
    );
    const jsonB = stableStringifyJson(
      serializeToolDefinition(toolB) as unknown as JsonValue,
    );

    expect(jsonA).toBe(jsonB);
  });

  it('serializes registry aliases in sorted order', () => {
    const registry = createRegistry();
    const tool = defineTool({
      name: 'alias-tool',
      description: 'alias tool',
      inputSchema: schema,
      version: '1.0.0',
    });
    registry.register(tool, {
      aliases: ['default:alias-b@1.0.0', 'default:alias-a@1.0.0'],
    });

    const serialized = serializeRegistry(registry);
    expect(serialized[0]?.aliases).toEqual([
      'default:alias-a@1.0.0',
      'default:alias-b@1.0.0',
    ]);
  });
});
