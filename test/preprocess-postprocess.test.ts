import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createTool } from '../src/create-tool';
import { postprocess } from '../src/utilities/postprocess';
import { preprocess } from '../src/utilities/preprocess';

describe('preprocess', () => {
  it('transforms inputs before passing to the tool', async () => {
    const addNumbers = createTool({
      name: 'add-numbers',
      description: 'Add two numbers',
      schema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    });

    const addNumbersWithPreprocessing = preprocess(
      addNumbers,
      async (input: { a: string; b: string }) => ({
        a: Number(input.a),
        b: Number(input.b),
      }),
    );

    const result = await addNumbersWithPreprocessing({ a: '5', b: '3' });
    expect(result).toBe(8);
  });

  it('has correct name and description', () => {
    const tool = createTool({
      name: 'original',
      description: 'Original tool',
      schema: z.object({ value: z.number() }),
      execute: async ({ value }) => value * 2,
    });

    const preprocessed = preprocess(tool, async (input) => input);
    expect(preprocessed.name).toBe('preprocess(original)');
    expect(preprocessed.description).toBe('Preprocessed tool: Original tool');
  });

  it('preserves tags from original tool', async () => {
    const tool = createTool({
      name: 'tagged-tool',
      description: 'A tool with tags',
      schema: z.object({ value: z.number() }),
      tags: ['math', 'utility'],
      execute: async ({ value }) => value,
    });

    const preprocessed = preprocess(tool, async (input) => input);
    expect(preprocessed.tags).toEqual(['math', 'utility']);
  });

  it('preserves metadata from original tool', async () => {
    const tool = createTool({
      name: 'metadata-tool',
      description: 'A tool with metadata',
      schema: z.object({ value: z.number() }),
      metadata: { category: 'test', priority: 1 },
      execute: async ({ value }) => value,
    });

    const preprocessed = preprocess(tool, async (input) => input);
    expect(preprocessed.metadata).toEqual({ category: 'test', priority: 1 });
  });

  it('works with sync mapper', async () => {
    const tool = createTool({
      name: 'double',
      description: 'Double a number',
      schema: z.object({ n: z.number() }),
      execute: async ({ n }) => n * 2,
    });

    const preprocessed = preprocess(tool, (input: { str: string }) => ({
      n: parseInt(input.str, 10),
    }));

    const result = await preprocessed({ str: '10' });
    expect(result).toBe(20);
  });

  it('handles no tags gracefully', async () => {
    const tool = createTool({
      name: 'no-tags',
      description: 'A tool without tags',
      schema: z.object({ value: z.number() }),
      execute: async ({ value }) => value,
    });

    const preprocessed = preprocess(tool, async (input) => input);
    expect(preprocessed.tags).toBeUndefined();
  });
});

describe('postprocess', () => {
  it('transforms outputs after tool execution', async () => {
    const fetchUser = createTool({
      name: 'fetch-user',
      description: 'Fetch user data',
      schema: z.object({ id: z.string() }),
      execute: async ({ id }) => ({ userId: id, name: 'John' }),
    });

    const fetchUserFormatted = postprocess(fetchUser, async (output) => ({
      ...output,
      displayName: `${output.name} (${output.userId})`,
    }));

    const result = await fetchUserFormatted({ id: '123' });
    expect(result).toEqual({
      userId: '123',
      name: 'John',
      displayName: 'John (123)',
    });
  });

  it('has correct name and description', () => {
    const tool = createTool({
      name: 'original',
      description: 'Original tool',
      schema: z.object({ value: z.number() }),
      execute: async ({ value }) => value * 2,
    });

    const postprocessed = postprocess(tool, async (output) => output);
    expect(postprocessed.name).toBe('postprocess(original)');
    expect(postprocessed.description).toBe('Postprocessed tool: Original tool');
  });

  it('preserves tags from original tool', async () => {
    const tool = createTool({
      name: 'tagged-tool',
      description: 'A tool with tags',
      schema: z.object({ value: z.number() }),
      tags: ['math', 'utility'],
      execute: async ({ value }) => value,
    });

    const postprocessed = postprocess(tool, async (output) => output);
    expect(postprocessed.tags).toEqual(['math', 'utility']);
  });

  it('preserves metadata from original tool', async () => {
    const tool = createTool({
      name: 'metadata-tool',
      description: 'A tool with metadata',
      schema: z.object({ value: z.number() }),
      metadata: { category: 'test', priority: 1 },
      execute: async ({ value }) => value,
    });

    const postprocessed = postprocess(tool, async (output) => output);
    expect(postprocessed.metadata).toEqual({ category: 'test', priority: 1 });
  });

  it('works with sync mapper', async () => {
    const tool = createTool({
      name: 'double',
      description: 'Double a number',
      schema: z.object({ n: z.number() }),
      execute: async ({ n }) => n * 2,
    });

    const postprocessed = postprocess(tool, (output) => `Result: ${output}`);

    const result = await postprocessed({ n: 5 });
    expect(result).toBe('Result: 10');
  });

  it('handles no tags gracefully', async () => {
    const tool = createTool({
      name: 'no-tags',
      description: 'A tool without tags',
      schema: z.object({ value: z.number() }),
      execute: async ({ value }) => value,
    });

    const postprocessed = postprocess(tool, async (output) => output);
    expect(postprocessed.tags).toBeUndefined();
  });

  it('uses same schema as original tool', () => {
    const schema = z.object({ value: z.number() });
    const tool = createTool({
      name: 'original',
      description: 'Original tool',
      schema,
      execute: async ({ value }) => value,
    });

    const postprocessed = postprocess(tool, async (output) => output);
    expect(postprocessed.schema).toBe(schema);
  });
});

describe('preprocess and postprocess composition', () => {
  it('can be chained together', async () => {
    const baseTool = createTool({
      name: 'multiply',
      description: 'Multiply by 2',
      schema: z.object({ n: z.number() }),
      execute: async ({ n }) => n * 2,
    });

    const preprocessed = preprocess(baseTool, async (input: { str: string }) => ({
      n: parseInt(input.str, 10),
    }));

    const composed = postprocess(preprocessed, async (output) => `Result: ${output}`);

    const result = await composed({ str: '5' });
    expect(result).toBe('Result: 10');
  });
});
