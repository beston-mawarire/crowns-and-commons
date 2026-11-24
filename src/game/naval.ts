// Silent Fleet: hidden ships on a big grid, played live.
//
// Every player commands one ship, three squares long. Nobody can see anybody else. Action
// points arrive every thirty seconds and are spent on sailing, turning, radar and gunfire.
// A radar ping shows who is near, and tells them they have been seen. Shots are fired blind
// at any square within range, and range can be bought. Alliances share positions until they
// run out or are broken; they do not stop anyone firing. The last ship afloat wins.
//
// Like the trading game, this file is plain functions over a plain object, so every rule
// can be tested without a server.

import { mulberry32 } from "./util";

export const COUNTRIES = [
  { id: "za", name: "South Africa", flag: "🇿🇦" },
  { id: "zw", name: "Zimbabwe", flag: "🇿🇼" },
  { id: "ng", name: "Nigeria", flag: "🇳🇬" },
  { id: "ke", name: "Kenya", flag: "🇰🇪" },
  { id: "eg", name: "Egypt", flag: "🇪🇬" },
  { id: "gh", name: "Ghana", flag: "🇬🇭" },
  { id: "gb", name: "Britain", flag: "🇬🇧" },
  { id: "fr", name: "France", flag: "🇫🇷" },
  { id: "de", name: "Germany", flag: "🇩🇪" },
  { id: "it", name: "Italy", flag: "🇮🇹" },
  { id: "es", name: "Spain", flag: "🇪🇸" },
  { id: "no", name: "Norway", flag: "🇳🇴" },
  { id: "us", name: "United States", flag: "🇺🇸" },
  { id: "ca", name: "Canada", flag: "🇨🇦" },
  { id: "mx", name: "Mexico", flag: "🇲🇽" },
  { id: "br", name: "Brazil", flag: "🇧🇷" },
  { id: "ar", name: "Argentina", flag: "🇦🇷" },
  { id: "jp", name: "Japan", flag: "🇯🇵" },
  { id: "cn", name: "China", flag: "🇨🇳" },
  { id: "in", name: "India", flag: "🇮🇳" },
  { id: "kr", name: "South Korea", flag: "🇰🇷" },
  { id: "au", name: "Australia", flag: "🇦🇺" },
  { id: "nz", name: "New Zealand", flag: "🇳🇿" },
  { id: "tr", name: "Turkey", flag: "🇹🇷" },
];

export const NAVAL = {
  minPlayers: 2,
  maxPlayers: 8,
  /** A turn: action points arrive this often. */
  turnMs: 30_000,
  apStart: 2,
  apPerTurn: 2,
  apMax: 10,
  cost: { move: 1, turn: 1, ping: 2, fire: 3, range: 3 },
  /** A ship sinks after this many hits. */
  hull: 3,
  /**
   * How far guns and radar reach, counted in squares from the nearest part of the ship. Both
   * start short; each "increase range" adds one square to both, up to these limits.
   */
  rangeStart: 2,
  fireRange: 6,
  radarRange: 5,
  /** A shell that misses is seen by any ship this close to where it lands. */
  splashRange: 2,
  /** Action points for sinking a ship. */
  sinkBonus: 3,
  /** How long an alliance can be made for, in turns. */
  allianceTurns: [2, 4, 6, 10],
  /** Radar sightings are wiped after this many turns. */
  sightingTurns: 6,
  /** The storm: from this turn the edges of the map become deadly, closing in one more row every few turns. */
  stormStart: 12,
  stormEvery: 2,
  stormMinSafe: 6,
  /** Map sizes the host may choose instead of the automatic one. */
  sizes: [18, 22, 26, 30],
};

/** The sea is bigger with more ships on it. */
export const gridSize = (players: number) => (players <= 3 ? 18 : players <= 5 ? 22 : 26);

