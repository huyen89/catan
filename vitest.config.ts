import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'engine', root: 'packages/engine', include: ['src/**/*.test.ts'] } },
      { test: { name: 'shared', root: 'packages/shared', include: ['src/**/*.test.ts'] } },
      {
        test: {
          name: 'bot',
          root: 'packages/bot',
          include: ['src/**/*.test.ts'],
          testTimeout: 60000,
        },
      },
      {
        test: {
          name: 'server',
          root: 'apps/server',
          include: ['src/**/*.test.ts'],
          testTimeout: 20000,
        },
      },
      { test: { name: 'web', root: 'apps/web', include: ['src/**/*.test.{ts,tsx}'] } },
    ],
  },
});
