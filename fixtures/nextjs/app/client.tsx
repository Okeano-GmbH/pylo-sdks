"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createPyloHooks } from "@pylo/nextjs/hooks";
import type { PyloSchema } from "../schema";

const { usePyloList } = createPyloHooks<PyloSchema>();

function List() {
  const { data } = usePyloList("contact", { select: { id: true } });
  return <p>{data?.length ?? 0}</p>;
}

export function Contacts() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <List />
    </QueryClientProvider>
  );
}
