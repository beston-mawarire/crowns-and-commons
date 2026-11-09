// The election model. Pure and seeded: the same input always gives the same election,
// so the server can work out a whole count in advance and release it a piece at a time.
//
// For every region and every group, each party on the ballot and the "Old Order"
// (people who would rather keep things as they are) get a score; a softmax turns scores
// into a vote split, and the group's satisfaction decides how many of them vote at all.
//
// A count can be run twice with the same seed: once when everyone locks in, and again at
// half-time with the parties' half-time moves. The first half comes out identical.

import { ACTION_HIDDEN, ARCHETYPES, EVENTS, G, GROUP_KEYS, ISSUES, MODEL, REGION_NAMES, RULES, type EventDef, type W } from "./data";
import { LAW_BY_ID, frictionBetween, type Law } from "./laws";
import { buildHeadlines, type Headline } from "./headlines";

// ---------------------------------------------------------------- random numbers

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- types

export interface ActionPick {
  /** action id */
  a: string;
  /** target group index */
  g: number;
  /** target region index (national round only; the regional round is always the home region) */
  r?: number;
  /** rival party id (attacks only) */
  t?: string;
}

export interface Platform {
  laws: string[];
  tax: number;
  actions: ActionPick[];
}

/** A party's one move at half-time. */
export type Reaction = { kind: "push"; g: number; r?: number } | { kind: "drop"; law: string };

export interface Region {
  name: string;
  capital: string;
  places: string[];
  kind: string;
  blurb: string;
  pop: number;
  /** Share of the electorate in each group; sums to 1. */
  mix: number[];
  /** Satisfaction 0..100 per group, as it stands now. */
  sat: number[];
  /** Satisfaction at the very start of the match: how well the old ways suit each group. */
  sat0: number[];
}

export interface Contender {
  id: string;
  name: string;
  home: number;
  regional: Platform;
  national?: Platform;
  /** Knocked-out parties that told their old region to back this one. */
  endorsements?: { by: string; region: number }[];
}

/** What is different about this particular match. */
export interface World {
  /** Index into ISSUES, or -1 for none. */
  issue: number;
  /** tilt[group][area-1]: how far this group's taste has shifted along that area's spectrum. */
  tilt: number[][];
}

export const NEUTRAL: World = { issue: -1, tilt: Array.from({ length: G }, () => new Array(9).fill(0)) };

export function makeWorld(rng: Rng): World {
  return {
    issue: Math.floor(rng() * ISSUES.length),
    tilt: Array.from({ length: G }, () => Array.from({ length: 9 }, () => (rng() * 2 - 1) * MODEL.tiltMax)),
  };
}

/** A law's real effect on each group in this match: base weights, shifted by the year's mood. */
export function weights(law: Law, world: World): { w: number[]; d: number[] } {
  const hot = world.issue >= 0 && ISSUES[world.issue].cats.includes(law.cat) ? MODEL.issueMult : 1;
  const lean = (law.spec - 0.5) * 2;
  return {
    w: law.w.map((w, g) => (w + world.tilt[g][law.cat - 1] * lean) * hot),
    d: law.d.map((d) => d * hot),
  };
}

export interface ElectionInput {
  round: 1 | 2;
  regions: Region[];
  parties: Contender[];
  seed: number;
  q0: number;
  world?: World;
  /** Platform sums are divided by this (see limits() in data.ts). */
  norm?: number;
  ticks?: number;
  headlinesPerTick?: number;
  /** Half-time moves by party id; they take effect after tick `halfAt`. */
  reactions?: Record<string, Reaction | null>;
  halfAt?: number;
}

export interface PaintRegion {
  /** Fraction of the region painted for each party so far. */
  p: Record<string, number>;
  /** Fraction counted for the Old Order so far. */
  old: number;
}

export interface RegionResult {
  votes: Record<string, number>;
  old: number;
  cast: number;
  electorate: number;
  share: Record<string, number>;
  oldShare: number;
  turnout: number;
}

export interface PartyResult {
  votes: number;
  /** Regional round: share of votes cast in the home region. National round: share of all votes cast. */
  share: number;
  /** Share of each group's votes that went to this party, where it was on the ballot. */
  byGroup: number[];
}

