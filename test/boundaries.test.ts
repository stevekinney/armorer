import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'bun:test';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

describe('package dependency boundaries', () => {
  it('keeps MCP and Claude SDKs out of dependencies', () => {
    expect(pkg.dependencies?.['@modelcontextprotocol/sdk']).toBeUndefined();
    expect(pkg.dependencies?.['@anthropic-ai/claude-agent-sdk']).toBeUndefined();
  });

  it('declares MCP and Claude SDKs as optional peer dependencies', () => {
    expect(pkg.peerDependencies?.['@modelcontextprotocol/sdk']).toBeDefined();
    expect(pkg.peerDependencies?.['@anthropic-ai/claude-agent-sdk']).toBeDefined();
    expect(pkg.peerDependenciesMeta?.['@modelcontextprotocol/sdk']?.optional).toBe(true);
    expect(pkg.peerDependenciesMeta?.['@anthropic-ai/claude-agent-sdk']?.optional).toBe(
      true,
    );
  });
});
