// The match itself, as plain functions over a plain object. No networking in here:
// the Durable Object (src/room.ts) feeds messages and alarms in, and sends views out.
// That keeps every rule testable without a server.

import { ACTIONS, BOT_NAMES, CATEGORIES, COLORS, GROUPS, ISSUES, MODEL, RULES, limits } from "./data";
import type { Headline } from "./headlines";
import { LAW_BY_ID, publicCatalogue } from "./laws";
import { actionCost, botReaction, clerk, compatibility, emptyPlatform, problem, randomLean, sanitize, sanitizeReaction } from "./rules";
import { NEUTRAL, allocateSeats, lawReport, makeRegions, makeWorld, mulberry32, runElection, shuffle } from "./sim";
import type { Contender, ElectionInput, PaintRegion, Platform, Reaction, Region, Results, Seats, Timeline, World } from "./sim";

export type Phase = "lobby" | "planning" | "counting" | "coalition" | "results" | "final";

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
  /** Half-time: the move chosen, and whether the player has decided (a pass counts). */
  reaction: Reaction | null;
  reacted: boolean;
  /** A knocked-out party may back one party still in the race; `endorsed` means it has decided. */
  endorse: string | null;
  endorsed: boolean;
  /** Coalition talks: the partner chosen, and whether the player has decided. */
  ally: string | null;
  allied: boolean;
}

export interface TickerItem extends Headline {
  id: number;
  /** server time at which to show it */
  t: number;
}

export interface Outcome {
  kind: "none" | "single" | "advance" | "national";
  winner: string | null;
  /** The winner's coalition partner, if it governs with one. */
  partner: string | null;
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
  settings: { simSec: number; planSec: number; quick: boolean };
  players: Player[];
  regions: Region[];
  world: World | null;
  deadline: number | null;
  count: { startedAt: number; periodMs: number; released: number; total: number; half: { until: number; done: boolean } | null } | null;
  countSeed: number;
  paint: PaintRegion[] | null;
  ticker: TickerItem[];
  nextHeadline: number;
  results1: Results | null;
  results2: Results | null;
  seats: Seats | null;
  outcome: Outcome | null;
}

export interface Store {
  room: Room;
  timeline: Timeline | null;
}

export type NewId = () => string;

const IDLE_MS = 3 * 60 * 60 * 1000;
/** The count pauses for half-time after this many of its ten periods. */
const HALF = Math.floor(RULES.ticks / 2);

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
    settings: { simSec: RULES.defaultSimSec, planSec: RULES.defaultPlanSec, quick: false },
    players: [],
    regions: [],
    world: null,
    deadline: null,
    count: null,
    countSeed: 0,
    paint: null,
    ticker: [],
    nextHeadline: 1,
    results1: null,
    results2: null,
    seats: null,
    outcome: null,
  };
}

const cleanName = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 28);
const freeColor = (room: Room) => COLORS.find((c) => !room.players.some((p) => p.color === c.id))?.id ?? COLORS[0].id;

const FRESH = { home: -1, gold: 0, locked: false, hasten: false, regional: null, national: null, qualified: false, eliminated: false, reaction: null, reacted: false, endorse: null, endorsed: false, ally: null, allied: false };

function newPlayer(room: Room, newId: NewId, name: string, bot: boolean): Player {
  return { id: newId(), token: newId(), name, color: freeColor(room), bot, connected: !bot, draft: emptyPlatform(), ...FRESH };
}

const PARTY_WORDS = ["Oak", "Lantern", "Harrow", "Anvil", "Heron", "Thistle", "Quill", "Barley"];

