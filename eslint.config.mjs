import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.pylo/**", "**/*.tgz"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `any` is used intentionally in a few spots (e.g. the untyped schema
      // fallback). Surface it as a warning rather than blocking the build.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Type-level test files declare values used only in type position
    // (`const sel = … satisfies …; type T = typeof sel`), which the
    // unused-vars rule can't see through.
    files: ["**/*.test-d.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
