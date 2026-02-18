import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
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
