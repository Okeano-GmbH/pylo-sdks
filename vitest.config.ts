import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runtime unit tests.
    include: ["**/test/**/*.test.ts"],
    // Type-level tests (`expectTypeOf` / `@ts-expect-error`), run through tsc.
    typecheck: {
      enabled: true,
      include: ["**/test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.test.json",
    },
  },
});
