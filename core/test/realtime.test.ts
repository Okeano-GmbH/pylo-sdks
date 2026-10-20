import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealtime } from "../src/realtime.js";
import type { RealtimeClient, RealtimeEvent, RealtimeOptions } from "../src/realtime.js";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: Array<{ operation: string; payload?: unknown }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }

  // Like a socket whose peer vanished: the close handshake never completes.
  close() {
    this.readyState = 2;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  finishClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  count(operation: string) {
    return this.sent.filter((m) => m.operation === operation).length;
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const sockets = () => FakeWebSocket.instances;
const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;

async function authenticate(ws: FakeWebSocket) {
  ws.open();
  ws.receive({ operation: "connected" });
  await flush();
  ws.receive({ operation: "authenticated" });
  await flush();
}

let request: ReturnType<typeof vi.fn>;
let registrations: Array<Record<string, unknown>>;
let deletions: Array<Record<string, unknown>>;
let realtime: RealtimeClient;

function setup(overrides: Partial<RealtimeOptions> = {}) {
  realtime = createRealtime({
    request: request as unknown as RealtimeOptions["request"],
    auth: async () => ({ token: "jwt" }),
    WebSocket: FakeWebSocket,
    windowEvents: false,
    ...overrides,
  });
  return realtime;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  registrations = [];
  let next = 0;
  deletions = [];
  request = vi.fn(async (query: string, variables: Record<string, unknown>) => {
    if (query.includes("deleteSubscription(")) {
      deletions.push(variables);
      return { deleteSubscription: { data: { success: true } } };
    }
    registrations.push(variables);
    const field = /\b(upsert\w+Subscription)\(/.exec(query)![1]!;
    const subscription = variables["subscription"] as { id?: string; connectionId: string };
    return {
      [field]: {
        subscription: {
          id: subscription.id ?? `s${++next}`,
          connectionId: subscription.connectionId,
          webserviceUrl: `ws://test/${subscription.connectionId}`,
        },
      },
    };
  });
});

afterEach(() => {
  realtime?.close();
  vi.useRealTimers();
});

async function subscribed(onEvent = vi.fn(), onResync = vi.fn()) {
  setup();
  const sub = realtime.subscribe(
    "contact",
    { select: { name: true } },
    { onEvent, onResync },
  );
  await flush();
  await authenticate(sockets()[0]!);
  await sub.ready;
  return { sub, onEvent, onResync };
}

describe("realtime connection", () => {
  it("registers over HTTP, then opens the socket and authenticates", async () => {
    const { onEvent } = await subscribed();
    const ws = sockets()[0]!;
    const connectionId = (registrations[0]!["subscription"] as { connectionId: string })
      .connectionId;

    expect(ws.url).toBe(`ws://test/${connectionId}`);
    expect(ws.sent[0]).toEqual({ operation: "authenticate", payload: { authToken: "jwt" } });
    expect(realtime.getStatus()).toBe("authenticated");
    expect(realtime.isLive("contact")).toBe(true);
    expect(realtime.isLive("order")).toBe(false);

    ws.receive({
      operation: "entity.update.Contact",
      subscriptionId: "s1",
      payload: { data: { id: "r1", name: "Ada" } },
    });
    expect(onEvent).toHaveBeenCalledWith({
      kind: "update",
      id: "r1",
      removed: false,
      data: { id: "r1", name: "Ada" },
    });
  });

  it("authenticates with an API key when the client has one", async () => {
    setup({ auth: async () => ({ apiKey: "key" }) });
    realtime.subscribe("contact", { select: { name: true } }, { onEvent: vi.fn() });
    await flush();
    await authenticate(sockets()[0]!);
    expect(sockets()[0]!.sent[0]).toEqual({
      operation: "authenticate",
      payload: { pyloApiKey: "key" },
    });
  });

  it("fetches a fresh credential when the server asks to reauthenticate", async () => {
    let token = "first";
    setup({ auth: async () => ({ token }) });
    realtime.subscribe("contact", { select: { name: true } }, { onEvent: vi.fn() });
    await flush();
    const ws = sockets()[0]!;
    await authenticate(ws);

    token = "second";
    ws.receive({ operation: "reauthenticate" });
    await flush();
    expect(ws.sent.at(-1)).toEqual({ operation: "authenticate", payload: { authToken: "second" } });
  });

  it("marks removals from deletes and from leaving the filter", async () => {
    const { onEvent } = await subscribed();
    const ws = sockets()[0]!;

    ws.receive({
      operation: "entity.update.Contact",
      subscriptionId: "s1",
      payload: { data: { id: "r1" }, membership: { inResultSet: false } },
    });
    ws.receive({
      operation: "entity.delete.Contact",
      subscriptionId: "s1",
      payload: { data: { id: "r2", secret: "raw model" } },
    });

    expect(onEvent.mock.calls.map(([event]) => event as RealtimeEvent)).toEqual([
      { kind: "update", id: "r1", removed: true },
      { kind: "delete", id: "r2", removed: true },
    ]);
  });

  it("ignores events for unknown subscriptions and malformed frames", async () => {
    const { onEvent } = await subscribed();
    const ws = sockets()[0]!;
    ws.receive({ operation: "entity.update.Contact", subscriptionId: "other", payload: { data: { id: "r1" } } });
    ws.receive({ operation: "entity.update.Contact", subscriptionId: "s1", payload: {} });
    ws.onmessage?.({ data: "not json" });
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("realtime subscriptions", () => {
  it("shares one registration between identical subscriptions", async () => {
    setup();
    const a = vi.fn();
    const b = vi.fn();
    realtime.subscribe("contact", { select: { name: true }, filter: { query: [] } }, { onEvent: a });
    realtime.subscribe("contact", { filter: { query: [] }, select: { name: true } }, { onEvent: b });
    await flush();
    await authenticate(sockets()[0]!);

    expect(registrations).toHaveLength(1);
    sockets()[0]!.receive({
      operation: "entity.create.Contact",
      subscriptionId: "s1",
      payload: { data: { id: "r1" } },
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("registers different subscriptions separately on the same connection", async () => {
    setup();
    realtime.subscribe("contact", { select: { name: true } }, { onEvent: vi.fn() });
    realtime.subscribe("order", { select: { total: true } }, { onEvent: vi.fn() });
    await flush();

    const connections = registrations.map(
      (v) => (v["subscription"] as { connectionId: string }).connectionId,
    );
    expect(connections).toHaveLength(2);
    expect(connections[0]).toBe(connections[1]);
    expect(sockets()).toHaveLength(1);
  });

  it("keeps a subscription briefly so a remount reuses it", async () => {
    const { sub } = await subscribed();
    sub.unsubscribe();
    await vi.advanceTimersByTimeAsync(500);
    realtime.subscribe("contact", { select: { name: true } }, { onEvent: vi.fn() });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(registrations).toHaveLength(1);
    expect(sockets()[0]!.readyState).toBe(1);
  });

  it("deletes the subscription and closes the socket once it has lingered out", async () => {
    const { sub } = await subscribed();
    const connectionId = (registrations[0]!["subscription"] as { connectionId: string })
      .connectionId;
    sub.unsubscribe();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(deletions).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(deletions).toEqual([{ id: "s1", connectionId }]);
    expect(realtime.getStatus()).toBe("closed");
    expect(sockets()[0]!.readyState).toBe(2);
  });

  it("deletes only the dropped subscription while others stay", async () => {
    setup();
    const contact = realtime.subscribe("contact", { select: { name: true } }, { onEvent: vi.fn() });
    realtime.subscribe("order", { select: { total: true } }, { onEvent: vi.fn() });
    await flush();
    await authenticate(sockets()[0]!);

    contact.unsubscribe();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(deletions).toHaveLength(1);
    expect(deletions[0]).toMatchObject({ id: "s1" });
    expect(realtime.isLive("order")).toBe(true);
  });

  it("waits for an in-flight registration before deleting it", async () => {
    setup();
    const sub = realtime.subscribe("contact", { select: { name: true } }, { onEvent: vi.fn() });
    sub.unsubscribe();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(deletions).toEqual([
      { id: "s1", connectionId: (registrations[0]!["subscription"] as { connectionId: string }).connectionId },
    ]);
  });

  it("reports a failed registration and retries it on wake", async () => {
    setup();
    request.mockRejectedValueOnce(new Error("ws service down"));
    const onError = vi.fn();
    const sub = realtime.subscribe("contact", { select: { name: true } }, { onEvent: vi.fn(), onError });
    await sub.ready;

    expect(onError).toHaveBeenCalledWith(new Error("ws service down"));
    expect(sockets()).toHaveLength(0);

    realtime.wake();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(sockets()).toHaveLength(1);
  });

  it("requires a WebSocket implementation", () => {
    vi.stubGlobal("WebSocket", undefined);
    try {
      setup({ WebSocket: undefined as never });
      expect(() => realtime.subscribe("contact", { select: { name: true } }, { onEvent: vi.fn() })).toThrow(
        /No WebSocket implementation/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("realtime recovery", () => {
  it("re-registers before reopening after a drop, then resyncs", async () => {
    const { onResync } = await subscribed();
    sockets()[0]!.finishClose();
    expect(realtime.isLive("contact")).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(registrations).toHaveLength(2);
    expect(registrations[1]!["subscription"]).toMatchObject({ id: "s1" });
    expect(sockets()).toHaveLength(2);

    await authenticate(latest());
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(realtime.isLive("contact")).toBe(true);
  });

  it("re-registers after the server forgot the connection", async () => {
    await subscribed();
    const ws = sockets()[0]!;
    ws.receive({ operation: "connectionNotFound" });
    ws.finishClose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(registrations).toHaveLength(2);
  });

  it("reconnects without waiting for a dead socket's close handshake", async () => {
    const { onResync } = await subscribed();
    const dead = sockets()[0]!;

    await vi.advanceTimersByTimeAsync(25_000 + 10_000 + 1_000);

    expect(dead.count("ping")).toBe(1);
    expect(sockets()).toHaveLength(2);
    await authenticate(latest());
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(realtime.isLive("contact")).toBe(true);
  });

  it("ignores the superseded socket's late close and events", async () => {
    const { onEvent } = await subscribed();
    const dead = sockets()[0]!;
    await vi.advanceTimersByTimeAsync(25_000 + 10_000 + 1_000);
    const fresh = latest();
    await authenticate(fresh);

    dead.receive({ operation: "entity.update.Contact", subscriptionId: "s1", payload: { data: { id: "r1" } } });
    dead.receive({ operation: "connectionNotFound" });
    dead.finishClose();
    await vi.advanceTimersByTimeAsync(31_000);

    expect(onEvent).not.toHaveBeenCalled();
    expect(realtime.getStatus()).toBe("authenticated");
    expect(sockets()).toHaveLength(2);
    expect(fresh.count("ping")).toBeGreaterThan(0);
  });

  it("drops the socket when the server rejects the credential", async () => {
    await subscribed();
    sockets()[0]!.receive({ operation: "unauthenticated" });
    expect(realtime.isLive("contact")).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets()).toHaveLength(2);
  });

  it("drops and retries a socket whose handshake stalls", async () => {
    setup();
    const onResync = vi.fn();
    const sub = realtime.subscribe("contact", { select: { name: true } }, { onEvent: vi.fn(), onResync });
    await flush();
    const stalled = sockets()[0]!;

    await vi.advanceTimersByTimeAsync(10_000);
    await sub.ready;
    expect(stalled.readyState).toBe(2);
    expect(realtime.getStatus()).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets()).toHaveLength(2);
    await authenticate(latest());
    expect(realtime.isLive("contact")).toBe(true);
  });

  it("keeps a socket that authenticates before the handshake deadline", async () => {
    await subscribed();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets()).toHaveLength(1);
    expect(realtime.getStatus()).toBe("authenticated");
  });

  it("probes an open socket on wake instead of reconnecting", async () => {
    await subscribed();
    realtime.wake();
    expect(sockets()[0]!.count("ping")).toBe(1);
    expect(sockets()).toHaveLength(1);
  });

  it("does not send on a socket that closed while the token was fetched", async () => {
    let release!: (value: { token: string }) => void;
    setup({ auth: () => new Promise((resolve) => (release = resolve)) });
    realtime.subscribe("contact", { select: { name: true } }, { onEvent: vi.fn() });
    await flush();
    const ws = sockets()[0]!;
    ws.open();
    ws.receive({ operation: "connected" });
    ws.finishClose();
    release({ token: "jwt" });
    await flush();
    expect(ws.sent).toEqual([]);
  });
});
