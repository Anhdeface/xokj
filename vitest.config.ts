import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: true,
        maxForks: 3
      }
    },
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**'
    ]
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
});
