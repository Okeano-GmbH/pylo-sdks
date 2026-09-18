import { createPyloNode, PyloError } from "@pylo/node";
import type { PyloClient } from "@pylo/node";
import type { PyloSchema } from "./schema.js";

const client: PyloClient<PyloSchema> = createPyloNode({ apiKey: "k" });

void client;
void PyloError;