/** North, east, south, west. The y axis runs down the screen. */
const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface Ship {
  /** The middle square, and which way the bow points (0 north, 1 east, 2 south, 3 west). */
  x: number;
  y: number;
  dir: number;
  hull: number;
  ap: number;
  alive: boolean;
  /** Which parts of the ship have been hit: 0 is the stern, 1 the middle, 2 the bow. The damage travels with the ship. */
  damaged?: number[];
  /** How far this ship's guns and radar reach now. */
  guns: number;
  radar: number;
  /** Ships found by radar: the squares of them that were in range, and on which turn. */
  sightings: Record<string, { cells: number[][]; turn: number }>;
  /** Squares worth remembering: your hits and misses, and shells seen landing nearby. */
  marks: { x: number; y: number; kind: "hit" | "miss" | "splash"; turn: number }[];
  shots: number;
  hits: number;
  pings: number;
  sunkBy: string | null;
  sunkTurn: number | null;
  /** Finishing place: 1 for the winner. */
  place: number;
}

export interface NavalState {
  size: number;
  seed: number;
  startedAt: number;
  turn: number;
  nextTurn: number;
  over: boolean;
  winner: string | null;
  /** Whether this game has a storm at all (the host's choice), and how many rows in from each edge it has reached. */
  stormOn?: boolean;
  storm: number;
  ships: Record<string, Ship>;
  alliances: { a: string; b: string; until: number }[];
  proposals: { id: number; from: string; to: string; turns: number }[];
  news: { id: number; t: number; text: string; to: string | null; kind?: string }[];
  chat: { id: number; t: number; from: string; to: string | null; text: string }[];
  nextId: number;
}

type Who = { id: string; name: string; country?: string };

export const cellsOf = (s: { x: number; y: number; dir: number }): number[][] => {
  const [dx, dy] = DIRS[s.dir];
  return [-1, 0, 1].map((k) => [s.x + dx * k, s.y + dy * k]);
};
/** A square's name, like F7. */
export const coord = (x: number, y: number) => (x < 26 ? "" : "A") + String.fromCharCode(65 + (x % 26)) + (y + 1);
/** How many squares from the nearest part of a ship to a square. */
const reach = (cells: number[][], x: number, y: number) => Math.min(...cells.map(([cx, cy]) => Math.max(Math.abs(cx - x), Math.abs(cy - y))));
const near = (cells: number[][], x: number, y: number, range: number) => cells.some(([cx, cy]) => Math.max(Math.abs(cx - x), Math.abs(cy - y)) <= range);
const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
/** Roughly which way b lies from a. */
const bearing = (a: Ship, b: Ship) => COMPASS[(Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) + 8) % 8];

const living = (t: NavalState) => Object.keys(t.ships).filter((id) => t.ships[id].alive);
const allied = (t: NavalState, a: string, b: string) => t.alliances.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
const inStorm = (t: NavalState, x: number, y: number) => x < t.storm || y < t.storm || x >= t.size - t.storm || y >= t.size - t.storm;

function say(t: NavalState, now: number, text: string, to: string | null = null, kind?: string) {
  t.news.push({ id: t.nextId++, t: now, text, to, kind });
  if (t.news.length > 200) t.news.splice(0, t.news.length - 200);
}

function label(players: Who[]) {
  return (id: string) => {
    const p = players.find((x) => x.id === id);
    return COUNTRIES.find((c) => c.id === p?.country)?.name ?? p?.name ?? "A ship";
  };
}

// ---------------------------------------------------------------- start

export function startNaval(players: Who[], seed: number, now: number, opts: { size?: number; storm?: boolean } = {}): NavalState {
  const rng = mulberry32(seed);
  const size = opts.size && NAVAL.sizes.includes(opts.size) ? opts.size : gridSize(players.length);
  const t: NavalState = {
    size,
    seed,
    startedAt: now,
    turn: 0,
    nextTurn: now + NAVAL.turnMs,
    over: false,
    winner: null,
    stormOn: opts.storm !== false,
    storm: 0,
    ships: {},
    alliances: [],
    proposals: [],
    news: [],
    chat: [],
    nextId: 1,
  };
  // Scatter the ships: away from the edges, and as far from each other as there is room for.
  const placed: Ship[] = [];
  for (const p of players) {
    let best: { x: number; y: number; dir: number } | null = null;
    for (let gap = 7; gap >= 2 && !best; gap--) {
      for (let tries = 0; tries < 60 && !best; tries++) {
        const spot = { x: 3 + Math.floor(rng() * (size - 6)), y: 3 + Math.floor(rng() * (size - 6)), dir: Math.floor(rng() * 4) };
        if (placed.every((o) => Math.max(Math.abs(o.x - spot.x), Math.abs(o.y - spot.y)) >= gap)) best = spot;
      }
    }
    const ship: Ship = { ...(best ?? { x: 3 + placed.length * 2, y: 3, dir: 0 }), hull: NAVAL.hull, ap: NAVAL.apStart, alive: true, guns: NAVAL.rangeStart, radar: NAVAL.rangeStart, sightings: {}, marks: [], shots: 0, hits: 0, pings: 0, sunkBy: null, sunkTurn: null, place: 1 };
    placed.push(ship);
    t.ships[p.id] = ship;
  }
  say(t, now, "The fleets have put to sea. Nobody knows where anybody else is. The last ship afloat wins.");
  return t;
}

