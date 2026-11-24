// The room: who is in it, which game it plays, and the lobby. The games themselves live in
// naval.ts (Silent Fleet) and trade.ts (Trade and Treachery). No networking in here: the
// Durable Object (src/room.ts) feeds messages and alarms in, and sends views out.

import { COUNTRIES, NAVAL, navalAlarm, navalHandle, navalTick, navalView, startNaval, type NavalState } from "./naval";
import { TRADE, startTrade, tradeAlarm, tradeHandle, tradeTick, tradeView, type TradeState } from "./trade";
import { COLORS } from "./util";

export type Mode = "naval" | "trade";
export type Phase = "lobby" | "battle" | "trading" | "final";

export interface Player {
  id: string;
  token: string;
  name: string;
  color: string;
  /** The country this player sails for in Silent Fleet. */
  country: string;
  bot: boolean;
  connected: boolean;
}

export interface Room {
  code: string;
  seed: number;
  createdAt: number;
  touchedAt: number;
  match: number;
  phase: Phase;
  hostId: string;
  settings: { mode: Mode; tradeSec?: number; tradeOpen?: boolean; tradeAutoReturn?: boolean };
  trade?: TradeState | null;
  naval?: NavalState | null;
  players: Player[];
}

export interface Store {
  room: Room;
}

export type NewId = () => string;

const IDLE_MS = 3 * 60 * 60 * 1000;
const modeOf = (room: Room): Mode => (room.settings.mode === "trade" ? "trade" : "naval");
const maxPlayers = (room: Room) => (modeOf(room) === "trade" ? TRADE.maxPlayers : NAVAL.maxPlayers);

// ---------------------------------------------------------------- lobby

export function createRoom(code: string, seed: number, now: number, mode: Mode = "naval"): Room {
  return { code, seed, createdAt: now, touchedAt: now, match: 0, phase: "lobby", hostId: "", settings: { mode }, trade: null, naval: null, players: [] };
}

const cleanName = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 28);
const freeColor = (room: Room) => COLORS.find((c) => !room.players.some((p) => p.color === c.id))?.id ?? COLORS[0].id;
const freeCountry = (room: Room) => {
  const open = COUNTRIES.filter((c) => !room.players.some((p) => p.country === c.id));
  return (open[(room.seed + room.players.length * 7) % Math.max(1, open.length)] ?? COUNTRIES[0]).id;
};

const NAME_WORDS = ["Oak", "Lantern", "Harrow", "Anvil", "Heron", "Thistle", "Quill", "Barley"];

/** A newcomer takes a seat, if the game has not started and there is room. */
export function join(room: Room, newId: NewId, name?: string): Player | string {
  if (room.phase !== "lobby") return "This game has already started. Only the players already in it can come back.";
  if (room.players.length >= maxPlayers(room)) return `This room is full (${maxPlayers(room)} players at most).`;
  const word = NAME_WORDS[(room.players.length + room.seed) % NAME_WORDS.length];
  const fallback = modeOf(room) === "trade" ? `The ${word} Party` : `Captain ${word}`;
  const player: Player = { id: newId(), token: newId(), name: cleanName(name) || fallback, color: freeColor(room), country: freeCountry(room), bot: false, connected: true };
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  return player;
}

export const byToken = (room: Room, token: unknown) => (typeof token === "string" ? room.players.find((p) => p.token === token) : undefined);
const byId = (room: Room, id: string) => room.players.find((p) => p.id === id);

/** The host runs the room; if the host has dropped out, anyone still here may. */
function mayHost(room: Room, playerId: string): boolean {
  if (playerId === room.hostId) return true;
  const host = byId(room, room.hostId);
  return !host || !host.connected;
}

// ---------------------------------------------------------------- messages from players

