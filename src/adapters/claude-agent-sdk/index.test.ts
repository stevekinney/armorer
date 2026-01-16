import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createArmorer } from '../../create-armorer';
import { createTool } from '../../create-tool';
import { createClaudeAgentSdkServer, createClaudeToolGate } from './index';

describe('claude-agent-sdk adapter', () => {
  it('creates SDK tools with mutating and dangerous lists', () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'safe-tool',
        description: 'safe',
        schema: z.object({}),
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );
    createTool(
      {
        name: 'mutating-tool',
        description: 'mutates',
        schema: z.object({}),
        metadata: { mutates: true },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );
    createTool(
      {
        name: 'dangerous-tool',
        description: 'dangerous',
        schema: z.object({}),
        metadata: { dangerous: true },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const { toolNames, mutatingToolNames, dangerousToolNames } =
      createClaudeAgentSdkServer(armorer, {
        name: 'test-tools',
        version: '0.0.0',
      });

    expect(toolNames).toEqual(['safe-tool', 'mutating-tool', 'dangerous-tool']);
    expect(mutatingToolNames).toEqual(['mutating-tool']);
    expect(dangerousToolNames).toEqual(['dangerous-tool']);
  });

  it('denies mutating and dangerous tools when gated', async () => {
    const armorer = createArmorer();
    createTool(
      {
        name: 'mutating-tool',
        description: 'mutates',
        schema: z.object({}),
        metadata: { mutates: true },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );
    createTool(
      {
        name: 'dangerous-tool',
        description: 'dangerous',
        schema: z.object({}),
        metadata: { dangerous: true },
        async execute() {
          return { ok: true };
        },
      },
      armorer,
    );

    const gate = createClaudeToolGate({
      registry: armorer,
      readOnly: true,
      allowDangerous: false,
    });

    const mutatingDecision = await gate('mutating-tool');
    const dangerousDecision = await gate('dangerous-tool');

    expect(mutatingDecision).toEqual({
      behavior: 'deny',
      message: 'Read-only mode: mutating tools disabled.',
    });
    expect(dangerousDecision).toEqual({
      behavior: 'deny',
      message: 'Use --apply to allow mutating tools.',
    });
  });
});
