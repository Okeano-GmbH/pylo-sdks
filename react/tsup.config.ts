import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/hooks.ts", "src/provider.tsx", "src/codegen.ts"],
    format: ["esm"],
    outDir: "dist",
    dts: true,
    splitting: false,
    external: ["react", "react/jsx-runtime", "@tanstack/react-query"],
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
