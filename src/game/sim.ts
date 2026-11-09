// The election model. Pure and seeded: the same input always gives the same election,
// so the server can work out a whole count in advance and release it a piece at a time.
//
// For every region and every group, each party on the ballot and the "Old Order"
// (the council that already sits) get a utility; a softmax turns utilities into a vote
// split, and the group's satisfaction decides how many of them turn out at all.

import { ACTION_HIDDEN, ARCHETYPES, EVENTS, G, GROUP_KEYS, MODEL, REGION_NAMES, RULES, type EventDef, type W } from "./data";
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
  /** target region index (Round 2 only; Round 1 is always the home region) */
  r?: number;
}

export interface Platform {
  laws: string[];
  tax: number;
  actions: ActionPick[];
}

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
}

export interface ElectionInput {
  round: 1 | 2;
  regions: Region[];
  parties: Contender[];
  seed: number;
  q0: number;
  ticks?: number;
  headlinesPerTick?: number;
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
  /** Round 1: share of votes cast in the home region. Round 2: share of all votes cast. */
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

// ---------------------------------------------------------------- pieces of the utility

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
export function appeal(platform: Platform | undefined, tau: number): number[] {
  const out = new Array(G).fill(0);
  if (!platform) return out;
  const bite = ramp(tau, MODEL.downsideFrom, MODEL.downsideTo);
  const short = shortfall(platform);
  for (const law of laws(platform)) {
    const costly = law.tags.includes("spend");
    for (let g = 0; g < G; g++) {
      let w = law.w[g];
      if (costly && w > 0) w *= 1 - MODEL.unfundedCut * short * bite;
      out[g] += w + law.d[g] * bite;
    }
  }
  return out.map((x) => x / MODEL.lawNorm);
}

export interface FrictionPair {
  regional: Law;
  national: Law;
  strength: number;
}

export function frictionPairs(c: Contender): FrictionPair[] {
  const pairs: FrictionPair[] = [];
  for (const r of laws(c.regional))
    for (const n of laws(c.national)) {
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
  /** utility added for the target group */
  effect: number;
  /** how well the action suited the group, before repeats */
  fit: number;
  repeat: boolean;
}

/** Work out what each of a party's campaign actions is worth, with diminishing returns. */
export function campaignEffects(picks: ActionPick[], home: number, round: 1 | 2): CampaignEffect[] {
  const sameTarget: Record<string, number> = {};
  const sameAction: Record<string, number> = {};
  return picks.map((pick) => {
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

// ---------------------------------------------------------------- the election

export interface StoryFacts {
  input: ElectionInput;
  campaigns: Record<string, CampaignEffect[]>;
  friction: Record<string, FrictionPair[]>;
  event: { def: EventDef; region: number | null; tick: number } | null;
  /** support[partyId][region][group] averaged over the count (0..1 of votes cast) */
  support: Record<string, number[][]>;
  /** share[partyId][tick] of all votes cast in that tick where the party stood */
  trend: Record<string, number[]>;
  rng: Rng;
}

export function runElection(input: ElectionInput): Timeline {
  const K = input.ticks ?? RULES.ticks;
  const rng = mulberry32(input.seed);
  const { regions, parties, round } = input;
  const R = regions.length;

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

  // Per-party fixed pieces.
  const campaigns: Record<string, CampaignEffect[]> = {};
  const friction: Record<string, FrictionPair[]> = {};
  const fPenalty: Record<string, number[]> = {};
  const eventShock: Record<string, number[]> = {};
  for (const p of parties) {
    const picks = (round === 1 ? p.regional : p.national!)?.actions ?? [];
    campaigns[p.id] = campaignEffects(picks, p.home, round);
    friction[p.id] = round === 2 ? frictionPairs(p) : [];
    fPenalty[p.id] = frictionPenalty(friction[p.id]);
    eventShock[p.id] = new Array(G).fill(0);
    if (event) {
      const tagged = [...laws(p.regional), ...laws(p.national)].some((l) => l.tags.includes(event!.def.tag));
      for (const key of event.def.groups) eventShock[p.id][GROUP_KEYS.indexOf(key)] = tagged ? event.def.bonus : -event.def.malus;
    }
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
    const campRamp = Math.min(1, 1.5 * tau);
    const bite = ramp(tau, MODEL.downsideFrom, MODEL.downsideTo);
    const eventOn = event !== null && k >= event.tick;
    const tickVotes: Record<string, number> = {};
    const tickCast: Record<string, number> = {};

    // Satisfaction at this moment.
    sat = regions.map((region, r) => {
      const s = region.sat.slice();
      if (round === 1) {
        for (const p of ballot[r]) {
          const over = (p.regional.tax - RULES.taxNeutral) / 5;
          for (const law of laws(p.regional)) for (let g = 0; g < G; g++) s[g] -= MODEL.downsideSat * Math.abs(law.d[g]) * bite;
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
      aRegional[p.id] = appeal(p.regional, round === 1 ? tau : 1);
      aNational[p.id] = round === 2 ? appeal(p.national, tau) : [];
    }

    for (let r = 0; r < R; r++) {
      for (let g = 0; g < G; g++) {
        const v0 = input.q0 + MODEL.qGroup[g] + (MODEL.lambda * (regions[r].sat0[g] - 50)) / 50 + eps0[r][g] + gauss(rng) * MODEL.tickNoise;
        const vs = ballot[r].map((p) => {
          const a = round === 1 ? aRegional[p.id][g] : MODEL.regionalShare * aRegional[p.id][g] + (1 - MODEL.regionalShare) * aNational[p.id][g];
          const tax = round === 1 ? p.regional.tax : p.national!.tax;
          const short = shortfall(round === 1 ? p.regional : p.national) * bite;
          let v = MODEL.beta * a - (MODEL.taxUtil[g] * (tax - RULES.taxNeutral)) / 5 - MODEL.unfundedPenalty * short * (g === 4 ? 2 : 1);
          for (const c of campaigns[p.id]) {
            if (c.region !== r) continue;
            if (c.pick.g === g) v += c.effect * campRamp;
            const back = ACTION_HIDDEN[c.pick.a].backlash?.[GROUP_KEYS[g]];
            if (back && c.pick.g !== g) v += back * campRamp;
          }
          if (round === 2) {
            v -= fPenalty[p.id][g];
            if (p.home === r) v += MODEL.homeBonus;
          }
          if (eventOn && eventHits(r)) v += eventShock[p.id][g];
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
  const support: Record<string, number[][]> = {};
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
    support[p.id] = regions.map((_, r) =>
      Array.from({ length: G }, (_, g) => {
        const c = oldVotes[r][g] + ballot[r].reduce((b, q) => b + votes[q.id][r][g], 0);
        return ballot[r].includes(p) ? votes[p.id][r][g] / c : 0;
      }),
    );
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

  const facts: StoryFacts = { input, campaigns, friction, event, support, trend, rng };
  const headlines = buildHeadlines(facts, K, input.headlinesPerTick ?? 5);

  return { paints, headlines, results, satAfter: sat.map((s) => s.map((x) => Math.round(x))) };
}

// ---------------------------------------------------------------- after the count

/** How each of a party's laws went down across a set of regions (population-weighted, downsides included). */
export function lawReport(lawIds: string[], regions: Region[]): { id: string; score: number }[] {
  const total = regions.reduce((a, r) => a + r.pop, 0);
  const weight = Array.from({ length: G }, (_, g) => regions.reduce((a, r) => a + r.pop * r.mix[g], 0) / total);
  return lawIds
    .map((id) => {
      const law = LAW_BY_ID[id];
      return { id, score: law.w.reduce((a: number, w, g) => a + weight[g] * (w + law.d[g]), 0) };
    })
    .sort((a, b) => b.score - a.score);
}

export type { W };