// ---------------------------------------------------------------- sinking and the end

function sink(t: NavalState, id: string, by: string | null, now: number, name: (id: string) => string) {
  const ship = t.ships[id];
  if (!ship.alive) return;
  ship.alive = false;
  ship.hull = 0;
  ship.sunkBy = by;
  ship.sunkTurn = t.turn;
  ship.place = living(t).length + 1;
  t.alliances = t.alliances.filter((x) => x.a !== id && x.b !== id);
  t.proposals = t.proposals.filter((x) => x.from !== id && x.to !== id);
  for (const other of Object.values(t.ships)) delete other.sightings[id];
  say(t, now, by ? `${name(id)} has been sunk by ${name(by)}!` : `${name(id)} has gone down in the storm!`, null, "sunk");
  if (by && t.ships[by].alive) t.ships[by].ap = Math.min(NAVAL.apMax, t.ships[by].ap + NAVAL.sinkBonus);
}

function checkEnd(t: NavalState, now: number, name: (id: string) => string) {
  if (t.over) return;
  const left = living(t);
  if (left.length <= 1) {
    t.over = true;
    t.winner = left[0] ?? null;
    t.alliances = [];
    t.proposals = [];
    say(t, now, t.winner ? `${name(t.winner)} is the last ship afloat, and wins!` : "Every ship has gone down. Nobody wins.", null, "sunk");
  } else if (left.length === 2 && (t.alliances.length || t.proposals.length)) {
    t.alliances = [];
    t.proposals = [];
    say(t, now, "Only two ships are left. All alliances are over: there can be only one winner.");
  }
}

// ---------------------------------------------------------------- the clock

/** Bring the game up to date: hand out action points, end alliances, move the storm. */
export function navalTick(t: NavalState, players: Who[], now: number) {
  const name = label(players);
  while (!t.over && t.nextTurn <= now) {
    const at = t.nextTurn;
    t.turn++;
    t.nextTurn += NAVAL.turnMs;
    for (const id of living(t)) t.ships[id].ap = Math.min(NAVAL.apMax, t.ships[id].ap + NAVAL.apPerTurn);

    for (const x of t.alliances.filter((x) => x.until <= t.turn)) {
      say(t, at, `Your alliance with ${name(x.b)} has run out.`, x.a, "ally");
      say(t, at, `Your alliance with ${name(x.a)} has run out.`, x.b, "ally");
    }
    t.alliances = t.alliances.filter((x) => x.until > t.turn);

    for (const ship of Object.values(t.ships)) {
      for (const [id, s] of Object.entries(ship.sightings)) if (t.turn - s.turn >= NAVAL.sightingTurns) delete ship.sightings[id];
      ship.marks = ship.marks.filter((m) => t.turn - m.turn < NAVAL.sightingTurns * 2);
    }

    // The storm, which makes sure every game ends.
    const stormy = t.stormOn !== false;
    if (stormy && t.turn === NAVAL.stormStart - 2) say(t, at, "A storm is gathering around the edges of the map. In two turns the outermost squares become deadly. Head for the middle.", null, "storm");
    const maxRing = Math.floor((t.size - NAVAL.stormMinSafe) / 2);
    const ring = !stormy || t.turn < NAVAL.stormStart ? 0 : Math.min(maxRing, Math.floor((t.turn - NAVAL.stormStart) / NAVAL.stormEvery) + 1);
    if (ring > t.storm) {
      t.storm = ring;
      say(t, at, `The storm closes in. The outer ${ring === 1 ? "row of squares is" : `${ring} rows of squares are`} now deadly.`, null, "storm");
    }
    if (t.storm > 0) {
      for (const id of living(t)) {
        const ship = t.ships[id];
        if (!cellsOf(ship).some(([x, y]) => inStorm(t, x, y))) continue;
        ship.hull--;
        if (ship.hull <= 0) sink(t, id, null, at, name);
        else say(t, at, `The storm batters your ship: 1 damage, ${ship.hull} left. Sail towards the middle!`, id, "bad");
      }
    }
    checkEnd(t, at, name);
  }
}

