import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  main: {
    // Workspace packages ship TS source → bundle them; everything else (better-sqlite3 etc.) stays external.
    plugins: [externalizeDepsPlugin({ exclude: ['@moto/shared', '@moto/api-client'] })],
    // Auto-update feed is baked at build time so cashier PCs need no environment configuration.
    define: { __POS_UPDATE_URL__: JSON.stringify(process.env.POS_UPDATE_URL ?? ''), __POS_UPDATE_PUBLISHER__: JSON.stringify(process.env.POS_UPDATE_PUBLISHER ?? ''), __POS_UPDATE_THUMBPRINTS__: JSON.stringify(process.env.POS_UPDATE_THUMBPRINTS ?? '') },
    build: { rollupOptions: { input: { index: path.resolve(__dirname, 'src/main/index.ts') } } },
    resolve: { alias: { '@main': path.resolve(__dirname, 'src/main') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // Sandboxed preload scripts must be CommonJS; this package is `type: module`, so force .cjs
    // instead of the default .mjs — otherwise the bridge never loads and the renderer stays blank.
    build: {
      rollupOptions: {
        input: { index: path.resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@renderer': path.resolve(__dirname, 'src/renderer/src') }, dedupe: ['react', 'react-dom'] },
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/renderer/index.html'),
          display: path.resolve(__dirname, 'src/renderer/display.html'),
        },
      },
    },
  },
});
