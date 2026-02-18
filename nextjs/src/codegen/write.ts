import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function writeGeneratedFiles(
  outputDir: string,
  files: Record<string, string>,
): void {
  mkdirSync(outputDir, { recursive: true });

  for (const [filename, content] of Object.entries(files)) {
    const filePath = resolve(outputDir, filename);
    writeFileSync(filePath, content, "utf-8");
    console.log(`  wrote ${filePath}`);
  }
}
