// The match itself, as plain functions over a plain object. No networking in here:
// the Durable Object (src/room.ts) feeds messages and alarms in, and sends views out.
// That keeps every rule testable without a server.

import { ACTIONS, BOT_NAMES, CATEGORIES, COLORS, GROUPS, MODEL, RULES } from "./data";
import type { Headline } from "./headlines";
import { LAW_BY_ID, publicCatalogue } from "./laws";
import { actionCost, clerk, emptyPlatform, problem, randomLean, sanitize } from "./rules";
import { lawReport, makeRegions, mulberry32, runElection, shuffle } from "./sim";
import type { Contender, PaintRegion, Platform, Region, Results, Timeline } from "./sim";

export type Phase = "lobby" | "planning" | "counting" | "results" | "final";

export interface Player {
  id: string;
  token: string;
  name: string;
  color: string;
  bot: boolean;
  connected: boolean;
  home: number;
  gold: number;
  locked: boolean;
  hasten: boolean;
  draft: Platform;
  regional: Platform | null;
  national: Platform | null;
  qualified: boolean;
  eliminated: boolean;
  lean?: number[];
}

export interface TickerItem extends Headline {
  id: number;
  /** server time at which to show it */
  t: number;
}

export interface Outcome {
  kind: "none" | "single" | "advance" | "national";
  winner: string | null;
  ranking: string[];
}

export interface Room {
  code: string;
  seed: number;
  createdAt: number;
  touchedAt: number;
  match: number;
  phase: Phase;
  round: 1 | 2;
  attempt: number;
  hostId: string;
  settings: { simSec: number; planSec: number };
  players: Player[];
  regions: Region[];
  deadline: number | null;
  count: { startedAt: number; periodMs: number; released: number; total: number } | null;
  paint: PaintRegion[] | null;
  ticker: TickerItem[];
  nextHeadline: number;
  results1: Results | null;
  results2: Results | null;
  outcome: Outcome | null;
}

export interface Store {
  room: Room;
  timeline: Timeline | null;
}

export type NewId = () => string;

const IDLE_MS = 3 * 60 * 60 * 1000;

// ---------------------------------------------------------------- lobby

export function createRoom(code: string, seed: number, now: number): Room {
  return {
    code,
    seed,
    createdAt: now,
    touchedAt: now,
    match: 0,
    phase: "lobby",
    round: 1,
    attempt: 1,
    hostId: "",
    settings: { simSec: RULES.defaultSimSec, planSec: RULES.defaultPlanSec },
    players: [],
    regions: [],
    deadline: null,
    count: null,
    paint: null,
    ticker: [],
    nextHeadline: 1,
    results1: null,
    results2: null,
    outcome: null,
  };
}

const cleanName = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 28);
const freeColor = (room: Room) => COLORS.find((c) => !room.players.some((p) => p.color === c.id))?.id ?? COLORS[0].id;

function newPlayer(room: Room, newId: NewId, name: string, bot: boolean): Player {
  return {
    id: newId(),
    token: newId(),
    name,
    color: freeColor(room),
    bot,
    connected: !bot,
    home: -1,
    gold: 0,
    locked: false,
    hasten: false,
    draft: emptyPlatform(),
    regional: null,
    national: null,
    qualified: false,
    eliminated: false,
  };
}

const PARTY_WORDS = ["Oak", "Lantern", "Harrow", "Anvil", "Heron", "Thistle", "Quill", "Barley"];

/** A newcomer takes a seat, if the match has not started and there is room. */
export function join(room: Room, newId: NewId, name?: string): Player | string {
  if (room.phase !== "lobby") return "This match has already started, and only its players can watch it.";
  if (room.players.length >= RULES.maxPlayers) return "This room is full (five parties at most).";
  const fallback = `The ${PARTY_WORDS[(room.players.length + room.seed) % PARTY_WORDS.length]} Party`;
  const player = newPlayer(room, newId, cleanName(name) || fallback, false);
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  return player;
}

