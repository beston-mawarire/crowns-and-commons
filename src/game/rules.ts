// What a player is allowed to lock in, plus the "clerk" that fills gaps and plays the bots.

import { ACTIONS, ACTION_HIDDEN, CATEGORIES, G, MODEL, RULES, limits } from "./data";
import { LAW_BY_ID, lawsOf, type Law } from "./laws";
import { NEUTRAL, appeal, gauss, lawReport, weights, type ActionPick, type Platform, type Reaction, type Region, type Rng, type World } from "./sim";

const clampTax = (t: number) => Math.min(RULES.taxMax, Math.max(RULES.taxMin, Math.round(t)));

export const emptyPlatform = (): Platform => ({ laws: [], tax: RULES.taxNeutral, actions: [] });

export const actionCost = (actions: ActionPick[]) => actions.reduce((a, p) => a + (ACTIONS.find((x) => x.id === p.a)?.cost ?? 0), 0);

export interface PlanContext {
  round: 1 | 2;
  gold: number;
  regions: number;
  /** Fewest and most laws per area (see limits() in data.ts). */
  min: number;
  max: number;
  /** Parties that may be attacked (national round only). */
  rivals: string[];
}

/** Drop anything that is not a legal choice, without complaining. Used on drafts. */
export function sanitize(input: unknown, ctx: PlanContext): Platform {
  const src = (input ?? {}) as Partial<Platform>;
  const tier = ctx.round === 1 ? "R" : "N";
  const out = emptyPlatform();
  const tax = Math.round(Number(src.tax));
  out.tax = Number.isFinite(tax) ? clampTax(tax) : RULES.taxNeutral;

  const byCat: Record<number, Law[]> = {};
  for (const id of Array.isArray(src.laws) ? src.laws : []) {
    const law = typeof id === "string" ? LAW_BY_ID[id] : undefined;
    if (!law || law.tier !== tier) continue;
    const have = (byCat[law.cat] ??= []);
    if (have.includes(law) || have.length >= ctx.max) continue;
    if (have.some((h) => Math.abs(h.pos - law.pos) > RULES.maxSpread)) continue;
    have.push(law);
  }
  out.laws = Object.values(byCat).flat().map((l) => l.id);

  let gold = ctx.gold;
  for (const a of Array.isArray(src.actions) ? src.actions : []) {
    if (out.actions.length >= RULES.actionsPerRound) break;
    const def = ACTIONS.find((x) => x.id === a?.a);
    const g = Number(a?.g);
    if (!def || !Number.isInteger(g) || g < 0 || g >= G || def.cost > gold) continue;
    if (def.national && ctx.round !== 2) continue;
    const pick: ActionPick = { a: def.id, g };
    if (ctx.round === 2) {
      const r = Number(a?.r);
      if (!Number.isInteger(r) || r < 0 || r >= ctx.regions) continue;
      pick.r = r;
    }
    if (def.id === "attack") {
      if (typeof a?.t !== "string" || !ctx.rivals.includes(a.t)) continue;
      pick.t = a.t;
    }
    gold -= def.cost;
    out.actions.push(pick);
  }
  return out;
}

/** Why a platform cannot be locked in, or null if it can. */
export function problem(platform: Platform, ctx: PlanContext): string | null {
  const tier = ctx.round === 1 ? "R" : "N";
  for (const cat of CATEGORIES) {
    const n = platform.laws.filter((id) => LAW_BY_ID[id]?.tier === tier && LAW_BY_ID[id].cat === cat.id).length;
    if (n < ctx.min) return `Choose at least ${ctx.min} ${ctx.min === 1 ? "law" : "laws"} for ${cat.name}.`;
  }
  if (actionCost(platform.actions) > ctx.gold) return "You cannot afford those campaign actions.";
  return null;
}