export const navalAlarm = (t: NavalState): number | null => (t.over ? null : t.nextTurn);

// ---------------------------------------------------------------- what players do

export function navalHandle(t: NavalState, players: Who[], me: string, msg: any, now: number): string | null {
  navalTick(t, players, now);
  const ship = t.ships[me];
  if (!ship) return "You are not in this game.";
  if (t.over) return "The battle is over.";
  if (!ship.alive) return "Your ship has been sunk. You can only watch now.";
  const name = label(players);
  const pay = (cost: number) => (ship.ap < cost ? `That costs ${cost} action ${cost === 1 ? "point" : "points"}. You have ${ship.ap}.` : null);
  const others = living(t).filter((id) => id !== me);
  const inside = (cells: number[][]) => cells.every(([x, y]) => x >= 0 && y >= 0 && x < t.size && y < t.size);
  /** Another ship lying across any of these squares, if there is one. */
  const blocker = (cells: number[][]) => others.find((id) => cellsOf(t.ships[id]).some(([x, y]) => cells.some(([cx, cy]) => cx === x && cy === y)));
  /** Try to put the ship somewhere new. Sailing into another ship costs the points and gives both away. */
  const sail = (next: { x: number; y: number; dir: number }, cost: number, edge: string) => {
    const short = pay(cost);
    if (short) return short;
    const cells = cellsOf(next);
    if (!inside(cells)) return edge;
    ship.ap -= cost;
    const hit = blocker(cells);
    if (hit) {
      say(t, now, "You bump into another ship! Something is right beside you.", me, "bad");
      say(t, now, "Another ship has bumped into yours. Someone is right beside you.", hit, "bad");
      return null;
    }
    Object.assign(ship, next);
    return null;
  };

  switch (msg?.type) {
    case "n.move": {
      const step = msg.dir === -1 ? -1 : 1;
      const [dx, dy] = DIRS[ship.dir];
      return sail({ x: ship.x + dx * step, y: ship.y + dy * step, dir: ship.dir }, NAVAL.cost.move, "You cannot sail off the edge of the map.");
    }
    case "n.turn": {
      const dir = (ship.dir + (msg.dir === -1 ? 3 : 1)) % 4;
      return sail({ x: ship.x, y: ship.y, dir }, NAVAL.cost.turn, "There is no room to turn here: you are too close to the edge.");
    }
    case "n.ping": {
      const short = pay(NAVAL.cost.ping);
      if (short) return short;
      ship.ap -= NAVAL.cost.ping;
      ship.pings++;
      const mine = cellsOf(ship);
      const found: string[] = [];
      for (const id of others) {
        const other = t.ships[id];
        const cells = cellsOf(other);
        // Radar shows only the squares of a ship that lie inside its range, not the whole ship.
        const seen = cells.filter(([x, y]) => reach(mine, x, y) <= ship.radar);
        if (!seen.length) continue;
        ship.sightings[id] = { cells: seen, turn: t.turn };
        found.push(id);
        if (!allied(t, me, id)) say(t, now, `Radar! Someone has just swept your position from the ${bearing(other, ship)}. They know where you are.`, id, "bad");
      }
      say(t, now, found.length ? `Radar: ${found.map(name).join(" and ")} found nearby.` : "Radar: nothing within range.", me, "radar");
      return null;
    }
    case "n.range": {
      if (ship.guns >= NAVAL.fireRange && ship.radar >= NAVAL.radarRange) return "Your guns and radar already reach as far as they can.";
      const short = pay(NAVAL.cost.range);
      if (short) return short;
      ship.ap -= NAVAL.cost.range;
      ship.guns = Math.min(NAVAL.fireRange, ship.guns + 1);
      ship.radar = Math.min(NAVAL.radarRange, ship.radar + 1);
      say(t, now, `Range increased: your guns now reach ${ship.guns} squares and your radar ${ship.radar}.`, me, "good");
      return null;
    }
    case "n.fire": {
      const x = Math.floor(Number(msg.x));
      const y = Math.floor(Number(msg.y));
      if (!(x >= 0 && y >= 0 && x < t.size && y < t.size)) return "Choose a square on the map.";
      if (reach(cellsOf(ship), x, y) > ship.guns) return `That is out of range. Your guns reach ${ship.guns} squares.${ship.guns < NAVAL.fireRange ? " Increase your range to reach further." : ""}`;
      if (cellsOf(ship).some(([cx, cy]) => cx === x && cy === y)) return "That is your own ship.";
      const target = others.find((id) => cellsOf(t.ships[id]).some(([cx, cy]) => cx === x && cy === y));
      const short = pay(NAVAL.cost.fire);
      if (short) return short;
      ship.ap -= NAVAL.cost.fire;
      ship.shots++;
      ship.marks = ship.marks.filter((m) => m.x !== x || m.y !== y);
      if (target) {
        const other = t.ships[target];
        ship.hits++;
        other.hull--;
        const part = cellsOf(other).findIndex(([cx, cy]) => cx === x && cy === y);
        other.damaged = [...new Set([...(other.damaged ?? []), part])];
        ship.marks.push({ x, y, kind: "hit", turn: t.turn });
        say(t, now, `You fire at ${coord(x, y)}: a hit!`, me, "good");
        if (other.hull <= 0) sink(t, target, me, now, name);
        else say(t, now, `You have been hit! The shot came from the ${bearing(other, ship)}. ${other.hull} more ${other.hull === 1 ? "hit" : "hits"} will sink you.`, target, "bad");
        checkEnd(t, now, name);
      } else {
        ship.marks.push({ x, y, kind: "miss", turn: t.turn });
        say(t, now, `You fire at ${coord(x, y)}: a miss.`, me, "radar");
        for (const id of others) {
          const other = t.ships[id];
          if (!near(cellsOf(other), x, y, NAVAL.splashRange)) continue;
          other.marks = other.marks.filter((m) => m.x !== x || m.y !== y);
          other.marks.push({ x, y, kind: "splash", turn: t.turn });
          say(t, now, `A shell lands in the water at ${coord(x, y)}, close to you. Someone is shooting.`, id, "bad");
        }
      }
      if (ship.marks.length > 60) ship.marks.splice(0, ship.marks.length - 60);
      return null;
    }
    case "n.give": {
      const n = Math.floor(Number(msg.n)) || 1;
      if (!others.includes(msg.to)) return "Choose a ship that is still afloat.";
      if (n < 1 || n > ship.ap) return "You do not have that many action points.";
      const room = NAVAL.apMax - t.ships[msg.to].ap;
      if (room < n) return `${name(msg.to)} cannot hold that many: nobody can have more than ${NAVAL.apMax}.`;
      ship.ap -= n;
      t.ships[msg.to].ap += n;
      say(t, now, `You send ${n} action ${n === 1 ? "point" : "points"} to ${name(msg.to)}.`, me, "ally");
      say(t, now, `${name(me)} sends you ${n} action ${n === 1 ? "point" : "points"}.`, msg.to, "good");
      return null;
    }
    case "n.propose": {
      if (!others.includes(msg.to)) return "Choose a ship that is still afloat.";
      if (others.length < 2) return "Only two ships are left. There can be no alliance now.";
      if (!NAVAL.allianceTurns.includes(msg.turns)) return "Choose how long the alliance should last.";
      if (allied(t, me, msg.to)) return `You are already allied with ${name(msg.to)}.`;
      t.proposals = t.proposals.filter((p) => !(p.from === me && p.to === msg.to));
      t.proposals.push({ id: t.nextId++, from: me, to: msg.to, turns: msg.turns });
      say(t, now, `${name(me)} offers you an alliance for ${msg.turns} turns.`, msg.to, "ally");
      return null;
    }
    case "n.accept": {
      const p = t.proposals.find((x) => x.id === msg.id && x.to === me);
      if (!p || !t.ships[p.from]?.alive) return "That offer is no longer there.";
      t.proposals = t.proposals.filter((x) => !((x.from === p.from && x.to === me) || (x.from === me && x.to === p.from)));
      if (allied(t, me, p.from)) return null;
      t.alliances.push({ a: p.from, b: me, until: t.turn + p.turns });
      for (const [a, b] of [[me, p.from], [p.from, me]]) say(t, now, `You and ${name(b)} are now allies for ${p.turns} turns. You can see each other's ships. Nothing stops either of you from firing.`, a, "ally");
      return null;
    }
    case "n.decline": {
      const p = t.proposals.find((x) => x.id === msg.id && (x.to === me || x.from === me));
      if (!p) return null;
      t.proposals = t.proposals.filter((x) => x !== p);
      if (p.to === me) say(t, now, `${name(me)} turns down your offer of an alliance.`, p.from, "ally");
      return null;
    }
    case "n.break": {
      if (!allied(t, me, msg.with)) return "You have no alliance with them.";
      t.alliances = t.alliances.filter((x) => !((x.a === me && x.b === msg.with) || (x.a === msg.with && x.b === me)));
      say(t, now, `You have broken your alliance with ${name(msg.with)}.`, me, "ally");
      say(t, now, `${name(me)} has broken the alliance with you! You can no longer see each other's ships.`, msg.with, "bad");
      return null;
    }
    case "n.chat": {
      const text = String(msg.text ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 200);
      if (!text) return null;
      const to = typeof msg.to === "string" && t.ships[msg.to] ? msg.to : null;
      t.chat.push({ id: t.nextId++, t: now, from: me, to, text });
      if (t.chat.length > 150) t.chat.splice(0, t.chat.length - 150);
      return null;
    }
    default:
      return "Unknown message.";
  }
}

