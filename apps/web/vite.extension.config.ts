import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The Deal check extension's game drawer (D245): drawer.html and its code, built into extension/drawer/, which the
// extension shows over a store's page. Relative paths, no inline scripts (an extension page allows only its own files).
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: resolve(__dirname, '../../extension/drawer'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    modulePreload: { polyfill: false },
    rollupOptions: { input: resolve(__dirname, 'drawer.html') },
  },
});
