import { buildSubscriptionMutation } from "./mutation-builder.js";
import type { FilterInput } from "./shared-types.js";

export type RealtimeEventKind = "create" | "update" | "delete";

export interface RealtimeEvent<T = Record<string, unknown>> {
  kind: RealtimeEventKind;
  id: string;
  // The row under the subscription's `select`; absent when `removed`.
  data?: T;
  // The row left this subscription's result set: deleted, no longer matching
  // the filter, or no longer readable. The server can't tell these apart.
  removed: boolean;
}

export interface RealtimeSubscribeOptions {
  select: unknown;
  filter?: FilterInput | undefined;
  // Defaults to all three.
  on?: readonly RealtimeEventKind[] | undefined;
}

export interface RealtimeHandlers<T = Record<string, unknown>> {
  onEvent: (event: RealtimeEvent<T>) => void;
  // Called after a reconnect, once events flow again. Events from the gap may
  // be lost, so refetch whatever this subscription feeds.
  onResync?: () => void;
  onError?: (error: unknown) => void;
}

export interface RealtimeSubscription {
  // Resolves once events can arrive, or after a timeout. Never rejects;
  // failures go to `onError`.
  ready: Promise<void>;
  unsubscribe: () => void;
}

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "authenticating"
  | "authenticated"
  | "reconnecting"
  | "closed";

export interface RealtimeClient {
  subscribe<T = Record<string, unknown>>(
    entityKey: string,
    options: RealtimeSubscribeOptions,
    handlers: RealtimeHandlers<T>,
  ): RealtimeSubscription;
  // Whether events for this entity are being delivered right now. Writers use
  // it to skip their own refetch and let the event update the cache.
  isLive(entityKey: string): boolean;
  getStatus(): RealtimeStatus;
  // Checks the socket now instead of waiting for the next heartbeat. Call it
  // when the app returns to the foreground or the network comes back.
  wake(): void;
  close(): void;
}

interface WebSocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface RealtimeOptions {
  // Sends a GraphQL operation and resolves with its `data`.
  request: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
  // Called on every (re)authentication, so a refreshed token is picked up.
  auth: () => Promise<{ token?: string | null; apiKey?: string | null }>;
  WebSocket?: WebSocketConstructor;
  // Probe the socket on window focus, visibility and `online`. Defaults to
  // true wherever those events exist.
  windowEvents?: boolean;
}

const OPEN = 1;
const CONNECTING = 0;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
// Browsers don't expose protocol-level pings, and a dead socket keeps
// reporting OPEN, so liveness is an app-level ping.
const HEARTBEAT_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
const CONNECT_SETTLE_TIMEOUT_MS = 5_000;
// Keeps a subscription briefly after its last listener leaves, so a remount
// (React StrictMode, route changes) reuses it instead of registering anew.
const LINGER_MS = 2_000;

interface Group {
  key: string;
  entityKey: string;
  options: RealtimeSubscribeOptions;
  listeners: Set<RealtimeHandlers<never>>;
  serverId?: string;
  registration: Promise<void>;
  ready: Promise<void>;
  lingerTimer?: ReturnType<typeof setTimeout>;
}

interface Message {
  operation?: string;
  subscriptionId?: string;
  payload?: {
    data?: Record<string, unknown>;
    membership?: { inResultSet?: boolean };
  };
}

interface SubscriptionPayload {
  subscription: { id: string; webserviceUrl: string };
}

export function createRealtime(options: RealtimeOptions): RealtimeClient {
  return new Realtime(options);
}

class Realtime implements RealtimeClient {
  private readonly WebSocketImpl: WebSocketConstructor | undefined;
  private readonly groups = new Map<string, Group>();
  private connectionId = uuid();
  private webserviceUrl: string | null = null;
  private ws: WebSocketLike | null = null;
  private status: RealtimeStatus = "idle";
  private connecting: Promise<void> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  // The server forgets a connectionId ~3 minutes after its socket drops and
  // then refuses the socket with `connectionNotFound` before auth. So after a
  // drop, every subscription is re-registered before the next socket opens.
  private needsReregister = false;
  private resyncPending = false;
  private lastActivityAt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private settleConnect: (() => void) | null = null;
  private windowEventsAttached = false;