export const byToken = (room: Room, token: unknown) => (typeof token === "string" ? room.players.find((p) => !p.bot && p.token === token) : undefined);
const byId = (room: Room, id: string) => room.players.find((p) => p.id === id);
const active = (room: Room) => room.players.filter((p) => !p.eliminated);

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

  switch (msg?.type) {
    case "profile": {
      if (room.phase !== "lobby") return "Names and colours are fixed once the match starts.";
      const name = cleanName(msg.name);
      if (name) me.name = name;
      if (typeof msg.color === "string" && COLORS.some((c) => c.id === msg.color)) {
        if (room.players.some((p) => p !== me && p.color === msg.color)) return "Another party already flies that colour.";
        me.color = msg.color;
      }
      return null;
    }
    case "settings": {
      if (room.phase !== "lobby") return "Settings can only change in the lobby.";
      if (!mayHost(room, playerId)) return "Only the host can change the settings.";
      if ((RULES.simChoices as readonly number[]).includes(msg.simSec)) room.settings.simSec = msg.simSec;
      if ((RULES.planChoices as readonly number[]).includes(msg.planSec)) room.settings.planSec = msg.planSec;
      return null;
    }
    case "addBot": {
      if (room.phase !== "lobby") return "Bots can only join in the lobby.";
      if (!mayHost(room, playerId)) return "Only the host can add bots.";
      if (room.players.length >= RULES.maxPlayers) return "The room is full.";
      const name = BOT_NAMES.find((n) => !room.players.some((p) => p.name === n)) ?? "The Spare Party";
      const bot = newPlayer(room, newId, name, true);
      bot.lean = randomLean(mulberry32(room.seed + room.players.length * 977 + now));
      room.players.push(bot);
      return null;
    }
    case "remove": {
      if (room.phase !== "lobby") return "Players can only be removed in the lobby.";
      const target = byId(room, String(msg.id));
      if (!target) return null;
      if (target !== me && !mayHost(room, playerId)) return "Only the host can remove players.";
      room.players = room.players.filter((p) => p !== target);
      if (room.hostId === target.id) room.hostId = room.players.find((p) => !p.bot)?.id ?? "";
      return null;
    }
    case "start": {
      if (room.phase !== "lobby") return "The match has already started.";
      if (!mayHost(room, playerId)) return "Only the host can start the match.";
      if (room.players.length < RULES.minPlayers) return "You need at least two parties. Invite a friend or add a bot.";
      startMatch(store, now);
      return null;
    }
    case "draft": {
      if (room.phase !== "planning" || me.eliminated || me.locked) return null;
      me.draft = sanitize(msg.platform, planContext(room, me));
      return null;
    }
    case "lock": {
      if (room.phase !== "planning") return "There is nothing to lock in right now.";
      if (me.eliminated) return "You are watching this round.";
      const platform = sanitize(msg.platform ?? me.draft, planContext(room, me));
      const why = problem(platform, planContext(room, me));
      if (why) return why;
      me.draft = platform;
      me.locked = true;
      maybeStartCount(store, now);
      return null;
    }
    case "unlock": {
      if (room.phase !== "planning" || me.eliminated) return null;
      me.locked = false;
      return null;
    }
    case "forceLock": {
      if (room.phase !== "planning") return null;
      if (!mayHost(room, playerId)) return "Only the host can call time.";
      lockEveryone(store, now);
      return null;
    }
    case "hasten": {
      if (room.phase !== "counting") return null;
      me.hasten = true;
      const humans = room.players.filter((p) => !p.bot && p.connected);
      const voters = humans.some((p) => !p.eliminated) ? humans.filter((p) => !p.eliminated) : humans;
      if (voters.length && voters.every((p) => p.hasten)) finishCount(store, now);
      return null;
    }
    case "next": {
      if (room.phase !== "results") return null;
      if (!mayHost(room, playerId)) return "Only the host can move the match on.";
      if (room.outcome?.kind === "none") restartRegional(store, now);
      else if (room.outcome?.kind === "advance") startNational(store, now);
      return null;
    }
    case "newGame": {
      if (room.phase !== "final" && room.phase !== "results") return null;
      if (!mayHost(room, playerId)) return "Only the host can start a new match.";
      backToLobby(store);
      return null;
    }
    default:
      return "Unknown message.";
  }
}

