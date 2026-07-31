import { defineConfig } from "tsup";

// @pylo/core and @pylo/auth are real dependencies (auto-external), so their
// types resolve from the consumer's node_modules instead of being bundled —
// tsup's dts bundler can't inline subpath exports like @pylo/core/codegen.
export default defineConfig([
  {
    entry: ["src/index.ts", "src/codegen.ts", "src/schema.ts"],
    format: ["esm"],
    outDir: "dist",
    dts: true,
    splitting: false,
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
    dts: false,
    splitting: false,
  },
]);
