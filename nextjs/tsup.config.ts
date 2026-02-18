import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  outDir: "dist",
  splitting: false,
  external: [
    "react",
    "react/jsx-runtime",
    "next",
    "next/server",
    "next/headers",
    "@tanstack/react-query",
  ],
};

export default defineConfig([
  {
    ...shared,
    entry: [
      "src/index.ts",
      "src/server.ts",
      "src/hooks.ts",
      "src/api.ts",
      "src/codegen/index.ts",
    ],
    dts: true,
  },
  {
    ...shared,
    entry: ["src/cli.ts"],
    banner: { js: "#!/usr/bin/env node" },
    dts: false,
  },
]);
