import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['packages/sim-core/**/*.test.ts','packages/learning/**/*.test.ts','tests/**/*.unit.test.ts']}});
