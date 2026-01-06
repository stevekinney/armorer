import { $ } from 'bun';

const entrypoints = [
  './src/index.ts',
  './src/adapters/openai/index.ts',
  './src/adapters/anthropic/index.ts',
  './src/adapters/gemini/index.ts',
];

// Clean dist folder
await $`rm -rf dist`;

// Build with Bun
await Bun.build({
  entrypoints,
  outdir: './dist',
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
  target: 'node',
  format: 'cjs',
  naming: '[dir]/[name].cjs',
  sourcemap: 'external',
  minify: true,
});

console.log('Build complete!');