/** Check a half-time move against the platform it applies to. */
export function sanitizeReaction(input: any, current: Platform, round: 1 | 2, regions: number): Reaction | null {
  if (input?.kind === "push") {
    const g = Number(input.g);
    if (!Number.isInteger(g) || g < 0 || g >= G) return null;
    if (round === 1) return { kind: "push", g };
    const r = Number(input.r);
    return Number.isInteger(r) && r >= 0 && r < regions ? { kind: "push", g, r } : null;
  }
  if (input?.kind === "drop" && typeof input.law === "string" && current.laws.includes(input.law)) return { kind: "drop", law: input.law };
  return null;
}

// ---------------------------------------------------------------- the clerk

export interface ClerkOptions {
  round: 1 | 2;
  /** Regions the platform will be judged in. */
  regions: Region[];
  home: number;
  gold: number;
  rng: Rng;
  /** How badly the clerk misjudges the public mood (0 = perfectly informed). */
  noise: number;
  /** A bot's leanings: how much it cares about each group. */
  lean?: number[];
  /** Keep these choices and only fill what is missing. */
  keep?: Platform;
  /** Bots also choose a tax rate and campaign actions; a clerk filling in for a human does not. */
  full: boolean;
  world?: World;
  quick?: boolean;
  /** Parties a bot might attack in the national round, with their laws on record. */
  rivals?: { id: string; laws: string[] }[];
}

export function clerk(o: ClerkOptions): Platform {
  const tier = o.round === 1 ? "R" : "N";
  const world = o.world ?? NEUTRAL;
  const lim = limits(!!o.quick);
  const lean = o.lean ?? new Array(G).fill(1);
  const total = o.regions.reduce((a, r) => a + r.pop, 0);
  const weight = Array.from({ length: G }, (_, g) => (o.regions.reduce((a, r) => a + r.pop * r.mix[g], 0) / total) * lean[g]);
  const keep = o.keep ?? emptyPlatform();
  const out: Platform = { laws: [], tax: keep.tax, actions: keep.actions.slice() };

  for (const cat of CATEGORIES) {
    const options = lawsOf(tier, cat.id);
    const kept = options.filter((l) => keep.laws.includes(l.id));
    const score = options.map((l) => {
      const eff = weights(l, world);
      return eff.w.reduce((a: number, w, g) => a + weight[g] * (w + 0.5 * eff.d[g]), 0) + gauss(o.rng) * o.noise * 0.3;
    });
    let best: Law[] = kept;
    if (kept.length < lim.min) {
      let bestScore = -Infinity;
      // Try every legal set of laws for this area and keep the one judged best.
      for (let mask = 1; mask < 1 << options.length; mask++) {
        const set = options.filter((_, i) => mask & (1 << i));
        if (set.length < lim.min || set.length > lim.max) continue;
        if (!kept.every((k) => set.includes(k))) continue;
        const pos = set.map((l) => l.pos);
        if (Math.max(...pos) - Math.min(...pos) > RULES.maxSpread) continue;
        const s = options.reduce((a, _, i) => (mask & (1 << i) ? a + score[i] : a), 0);
        if (s > bestScore) [best, bestScore] = [set, s];
      }
    }
    out.laws.push(...best.map((l) => l.id));
  }

  if (o.full) {
    const costly = out.laws.filter((id) => LAW_BY_ID[id].tags.includes("spend")).length;
    out.tax = clampTax(MODEL.fundingBase + MODEL.fundingPerLaw * costly + gauss(o.rng) * Math.min(6, o.noise));
    out.actions = [];
    // Keep a little back in the regional round for the campaign that follows.
    let gold = o.round === 1 ? Math.min(o.gold, 45) : o.gold;
    const sameTarget: Record<string, number> = {};
    const sameAction: Record<string, number> = {};
    const targets = o.round === 1 ? [o.home] : o.regions.map((_, r) => r);
    for (let n = 0; n < RULES.actionsPerRound; n++) {
      let pick: ActionPick | null = null;
      let bestValue = 0.01;
      const consider = (candidate: ActionPick, value: number) => {
        const noisy = value * (1 + gauss(o.rng) * o.noise * 0.3);
        if (noisy > bestValue) [pick, bestValue] = [candidate, noisy];
      };
      for (const def of ACTIONS) {
        if (def.cost > gold || (def.national && o.round !== 2)) continue;
        const h = ACTION_HIDDEN[def.id];
        for (const r of targets)
          for (let g = 0; g < G; g++) {
            const reach = (o.regions[r].mix[g] * o.regions[r].pop) / total;
            const where = o.round === 2 ? { r } : {};
            if (def.id === "attack") {
              for (const rival of o.rivals ?? []) {
                const open = rival.laws.some((id) => weights(LAW_BY_ID[id], world).w[g] <= -1);
                const repeat = Math.pow(MODEL.repeatSameTarget, sameTarget[`attack|${rival.id}|${r}|${g}`] ?? 0);
                // An attack only takes votes off one rival, so it is worth less than winning them yourself.
                consider({ a: "attack", g, t: rival.id, ...where }, MODEL.attackBase * (open ? 1 : MODEL.attackWeakFactor) * (1 - MODEL.attackBackfireChance) * repeat * reach * 0.6);
              }
              continue;
            }
            const repeat = Math.pow(MODEL.repeatSameTarget, sameTarget[`${def.id}|${r}|${g}`] ?? 0) * Math.pow(MODEL.repeatSameAction, sameAction[def.id] ?? 0);
            consider({ a: def.id, g, ...where }, h.b * h.fit[g] * repeat * reach * lean[g]);
          }
      }
      if (!pick) break;
      const chosen: ActionPick = pick;
      const r = chosen.r ?? o.home;
      const key = chosen.a === "attack" ? `attack|${chosen.t}|${r}|${chosen.g}` : `${chosen.a}|${r}|${chosen.g}`;
      sameTarget[key] = (sameTarget[key] ?? 0) + 1;
      sameAction[chosen.a] = (sameAction[chosen.a] ?? 0) + 1;
      gold -= ACTIONS.find((a) => a.id === chosen.a)!.cost;
      out.actions.push(chosen);
    }
  }
  return out;
}

