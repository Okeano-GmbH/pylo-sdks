import { generate } from "@pylo/core/codegen";

const args = process.argv.slice(2);
const command = args[0];

if (command === "generate") {
  generate({ importSource: "@pylo/nextjs" }).catch((err: unknown) => {
    console.error(
      "Error:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
} else {
  console.log("Usage: pylo generate");
  console.log("");
  console.log("Commands:");
  console.log(
    "  generate    Introspect Pylo schema and generate TypeScript types",
  );

  if (command && command !== "--help" && command !== "-h") {
    console.error(`\nUnknown command: ${command}`);
    process.exit(1);
  }
}
