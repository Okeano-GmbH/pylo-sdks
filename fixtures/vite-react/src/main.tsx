import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  PyloProvider,
  usePyloAuth,
  usePyloClient,
  usePyloTransport,
  createPyloHooks,
} from "@pylo/react";
import type { PyloSchema } from "./schema";

const { usePyloList, usePyloUpload } = createPyloHooks<PyloSchema>();

function Screen() {
  const { isLoading, isSignedIn, user, login, logout } = usePyloAuth();
  const client = usePyloClient<PyloSchema>();
  const transport = usePyloTransport();
  const { data } = usePyloList("contact", { select: { id: true } });
  const { startUpload } = usePyloUpload();

  void client;
  void transport;
  void startUpload;

  if (isLoading) return <p>loading</p>;
  return isSignedIn ? (
    <button onClick={() => void logout()}>{user?.email ?? String(data?.length)}</button>
  ) : (
    <button onClick={() => void login("a@b.c", "pw")}>sign in</button>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <PyloProvider>
      <Screen />
    </PyloProvider>
  </QueryClientProvider>,
);
