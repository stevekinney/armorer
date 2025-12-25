import { $ } from 'bun';

// Clean dist folder
await $`rm -rf dist`;

// Build with Bun
await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'bun',
  format: 'esm',
  sourcemap: 'external',
  minify: true,
});

// Generate declaration files
await $`bunx tsc --declaration --emitDeclarationOnly --outDir dist`;

// Also create a CJS build
await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'node',
  format: 'cjs',
  naming: '[name].cjs',
  sourcemap: 'external',
  minify: true,
});

console.log('Build complete!');
