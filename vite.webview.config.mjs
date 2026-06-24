import path from 'node:path';
import { defineConfig } from 'vite';

const rootDir = path.resolve(__dirname);

export default defineConfig({
  build: {
    cssCodeSplit: false,
    emptyOutDir: false,
    outDir: path.resolve(rootDir, 'dist/webview'),
    rollupOptions: {
      input: path.resolve(rootDir, 'webview/main.js'),
      output: {
        assetFileNames: 'viewer[extname]',
        chunkFileNames: 'viewer-[name].js',
        entryFileNames: 'viewer.js',
        format: 'es'
      }
    },
    sourcemap: true,
    target: 'es2020'
  }
});
