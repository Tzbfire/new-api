import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'src/**/__tests__/*.test.{ts,tsx}',
      'scripts/**/__tests__/*.test.{ts,tsx}',
      'tests/*.test.{ts,tsx}',
    ],
    restoreMocks: true,
  },
})
