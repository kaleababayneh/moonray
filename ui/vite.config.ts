// Vite configuration for the midnight-js browser stack, ported wholesale from
// lumera-vault (wasm chunking for onchain-runtime, node polyfills with
// Buffer/process globals, native TLA via esnext target, isomorphic-ws shim)
// plus the react plugin.
import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  cacheDir: './.vite',
  build: {
    target: 'esnext',
    minify: false,
    commonjsOptions: {
      transformMixedEsModules: true,
      extensions: ['.js', '.cjs'],
      ignoreDynamicRequires: true,
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events', 'fs', 'path', 'crypto'],
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
    wasm(),
    // NOTE: no vite-plugin-top-level-await — build target is esnext, so
    // native TLA is emitted; the plugin's wrapper can deadlock the bundle.
    {
      // Force the wasm-backed runtime through the normal module graph
      // when imported from compact-runtime.
      name: 'wasm-module-resolver',
      resolveId(source, importer) {
        if (
          source === '@midnight-ntwrk/onchain-runtime-v3' &&
          importer &&
          importer.includes('@midnight-ntwrk/compact-runtime')
        ) {
          return { id: source, external: false, moduleSideEffects: true };
        }
        return null;
      },
    },
  ],
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
      supported: { 'top-level-await': true },
      platform: 'browser',
      format: 'esm',
      loader: { '.wasm': 'binary' },
    },
    include: ['@midnight-ntwrk/compact-runtime', 'buffer', 'process', 'react', 'react-dom'],
    exclude: [
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js',
    ],
  },
  resolve: {
    extensions: ['.mjs', '.js', '.ts', '.tsx', '.json', '.wasm'],
    mainFields: ['browser', 'module', 'main'],
    alias: {
      buffer: 'buffer',
      process: 'process/browser',
      // isomorphic-ws browser build only has a default export; the shim
      // adds the named WebSocket export @midnight-ntwrk packages expect.
      'isomorphic-ws': path.resolve(__dirname, 'src/shims/isomorphic-ws.js'),
    },
  },
  server: {
    fs: { allow: ['..'] },
  },
});
