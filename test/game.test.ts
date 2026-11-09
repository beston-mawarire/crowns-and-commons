import { describe, expect, it } from "vitest";
import { CATEGORIES, G, MODEL, RULES } from "../src/game/data";
import { LAWS, LAW_BY_ID, frictionBetween, lawsOf, publicCatalogue } from "../src/game/laws";
import { clerk, problem, sanitize } from "../src/game/rules";
import { createRoom, handle, join, nextAlarm, onAlarm, view, welcome, byToken, type Player, type Store } from "../src/game/game";
import { campaignEffects, makeRegions, mulberry32, runElection, shortfall, type Contender } from "../src/game/sim";

let idCounter = 0;
const newId = () => `id${++idCounter}`;

function room(humans: number, bots: number, settings = { simSec: 60, planSec: 300 }): { store: Store; players: Player[]; now: number } {
  const store: Store = { room: createRoom("TEST2", 12345, 1000), timeline: null };
  const players: Player[] = [];
  for (let i = 0; i < humans; i++) players.push(join(store.room, newId, `Party ${i + 1}`) as Player);
  const host = players[0].id;
  for (let i = 0; i < bots; i++) expect(handle(store, host, { type: "addBot" }, 1000 + i, newId)).toBeNull();
  expect(handle(store, host, { type: "settings", ...settings }, 1000, newId)).toBeNull();
  return { store, players, now: 2000 };
}

/** Run the clock forward until the count is over. */
function runCount(store: Store, from: number): number {
  let now = from;
  for (let i = 0; i < 50 && store.room.phase === "counting"; i++) {
    now = nextAlarm(store.room)!;
    onAlarm(store, now);
  }
  expect(store.room.phase).not.toBe("counting");
  return now;
}

const goodPlatform = (store: Store, p: Player, seed = 1) =>
  clerk({
    round: store.room.round,
    regions: store.room.round === 1 ? [store.room.regions[p.home]] : store.room.regions,
    home: store.room.round === 1 ? 0 : p.home,
    gold: p.gold,
    rng: mulberry32(seed),
    noise: 0,
    full: true,
  });

const badPlatform = () => ({
  // Everything the commons hate, taxed to the hilt.
  laws: CATEGORIES.flatMap((c) => lawsOf("R", c.id).slice().sort((a, b) => a.w[0] - b.w[0]).filter((l, _i, arr) => Math.abs(l.pos - arr[0].pos) <= RULES.maxSpread).slice(0, 2).map((l) => l.id)),
  tax: 40,
  actions: [],
});

describe("catalogue", () => {
  it("has enough laws in every category and tier", () => {
    for (const c of CATEGORIES) {
      expect(lawsOf("R", c.id).length).toBeGreaterThanOrEqual(6);
      expect(lawsOf("N", c.id).length).toBeGreaterThanOrEqual(5);
    }
    expect(LAWS.length).toBe(116);
  });

  it("keeps weights in range and gives every law a downside", () => {
    for (const law of LAWS) {
      expect(law.w).toHaveLength(G);
      for (const w of law.w) expect(Math.abs(w)).toBeLessThanOrEqual(3);
      expect(law.d.some((d) => d < 0)).toBe(true);
      expect(law.down.length).toBeGreaterThan(5);
    }
  });

  it("never sends hidden numbers to the browser", () => {
    const text = JSON.stringify(publicCatalogue());
    expect(text).not.toContain('"w"');
    expect(text).not.toContain('"down"');
    expect(text).not.toContain('"tags"');
  });

  it("knows direct and distant contradictions", () => {
    expect(frictionBetween(LAW_BY_ID["R1.4"], LAW_BY_ID["N1.5"])).toBe(2);
    expect(frictionBetween(LAW_BY_ID["R5.1"], LAW_BY_ID["N5.6"])).toBe(2);
    expect(frictionBetween(LAW_BY_ID["R6.1"], LAW_BY_ID["N6.5"])).toBe(1); // opposite ends, not listed
    expect(frictionBetween(LAW_BY_ID["R6.1"], LAW_BY_ID["N6.1"])).toBe(0);
  });
});