/** A newcomer takes a seat, if the match has not started and there is room. */
export function join(room: Room, newId: NewId, name?: string): Player | string {
  if (room.phase !== "lobby") return "This match has already started. Only the players already in it can watch.";
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
/** Active human players who are here to be waited for. */
const present = (room: Room) => active(room).filter((p) => !p.bot && p.connected);
const world = (room: Room) => room.world ?? NEUTRAL;

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
        if (room.players.some((p) => p !== me && p.color === msg.color)) return "Another party is already using that colour.";
        me.color = msg.color;
      }
      return null;
    }
    case "settings": {
      if (room.phase !== "lobby") return "Settings can only change in the lobby.";
      if (!mayHost(room, playerId)) return "Only the host can change the settings.";
      if ((RULES.simChoices as readonly number[]).includes(msg.simSec)) room.settings.simSec = msg.simSec;
      if ((RULES.planChoices as readonly number[]).includes(msg.planSec)) room.settings.planSec = msg.planSec;
      if (typeof msg.quick === "boolean" && msg.quick !== room.settings.quick) {
        room.settings.quick = msg.quick;
        // A quick game comes with shorter counts, a full game with the full five minutes.
        room.settings.simSec = msg.quick ? 120 : RULES.defaultSimSec;
      }
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
      if (!mayHost(room, playerId)) return "Only the host can end planning early.";
      lockEveryone(store, now);
      return null;
    }
    case "endorse": {
      if (room.phase !== "planning" || room.round !== 2 || !me.eliminated) return "Only a knocked-out party can endorse, and only before the national vote.";
      const target = byId(room, String(msg.id));
      me.endorse = target && !target.eliminated ? target.id : null;
      me.endorsed = true;
      maybeStartCount(store, now);
      return null;
    }
    case "react": {
      const half = room.count?.half;
      if (room.phase !== "counting" || !half || half.done || me.eliminated) return null;
      const current = room.round === 1 ? me.regional : me.national;
      me.reaction = current ? sanitizeReaction(msg.reaction, current, room.round, room.regions.length) : null;
      me.reacted = true;
      if (present(room).every((p) => p.reacted)) resolveHalf(store, now);
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
    case "ally": {
      if (room.phase !== "coalition" || me.eliminated) return null;
      const target = byId(room, String(msg.id));
      me.ally = target && !target.eliminated && target !== me ? target.id : null;
      me.allied = true;
      if (present(room).every((p) => p.allied)) resolveCoalition(store);
      return null;
    }
    case "next": {
      if (room.phase !== "results") return null;
      if (!mayHost(room, playerId)) return "Only the host can continue the match.";
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

function planContext(room: Room, p: Player) {
  const lim = limits(room.settings.quick);
  return {
    round: room.round,
    gold: p.gold,
    regions: room.regions.length,
    min: lim.min,
    max: lim.max,
    rivals: room.round === 2 ? active(room).filter((q) => q !== p).map((q) => q.id) : [],
  };
}

// ---------------------------------------------------------------- flow

function startMatch(store: Store, now: number) {
  const { room } = store;
  room.match++;
  const rng = mulberry32(room.seed + room.match * 7919 + (now % 100000));
  room.regions = makeRegions(room.players.length, rng);
  const homes = shuffle(room.players.map((_, i) => i), rng);
  room.world = makeWorld(rng);
  room.players.forEach((p, i) => Object.assign(p, FRESH, { home: homes[i], gold: RULES.startGold, draft: emptyPlatform() }));
  room.round = 1;
  room.attempt = 1;
  room.results1 = room.results2 = null;
  room.seats = null;
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
    Object.assign(p, { locked: false, hasten: false, reaction: null, reacted: false });
    if (p.bot && !p.eliminated) {
      p.draft = clerkFor(room, p, now, true);
      p.locked = true;
    }
  }
  maybeStartCount(store, now);
}

/** The clerk writes a platform: a whole one for a bot, or just the gaps for a player who ran out of time. */
function clerkFor(room: Room, p: Player, now: number, bot: boolean): Platform {
  const rng = mulberry32(room.seed + room.match * 31 + room.attempt * 101 + room.round * 7 + p.home * 13 + (now % 9973));
  return clerk({
    round: room.round,
    regions: room.round === 1 ? [room.regions[p.home]] : room.regions,
    home: room.round === 1 ? 0 : p.home,
    gold: p.gold,
    rng,
    noise: 5,
    lean: bot ? p.lean : undefined,
    keep: bot ? undefined : sanitize(p.draft, planContext(room, p)),
    full: bot,
    world: world(room),
    quick: room.settings.quick,
    rivals: room.round === 2 ? active(room).filter((q) => q !== p).map((q) => ({ id: q.id, laws: q.regional?.laws ?? [] })) : [],
  });
}

/** How long the count waits for knocked-out players to endorse once everyone else is ready. */
const ENDORSE_WAIT_MS = 20_000;

function maybeStartCount(store: Store, now: number) {
  const { room } = store;
  const players = active(room);
  if (!players.length || !players.some((p) => p.locked) || !players.every((p) => p.locked)) return;
  // Knocked-out players who are here get a short while to back someone before the vote.
  const undecided = room.round === 2 && room.players.some((p) => p.eliminated && !p.bot && p.connected && !p.endorsed);
  if (!undecided) return startCount(store, now);
  if (!room.deadline || room.deadline > now + ENDORSE_WAIT_MS) room.deadline = now + ENDORSE_WAIT_MS;
}

/** Time is up: whatever anyone has chosen stands, and a clerk fills in the rest. */
function lockEveryone(store: Store, now: number) {
  const { room } = store;
  for (const p of active(room)) {
    if (p.locked) continue;
    p.draft = clerkFor(room, p, now, false);
    p.locked = true;
  }
  startCount(store, now);
}

function electionInput(room: Room, reactions?: Record<string, Reaction | null>): ElectionInput {
  const periodMs = (room.settings.simSec * 1000) / RULES.ticks;
  const parties: Contender[] = active(room).map((p) => ({
    id: p.id,
    name: p.name,
    home: p.home,
    regional: p.regional!,
    national: p.national ?? undefined,
    endorsements: room.round === 2 ? room.players.filter((e) => e.eliminated && e.endorse === p.id).map((e) => ({ by: e.name, region: e.home })) : undefined,
  }));
  return {
    round: room.round,
    regions: room.regions,
    parties,
    seed: room.countSeed,
    q0: MODEL.q0 - MODEL.q0RestartStep * (room.attempt - 1) - (room.round === 2 ? MODEL.q0NationalShift : 0),
    world: world(room),
    norm: limits(room.settings.quick).norm,
    ticks: RULES.ticks,
    headlinesPerTick: Math.min(5, Math.max(1, Math.round(periodMs / 6000))),
    reactions,
    halfAt: HALF,
  };
}

function startCount(store: Store, now: number) {
  const { room } = store;
  for (const p of active(room)) {
    if (room.round === 1) p.regional = p.draft;
    else p.national = p.draft;
    p.gold -= actionCost(p.draft.actions);
  }
  room.countSeed = (room.seed + room.match * 104729 + room.attempt * 1299709 + room.round * 15485863 + (now % 1000003)) >>> 0;
  store.timeline = runElection(electionInput(room));
  room.phase = "counting";
  room.deadline = null;
  room.count = { startedAt: now + 1500, periodMs: (room.settings.simSec * 1000) / RULES.ticks, released: 0, total: RULES.ticks, half: null };
  room.paint = store.timeline.paints[0];
  room.ticker = [];
}

/** Release whatever part of the count is due, stopping for half-time on the way. */
function advanceCount(store: Store, now: number) {
  const { room } = store;
  const c = room.count;
  if (!c || !store.timeline) return;
  while (room.phase === "counting" && now >= c.startedAt + c.released * c.periodMs - 100) {
    if (c.half && !c.half.done) return;
    if (c.released === HALF && !c.half) {
      room.paint = store.timeline.paints[HALF];
      startHalf(store, now);
      continue;
    }
    const i = c.released++;
    room.paint = store.timeline.paints[i];
    if (i < c.total) {
      for (const h of store.timeline.headlines[i] ?? []) room.ticker.push({ ...h, id: room.nextHeadline++, t: Math.round(c.startedAt + (i + h.at) * c.periodMs) });
      room.ticker = room.ticker.slice(-60);
    } else {
      finishCount(store, now);
    }
  }
}

/** Half-time: the count stops and every party still standing gets one move. */
function startHalf(store: Store, now: number) {
  const { room } = store;
  room.count!.half = { until: now + RULES.halfTimeSec * 1000, done: false };
  for (const p of room.players) Object.assign(p, { reaction: null, reacted: false });
  if (!present(room).length) resolveHalf(store, now);
}

/** Everyone has moved (or time ran out): work out the second half with those moves in it. */
function resolveHalf(store: Store, now: number) {
  const { room } = store;
  const c = room.count;
  if (!c?.half || c.half.done) return;
  const reactions: Record<string, Reaction | null> = {};
  for (const p of active(room)) {
    if (p.bot) {
      const current = room.round === 1 ? p.regional! : p.national!;
      p.reaction = botReaction({ round: room.round, current, regions: room.regions, home: p.home, lean: p.lean, world: world(room), rng: mulberry32(room.countSeed + p.home * 97) });
    }
    reactions[p.id] = p.reaction;
  }
  if (Object.values(reactions).some(Boolean)) store.timeline = runElection(electionInput(room, reactions));
  c.half.done = true;
  // Pick the clock up where it stopped.
  c.startedAt = now - HALF * c.periodMs;
  advanceCount(store, now);
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
  // A law scrapped at half-time comes off the record.
  for (const p of standing) {
    const after = timeline.platformsAfter[p.id];
    if (!after) continue;
    if (room.round === 1) p.regional = after;
    else p.national = after;
  }
  store.timeline = null;

  if (room.round === 1) {
    room.results1 = res;
    for (const p of standing) p.qualified = res.parties[p.id].share >= RULES.qualifyShare;
    const through = standing.filter((p) => p.qualified);
    const ranking = standing.slice().sort((a, b) => res.parties[b.id].share - res.parties[a.id].share).map((p) => p.id);
    if (through.length === 0) {
      room.outcome = { kind: "none", winner: null, partner: null, ranking };
      room.phase = "results";
    } else if (through.length === 1) {
      room.outcome = { kind: "single", winner: through[0].id, partner: null, ranking };
      room.phase = "final";
    } else {
      room.outcome = { kind: "advance", winner: null, partner: null, ranking };
      room.phase = "results";
    }
    return;
  }

  room.results2 = res;
  const seats = (room.seats = allocateSeats(res, room.regions));
  const order = bySeats(room, standing.map((p) => p.id));
  // With three or more parties and nobody holding more than half the council, they must talk.
  if (standing.length >= 3 && seats.total[order[0]] * 2 <= seats.all) startCoalition(store, now);
  else {
    room.outcome = { kind: "national", winner: order[0], partner: null, ranking: order };
    room.phase = "final";
  }
}

const bySeats = (room: Room, ids: string[]) =>
  ids.slice().sort((a, b) => room.seats!.total[b] - room.seats!.total[a] || room.results2!.parties[b].votes - room.results2!.parties[a].votes);

// ---------------------------------------------------------------- coalition talks

function startCoalition(store: Store, now: number) {
  const { room } = store;
  room.phase = "coalition";
  room.deadline = now + RULES.coalitionSec * 1000;
  const standing = active(room);
  for (const p of standing) {
    p.ally = null;
    p.allied = false;
    if (!p.bot) continue;
    // A bot teams up with whoever's laws are most like its own, if anyone's are.
    let best: Player | null = null;
    let bestScore = 0;
    for (const q of standing) {
      if (q === p) continue;
      const score = compatibility(p, q, world(room));
      if (score > bestScore) [best, bestScore] = [q, score];
    }
    p.ally = best?.id ?? null;
    p.allied = true;
  }
  if (!present(room).length) resolveCoalition(store);
}

/** Two parties that chose each other govern together. The biggest bloc wins. */
function resolveCoalition(store: Store) {
  const { room } = store;
  if (room.phase !== "coalition") return;
  const seats = room.seats!;
  const standing = active(room);
  const blocs: Player[][] = [];
  const taken = new Set<string>();
  for (const p of standing) {
    if (taken.has(p.id)) continue;
    const q = p.ally ? standing.find((x) => x.id === p.ally && x.ally === p.id && !taken.has(x.id)) : undefined;
    const bloc = q ? [p, q] : [p];
    for (const m of bloc) taken.add(m.id);
    blocs.push(bloc);
  }
  const size = (b: Player[]) => b.reduce((a, m) => a + seats.total[m.id], 0);
  const votes = (b: Player[]) => b.reduce((a, m) => a + room.results2!.parties[m.id].votes, 0);
  const winners = blocs.reduce((a, b) => (size(b) > size(a) || (size(b) === size(a) && votes(b) > votes(a)) ? b : a));
  const [leader, partner] = bySeats(room, winners.map((m) => m.id));
  const rest = bySeats(room, standing.filter((p) => !winners.includes(p)).map((p) => p.id));
  room.outcome = { kind: "national", winner: leader, partner: partner ?? null, ranking: [leader, ...(partner ? [partner] : []), ...rest] };
  room.phase = "final";
  room.deadline = null;
}

// ---------------------------------------------------------------- between rounds

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
    p.endorse = null;
    p.endorsed = false;
    // Donations follow success: a better regional result fills the war chest for the national campaign.
    if (!p.eliminated) p.gold += RULES.donationBase + Math.round(room.results1!.parties[p.id].share * RULES.donationPerShare);
  }
  // A knocked-out bot backs whichever remaining party is most like it.
  for (const p of room.players) {
    if (!p.eliminated || !p.bot) continue;
    let best: Player | null = null;
    let bestScore = 0;
    for (const q of active(room)) {
      const score = compatibility(p, q, world(room));
      if (score > bestScore) [best, bestScore] = [q, score];
    }
    p.endorse = best?.id ?? null;
  }
  beginPlanning(store, now);
}