export interface Results {
  round: 1 | 2;
  regions: RegionResult[];
  parties: Record<string, PartyResult>;
  old: { votes: number; share: number; byGroup: number[] };
  event: { name: string; region: number | null } | null;
}

export interface Timeline {
  /** paints[k] is the map after k of `ticks` counting periods; paints[0] is blank. */
  paints: PaintRegion[][];
  /** headlines[k] are shown during counting period k. */
  headlines: Headline[][];
  results: Results;
  satAfter: number[][];
  /** Each party's platform for this round once half-time moves are applied. */
  platformsAfter: Record<string, Platform>;
}

// ---------------------------------------------------------------- regions

export function makeRegions(n: number, rng: Rng): Region[] {
  const kinds = shuffle(ARCHETYPES, rng).slice(0, n);
  return kinds.map((arch, i) => {
    const noisy = arch.mix.map((m) => Math.max(4, m + (rng() * 6 - 3)));
    const total = noisy.reduce((a, b) => a + b, 0);
    const base = 40 + rng() * 20;
    const sat0 = noisy.map(() => Math.round(clamp(base + (rng() * 20 - 10), 20, 80)));
    return {
      ...REGION_NAMES[i],
      kind: arch.kind,
      blurb: arch.blurb,
      pop: Math.round(60 + rng() * 80) * 1000,
      mix: noisy.map((m) => m / total),
      sat: sat0.slice(),
      sat0,
    };
  });
}

// ---------------------------------------------------------------- pieces of the score

const ramp = (tau: number, from: number, to: number) => clamp((tau - from) / (to - from), 0, 1);

function laws(p: Platform | undefined): Law[] {
  return (p?.laws ?? []).map((id) => LAW_BY_ID[id]).filter(Boolean);
}

/**
 * Taxes have to cover what a platform promises. Returns 0 when the tax rate is enough,
 * rising to 1 when there is nothing in the treasury at all.
 */
export function shortfall(platform: Platform | undefined): number {
  if (!platform) return 0;
  const need = MODEL.fundingBase + MODEL.fundingPerLaw * laws(platform).filter((l) => l.tags.includes("spend")).length;
  return clamp((need - platform.tax) / need, 0, 1);
}

/** Appeal of a set of laws to each group at time tau (0..1) of the count. */
export function appeal(platform: Platform | undefined, tau: number, world: World = NEUTRAL, norm: number = MODEL.lawNorm): number[] {
  const out = new Array(G).fill(0);
  if (!platform) return out;
  const bite = ramp(tau, MODEL.downsideFrom, MODEL.downsideTo);
  const short = shortfall(platform);
  for (const law of laws(platform)) {
    const costly = law.tags.includes("spend");
    const eff = weights(law, world);
    for (let g = 0; g < G; g++) {
      let w = eff.w[g];
      if (costly && w > 0) w *= 1 - MODEL.unfundedCut * short * bite;
      out[g] += w + eff.d[g] * bite;
    }
  }
  // A big issue doubles two of the nine areas; scale back so a platform's overall pull stays the same.
  const scale = world.issue >= 0 ? norm * (1 + (2 * (MODEL.issueMult - 1)) / 9) : norm;
  return out.map((x) => x / scale);
}

export interface FrictionPair {
  regional: Law;
  national: Law;
  strength: number;
}

export function frictionPairs(regional: Platform | undefined, national: Platform | undefined): FrictionPair[] {
  const pairs: FrictionPair[] = [];
  for (const r of laws(regional))
    for (const n of laws(national)) {
      const strength = frictionBetween(r, n);
      if (strength) pairs.push({ regional: r, national: n, strength });
    }
  return pairs;
}

function frictionPenalty(pairs: FrictionPair[]): number[] {
  const points = pairs.reduce((a, p) => a + p.strength, 0);
  const base = Math.min(MODEL.frictionCap, MODEL.frictionPerPoint * points);
  const out = new Array(G).fill(base);
  for (let g = 0; g < G; g++)
    if (pairs.some((p) => Math.abs(p.regional.w[g]) >= 2 || Math.abs(p.national.w[g]) >= 2)) out[g] += MODEL.frictionStrong;
  return out;
}

export interface CampaignEffect {
  pick: ActionPick;
  region: number;
  /** score added for the target group */
  effect: number;
  /** how well the action suited the group, before repeats */
  fit: number;
  repeat: boolean;
}