export function handle(store: Store, playerId: string, msg: any, now: number, newId: NewId): string | null {
  const { room } = store;
  const me = byId(room, playerId);
  if (!me) return "You are not seated in this room.";
  room.touchedAt = now;
  const type = typeof msg?.type === "string" ? msg.type : "";

  // Each game handles its own messages.
  if (type.startsWith("t.")) {
    if (room.phase !== "trading" || !room.trade) return null;
    const error = tradeHandle(room.trade, room.players, playerId, msg, now);
    if (room.trade.over) room.phase = "final";
    return error;
  }
  if (type.startsWith("n.")) {
    if (room.phase !== "battle" || !room.naval) return null;
    const error = navalHandle(room.naval, room.players, playerId, msg, now);
    if (room.naval.over) room.phase = "final";
    return error;
  }

  switch (type) {
    case "profile": {
      if (room.phase !== "lobby") return "Names, colours and countries are fixed once the game starts.";
      const name = cleanName(msg.name);
      if (name) me.name = name;
      if (typeof msg.color === "string" && COLORS.some((c) => c.id === msg.color)) {
        if (room.players.some((p) => p !== me && p.color === msg.color)) return "Another player is already using that colour.";
        me.color = msg.color;
      }
      if (typeof msg.country === "string" && COUNTRIES.some((c) => c.id === msg.country)) {
        if (room.players.some((p) => p !== me && p.country === msg.country)) return "Another player has already taken that country.";
        me.country = msg.country;
      }
      return null;
    }
    case "settings": {
      if (room.phase !== "lobby") return "Settings can only change in the lobby.";
      if (!mayHost(room, playerId)) return "Only the host can change the settings.";
      if (TRADE.lengths.includes(msg.tradeSec)) room.settings.tradeSec = msg.tradeSec;
      if (typeof msg.tradeOpen === "boolean") room.settings.tradeOpen = msg.tradeOpen;
      if (typeof msg.tradeAutoReturn === "boolean") room.settings.tradeAutoReturn = msg.tradeAutoReturn;
      return null;
    }
    case "remove": {
      if (room.phase !== "lobby") return "Players can only be removed in the lobby.";
      const target = byId(room, String(msg.id));
      if (!target) return null;
      if (target !== me && !mayHost(room, playerId)) return "Only the host can remove players.";
      room.players = room.players.filter((p) => p !== target);
      if (room.hostId === target.id) room.hostId = room.players[0]?.id ?? "";
      return null;
    }
    case "start": {
      if (room.phase !== "lobby") return "The game has already started.";
      if (!mayHost(room, playerId)) return "Only the host can start the game.";
      const seed = (room.seed + (room.match + 1) * 7919 + (now % 100000)) >>> 0;
      if (modeOf(room) === "trade") {
        if (room.players.length < TRADE.minPlayers) return "Trade and Treachery needs at least three players.";
        room.match++;
        room.trade = startTrade(room.players, room.settings.tradeSec ?? TRADE.defaultLength, seed, now, { open: room.settings.tradeOpen ?? true, autoReturn: room.settings.tradeAutoReturn ?? true });
        room.phase = "trading";
        return null;
      }
      if (room.players.length < NAVAL.minPlayers) return "Silent Fleet needs at least two players. Send a friend the link.";
      room.match++;
      room.naval = startNaval(room.players, seed, now);
      room.phase = "battle";
      return null;
    }
    case "leave": {
      // In the lobby the seat is given up. Once a game is running the ship or country stays on the
      // board (others may be dealing with it), and the room simply passes to someone who is still here.
      if (room.phase === "lobby") room.players = room.players.filter((p) => p !== me);
      if (room.hostId === me.id) room.hostId = room.players.find((p) => p !== me && p.connected)?.id ?? room.players.find((p) => p !== me)?.id ?? "";
      return null;
    }
    case "newGame": {
      // The host may take everyone back to the lobby at any time, ending the game in progress.
      if (room.phase === "lobby") return null;
      if (!mayHost(room, playerId)) return "Only the host can take everyone back to the lobby.";
      backToLobby(room);
      return null;
    }
    default:
      return "Unknown message.";
  }
}

function backToLobby(room: Room) {
  room.phase = "lobby";
  room.trade = null;
  room.naval = null;
}

// ---------------------------------------------------------------- time

/** When the room next needs waking, or null. */
export function nextAlarm(room: Room): number | null {
  if (room.phase === "trading" && room.trade) return tradeAlarm(room.trade);
  if (room.phase === "battle" && room.naval) return navalAlarm(room.naval) ?? room.touchedAt + IDLE_MS;
  return room.touchedAt + IDLE_MS;
}

/** Called when the alarm goes off. Returns "expire" when the room should be deleted. */
export function onAlarm(store: Store, now: number): "expire" | null {
  const { room } = store;
  if ((room.phase === "trading" && !room.trade) || (room.phase === "battle" && !room.naval)) {
    backToLobby(room); // should never happen; never leave a room stuck between two games
    return null;
  }
  if (room.phase === "trading" && room.trade) {
    tradeTick(room.trade, room.players, now + 100);
    if (room.trade.over) room.phase = "final";
    return null;
  }
  if (room.phase === "battle" && room.naval) {
    navalTick(room.naval, room.players, now + 100);
    if (room.naval.over) room.phase = "final";
    return null;
  }
  return now >= room.touchedAt + IDLE_MS - 100 ? "expire" : null;
}

export function setConnected(room: Room, playerId: string, connected: boolean) {
  const p = byId(room, playerId);
  if (p) p.connected = connected;
}

// ---------------------------------------------------------------- what a browser may see

/** Sent once on connecting: the rules that never change. */
export function welcome(player: Player) {
  return { type: "welcome", you: { id: player.id, token: player.token }, colors: COLORS, countries: COUNTRIES, tradeRules: TRADE, navalRules: NAVAL };
}

export function view(room: Room, playerId: string, now: number) {
  const me = byId(room, playerId)!;
  return {
    type: "state",
    now,
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    settings: room.settings,
    mode: modeOf(room),
    maxPlayers: maxPlayers(room),
    trade: room.trade ? tradeView(room.trade, playerId, now) : null,
    naval: room.naval ? navalView(room.naval, playerId, now) : null,
    you: { id: me.id, mayHost: mayHost(room, playerId) },
    players: room.players.map((p) => ({ id: p.id, name: p.name, color: p.color, country: p.country, bot: false, connected: p.connected })),
  };
}
