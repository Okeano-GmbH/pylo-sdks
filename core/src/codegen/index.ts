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

export async function generate(cwd?: string): Promise<void> {
  const projectRoot = cwd ?? process.cwd();

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
    "index.ts": generateIndexFile(entities),
    "entities.ts": generateEntitiesFile(entities),
    "schema-metadata.ts": generateSchemaMetadataFile(entities),
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