/** Work out what each of a party's campaign actions is worth, with diminishing returns. Attacks are handled apart. */
export function campaignEffects(picks: ActionPick[], home: number, round: 1 | 2): CampaignEffect[] {
  const sameTarget: Record<string, number> = {};
  const sameAction: Record<string, number> = {};
  return picks
    .filter((pick) => pick.a !== "attack")
    .map((pick) => {
      const region = round === 1 ? home : pick.r ?? home;
      const h = ACTION_HIDDEN[pick.a];
      const kt = `${pick.a}|${region}|${pick.g}`;
      const nt = (sameTarget[kt] = (sameTarget[kt] ?? 0) + 1);
      const na = (sameAction[pick.a] = (sameAction[pick.a] ?? 0) + 1);
      const fit = h.fit[pick.g];
      const effect = h.b * fit * Math.pow(MODEL.repeatSameTarget, nt - 1) * Math.pow(MODEL.repeatSameAction, na - 1);
      return { pick, region, effect, fit, repeat: nt > 1 };
    });
}

export interface Attack {
  by: Contender;
  on: Contender;
  region: number;
  g: number;
  strength: number;
  backfired: boolean;
  /** The rival's law the attack leans on, if the group really dislikes one. */
  law: Law | null;
}

/** A party's platform for the current round with its half-time move applied. */
function applyReaction(platform: Platform, reaction: Reaction | null | undefined): Platform {
  if (reaction?.kind !== "drop") return platform;
  return { ...platform, laws: platform.laws.filter((id) => id !== reaction.law) };
}

// ---------------------------------------------------------------- the election

export interface StoryFacts {
  input: ElectionInput;
  world: World;
  halfAt: number;
  campaigns: Record<string, CampaignEffect[]>;
  attacks: Attack[];
  friction: Record<string, FrictionPair[]>;
  event: { def: EventDef; region: number | null; tick: number } | null;
  /** share[partyId][tick] of all votes cast in that tick where the party stood */
  trend: Record<string, number[]>;
  rng: Rng;
}

interface View {
  regional: Platform;
  national?: Platform;
  friction: FrictionPair[];
  fPenalty: number[];
  shock: number[];
}