function backToLobby(store: Store) {
  const { room } = store;
  room.phase = "lobby";
  room.round = 1;
  room.attempt = 1;
  room.regions = [];
  room.world = null;
  room.deadline = null;
  room.count = null;
  room.paint = null;
  room.ticker = [];
  room.results1 = room.results2 = null;
  room.seats = null;
  room.outcome = null;
  store.timeline = null;
  for (const p of room.players) Object.assign(p, FRESH, { draft: emptyPlatform() });
}

// ---------------------------------------------------------------- time

const halfPending = (room: Room) => !!room.count?.half && !room.count.half.done;

/** When the room next needs waking, or null. */
export function nextAlarm(room: Room): number | null {
  if ((room.phase === "planning" || room.phase === "coalition") && room.deadline) return room.deadline;
  if (room.phase === "counting" && room.count) return halfPending(room) ? room.count.half!.until : room.count.startedAt + room.count.released * room.count.periodMs;
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
    if (halfPending(room)) {
      if (now >= room.count!.half!.until - 100) resolveHalf(store, now);
    } else advanceCount(store, now);
    return null;
  }
  if (room.phase === "coalition") {
    if (room.deadline && now >= room.deadline - 100) resolveCoalition(store);
    return null;
  }
  return now >= room.touchedAt + IDLE_MS - 100 ? "expire" : null;
}

