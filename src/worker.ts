// Entry point. Static files in ./public are served by Cloudflare directly; only
// /api/* and /ws/* reach this code (see run_worker_first in wrangler.jsonc).

import { GameRoom } from "./room";

export { GameRoom };

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
}

/** Changes with every deployment. Browsers compare it with the one they loaded and reload if it moved on. */
export const versionOf = (env: Env) => env.CF_VERSION_METADATA?.id || "dev";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I, so codes survive being read aloud
const CODE = /^[A-HJ-NP-Z2-9]{5}$/;

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/version") return Response.json({ version: versionOf(env) }, { headers: { "Cache-Control": "no-store" } });

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const made = await stub.fetch(`https://room/create?code=${code}`, { method: "POST" });
        if (made.ok) return Response.json({ code });
      }
      return Response.json({ error: "Could not open a room. Please try again." }, { status: 503 });
    }

    const ws = url.pathname.match(/^\/ws\/([A-Za-z0-9]{5})$/);
    if (ws) {
      const code = ws[1].toUpperCase();
      if (!CODE.test(code)) return new Response("No such room", { status: 404 });
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
