import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/hooks.ts", "src/provider.tsx", "src/codegen.ts"],
    format: ["esm"],
    outDir: "dist",
    dts: true,
    // The provider's context must be one module. Without splitting each entry
    // bundles its own copy, so hooks imported from "./hooks" would read a
    // context that a provider imported from "." never set.
    splitting: true,
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