  constructor(private readonly options: RealtimeOptions) {
    this.WebSocketImpl =
      options.WebSocket ??
      (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
  }

  subscribe<T>(
    entityKey: string,
    options: RealtimeSubscribeOptions,
    handlers: RealtimeHandlers<T>,
  ): RealtimeSubscription {
    if (!this.WebSocketImpl) {
      throw new Error("No WebSocket implementation available; pass one as `WebSocket`.");
    }
    const key = `${entityKey}:${stableStringify(options)}`;
    let group = this.groups.get(key);
    if (group?.lingerTimer !== undefined) {
      clearTimeout(group.lingerTimer);
      delete group.lingerTimer;
    }
    if (!group) {
      group = this.createGroup(key, entityKey, options);
    }
    const listener = handlers as unknown as RealtimeHandlers<never>;
    group.listeners.add(listener);
    const current = group;

    return {
      ready: current.ready,
      unsubscribe: () => {
        current.listeners.delete(listener);
        if (current.listeners.size > 0 || current.lingerTimer !== undefined) return;
        current.lingerTimer = setTimeout(() => this.dropGroup(current), LINGER_MS);
      },
    };
  }

  isLive(entityKey: string): boolean {
    if (this.status !== "authenticated" || this.needsReregister) return false;
    if (!this.ws || this.ws.readyState !== OPEN) return false;
    if (Date.now() - this.lastActivityAt >= HEARTBEAT_INTERVAL_MS + PONG_TIMEOUT_MS) {
      return false;
    }
    for (const group of this.groups.values()) {
      if (group.entityKey === entityKey && group.serverId !== undefined) return true;
    }
    return false;
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  wake = (): void => {
    if (this.groups.size === 0) return;
    if (this.ws?.readyState === OPEN) {
      this.reregisterFailed();
      this.probeLiveness();
      return;
    }
    if (this.ws?.readyState === CONNECTING || this.connecting) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.needsReregister = true;
    this.reconnectAttempts = 0;
    void this.ensureSocket();
  };

  close(): void {
    for (const group of this.groups.values()) {
      if (group.lingerTimer !== undefined) clearTimeout(group.lingerTimer);
    }
    this.groups.clear();
    this.closeSocket();
  }

  private createGroup(
    key: string,
    entityKey: string,
    options: RealtimeSubscribeOptions,
  ): Group {
    const group: Group = {
      key,
      entityKey,
      options,
      listeners: new Set(),
      registration: Promise.resolve(),
      ready: Promise.resolve(),
    };
    this.groups.set(key, group);
    this.manualClose = false;
    this.attachWindowEvents();
    group.ready = this.register(group)
      .then(() => this.ensureSocket())
      .catch(() => undefined);
    return group;
  }

  private dropGroup(group: Group): void {
    if (this.groups.get(group.key) !== group) return;
    this.groups.delete(group.key);
    // There is no server-side unsubscribe yet: the subscription stays
    // registered until the socket closes, and its events are dropped here.
    if (this.groups.size === 0) this.close();
  }

  // Calls are chained per group so a re-register never races the previous one.
  private register(group: Group): Promise<void> {
    const run = group.registration
      .catch(() => undefined)
      .then(async () => {
        const kinds = group.options.on ?? ["create", "update", "delete"];
        const { query, variables, field } = buildSubscriptionMutation(group.entityKey, {
          select: group.options.select,
          filter: group.options.filter,
          id: group.serverId,
          connectionId: this.connectionId,
          onCreate: kinds.includes("create"),
          onUpdate: kinds.includes("update"),
          onDelete: kinds.includes("delete"),
        });
        try {
          const data = (await this.options.request(query, variables)) as Record<
            string,
            SubscriptionPayload | undefined
          >;
          const result = data[field]?.subscription;
          if (!result) throw new Error(`Unexpected response shape — missing ${field}`);
          group.serverId = result.id;
          this.webserviceUrl = result.webserviceUrl;
        } catch (error) {
          for (const listener of group.listeners) listener.onError?.(error);
          throw error;
        }
      });
    group.registration = run;
    return run;
  }

  private async reregisterAll(): Promise<void> {
    await Promise.all(
      Array.from(this.groups.values(), (group) => this.register(group).catch(() => undefined)),
    );
  }

  private reregisterFailed(): void {
    for (const group of this.groups.values()) {
      if (group.serverId === undefined) void this.register(group).catch(() => undefined);
    }
  }

  private async ensureSocket(): Promise<void> {
    const state = this.ws?.readyState;
    if (state === OPEN || state === CONNECTING) return this.connecting ?? undefined;
    if (this.connecting) return this.connecting;
    if (!this.webserviceUrl && !this.needsReregister) return;

    this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.needsReregister) {
      this.needsReregister = false;
      this.resyncPending = true;
      await this.reregisterAll();
    }
    if (this.manualClose || this.groups.size === 0) return;
    await this.openSocket();
  }

  private openSocket(): Promise<void> {
    const url = this.webserviceUrl;
    const WebSocketImpl = this.WebSocketImpl;
    if (!url || !WebSocketImpl) return Promise.resolve();

    this.status = this.reconnectAttempts > 0 ? "reconnecting" : "connecting";

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => settle(), CONNECT_SETTLE_TIMEOUT_MS);
      const settle = () => {
        clearTimeout(timeout);
        if (this.settleConnect === settle) this.settleConnect = null;
        resolve();
      };
      this.settleConnect = settle;

      const ws = new WebSocketImpl(url);
      this.ws = ws;

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        this.lastActivityAt = Date.now();
        if (this.pongTimer) {
          clearTimeout(this.pongTimer);
          this.pongTimer = null;
        }
        let message: Message;
        try {
          message = JSON.parse(typeof event.data === "string" ? event.data : "") as Message;
        } catch {
          return;
        }
        void this.handleMessage(ws, message);
      };
      ws.onclose = () => {
        settle();
        this.handleSocketLost(ws);
      };
      ws.onerror = () => {};
    });
  }

  // A replaced socket's late close must not touch its successor.
  private handleSocketLost(ws: WebSocketLike): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.clearHeartbeat();
    if (this.manualClose) {
      this.status = "closed";
      return;
    }
    this.needsReregister = true;
    this.scheduleReconnect();
  }

  private async handleMessage(ws: WebSocketLike, message: Message): Promise<void> {
    switch (message.operation) {
      case "connected":
      case "reauthenticate":
        await this.authenticate(ws);
        return;
      case "authenticated":
        this.status = "authenticated";
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        if (this.resyncPending) {
          this.resyncPending = false;
          this.resyncAll();
        }
        this.settleConnect?.();
        return;
      case "unauthenticated":
        // Reconnecting with backoff fetches a fresh credential without
        // hammering the server with one that keeps failing.
        this.dropSocket(ws);
        return;
      case "connectionNotFound":
        this.needsReregister = true;
        return;
      case "pong":
      case "invalidPacket":
        return;
      default:
        this.dispatch(message);
    }
  }

  private async authenticate(ws: WebSocketLike): Promise<void> {
    this.status = "authenticating";
    let credentials: Awaited<ReturnType<RealtimeOptions["auth"]>>;
    try {
      credentials = await this.options.auth();
    } catch {
      this.dropSocket(ws);
      return;
    }
    // The socket can close while the credential is being fetched.
    if (this.ws !== ws || ws.readyState !== OPEN) return;
    const payload = credentials.apiKey
      ? { pyloApiKey: credentials.apiKey }
      : credentials.token
        ? { authToken: credentials.token }
        : null;
    if (!payload) {
      this.dropSocket(ws);
      return;
    }
    ws.send(JSON.stringify({ operation: "authenticate", payload }));
  }

  private dispatch(message: Message): void {
    const [type, kind] = (message.operation ?? "").split(".");
    if (type !== "entity" || (kind !== "create" && kind !== "update" && kind !== "delete")) {
      return;
    }
    const id = message.payload?.data?.["id"];
    if (typeof id !== "string" || message.subscriptionId === undefined) return;

    const removed = kind === "delete" || message.payload?.membership?.inResultSet === false;
    const event: RealtimeEvent = removed
      ? { kind, id, removed }
      : { kind, id, removed, data: message.payload?.data ?? {} };

    for (const group of this.groups.values()) {
      if (group.serverId !== message.subscriptionId) continue;
      for (const listener of group.listeners) {
        try {
          listener.onEvent(event as never);
        } catch (error) {
          reportError(listener, error);
        }
      }
      return;
    }
  }

  private resyncAll(): void {
    for (const group of this.groups.values()) {
      for (const listener of group.listeners) {
        try {
          listener.onResync?.();
        } catch (error) {
          reportError(listener, error);
        }
      }
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.lastActivityAt = Date.now();
    this.heartbeatTimer = setInterval(() => this.probeLiveness(), HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.heartbeatTimer = null;
    this.pongTimer = null;
  }

  private probeLiveness(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return;
    try {
      ws.send(JSON.stringify({ operation: "ping" }));
    } catch {
      return;
    }
    if (this.pongTimer) return;
    // On a dead link the close handshake never completes and browsers hold
    // back `onclose` for up to a minute, so the socket is dropped right away.
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      this.dropSocket(ws);
    }, PONG_TIMEOUT_MS);
  }

  private dropSocket(ws: WebSocketLike): void {
    if (this.ws !== ws) return;
    try {
      ws.close();
    } catch {
      // Already closing.
    }
    this.handleSocketLost(ws);
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.groups.size === 0 || this.reconnectTimer) return;
    this.status = "reconnecting";
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempts += 1;
    // Jitter so many clients don't reconnect in lockstep after an outage.
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        void this.ensureSocket();
      },
      delay / 2 + Math.random() * (delay / 2),
    );
  }

  private closeSocket(): void {
    this.manualClose = true;
    this.clearHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.settleConnect?.();
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      // Already closing.
    }
    this.detachWindowEvents();
    this.status = "closed";
    this.reconnectAttempts = 0;
    this.needsReregister = false;
    this.resyncPending = false;
    // A fresh connection after a full close; the old one lapses server-side.
    this.connectionId = uuid();
    this.webserviceUrl = null;
  }

  private handleVisibility = (): void => {
    if (document.visibilityState === "visible") this.wake();
  };

  private attachWindowEvents(): void {
    if (this.windowEventsAttached || this.options.windowEvents === false) return;
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    if (typeof document === "undefined") return;
    window.addEventListener("online", this.wake);
    window.addEventListener("focus", this.wake);
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.windowEventsAttached = true;
  }

  private detachWindowEvents(): void {
    if (!this.windowEventsAttached) return;
    window.removeEventListener("online", this.wake);
    window.removeEventListener("focus", this.wake);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.windowEventsAttached = false;
  }
}

function reportError(listener: RealtimeHandlers<never>, error: unknown): void {
  if (listener.onError) listener.onError(error);
  else console.error("[pylo realtime]", error);
}

// The websocket-service only accepts lowercase v4 UUIDs as connection ids.
// Hermes (React Native) has no `crypto.randomUUID`.
function uuid(): string {
  const cryptoImpl = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoImpl?.randomUUID) return cryptoImpl.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, field]) => `${JSON.stringify(key)}:${stableStringify(field)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
