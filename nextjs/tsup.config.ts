import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/server.ts",
    "src/hooks.ts",
    "src/api.ts",
  ],
  format: ["esm"],
  outDir: "dist",
  dts: true,
  splitting: false,
  external: [
    "react",
    "react/jsx-runtime",
    "next",
    "next/server",
    "next/headers",
    "@tanstack/react-query",
  ],
});
