import { createPyloNode } from "../src/index.js";

interface TestSchema {
  contact: {
    fields: { id: string; name: string };
    relations: Record<never, never>;
    updateInput: Record<string, never>;
  };
}

createPyloNode<TestSchema>({ apiKey: "k" });
createPyloNode<TestSchema>({ token: "t" });
createPyloNode<TestSchema>({ token: () => "t" });
createPyloNode<TestSchema>({ token: async () => "t" });

// @ts-expect-error — credentials are mutually exclusive
createPyloNode<TestSchema>({ apiKey: "k", token: "t" });
