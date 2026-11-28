import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const shim = fileURLToPath(new URL('./tests/shims/primitives.tsx', import.meta.url))

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'host', environment: 'node', include: ['dsh-plugin/tests/**/*.test.ts'], testTimeout: 30_000 },
      },
      {
        extends: true,
        resolve: { alias: { '@deepseek-ai/dsh-client-ui-primitives': shim } },
        test: { name: 'client', environment: 'jsdom', include: ['dsh-plugin/tests/**/*.test.tsx'] },
      },
    ],
  },
})