const planContext = (room: Room, p: Player) => ({ round: room.round, gold: p.gold, regions: room.regions.length });

// ---------------------------------------------------------------- flow

function startMatch(store: Store, now: number) {
  const { room } = store;
  room.match++;
  const rng = mulberry32(room.seed + room.match * 7919 + (now % 100000));
  room.regions = makeRegions(room.players.length, rng);
  const homes = shuffle(room.players.map((_, i) => i), rng);
  room.players.forEach((p, i) => {
    Object.assign(p, { home: homes[i], gold: RULES.startGold, regional: null, national: null, qualified: false, eliminated: false, draft: emptyPlatform() });
  });
  room.round = 1;
  room.attempt = 1;
  room.results1 = room.results2 = null;
  room.outcome = null;
  beginPlanning(store, now);
}

function beginPlanning(store: Store, now: number) {
  const { room } = store;
  room.phase = "planning";
  room.deadline = room.settings.planSec ? now + room.settings.planSec * 1000 : null;
  room.count = null;
  room.paint = null;
  room.ticker = [];
  store.timeline = null;
  for (const p of room.players) {
    p.locked = false;
    p.hasten = false;
    if (p.bot && !p.eliminated) {
      p.draft = botPlatform(room, p, now);
      p.locked = true;
    }
  }
  maybeStartCount(store, now);
}

function botPlatform(room: Room, p: Player, now: number): Platform {
  const rng = mulberry32(room.seed + room.match * 31 + room.attempt * 101 + room.round * 7 + p.home * 13 + (now % 9973));
  return clerk({
    round: room.round,
    regions: room.round === 1 ? [room.regions[p.home]] : room.regions,
    home: room.round === 1 ? 0 : p.home,
    gold: p.gold,
    rng,
    noise: 5,
    lean: p.lean,
    full: true,
  });
}

function maybeStartCount(store: Store, now: number) {
  const players = active(store.room);
  if (players.length && players.every((p) => p.locked)) startCount(store, now);
}

/** Time is up: whatever anyone has chosen stands, and a clerk fills in the rest. */
function lockEveryone(store: Store, now: number) {
  const { room } = store;
  for (const p of active(room)) {
    if (p.locked) continue;
    const ctx = planContext(room, p);
    const kept = sanitize(p.draft, ctx);
    p.draft = clerk({
      round: room.round,
      regions: room.round === 1 ? [room.regions[p.home]] : room.regions,
      home: room.round === 1 ? 0 : p.home,
      gold: p.gold,
      rng: mulberry32(room.seed + p.home * 17 + (now % 9973)),
      noise: 5,
      keep: kept,
      full: false,
    });
    p.locked = true;
  }
  startCount(store, now);
}

function startCount(store: Store, now: number) {
  const { room } = store;
  const K = RULES.ticks;
  const parties: Contender[] = [];
  for (const p of active(room)) {
    if (room.round === 1) p.regional = p.draft;
    else p.national = p.draft;
    p.gold -= actionCost(p.draft.actions);
    parties.push({ id: p.id, name: p.name, home: p.home, regional: p.regional!, national: p.national ?? undefined });
  }
  const periodMs = (room.settings.simSec * 1000) / K;
  store.timeline = runElection({
    round: room.round,
    regions: room.regions,
    parties,
    seed: (room.seed + room.match * 104729 + room.attempt * 1299709 + room.round * 15485863 + (now % 1000003)) >>> 0,
    q0: MODEL.q0 - MODEL.q0RestartStep * (room.attempt - 1),
    ticks: K,
    headlinesPerTick: Math.min(5, Math.max(1, Math.round(periodMs / 6000))),
  });
  room.phase = "counting";
  room.deadline = null;
  room.count = { startedAt: now + 1500, periodMs, released: 0, total: K };
  room.paint = store.timeline.paints[0];
  room.ticker = [];
}

