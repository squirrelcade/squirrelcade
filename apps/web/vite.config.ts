import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs separately (npm run dev:server); Vite forwards /api to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.SQUIRRELCADE_PORT ?? 7575}`,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
});
