import path from 'node:path';
import { defineConfig } from 'vite';

const rootDir = path.resolve(__dirname);

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: path.resolve(rootDir, 'dist'),
    rollupOptions: {
      external: ['vscode', 'prismarine-nbt'],
      output: {
        entryFileNames: 'extension.cjs',
        format: 'cjs'
      }
    },
    sourcemap: true,
    ssr: path.resolve(rootDir, 'src/extension.js'),
    target: 'node18'
  }
});