export function runElection(input: ElectionInput): Timeline {
  const K = input.ticks ?? RULES.ticks;
  const H = input.halfAt ?? Math.floor(K / 2);
  const world = input.world ?? NEUTRAL;
  const norm = input.norm ?? MODEL.lawNorm;
  const rng = mulberry32(input.seed);
  const { regions, parties, round } = input;
  const R = regions.length;
  const reactions = input.reactions ?? {};

  // Who stands where.
  const ballot: Contender[][] = regions.map((_, r) => (round === 1 ? parties.filter((p) => p.home === r) : parties));

  // Fixed draws for this election.
  const eps: Record<string, number[][]> = {};
  for (const p of parties) eps[p.id] = regions.map(() => Array.from({ length: G }, () => gauss(rng) * MODEL.noise));
  const eps0 = regions.map(() => Array.from({ length: G }, () => gauss(rng) * MODEL.noise));

  // A rare event.
  let event: StoryFacts["event"] = null;
  if (rng() < MODEL.eventChance) {
    const def = EVENTS[Math.floor(rng() * EVENTS.length)];
    const everywhere = round === 2 && rng() < 0.5;
    event = { def, region: everywhere ? null : Math.floor(rng() * R), tick: 2 + Math.floor(rng() * Math.max(1, K - 5)) };
  }
  const eventHits = (r: number) => event !== null && (event.region === null || event.region === r);

  // Attacks (national round only). The dice are rolled here so both runs of a count agree.
  const attacks: Attack[] = [];
  if (round === 2)
    for (const p of parties) {
      const seen: Record<string, number> = {};
      for (const pick of p.national?.actions ?? []) {
        if (pick.a !== "attack") continue;
        const on = parties.find((q) => q.id === pick.t && q !== p);
        const backfired = rng() < MODEL.attackBackfireChance;
        if (!on) continue;
        const region = pick.r ?? p.home;
        let worst: Law | null = null;
        let worstW = -1;
        for (const law of [...laws(on.regional), ...laws(on.national)]) {
          const w = weights(law, world).w[pick.g];
          if (w <= worstW) [worst, worstW] = [law, w];
        }
        const key = `${on.id}|${region}|${pick.g}`;
        const n = (seen[key] = (seen[key] ?? 0) + 1);
        const strength = MODEL.attackBase * (worst ? 1 : MODEL.attackWeakFactor) * Math.pow(MODEL.repeatSameTarget, n - 1);
        attacks.push({ by: p, on, region, g: pick.g, strength, backfired, law: worst });
      }
    }

  // Each party as it stands before and after its half-time move.
  const campaigns: Record<string, CampaignEffect[]> = {};
  const views: Record<string, [View, View]> = {};
  const platformsAfter: Record<string, Platform> = {};
  for (const p of parties) {
    const picks = (round === 1 ? p.regional : p.national!)?.actions ?? [];
    campaigns[p.id] = campaignEffects(picks, p.home, round);
    const current = round === 1 ? p.regional : p.national!;
    const after = applyReaction(current, reactions[p.id]);
    platformsAfter[p.id] = after;
    const make = (cur: Platform): View => {
      const regional = round === 1 ? cur : p.regional;
      const national = round === 2 ? cur : undefined;
      const friction = round === 2 ? frictionPairs(regional, national) : [];
      const shock = new Array(G).fill(0);
      if (event) {
        const tagged = [...laws(regional), ...laws(national)].some((l) => l.tags.includes(event!.def.tag));
        for (const key of event.def.groups) shock[GROUP_KEYS.indexOf(key)] = tagged ? event.def.bonus : -event.def.malus;
      }
      return { regional, national, friction, fPenalty: frictionPenalty(friction), shock };
    };
    views[p.id] = [make(current), make(after)];
  }

  // Running tallies.
  const votes: Record<string, number[][]> = {};
  for (const p of parties) votes[p.id] = regions.map(() => new Array(G).fill(0));
  const oldVotes = regions.map(() => new Array(G).fill(0));
  const trend: Record<string, number[]> = {};
  for (const p of parties) trend[p.id] = [];
  const cumulative: { p: Record<string, number>; old: number }[][] = [];
  let sat = regions.map((r) => r.sat.slice());

  for (let k = 1; k <= K; k++) {
    const tau = k / K;
    const late = k > H;
    const campRamp = Math.min(1, 1.5 * tau);
    const bite = ramp(tau, MODEL.downsideFrom, MODEL.downsideTo);
    const eventOn = event !== null && k >= event.tick;
    const tickVotes: Record<string, number> = {};
    const tickCast: Record<string, number> = {};
    const view = (p: Contender) => views[p.id][late ? 1 : 0];

    // Satisfaction at this moment.
    sat = regions.map((region, r) => {
      const s = region.sat.slice();
      if (round === 1) {
        for (const p of ballot[r]) {
          const platform = view(p).regional;
          const over = (platform.tax - RULES.taxNeutral) / 5;
          for (const law of laws(platform)) {
            const eff = weights(law, world);
            for (let g = 0; g < G; g++) s[g] -= MODEL.downsideSat * Math.abs(eff.d[g]) * bite;
          }
          for (let g = 0; g < G; g++) s[g] -= MODEL.taxSat[g] * over;
        }
      }
      for (const p of ballot[r])
        for (const c of campaigns[p.id]) {
          const bonus = ACTION_HIDDEN[c.pick.a].sat;
          if (bonus && c.region === r && c.fit > 0) s[c.pick.g] += bonus * campRamp;
        }
      if (eventOn && eventHits(r)) for (let g = 0; g < G; g++) s[g] += event!.def.sat[g];
      return s.map((x) => clamp(x, 0, 100));
    });

    const aRegional: Record<string, number[]> = {};
    const aNational: Record<string, number[]> = {};
    for (const p of parties) {
      aRegional[p.id] = appeal(view(p).regional, round === 1 ? tau : 1, world, norm);
      aNational[p.id] = round === 2 ? appeal(view(p).national, tau, world, norm) : [];
    }

    for (let r = 0; r < R; r++) {
      for (let g = 0; g < G; g++) {
        const v0 = input.q0 + MODEL.qGroup[g] + (MODEL.lambda * (regions[r].sat0[g] - 50)) / 50 + eps0[r][g] + gauss(rng) * MODEL.tickNoise;
        const vs = ballot[r].map((p) => {
          const pv = view(p);
          const current = round === 1 ? pv.regional : pv.national!;
          const a = round === 1 ? aRegional[p.id][g] : MODEL.regionalShare * aRegional[p.id][g] + (1 - MODEL.regionalShare) * aNational[p.id][g];
          const short = shortfall(current) * bite;
          let v = MODEL.beta * a - (MODEL.taxUtil[g] * (current.tax - RULES.taxNeutral)) / 5 - MODEL.unfundedPenalty * short * (g === 4 ? 2 : 1);
          for (const c of campaigns[p.id]) {
            if (c.region !== r) continue;
            if (c.pick.g === g) v += c.effect * campRamp;
            const back = ACTION_HIDDEN[c.pick.a].backlash?.[GROUP_KEYS[g]];
            if (back && c.pick.g !== g) v += back * campRamp;
          }
          for (const a2 of attacks) {
            if (a2.region !== r || a2.g !== g) continue;
            if (a2.on === p && !a2.backfired) v -= a2.strength * campRamp;
            if (a2.by === p && a2.backfired) v -= MODEL.attackBackfireCost * campRamp;
          }
          if (round === 2) {
            v -= pv.fPenalty[g];
            if (p.home === r) v += MODEL.homeBonus;
            if (p.endorsements?.some((e) => e.region === r)) v += MODEL.endorseEffect;
          }
          if (late) {
            const move = reactions[p.id];
            if (move?.kind === "push" && move.g === g && (round === 1 ? p.home : move.r ?? p.home) === r) v += MODEL.pushEffect;
            if (move?.kind === "drop") v -= MODEL.uturnPenalty;
          }
          if (eventOn && eventHits(r)) v += pv.shock[g];
          return v + eps[p.id][r][g] + gauss(rng) * MODEL.tickNoise;
        });

        const best = vs.length ? Math.max(...vs) : -9;
        const turnout = clamp(0.3 + (0.5 * sat[r][g]) / 100 + 0.1 * Math.tanh(best - v0), 0.15, 0.95);
        const ballots = (regions[r].pop * regions[r].mix[g] * turnout) / K;
        const e0 = Math.exp(v0 / MODEL.mu);
        const es = vs.map((v) => Math.exp(v / MODEL.mu));
        const sum = e0 + es.reduce((a, b) => a + b, 0);
        oldVotes[r][g] += (ballots * e0) / sum;
        ballot[r].forEach((p, i) => {
          const n = (ballots * es[i]) / sum;
          votes[p.id][r][g] += n;
          tickVotes[p.id] = (tickVotes[p.id] ?? 0) + n;
          tickCast[p.id] = (tickCast[p.id] ?? 0) + ballots;
        });
      }
    }
    for (const p of parties) trend[p.id].push(tickCast[p.id] ? tickVotes[p.id] / tickCast[p.id] : 0);
    cumulative.push(
      regions.map((_, r) => ({
        p: Object.fromEntries(ballot[r].map((p) => [p.id, votes[p.id][r].reduce((a, b) => a + b, 0)])),
        old: oldVotes[r].reduce((a, b) => a + b, 0),
      })),
    );
  }

  // Final tallies.
  const sumArr = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const regionResults: RegionResult[] = regions.map((region, r) => {
    const v: Record<string, number> = {};
    for (const p of ballot[r]) v[p.id] = sumArr(votes[p.id][r]);
    const old = sumArr(oldVotes[r]);
    const cast = old + sumArr(Object.values(v));
    return {
      votes: v,
      old,
      cast,
      electorate: region.pop,
      share: Object.fromEntries(Object.entries(v).map(([id, n]) => [id, n / cast])),
      oldShare: old / cast,
      turnout: cast / region.pop,
    };
  });

  const castByGroup = (rs: number[]) =>
    Array.from({ length: G }, (_, g) => rs.reduce((a, r) => a + oldVotes[r][g] + ballot[r].reduce((b, p) => b + votes[p.id][r][g], 0), 0));
  const allRegions = regions.map((_, r) => r);
  const partyResults: Record<string, PartyResult> = {};
  for (const p of parties) {
    const where = round === 1 ? [p.home] : allRegions;
    const total = where.reduce((a, r) => a + sumArr(votes[p.id][r]), 0);
    const cast = where.reduce((a, r) => a + regionResults[r].cast, 0);
    const groupCast = castByGroup(where);
    partyResults[p.id] = {
      votes: total,
      share: total / cast,
      byGroup: Array.from({ length: G }, (_, g) => where.reduce((a, r) => a + votes[p.id][r][g], 0) / groupCast[g]),
    };
  }
  const oldTotal = sumArr(regionResults.map((r) => r.old));
  const castTotal = sumArr(regionResults.map((r) => r.cast));
  const groupCastAll = castByGroup(allRegions);
  const results: Results = {
    round,
    regions: regionResults,
    parties: partyResults,
    old: {
      votes: oldTotal,
      share: oldTotal / castTotal,
      byGroup: Array.from({ length: G }, (_, g) => allRegions.reduce((a, r) => a + oldVotes[r][g], 0) / groupCastAll[g]),
    },
    event: event ? { name: event.def.name, region: event.region } : null,
  };

  // The map, as fractions of each region's final count.
  const blank = regions.map((_, r) => ({ p: Object.fromEntries(ballot[r].map((p) => [p.id, 0])), old: 0 }));
  const paints: PaintRegion[][] = [blank].concat(
    cumulative.map((snap) =>
      snap.map((s, r) => ({
        p: Object.fromEntries(Object.entries(s.p).map(([id, n]) => [id, n / regionResults[r].cast])),
        old: s.old / regionResults[r].cast,
      })),
    ),
  );

  const friction = Object.fromEntries(parties.map((p) => [p.id, views[p.id][0].friction]));
  const facts: StoryFacts = { input, world, halfAt: H, campaigns, attacks, friction, event, trend, rng };
  const headlines = buildHeadlines(facts, K, input.headlinesPerTick ?? 5);

  return { paints, headlines, results, satAfter: sat.map((s) => s.map((x) => Math.round(x))), platformsAfter };
}

