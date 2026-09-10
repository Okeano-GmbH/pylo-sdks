import { createRequire } from "node:module";

// Two resolved copies of @pylo/react mean two React contexts, and a provider
// that silently never matches its consumers. Resolving the same specifier from
// the app and from inside @pylo/expo is what detects a nested duplicate.
const fromApp = createRequire(import.meta.url);
const fromExpo = createRequire(fromApp.resolve("@pylo/expo/package.json"));

const app = fromApp.resolve("@pylo/react/package.json");
const expo = fromExpo.resolve("@pylo/react/package.json");

if (app !== expo) {
  throw new Error(`@pylo/react resolved to two copies:\n  ${app}\n  ${expo}`);
}

console.log("@pylo/react resolves to one copy");
