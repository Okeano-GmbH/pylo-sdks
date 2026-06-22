import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/codegen.ts", "src/schema.ts"],
    format: ["esm"],
    outDir: "dist",
    dts: { resolve: ['@pylo/core', '@pylo/auth'] },
    noExternal: ['@pylo/core', '@pylo/auth'],
    splitting: false,
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    noExternal: ['@pylo/core'],
    external: ['jiti'],
    banner: { js: "#!/usr/bin/env node" },
    dts: false,
    splitting: false,
  },
]);
