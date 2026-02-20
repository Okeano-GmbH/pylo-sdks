import { resolve } from "node:path";
import { loadConfig, defineConfig } from "./config.js";
import { fetchSchema } from "./fetch-schema.js";
import { analyzeEntities } from "./analyze.js";
import {
  generateIndexFile,
  generateEntitiesFile,
  generateSchemaMetadataFile,
} from "./generate.js";
import { writeGeneratedFiles } from "./write.js";

export { defineConfig } from "./config.js";
export type { PyloConfig } from "./config.js";

export interface GenerateOptions {
  cwd?: string;
  importSource?: string;
}

export async function generate(options?: GenerateOptions): Promise<void> {
  const projectRoot = options?.cwd ?? process.cwd();
  const importSource = options?.importSource ?? "@pylo/core";

  console.log("Loading config...");
  const config = await loadConfig(projectRoot);

  const outputDir = resolve(projectRoot, config.output ?? ".pylo");

  console.log("Fetching schema from Pylo...");
  const rawEntities = await fetchSchema(config);
  console.log(`  found ${rawEntities.length} entities`);

  console.log("Analyzing entities...");
  const entities = analyzeEntities(rawEntities);

  console.log("Generating types...");
  const files: Record<string, string> = {
    "index.ts": generateIndexFile(entities, importSource),
    "entities.ts": generateEntitiesFile(entities, importSource),
    "schema-metadata.ts": generateSchemaMetadataFile(entities, config.unknownFieldBehavior, importSource),
  };

  console.log(`Writing files to ${outputDir}...`);
  writeGeneratedFiles(outputDir, files);

  console.log(
    `\nDone! Generated types for ${entities.length} entities in ${outputDir}`,
  );
  console.log(
    "\nMake sure your tsconfig.json has path aliases set up:",
  );
  console.log('  "@pylo/types": ["./.pylo"]');
  console.log('  "@pylo/types/*": ["./.pylo/*"]');
}