/** Release whatever part of the count is due. */
function advanceCount(store: Store, now: number) {
  const { room, timeline } = store;
  const c = room.count;
  if (!c || !timeline) return;
  while (room.phase === "counting" && now >= c.startedAt + c.released * c.periodMs - 100) {
    const i = c.released++;
    room.paint = timeline.paints[i];
    if (i < c.total) {
      for (const h of timeline.headlines[i] ?? []) room.ticker.push({ ...h, id: room.nextHeadline++, t: Math.round(c.startedAt + (i + h.at) * c.periodMs) });
      room.ticker = room.ticker.slice(-60);
    } else {
      finishCount(store, now);
    }
  }
}

function finishCount(store: Store, now: number) {
  const { room, timeline } = store;
  if (!timeline || room.phase !== "counting") return;
  const res = timeline.results;
  room.paint = timeline.paints[timeline.paints.length - 1];
  room.count = null;
  room.regions.forEach((r, i) => (r.sat = timeline.satAfter[i]));
  // Anything not yet shown is no longer news.
  room.ticker = room.ticker.filter((h) => h.t <= now);
  const standing = active(room);

  if (room.round === 1) {
    room.results1 = res;
    for (const p of standing) p.qualified = res.parties[p.id].share >= RULES.qualifyShare;
    const through = standing.filter((p) => p.qualified);
    const ranking = standing.slice().sort((a, b) => res.parties[b.id].share - res.parties[a.id].share).map((p) => p.id);
    if (through.length === 0) {
      room.outcome = { kind: "none", winner: null, ranking };
      room.phase = "results";
    } else if (through.length === 1) {
      room.outcome = { kind: "single", winner: through[0].id, ranking };
      room.phase = "final";
    } else {
      room.outcome = { kind: "advance", winner: null, ranking };
      room.phase = "results";
    }
  } else {
    room.results2 = res;
    const ranking = standing.slice().sort((a, b) => res.parties[b.id].share - res.parties[a.id].share).map((p) => p.id);
    room.outcome = { kind: "national", winner: ranking[0], ranking };
    room.phase = "final";
  }
  store.timeline = null;
}

function restartRegional(store: Store, now: number) {
  const { room } = store;
  room.attempt++;
  room.results1 = null;
  room.outcome = null;
  for (const r of room.regions) r.sat = r.sat0.slice();
  for (const p of room.players) {
    p.gold += RULES.roundIncome;
    p.qualified = false;
    p.draft = { ...(p.regional ?? emptyPlatform()), actions: [] };
    p.regional = null;
  }
  beginPlanning(store, now);
}

function startNational(store: Store, now: number) {
  const { room } = store;
  room.round = 2;
  room.outcome = null;
  for (const p of room.players) {
    p.eliminated = !p.qualified;
    p.draft = emptyPlatform();
    if (!p.eliminated) p.gold += RULES.roundIncome;
  }
  beginPlanning(store, now);
}

function backToLobby(store: Store) {
  const { room } = store;
  room.phase = "lobby";
  room.round = 1;
  room.attempt = 1;
  room.regions = [];
  room.deadline = null;
  room.count = null;
  room.paint = null;
  room.ticker = [];
  room.results1 = room.results2 = null;
  room.outcome = null;
  store.timeline = null;
  for (const p of room.players)
    Object.assign(p, { home: -1, gold: 0, locked: false, hasten: false, draft: emptyPlatform(), regional: null, national: null, qualified: false, eliminated: false });
}

// ---------------------------------------------------------------- time

/** When the room next needs waking, or null. */
export function nextAlarm(room: Room): number | null {
  if (room.phase === "planning" && room.deadline) return room.deadline;
  if (room.phase === "counting" && room.count) return room.count.startedAt + room.count.released * room.count.periodMs;
  return room.touchedAt + IDLE_MS;
}

