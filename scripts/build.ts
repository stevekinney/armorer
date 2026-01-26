import { $ } from 'bun';

const entrypoints = [
  './src/index.ts',
  './src/core/index.ts',
  './src/runtime/index.ts',
  './src/lazy/index.ts',
  './src/utilities/index.ts',
  './src/registry/index.ts',
  './src/integrations/mcp/index.ts',
  './src/adapters/openai/index.ts',
  './src/adapters/anthropic/index.ts',
  './src/adapters/gemini/index.ts',
  './src/integrations/claude-agent-sdk/index.ts',
  './src/tools/index.ts',
];

const root = './src';

// Clean dist folder
await $`rm -rf dist`;

// Build with Bun
await Bun.build({
  entrypoints,
  outdir: './dist',
  root,
  target: 'bun',
  format: 'esm',
  naming: '[dir]/[name].js',
  sourcemap: 'external',
  minify: true,
});

// Generate declaration files
await $`bunx tsc --declaration --emitDeclarationOnly --project tsconfig.build.json`;

// Also create a CJS build
await Bun.build({
  entrypoints,
  outdir: './dist',
  root,
  target: 'node',
  format: 'cjs',
  naming: '[dir]/[name].cjs',
  sourcemap: 'external',
  minify: true,
});

console.log('Build complete!');
