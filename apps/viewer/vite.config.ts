import { defineConfig } from 'vite';

export default defineConfig({ test: { include: ['src/**/*.test.ts'] } } as Parameters<typeof defineConfig>[0]);
