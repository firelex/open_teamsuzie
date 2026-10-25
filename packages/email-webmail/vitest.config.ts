import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
        // Browser tests drive installed Chrome; each file starts its own.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
