import { Button, Text, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PyloProvider, usePyloAuth, createPyloHooks } from "@pylo/expo";
import type { PyloSchema } from "./schema";

const { usePyloList, usePyloUpload } = createPyloHooks<PyloSchema>();

function Screen() {
  const { isLoading, isSignedIn, user, login, logout } = usePyloAuth();
  const { data } = usePyloList("contact", { select: { id: true } });
  const { startUpload } = usePyloUpload();

  // The React Native upload source: a uri, not a File.
  const pick = () =>
    void startUpload({ uri: "file:///tmp/a.png", name: "a.png", type: "image/png" });

  if (isLoading) return <Text>loading</Text>;
  return (
    <View>
      <Text>{user?.email ?? String(data?.length ?? 0)}</Text>
      <Button title="upload" onPress={pick} />
      <Button
        title={isSignedIn ? "sign out" : "sign in"}
        onPress={() => void (isSignedIn ? logout() : login("a@b.c", "pw"))}
      />
    </View>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <PyloProvider>
        <Screen />
      </PyloProvider>
    </QueryClientProvider>
  );
}
