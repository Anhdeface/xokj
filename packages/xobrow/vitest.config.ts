import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    pool: 'forks',
    include: ['test/**/*.{test,spec}.ts', 'packages/xobrow/test/**/*.{test,spec}.ts']
  }
});