// ---------------------------------------------------------------- seats

export interface Seats {
  regions: { total: number; p: Record<string, number>; old: number; first: string | null }[];
  total: Record<string, number>;
  old: number;
  all: number;
}

/**
 * Turn the national vote into council seats. Each region has seats in proportion to its
 * voters, shared between the parties by their votes there (largest remainders); the party
 * that comes first in a region wins bonus seats on top. People who voted for the Old Order
 * are not represented: their votes win no seats.
 */
export function allocateSeats(results: Results, regions: Region[]): Seats {
  const out: Seats = { regions: [], total: {}, old: 0, all: 0 };
  for (const id of Object.keys(results.parties)) out.total[id] = 0;
  results.regions.forEach((res, r) => {
    const base = Math.max(3, Math.round(regions[r].pop / RULES.votersPerSeat));
    const ids = Object.keys(res.share);
    const partyVotes = ids.reduce((a, id) => a + res.share[id], 0) || 1;
    const quota = ids.map((id) => ({ id, exact: (res.share[id] / partyVotes) * base, n: Math.floor((res.share[id] / partyVotes) * base) }));
    let left = base - quota.reduce((a, q) => a + q.n, 0);
    for (const q of quota.slice().sort((a, b) => b.exact - b.n - (a.exact - a.n))) if (left-- > 0) q.n++;
    const first = ids.length ? ids.reduce((a, b) => (res.share[a] >= res.share[b] ? a : b)) : null;
    const p: Record<string, number> = {};
    for (const q of quota) p[q.id] = q.n + (q.id === first ? RULES.winnerBonusSeats : 0);
    const total = Object.values(p).reduce((a, b) => a + b, 0);
    out.regions.push({ total, p, old: 0, first });
    for (const [id, n] of Object.entries(p)) out.total[id] += n;
    out.all += total;
  });
  return out;
}

// ---------------------------------------------------------------- after the count

/** How each of a party's laws went down across a set of regions (population-weighted, downsides included). */
export function lawReport(lawIds: string[], regions: Region[], world: World = NEUTRAL): { id: string; score: number }[] {
  const total = regions.reduce((a, r) => a + r.pop, 0);
  const weight = Array.from({ length: G }, (_, g) => regions.reduce((a, r) => a + r.pop * r.mix[g], 0) / total);
  return lawIds
    .map((id) => {
      const eff = weights(LAW_BY_ID[id], world);
      return { id, score: eff.w.reduce((a: number, w, g) => a + weight[g] * (w + eff.d[g]), 0) };
    })
    .sort((a, b) => b.score - a.score);
}

export type { W };
