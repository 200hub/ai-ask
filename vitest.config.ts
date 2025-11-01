import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  // Cast to any to avoid Vite 5/6 type mismatch in editor tooling; runtime is fine
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [sveltekit() as unknown as any],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: 'src/lib/__tests__/setup.ts',
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.{ts,svelte}'],
    },
  },
});