export function setConnected(room: Room, playerId: string, connected: boolean) {
  const p = byId(room, playerId);
  if (p && !p.bot) p.connected = connected;
}

// ---------------------------------------------------------------- what a browser may see

const MOODS = ["furious", "unhappy", "unsure", "okay", "happy", "very happy"];
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
  const showNational = (room.phase === "final" || room.phase === "coalition") && room.results2 !== null;
  const final = room.phase === "final";
  const lim = limits(room.settings.quick);
  const issue = room.world && room.world.issue >= 0 ? ISSUES[room.world.issue] : null;

  let report: Record<string, { best: string[]; worst: string[] }> | null = null;
  let reveal: Record<string, string> | null = null;
  if (final) {
    report = {};
    reveal = {};
    for (const p of room.players) {
      const ids = [...(p.regional?.laws ?? []), ...(p.national?.laws ?? [])];
      if (!ids.length) continue;
      const scored = lawReport(ids, room.round === 2 && p.national ? room.regions : [room.regions[p.home]], world(room));
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
    limits: { min: lim.min, max: lim.max },
    issue: issue ? { name: issue.name, blurb: issue.blurb, cats: issue.cats } : null,
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
      reacted: me.reacted,
      endorse: me.endorse,
      endorsed: me.endorsed,
      ally: me.ally,
      allied: me.allied,
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
      // Whether someone has decided is public; what they decided is not.
      reacted: p.bot || p.reacted,
      allied: p.allied,
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
    count: room.count ? { startedAt: room.count.startedAt, periodMs: room.count.periodMs, released: room.count.released, total: room.count.total, half: halfPending(room) ? room.count.half!.until : null } : null,
    // While votes are still coming in the map is deliberately coarse: no exact numbers leak.
    paint: room.phase === "counting" && room.paint ? room.paint.map(coarse) : room.paint,
    ticker: room.ticker,
    results1: room.results1,
    results2: room.results2,
    seats: room.seats,
    outcome: room.outcome,
    report,
    reveal,
  };
}