// ---------------------------------------------------------------- what one player may see

export function navalView(t: NavalState, me: string, now: number) {
  const mine = t.ships[me];
  // A sunk captain, and everyone once the battle is over, sees the whole sea.
  const all = t.over || (mine && !mine.alive);
  return {
    size: t.size,
    turn: t.turn,
    nextTurn: t.nextTurn,
    over: t.over,
    winner: t.winner,
    storm: t.storm,
    stormOn: t.stormOn !== false,
    /** When the storm next moves in, if it will. */
    stormNext: t.stormOn === false || t.over || t.storm >= Math.floor((t.size - NAVAL.stormMinSafe) / 2) ? null : t.turn < NAVAL.stormStart ? NAVAL.stormStart : t.turn + NAVAL.stormEvery - ((t.turn - NAVAL.stormStart) % NAVAL.stormEvery),
    rules: NAVAL,
    me: mine ? { x: mine.x, y: mine.y, dir: mine.dir, hull: mine.hull, ap: mine.ap, alive: mine.alive, damaged: mine.damaged ?? [], guns: mine.guns, radar: mine.radar, cells: cellsOf(mine), marks: mine.marks, sightings: Object.entries(mine.sightings).map(([id, s]) => ({ id, ...s })) } : null,
    ships: Object.entries(t.ships).map(([id, s]) => {
      const friend = id !== me && allied(t, me, id);
      const open = all || friend;
      return { id, alive: s.alive, ally: friend, place: s.alive ? null : s.place, sunkBy: s.sunkBy, cells: s.alive && open && id !== me ? cellsOf(s) : null, dir: open ? s.dir : null, hull: open ? s.hull : null, damaged: open ? (s.damaged ?? []) : null };
    }),
    alliances: t.alliances.filter((x) => x.a === me || x.b === me).map((x) => ({ with: x.a === me ? x.b : x.a, until: x.until })),
    proposals: t.proposals.filter((p) => p.from === me || p.to === me),
    news: t.news.filter((n) => n.to === null || n.to === me),
    chat: t.chat.filter((c) => c.to === null || c.to === me || c.from === me),
    result: t.over
      ? {
          winner: t.winner,
          turns: t.turn,
          rows: Object.entries(t.ships)
            .map(([id, s]) => ({ id, place: s.alive ? 1 : s.place, hull: s.hull, shots: s.shots, hits: s.hits, pings: s.pings, sunkBy: s.sunkBy, sunkTurn: s.sunkTurn, cells: cellsOf(s) }))
            .sort((a, b) => a.place - b.place),
        }
      : null,
  };
}
