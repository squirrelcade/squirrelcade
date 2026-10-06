import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts', 'reset-link': 'src/resetLink.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle our own workspace code; keep third-party packages (and the native SQLite module) external.
  noExternal: ['@squirrelcade/core'],
});
