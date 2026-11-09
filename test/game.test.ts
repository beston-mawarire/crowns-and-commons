import { describe, expect, it } from "vitest";
import { CATEGORIES, G, ISSUES, MODEL, RULES } from "../src/game/data";
import { LAWS, LAW_BY_ID, frictionBetween, lawsOf, publicCatalogue } from "../src/game/laws";
import { clerk, problem, sanitize, sanitizeReaction } from "../src/game/rules";
import { createRoom, handle, join, nextAlarm, onAlarm, view, welcome, byToken, type Player, type Store } from "../src/game/game";
import { NEUTRAL, allocateSeats, campaignEffects, makeRegions, mulberry32, runElection, shortfall, weights, type Contender } from "../src/game/sim";

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

/** The worst possible platform for a region: every law its people dislike most, taxed to the limit. */
const badPlatform = (store: Store, p: Player) => {
  // Make sure of it: this region was perfectly happy with the old council.
  store.room.regions[p.home].sat0 = new Array(G).fill(95);
  return worst(store, p);
};
const worst = (store: Store, p: Player) => ({
  ...clerk({ round: 1, regions: [store.room.regions[p.home]], home: 0, gold: p.gold, rng: mulberry32(3), noise: 0, lean: new Array(G).fill(-1), full: false }),
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
  const ctx = { round: 1 as const, gold: 60, regions: 3, min: 2, max: 3, rivals: [] as string[] };

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
    expect(handle(store, c.id, { type: "lock", platform: badPlatform(store, c) }, 3000, newId)).toBeNull();
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
    expect(store.room.results1!.parties[a.id].share).toBeGreaterThanOrEqual(RULES.qualifyShare);
    expect(store.room.results1!.parties[c.id].share).toBeLessThan(RULES.qualifyShare);
    // Platforms become public record once the votes are in.
    expect(JSON.stringify(view(store.room, c.id, now))).toContain(a.regional!.laws[0]);

    expect(handle(store, b.id, { type: "next" }, now, newId)).toMatch(/host/);
    const goldBefore = a.gold;
    expect(handle(store, a.id, { type: "next" }, now, newId)).toBeNull();
    expect(store.room.round).toBe(2);
    expect(c.eliminated).toBe(true);
    // Donations follow the regional result: a base plus a share-based top-up.
    expect(a.gold).toBe(goldBefore + RULES.donationBase + Math.round(store.room.results1!.parties[a.id].share * RULES.donationPerShare));
    expect(c.gold).toBeLessThanOrEqual(RULES.startGold);

    // The eliminated player can watch but not act.
    expect(handle(store, c.id, { type: "lock", platform: goodPlatform(store, c) }, now, newId)).toMatch(/watching/);
    expect(view(store.room, c.id, now).you.eliminated).toBe(true);

    // Regional laws cannot be offered again as national ones.
    const mixed = sanitize({ laws: a.regional!.laws }, { round: 2, gold: a.gold, regions: 3, min: 2, max: 3, rivals: [] });
    expect(mixed.laws).toHaveLength(0);

    const planA = goodPlatform(store, a, 5);
    expect(planA.actions.every((x) => typeof x.r === "number")).toBe(true);
    handle(store, a.id, { type: "lock", platform: planA }, now, newId);
    handle(store, b.id, { type: "lock", platform: goodPlatform(store, b, 6) }, now, newId);
    expect(store.room.phase).toBe("planning"); // waiting for the knocked-out player to endorse or decline
    handle(store, c.id, { type: "endorse", id: "" }, now, newId);
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
    handle(store, b.id, { type: "lock", platform: badPlatform(store, b) }, 3000, newId);
    runCount(store, 3000);
    expect(store.room.phase).toBe("final");
    expect(store.room.outcome).toMatchObject({ kind: "single", winner: a.id });
  });

  it("runs the regional round again when nobody qualifies, a little easier each time", () => {
    const { store, players } = room(2, 0);
    const [a, b] = players;
    handle(store, a.id, { type: "start" }, 2000, newId);
    handle(store, a.id, { type: "lock", platform: badPlatform(store, a) }, 3000, newId);
    handle(store, b.id, { type: "lock", platform: badPlatform(store, b) }, 3000, newId);
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
    const ctx = { round: 1 as const, gold: 60, regions: 2, min: 2, max: 3, rivals: [] };
    expect(problem(a.regional!, ctx)).toBeNull();
    expect(problem(b.regional!, ctx)).toBeNull();
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

// ---------------------------------------------------------------- features added after the first live test

/** Run the clock until the count stops for half-time. */
function runToHalf(store: Store) {
  for (let i = 0; i < 20 && !store.room.count?.half; i++) onAlarm(store, nextAlarm(store.room)!);
  expect(store.room.count?.half?.done).toBe(false);
}

describe("this year's big issue", () => {
  it("makes laws in its two areas count double and leaves the rest alone", () => {
    const issue = ISSUES.findIndex((i) => i.cats.includes(4) && i.cats.includes(5));
    const world = { issue, tilt: NEUTRAL.tilt };
    expect(weights(LAW_BY_ID["R4.1"], world).w).toEqual(LAW_BY_ID["R4.1"].w.map((w) => w * MODEL.issueMult));
    expect(weights(LAW_BY_ID["R1.1"], world).w).toEqual([...LAW_BY_ID["R1.1"].w]);
  });

  it("is announced to the players, while the yearly shift in tastes stays hidden", () => {
    const { store, players } = room(2, 0);
    handle(store, players[0].id, { type: "start" }, 2000, newId);
    const v = view(store.room, players[0].id, 2000);
    expect(v.issue!.cats).toHaveLength(2);
    expect(JSON.stringify(v)).not.toContain("tilt");
  });
});

describe("half-time", () => {
  const regions = makeRegions(3, mulberry32(11));
  const parties: Contender[] = regions.map((_, i) => ({
    id: "p" + i,
    name: "Party " + "ABC"[i],
    home: i,
    regional: clerk({ round: 1, regions: [regions[i]], home: 0, gold: 60, rng: mulberry32(30 + i), noise: 3, full: true }),
  }));
  const input = { round: 1 as const, regions, parties, seed: 42, q0: MODEL.q0, headlinesPerTick: 5 };

  it("leaves the first half exactly as it was and changes the second", () => {
    const plain = runElection(input);
    const moved = runElection({ ...input, reactions: { p0: { kind: "push", g: 0 } } });
    expect(moved.headlines.slice(0, 5)).toEqual(plain.headlines.slice(0, 5));
    expect(moved.results.parties.p0.share).toBeGreaterThan(plain.results.parties.p0.share);
    expect(moved.results.parties.p1.share).toBeCloseTo(plain.results.parties.p1.share, 10);
  });

  it("takes a scrapped law off the record and out of the news", () => {
    const law = parties[1].regional.laws[0];
    const t = runElection({ ...input, reactions: { p1: { kind: "drop", law } } });
    expect(t.platformsAfter.p1.laws).not.toContain(law);
    expect(t.platformsAfter.p0.laws).toEqual(parties[0].regional.laws);
    const lateNews = t.headlines.slice(5).flat().filter((h) => h.p === "p1").map((h) => h.text).join(" | ");
    expect(lateNews).toContain("U-turn");
  });

  it("only accepts moves that make sense", () => {
    const current = parties[0].regional;
    expect(sanitizeReaction({ kind: "drop", law: "N1.1" }, current, 1, 3)).toBeNull();
    expect(sanitizeReaction({ kind: "drop", law: current.laws[2] }, current, 1, 3)).toEqual({ kind: "drop", law: current.laws[2] });
    expect(sanitizeReaction({ kind: "push", g: 9 }, current, 1, 3)).toBeNull();
    expect(sanitizeReaction({ kind: "push", g: 2 }, current, 2, 3)).toBeNull(); // the national round needs a region
    expect(sanitizeReaction({ kind: "push", g: 2, r: 1 }, current, 2, 3)).toEqual({ kind: "push", g: 2, r: 1 });
  });

  it("stops the count until every player has moved or time runs out", () => {
    const { store, players } = room(2, 0);
    const [a, b] = players;
    handle(store, a.id, { type: "start" }, 2000, newId);
    handle(store, a.id, { type: "lock", platform: goodPlatform(store, a, 1) }, 3000, newId);
    handle(store, b.id, { type: "lock", platform: goodPlatform(store, b, 2) }, 3000, newId);
    runToHalf(store);
    expect(store.room.count!.released).toBe(5);
    const stoppedAt = nextAlarm(store.room)!;
    expect(view(store.room, a.id, stoppedAt - 20000).count!.half).toBe(stoppedAt);

    const scrapped = a.regional!.laws[0];
    handle(store, a.id, { type: "react", reaction: { kind: "drop", law: scrapped } }, stoppedAt - 20000, newId);
    expect(store.room.count!.half!.done).toBe(false); // still waiting for the other party
    handle(store, b.id, { type: "react", reaction: null }, stoppedAt - 15000, newId); // a pass
    expect(store.room.count!.half!.done).toBe(true);
    expect(store.room.count!.released).toBe(6);
    runCount(store, stoppedAt);
    expect(a.regional!.laws).not.toContain(scrapped);
    expect(b.regional!.laws).toHaveLength(goodPlatform(store, b, 2).laws.length);
  });
});

describe("attacks", () => {
  it("are for the national round only and need a real rival", () => {
    const pick = { a: "attack", g: 0, r: 1, t: "rival" };
    expect(sanitize({ actions: [pick] }, { round: 1, gold: 60, regions: 3, min: 2, max: 3, rivals: [] }).actions).toHaveLength(0);
    expect(sanitize({ actions: [pick] }, { round: 2, gold: 60, regions: 3, min: 2, max: 3, rivals: ["someone-else"] }).actions).toHaveLength(0);
    expect(sanitize({ actions: [pick] }, { round: 2, gold: 60, regions: 3, min: 2, max: 3, rivals: ["rival"] }).actions).toEqual([pick]);
  });
});

describe("the national round", () => {
  /** Three players all reach the national round and lock in. */
  function toNationalCount(lockAt: number) {
    const made = room(3, 0);
    const { store, players } = made;
    handle(store, players[0].id, { type: "start" }, 2000, newId);
    players.forEach((p, i) => handle(store, p.id, { type: "lock", platform: goodPlatform(store, p, i + 1) }, 3000, newId));
    const now = runCount(store, 3000);
    expect(store.room.outcome!.kind).toBe("advance");
    handle(store, players[0].id, { type: "next" }, now, newId);
    players.forEach((p, i) => handle(store, p.id, { type: "lock", platform: goodPlatform(store, p, i + 7) }, now + lockAt, newId));
    expect(store.room.phase).toBe("counting");
    return { ...made, end: runCount(store, now + lockAt) };
  }

  it("turns votes into seats, with every seat accounted for and a bonus for coming first", () => {
    const { store } = toNationalCount(1000);
    const seats = store.room.seats!;
    const res = store.room.results2!;
    expect(seats.all).toBe(seats.old + Object.values(seats.total).reduce((a, b) => a + b, 0));
    seats.regions.forEach((r, i) => {
      const base = Math.max(3, Math.round(store.room.regions[i].pop / RULES.votersPerSeat));
      expect(r.total).toBe(base + RULES.winnerBonusSeats);
      const top = Object.keys(res.regions[i].share).reduce((a, b) => (res.regions[i].share[a] >= res.regions[i].share[b] ? a : b));
      expect(r.first).toBe(top);
      expect(r.p[top]).toBeGreaterThanOrEqual(RULES.winnerBonusSeats);
    });
    expect(allocateSeats(res, store.room.regions)).toEqual(seats);
  });

  it("sends the parties into coalition talks when nobody holds more than half the seats", () => {
    const { store, players, end } = toNationalCount(1000);
    const seats = store.room.seats!;
    const order = players.slice().sort((x, y) => seats.total[y.id] - seats.total[x.id]);
    expect(seats.total[order[0].id] * 2).toBeLessThanOrEqual(seats.all);
    expect(store.room.phase).toBe("coalition");
    expect(nextAlarm(store.room)).toBe(end + RULES.coalitionSec * 1000);

    // The two smaller parties choose each other; the biggest is left out.
    const [first, second, third] = order;
    handle(store, second.id, { type: "ally", id: third.id }, end + 1000, newId);
    handle(store, first.id, { type: "ally", id: second.id }, end + 2000, newId);
    expect(store.room.phase).toBe("coalition");
    handle(store, third.id, { type: "ally", id: second.id }, end + 3000, newId);
    expect(store.room.phase).toBe("final");
    const together = seats.total[second.id] + seats.total[third.id];
    if (together > seats.total[first.id]) expect(store.room.outcome).toMatchObject({ winner: second.id, partner: third.id, ranking: [second.id, third.id, first.id] });
    else expect(store.room.outcome).toMatchObject({ winner: first.id, partner: null });
  });

  it("gives the biggest party the win if the talks run out of time with no deal", () => {
    const { store, players, end } = toNationalCount(1000);
    const seats = store.room.seats!;
    const top = players.slice().sort((x, y) => seats.total[y.id] - seats.total[x.id])[0];
    onAlarm(store, end + RULES.coalitionSec * 1000);
    expect(store.room.phase).toBe("final");
    expect(store.room.outcome).toMatchObject({ winner: top.id, partner: null });
  });

  it("lets a knocked-out party endorse one that is still in the race", () => {
    const { store, players } = room(3, 0);
    const [a, b, c] = players;
    handle(store, a.id, { type: "start" }, 2000, newId);
    handle(store, a.id, { type: "lock", platform: goodPlatform(store, a, 1) }, 3000, newId);
    handle(store, b.id, { type: "lock", platform: goodPlatform(store, b, 2) }, 3000, newId);
    handle(store, c.id, { type: "lock", platform: badPlatform(store, c) }, 3000, newId);
    const now = runCount(store, 3000);
    handle(store, a.id, { type: "next" }, now, newId);
    expect(c.eliminated).toBe(true);
    expect(handle(store, a.id, { type: "endorse", id: b.id }, now, newId)).toMatch(/knocked-out/);
    expect(handle(store, c.id, { type: "endorse", id: a.id }, now, newId)).toBeNull();
    expect(view(store.room, c.id, now).you.endorse).toBe(a.id);

    // The endorsement is worth votes in the endorser's old region.
    const base = { round: 2 as const, regions: store.room.regions, seed: 9, q0: MODEL.q0 - MODEL.q0NationalShift };
    const stand = (endorsed: boolean): Contender[] =>
      [a, b].map((p) => ({ id: p.id, name: p.name, home: p.home, regional: p.regional!, national: goodPlatform(store, p, 4), endorsements: endorsed && p === a ? [{ by: c.name, region: c.home }] : [] }));
    const without = runElection({ ...base, parties: stand(false) }).results.regions[c.home].share[a.id];
    const withIt = runElection({ ...base, parties: stand(true) }).results.regions[c.home].share[a.id];
    expect(withIt).toBeGreaterThan(without);
  });
});

describe("a quick game", () => {
  it("needs only one law in each area and runs shorter counts", () => {
    const { store, players } = room(2, 0, { simSec: 300, planSec: 300 });
    const [a] = players;
    handle(store, a.id, { type: "settings", quick: true }, 1500, newId);
    expect(store.room.settings).toMatchObject({ quick: true, simSec: 120 });
    handle(store, a.id, { type: "start" }, 2000, newId);
    expect(view(store.room, a.id, 2000).limits).toEqual({ min: 1, max: 2 });
    const one = { laws: CATEGORIES.map((c) => lawsOf("R", c.id)[3].id), tax: 12, actions: [] };
    expect(handle(store, a.id, { type: "lock", platform: one }, 2500, newId)).toBeNull();
    const three = sanitize({ laws: ["R1.1", "R1.2", "R1.3"] }, { round: 1, gold: 60, regions: 2, min: 1, max: 2, rivals: [] });
    expect(three.laws).toEqual(["R1.1", "R1.2"]);
  });
});

describe("endorsing when only bots are left in the race", () => {
  it("holds the vote briefly so a knocked-out player can choose, then goes ahead", () => {
    const { store, players } = room(1, 2);
    const [a] = players;
    handle(store, a.id, { type: "start" }, 2000, newId);
    handle(store, a.id, { type: "lock", platform: badPlatform(store, a) }, 3000, newId);
    const now = runCount(store, 3000);
    if (store.room.outcome!.kind !== "advance") return; // a bot fell short too: nothing to endorse
    handle(store, a.id, { type: "next" }, now, newId);
    expect(a.eliminated).toBe(true);
    expect(store.room.phase).toBe("planning"); // the bots are ready, but the vote waits
    expect(store.room.deadline).toBeLessThanOrEqual(now + 20_000);
    handle(store, a.id, { type: "endorse", id: "" }, now + 3000, newId); // "nobody" is a decision too
    expect(store.room.phase).toBe("counting");

    // And if the player never answers, the clock starts the vote.
    const again = room(1, 2);
    handle(again.store, again.players[0].id, { type: "start" }, 2000, newId);
    handle(again.store, again.players[0].id, { type: "lock", platform: badPlatform(again.store, again.players[0]) }, 3000, newId);
    const t = runCount(again.store, 3000);
    if (again.store.room.outcome!.kind !== "advance") return;
    handle(again.store, again.players[0].id, { type: "next" }, t, newId);
    onAlarm(again.store, nextAlarm(again.store.room)!);
    expect(again.store.room.phase).toBe("counting");
  });
});
