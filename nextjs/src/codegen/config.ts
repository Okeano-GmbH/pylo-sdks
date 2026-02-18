import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createJiti } from "jiti";

const DEFAULT_ENDPOINT = "https://api.pyloapp.com/graphql";

export interface PyloConfig {
  endpoint?: string;
  apiKey: string;
  output?: string;
}

export function defineConfig(config: PyloConfig): PyloConfig {
  return config;
}

export interface ResolvedPyloConfig {
  endpoint: string;
  apiKey: string;
  output?: string;
}

export async function loadConfig(cwd: string): Promise<ResolvedPyloConfig> {
  const candidates = ["pylo.config.ts", "pylo.config.js"];

  // Load .env files so process.env references in the config work
  for (const envFile of [".env", ".env.local"]) {
    const envPath = resolve(cwd, envFile);
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  }

  const jiti = createJiti(cwd);

  for (const filename of candidates) {
    const configPath = resolve(cwd, filename);
    if (existsSync(configPath)) {
      const mod = (await jiti.import(configPath)) as {
        default?: PyloConfig;
      };
      if (!mod.default) {
        throw new Error(
          `${filename} must have a default export. Use defineConfig() from '@pylo/nextjs/codegen'.`,
        );
      }
      const config = mod.default;
      if (!config.apiKey) {
        throw new Error(
          `Missing 'apiKey' in ${filename}. An API key is required to introspect the Pylo schema.`,
        );
      }
      return {
        endpoint: DEFAULT_ENDPOINT,
        ...config,
      };
    }
  }

  throw new Error(
    "No pylo.config.ts or pylo.config.js found in project root. Create one using defineConfig() from '@pylo/nextjs/codegen'.",
  );
}