describe("plans", () => {
  const ctx = { round: 1 as const, gold: 60, regions: 3 };

  it("caps laws at three per category and refuses contradictory picks", () => {
    const p = sanitize({ laws: ["R1.1", "R1.2", "R1.3", "R1.4", "R1.7", "N1.1", "nope"], tax: 99, actions: [] }, ctx);
    expect(p.laws).toEqual(["R1.1", "R1.2", "R1.3"]);
    expect(p.tax).toBe(40);
    // R1.1 and R1.7 are at opposite ends of the spectrum.
    expect(sanitize({ laws: ["R1.1", "R1.7"] }, ctx).laws).toEqual(["R1.1"]);
  });

  it("needs two laws in every category", () => {
    expect(problem(sanitize({ laws: ["R1.1", "R1.2"] }, ctx), ctx)).toMatch(/at least 2/);
    const full = clerk({ round: 1, regions: makeRegions(3, mulberry32(1)), home: 0, gold: 60, rng: mulberry32(2), noise: 1, full: true });
    expect(problem(full, ctx)).toBeNull();
  });

  it("drops actions the party cannot pay for, and allows no more than three", () => {
    const p = sanitize({ actions: [{ a: "feast", g: 0 }, { a: "feast", g: 0 }, { a: "speech", g: 1 }, { a: "speech", g: 1 }] }, ctx);
    expect(p.actions.map((a) => a.a)).toEqual(["feast", "feast"]); // 60 gold spent
    expect(sanitize({ actions: Array(5).fill({ a: "speech", g: 2 }) }, ctx).actions).toHaveLength(3);
  });

  it("gives repeated actions diminishing returns", () => {
    const e = campaignEffects([{ a: "visit", g: 0 }, { a: "visit", g: 0 }, { a: "visit", g: 1 }], 0, 1);
    expect(e[1].effect).toBeLessThan(e[0].effect);
    expect(e[1].repeat).toBe(true);
    expect(e[2].repeat).toBe(false);
  });

  it("makes costly promises need taxes", () => {
    const laws = ["R5.1", "R5.2", "R5.3"];
    expect(shortfall({ laws, tax: 0, actions: [] })).toBe(1);
    expect(shortfall({ laws, tax: 14, actions: [] })).toBe(0);
  });
});

describe("election", () => {
  const regions = makeRegions(4, mulberry32(7));
  const parties: Contender[] = regions.map((_, i) => ({
    id: "p" + i,
    name: "Party " + "ABCD"[i],
    home: i,
    regional: clerk({ round: 1, regions: [regions[i]], home: 0, gold: 60, rng: mulberry32(20 + i), noise: 3, full: true }),
  }));

  it("is repeatable and adds up", () => {
    const a = runElection({ round: 1, regions, parties, seed: 99, q0: MODEL.q0 });
    const b = runElection({ round: 1, regions, parties, seed: 99, q0: MODEL.q0 });
    expect(a.results).toEqual(b.results);
    expect(a.headlines).toEqual(b.headlines);
    a.results.regions.forEach((r, i) => {
      expect(r.share["p" + i] + r.oldShare).toBeCloseTo(1, 6);
      expect(r.turnout).toBeGreaterThan(0.15);
      expect(r.turnout).toBeLessThan(0.95);
    });
    expect(a.paints).toHaveLength(RULES.ticks + 1);
    const last = a.paints[RULES.ticks];
    last.forEach((p, i) => expect(p.p["p" + i] + p.old).toBeCloseTo(1, 6));
    expect(a.paints[0][0].old).toBe(0);
  });

  it("writes headlines without numbers or unfilled blanks", () => {
    const t = runElection({ round: 1, regions, parties, seed: 5, q0: MODEL.q0, headlinesPerTick: 5 });
    const all = t.headlines.flat();
    expect(all.length).toBeGreaterThan(30);
    for (const h of all) {
      expect(h.text).not.toMatch(/[{}]|undefined|NaN/);
      expect(h.text).not.toMatch(/\d/);
    }
  });

  it("puts every qualifier on every ballot in the national round, with the Old Order", () => {
    const national = parties.slice(0, 3).map((p) => ({ ...p, national: clerk({ round: 2, regions, home: p.home, gold: 60, rng: mulberry32(40 + p.home), noise: 3, full: true }) }));
    const t = runElection({ round: 2, regions, parties: national, seed: 3, q0: MODEL.q0 });
    for (const r of t.results.regions) {
      expect(Object.keys(r.share)).toHaveLength(3);
      expect(r.oldShare).toBeGreaterThan(0);
      expect(Object.values(r.share).reduce((a, b) => a + b, 0) + r.oldShare).toBeCloseTo(1, 6);
    }
    const total = Object.values(t.results.parties).reduce((a, p) => a + p.share, 0) + t.results.old.share;
    expect(total).toBeCloseTo(1, 6);
  });
});

