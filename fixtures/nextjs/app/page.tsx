import { createPyloServer } from "@pylo/nextjs/server";
import type { PyloSchema } from "../schema";
import { Contacts } from "./client";

export default async function Page() {
  const pylo = createPyloServer<PyloSchema>({ apiKey: "k" });
  void pylo;
  return <Contacts />;
}
