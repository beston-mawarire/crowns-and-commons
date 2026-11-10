// One Durable Object per game room. It owns the room's state, talks to the players'
// browsers over hibernatable WebSockets, and uses a single alarm as its clock, so it
// costs nothing while everyone is thinking or while the votes are "coming in".

import { DurableObject } from "cloudflare:workers";
import { byToken, createRoom, handle, join, nextAlarm, onAlarm, setConnected, view, welcome, type Store } from "./game/game";
import type { Room } from "./game/game";
import type { Timeline } from "./game/sim";
import { versionOf, type Env } from "./worker";

interface Attachment {
  pid?: string;
}

export class GameRoom extends DurableObject<Env> {
  private store: Store | null | undefined = undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private async load(): Promise<Store | null> {
    if (this.store === undefined) {
      const room = await this.ctx.storage.get<Room>("room");
      const timeline = (await this.ctx.storage.get<Timeline>("timeline")) ?? null;
      this.store = room ? { room, timeline } : null;
    }
    return this.store;
  }

  /** Persist, reset the clock, and tell everyone what they are allowed to know. */
  private async commit(store: Store) {
    await this.ctx.storage.put("room", store.room);
    if (store.timeline) await this.ctx.storage.put("timeline", store.timeline);
    else await this.ctx.storage.delete("timeline");
    const at = nextAlarm(store.room);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 20));
    this.broadcast(store);
  }

  private broadcast(store: Store) {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const pid = (ws.deserializeAttachment() as Attachment | null)?.pid;
      if (!pid || !store.room.players.some((p) => p.id === pid)) continue;
      try {
        ws.send(JSON.stringify(view(store.room, pid, now)));
      } catch {
        // The socket is on its way out; webSocketClose will tidy up.
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/create" && request.method === "POST") {
      if (await this.load()) return new Response("exists", { status: 409 });
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      this.store = { room: createRoom(url.searchParams.get("code") ?? "", seed, Date.now(), url.searchParams.get("game") === "trade" ? "trade" : "election"), timeline: null };
      await this.commit(this.store);
      return new Response("ok");
    }

    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({} satisfies Attachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: any;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const fail = (message: string, fatal = false) => ws.send(JSON.stringify({ type: "error", message, fatal }));
    const store = await this.load();
    if (!store) return fail("There is no room with that code.", true);
    const now = Date.now();
    const att = (ws.deserializeAttachment() as Attachment | null) ?? {};

    if (msg?.type === "hello") {
      const player = byToken(store.room, msg.token) ?? join(store.room, () => crypto.randomUUID(), msg.name);
      if (typeof player === "string") return fail(player, true);
      ws.serializeAttachment({ pid: player.id } satisfies Attachment);
      setConnected(store.room, player.id, true);
      store.room.touchedAt = now;
      ws.send(JSON.stringify({ ...welcome(player), version: versionOf(this.env) }));
      return this.commit(store);
    }

    if (!att.pid) return fail("Say hello first.");
    const error = handle(store, att.pid, msg, now, () => crypto.randomUUID());
    if (error) fail(error);
    // A player who removed themselves from the lobby no longer has a seat.
    if (!store.room.players.some((p) => p.id === att.pid)) ws.serializeAttachment({} satisfies Attachment);
    // Drafts are private and frequent: save them without waking every browser.
    if (msg?.type === "draft") return void (await this.ctx.storage.put("room", store.room));
    return this.commit(store);
  }

  async webSocketClose(ws: WebSocket) {
    await this.dropped(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.dropped(ws);
  }

  private async dropped(ws: WebSocket) {
    const store = await this.load();
    const pid = (ws.deserializeAttachment() as Attachment | null)?.pid;
    if (!store || !pid) return;
    const stillHere = this.ctx.getWebSockets().some((other) => other !== ws && (other.deserializeAttachment() as Attachment | null)?.pid === pid);
    if (stillHere) return;
    setConnected(store.room, pid, false);
    await this.commit(store);
  }

  async alarm() {
    const store = await this.load();
    if (!store) return;
    if (onAlarm(store, Date.now()) === "expire") {
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, "This room has closed.");
      await this.ctx.storage.deleteAll();
      this.store = null;
      return;
    }
    await this.commit(store);
  }
}