describe("a match", () => {
  it("refuses to start alone and seats at most five", () => {
    const { store, players } = room(1, 0);
    expect(handle(store, players[0].id, { type: "start" }, 2000, newId)).toMatch(/at least two/);
    for (let i = 0; i < 4; i++) handle(store, players[0].id, { type: "addBot" }, 2000 + i, newId);
    expect(store.room.players).toHaveLength(5);
    expect(join(store.room, newId, "Late")).toMatch(/full/);
  });

  it("gives every party its own region and 60 gold, and keeps colours unique", () => {
    const { store, players } = room(2, 3);
    expect(new Set(store.room.players.map((p) => p.color)).size).toBe(5);
    expect(handle(store, players[1].id, { type: "profile", color: store.room.players[0].color }, 2000, newId)).toMatch(/colour/);
    handle(store, players[0].id, { type: "start" }, 2000, newId);
    expect(store.room.regions).toHaveLength(5);
    expect(new Set(store.room.players.map((p) => p.home)).size).toBe(5);
    expect(store.room.players.every((p) => p.gold === RULES.startGold)).toBe(true);
    expect(store.room.players.filter((p) => p.bot).every((p) => p.locked)).toBe(true);
    expect(join(store.room, newId, "Stranger")).toMatch(/already started/);
  });

  it("plays through both rounds, with eliminated players watching", () => {
    const { store, players } = room(3, 0);
    const [a, b, c] = players;
    handle(store, a.id, { type: "start" }, 2000, newId);
    expect(store.room.phase).toBe("planning");
    expect(store.room.deadline).toBe(2000 + 300_000);

    // Two strong campaigns and one hopeless one.
    expect(handle(store, a.id, { type: "lock", platform: goodPlatform(store, a, 1) }, 3000, newId)).toBeNull();
    expect(handle(store, b.id, { type: "lock", platform: goodPlatform(store, b, 2) }, 3000, newId)).toBeNull();
    expect(store.room.phase).toBe("planning");
    expect(handle(store, c.id, { type: "lock", platform: { laws: ["R1.1"], tax: 15, actions: [] } }, 3000, newId)).toMatch(/at least 2/);
    expect(handle(store, c.id, { type: "lock", platform: badPlatform() }, 3000, newId)).toBeNull();
    expect(store.room.phase).toBe("counting");
    expect(a.gold).toBeLessThan(RULES.startGold);

    // Nothing about other parties' plans or the hidden model is visible mid-count.
    const mid = JSON.stringify(view(store.room, c.id, 3500));
    expect(mid).not.toContain(a.regional!.laws[0] + '"');
    expect(JSON.stringify(welcome(c))).not.toContain('"w"');

    let now = runCount(store, 3000);
    expect(store.room.phase).toBe("results");
    expect(store.room.outcome!.kind).toBe("advance");
    expect(a.qualified && b.qualified).toBe(true);
    expect(c.qualified).toBe(false);
    expect(store.room.results1!.parties[a.id].share).toBeGreaterThanOrEqual(0.5);
    // Platforms become public record once the votes are in.
    expect(JSON.stringify(view(store.room, c.id, now))).toContain(a.regional!.laws[0]);

    expect(handle(store, b.id, { type: "next" }, now, newId)).toMatch(/host/);
    const goldBefore = a.gold;
    expect(handle(store, a.id, { type: "next" }, now, newId)).toBeNull();
    expect(store.room.round).toBe(2);
    expect(c.eliminated).toBe(true);
    expect(a.gold).toBe(goldBefore + RULES.roundIncome);
    expect(c.gold).toBeLessThanOrEqual(RULES.startGold);

    // The eliminated player can watch but not act.
    expect(handle(store, c.id, { type: "lock", platform: goodPlatform(store, c) }, now, newId)).toMatch(/watching/);
    expect(view(store.room, c.id, now).you.eliminated).toBe(true);

    // Regional laws cannot be offered again as national ones.
    const mixed = sanitize({ laws: a.regional!.laws }, { round: 2, gold: a.gold, regions: 3 });
    expect(mixed.laws).toHaveLength(0);

    const planA = goodPlatform(store, a, 5);
    expect(planA.actions.every((x) => typeof x.r === "number")).toBe(true);
    handle(store, a.id, { type: "lock", platform: planA }, now, newId);
    handle(store, b.id, { type: "lock", platform: goodPlatform(store, b, 6) }, now, newId);
    expect(store.room.phase).toBe("counting");
    now = runCount(store, now);

    expect(store.room.phase).toBe("final");
    expect(store.room.outcome!.kind).toBe("national");
    expect([a.id, b.id]).toContain(store.room.outcome!.winner);
    expect(a.regional).not.toBeNull(); // the regional record is kept
    const end = view(store.room, c.id, now);
    expect(end.report![a.id].best).toHaveLength(3);
    expect(Object.keys(end.reveal!).length).toBeGreaterThan(30);
    expect(end.results2!.regions.every((r) => r.oldShare > 0)).toBe(true);

    handle(store, a.id, { type: "newGame" }, now, newId);
    expect(store.room.phase).toBe("lobby");
    expect(store.room.players).toHaveLength(3);
  });

  it("hands the match to a lone qualifier", () => {
    const { store, players } = room(2, 0);
    const [a, b] = players;
    handle(store, a.id, { type: "start" }, 2000, newId);
    handle(store, a.id, { type: "lock", platform: goodPlatform(store, a) }, 3000, newId);
    handle(store, b.id, { type: "lock", platform: badPlatform() }, 3000, newId);
    runCount(store, 3000);
    expect(store.room.phase).toBe("final");
    expect(store.room.outcome).toMatchObject({ kind: "single", winner: a.id });
  });

  it("runs the regional round again when nobody qualifies, a little easier each time", () => {
    const { store, players } = room(2, 0);
    const [a, b] = players;
    handle(store, a.id, { type: "start" }, 2000, newId);
    handle(store, a.id, { type: "lock", platform: badPlatform() }, 3000, newId);
    handle(store, b.id, { type: "lock", platform: badPlatform() }, 3000, newId);
    const now = runCount(store, 3000);
    expect(store.room.outcome!.kind).toBe("none");
    expect(store.room.phase).toBe("results");
    handle(store, a.id, { type: "next" }, now, newId);
    expect(store.room.phase).toBe("planning");
    expect(store.room.round).toBe(1);
    expect(store.room.attempt).toBe(2);
    expect(a.gold).toBe(RULES.startGold + RULES.roundIncome);
    expect(a.draft.laws.length).toBeGreaterThan(0); // last attempt's laws are kept as a starting point
  });

  it("calls time with a clerk when the planning clock runs out", () => {
    const { store, players } = room(2, 0);
    const [a, b] = players;
    handle(store, a.id, { type: "start" }, 2000, newId);
    handle(store, a.id, { type: "draft", platform: { laws: ["R1.1", "R1.2"], tax: 20, actions: [{ a: "speech", g: 0 }] } }, 2500, newId);
    expect(nextAlarm(store.room)).toBe(2000 + 300_000);
    onAlarm(store, 2000 + 300_000);
    expect(store.room.phase).toBe("counting");
    expect(a.regional!.laws).toContain("R1.1");
    expect(a.regional!.tax).toBe(20);
    expect(problem(a.regional!, { round: 1, gold: 60, regions: 2 })).toBeNull();
    expect(problem(b.regional!, { round: 1, gold: 60, regions: 2 })).toBeNull();
  });

  it("lets a player back in with their token, and skips the count if everyone agrees", () => {
    const { store, players } = room(1, 1);
    const [a] = players;
    expect(byToken(store.room, a.token)).toBe(a);
    expect(byToken(store.room, "wrong")).toBeUndefined();
    handle(store, a.id, { type: "start" }, 2000, newId);
    handle(store, a.id, { type: "lock", platform: goodPlatform(store, a) }, 3000, newId);
    expect(store.room.phase).toBe("counting");
    handle(store, a.id, { type: "hasten" }, 3100, newId);
    expect(store.room.phase).not.toBe("counting");
    expect(store.room.results1).not.toBeNull();
  });
});