/** Called when the alarm goes off. Returns "expire" when the room should be deleted. */
export function onAlarm(store: Store, now: number): "expire" | null {
  const { room } = store;
  if (room.phase === "planning") {
    if (room.deadline && now >= room.deadline - 100) lockEveryone(store, now);
    return null;
  }
  if (room.phase === "counting") {
    advanceCount(store, now);
    return null;
  }
  return now >= room.touchedAt + IDLE_MS - 100 ? "expire" : null;
}

export function setConnected(room: Room, playerId: string, connected: boolean) {
  const p = byId(room, playerId);
  if (p && !p.bot) p.connected = connected;
}

// ---------------------------------------------------------------- what a browser may see

const MOODS = ["mutinous", "restless", "uneasy", "settled", "content", "thriving"];
const mood = (sat: number) => MOODS[Math.min(5, Math.max(0, Math.floor((sat - 10) / 15)))];

const round2 = (x: number) => Math.round(x * 50) / 50;
const coarse = (p: PaintRegion): PaintRegion => ({ p: Object.fromEntries(Object.entries(p.p).map(([id, x]) => [id, round2(x)])), old: round2(p.old) });

/** Sent once on connecting: the rules and the public face of the catalogue. */
export function welcome(player: Player) {
  return {
    type: "welcome",
    you: { id: player.id, token: player.token },
    catalogue: publicCatalogue(),
    categories: CATEGORIES,
    actions: ACTIONS,
    groups: GROUPS,
    colors: COLORS,
    rules: RULES,
  };
}

export function view(room: Room, playerId: string, now: number) {
  const me = byId(room, playerId)!;
  const showRegional = room.results1 !== null;
  const showNational = room.phase === "final" && room.results2 !== null;
  const final = room.phase === "final";

  let report: Record<string, { best: string[]; worst: string[] }> | null = null;
  let reveal: Record<string, string> | null = null;
  if (final) {
    report = {};
    reveal = {};
    for (const p of room.players) {
      const ids = [...(p.regional?.laws ?? []), ...(p.national?.laws ?? [])];
      if (!ids.length) continue;
      const scored = lawReport(ids, room.round === 2 && p.national ? room.regions : [room.regions[p.home]]);
      report[p.id] = { best: scored.slice(0, 3).map((s) => s.id), worst: scored.slice(-3).reverse().map((s) => s.id) };
      for (const id of ids) reveal[id] = LAW_BY_ID[id].down;
    }
  }

  return {
    type: "state",
    now,
    code: room.code,
    phase: room.phase,
    round: room.round,
    attempt: room.attempt,
    hostId: room.hostId,
    settings: room.settings,
    you: {
      id: me.id,
      gold: me.gold,
      home: me.home,
      locked: me.locked,
      hasten: me.hasten,
      draft: me.draft,
      eliminated: me.eliminated,
      qualified: me.qualified,
      mayHost: mayHost(room, playerId),
    },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      bot: p.bot,
      connected: p.connected,
      locked: p.locked,
      home: p.home,
      qualified: p.qualified,
      eliminated: p.eliminated,
      regional: showRegional || p === me ? p.regional : null,
      national: showNational || p === me ? p.national : null,
    })),
    regions: room.regions.map((r) => ({
      name: r.name,
      capital: r.capital,
      kind: r.kind,
      blurb: r.blurb,
      pop: r.pop,
      mix: r.mix.map((m) => Math.round(m * 100)),
      mood: r.sat.map(mood),
    })),
    deadline: room.deadline,
    count: room.count,
    // While votes are still coming in the map is deliberately coarse: no exact numbers leak.
    paint: room.phase === "counting" && room.paint ? room.paint.map(coarse) : room.paint,
    ticker: room.ticker,
    results1: room.results1,
    results2: room.results2,
    outcome: room.outcome,
    report,
    reveal,
  };
}