/** Give a bot a temperament, so that bots do not all campaign for the same voters. */
export function randomLean(rng: Rng): number[] {
  return Array.from({ length: G }, () => 0.5 + rng() * 1.1);
}

// ---------------------------------------------------------------- how bots make the smaller decisions

/** A bot's half-time move: scrap a law that is clearly hurting, or appeal to its best audience. */
export function botReaction(o: { round: 1 | 2; current: Platform; regions: Region[]; home: number; lean?: number[]; world: World; rng: Rng }): Reaction {
  const judged = o.round === 1 ? [o.regions[o.home]] : o.regions;
  const report = lawReport(o.current.laws, judged, o.world);
  const worst = report[report.length - 1];
  if (worst && worst.score < -0.6 && o.rng() < 0.5) return { kind: "drop", law: worst.id };
  const lean = o.lean ?? new Array(G).fill(1);
  const region = o.regions[o.home];
  let g = 0;
  for (let i = 1; i < G; i++) if (region.mix[i] * lean[i] > region.mix[g] * lean[g]) g = i;
  return o.round === 1 ? { kind: "push", g } : { kind: "push", g, r: o.home };
}

/** How alike two parties' platforms are, from -1 (opposites) to 1 (the same). */
export function compatibility(a: { regional: Platform | null; national: Platform | null }, b: { regional: Platform | null; national: Platform | null }, world: World): number {
  const vec = (p: { regional: Platform | null; national: Platform | null }) => {
    const r = appeal(p.regional ?? undefined, 1, world);
    const n = appeal(p.national ?? undefined, 1, world);
    return r.map((x, g) => x + n[g]);
  };
  const [x, y] = [vec(a), vec(b)];
  const dot = x.reduce((s, v, g) => s + v * y[g], 0);
  const len = Math.sqrt(x.reduce((s, v) => s + v * v, 0) * y.reduce((s, v) => s + v * v, 0));
  return len ? dot / len : 0;
}
