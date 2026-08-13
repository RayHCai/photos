import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
    resolve: {
        alias: { '@': resolve(import.meta.dirname, 'src') },
    },
    test: {
        // Pure logic only for now: layout maths, query-key invariants, date grouping.
        // No jsdom, so the suite stays fast and CI needs no browser environment.
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});
