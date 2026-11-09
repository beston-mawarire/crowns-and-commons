// What a player is allowed to lock in, plus the "clerk" that fills gaps and plays the bots.

import { ACTIONS, ACTION_HIDDEN, CATEGORIES, G, MODEL, RULES } from "./data";
import { LAW_BY_ID, lawsOf, type Law } from "./laws";
import { gauss, type ActionPick, type Platform, type Region, type Rng } from "./sim";

const clampTax = (t: number) => Math.min(RULES.taxMax, Math.max(RULES.taxMin, Math.round(t)));

export const emptyPlatform = (): Platform => ({ laws: [], tax: RULES.taxNeutral, actions: [] });

export const actionCost = (actions: ActionPick[]) => actions.reduce((a, p) => a + (ACTIONS.find((x) => x.id === p.a)?.cost ?? 0), 0);

export interface PlanContext {
  round: 1 | 2;
  gold: number;
  regions: number;
}

/** Drop anything that is not a legal choice, without complaining. Used on drafts. */
export function sanitize(input: unknown, ctx: PlanContext): Platform {
  const src = (input ?? {}) as Partial<Platform>;
  const tier = ctx.round === 1 ? "R" : "N";
  const out = emptyPlatform();
  const tax = Math.round(Number(src.tax));
  out.tax = Number.isFinite(tax) ? Math.min(RULES.taxMax, Math.max(RULES.taxMin, tax)) : RULES.taxNeutral;

  const byCat: Record<number, Law[]> = {};
  for (const id of Array.isArray(src.laws) ? src.laws : []) {
    const law = typeof id === "string" ? LAW_BY_ID[id] : undefined;
    if (!law || law.tier !== tier) continue;
    const have = (byCat[law.cat] ??= []);
    if (have.includes(law) || have.length >= RULES.maxLawsPerCategory) continue;
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
    const pick: ActionPick = { a: def.id, g };
    if (ctx.round === 2) {
      const r = Number(a?.r);
      if (!Number.isInteger(r) || r < 0 || r >= ctx.regions) continue;
      pick.r = r;
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
    if (n < RULES.minLawsPerCategory) return `Choose at least ${RULES.minLawsPerCategory} laws for ${cat.name}.`;
  }
  if (actionCost(platform.actions) > ctx.gold) return "You cannot afford those campaign actions.";
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
}

export function clerk(o: ClerkOptions): Platform {
  const tier = o.round === 1 ? "R" : "N";
  const lean = o.lean ?? new Array(G).fill(1);
  const total = o.regions.reduce((a, r) => a + r.pop, 0);
  const weight = Array.from({ length: G }, (_, g) => (o.regions.reduce((a, r) => a + r.pop * r.mix[g], 0) / total) * lean[g]);
  const keep = o.keep ?? emptyPlatform();
  const out: Platform = { laws: [], tax: keep.tax, actions: keep.actions.slice() };

  for (const cat of CATEGORIES) {
    const options = lawsOf(tier, cat.id);
    const kept = options.filter((l) => keep.laws.includes(l.id));
    const score = new Map(options.map((l) => [l.id, l.w.reduce((a: number, w, g) => a + weight[g] * (w + 0.5 * l.d[g]), 0) + gauss(o.rng) * o.noise * 0.3]));
    let best: Law[] = kept;
    let bestScore = -Infinity;
    const consider = (set: Law[]) => {
      if (set.length < RULES.minLawsPerCategory || set.length > RULES.maxLawsPerCategory) return;
      if (!kept.every((k) => set.includes(k))) return;
      const pos = set.map((l) => l.pos);
      if (Math.max(...pos) - Math.min(...pos) > RULES.maxSpread) return;
      const s = set.reduce((a, l) => a + score.get(l.id)!, 0);
      if (s > bestScore) [best, bestScore] = [set, s];
    };
    if (kept.length >= RULES.minLawsPerCategory) {
      best = kept;
    } else {
      for (let i = 0; i < options.length; i++)
        for (let j = i + 1; j < options.length; j++) {
          consider([options[i], options[j]]);
          for (let k = j + 1; k < options.length; k++) consider([options[i], options[j], options[k]]);
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
      for (const def of ACTIONS) {
        if (def.cost > gold) continue;
        const h = ACTION_HIDDEN[def.id];
        for (const r of targets)
          for (let g = 0; g < G; g++) {
            const repeat = Math.pow(MODEL.repeatSameTarget, sameTarget[`${def.id}|${r}|${g}`] ?? 0) * Math.pow(MODEL.repeatSameAction, sameAction[def.id] ?? 0);
            const reach = (o.regions[r].mix[g] * o.regions[r].pop) / total;
            const value = h.b * h.fit[g] * repeat * reach * lean[g] * (1 + gauss(o.rng) * o.noise * 0.3);
            if (value > bestValue) [pick, bestValue] = [{ a: def.id, g, ...(o.round === 2 ? { r } : {}) }, value];
          }
      }
      if (!pick) break;
      const r = pick.r ?? o.home;
      sameTarget[`${pick.a}|${r}|${pick.g}`] = (sameTarget[`${pick.a}|${r}|${pick.g}`] ?? 0) + 1;
      sameAction[pick.a] = (sameAction[pick.a] ?? 0) + 1;
      gold -= ACTIONS.find((a) => a.id === pick!.a)!.cost;
      out.actions.push(pick);
    }
  }
  return out;
}

/** Give a bot a temperament, so that bots do not all campaign for the same voters. */
export function randomLean(rng: Rng): number[] {
  return Array.from({ length: G }, () => 0.5 + rng() * 1.1);
}
