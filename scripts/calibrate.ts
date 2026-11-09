// Monte Carlo check of how hard the regional round is.
// Usage: npm run calibrate            (report with the current constants)
//        npm run calibrate -- --tune  (also search for the q0 that hits the target)
//
// Target: a "sensible" campaign (a thoughtful newcomer with an imperfect read of the region)
// should clear 50% a little more than half the time, an expert nearly always, and a
// careless platform only now and then.

import { CATEGORIES, G, MODEL, RULES } from "../src/game/data";
import { lawsOf } from "../src/game/laws";
import { clerk } from "../src/game/rules";
import { makeRegions, mulberry32, runElection, shuffle, type Platform, type Region, type Rng } from "../src/game/sim";

type Strategy = (region: Region, rng: Rng) => Platform;

const sensible: Strategy = (region, rng) => clerk({ round: 1, regions: [region], home: 0, gold: RULES.startGold, rng, noise: 5, full: true });
const expert: Strategy = (region, rng) => clerk({ round: 1, regions: [region], home: 0, gold: RULES.startGold, rng, noise: 0, full: true });
const random: Strategy = (_region, rng) => {
  const laws: string[] = [];
  for (const cat of CATEGORIES) {
    const options = lawsOf("R", cat.id);
    const start = Math.floor(rng() * (options.length - RULES.maxSpread));
    const window = shuffle(options.slice(start, start + RULES.maxSpread + 1), rng);
    laws.push(...window.slice(0, 2 + Math.floor(rng() * 2)).map((l) => l.id));
  }
  return { laws, tax: Math.round(rng() * 40), actions: [{ a: "speech", g: Math.floor(rng() * G) }, { a: "visit", g: Math.floor(rng() * G) }] };
};
const extreme = (end: "left" | "right"): Strategy => () => {
  const laws: string[] = [];
  for (const cat of CATEGORIES) {
    const options = lawsOf("R", cat.id);
    laws.push(...(end === "left" ? options.slice(0, 3) : options.slice(-3)).map((l) => l.id));
  }
  return { laws, tax: end === "left" ? 25 : 8, actions: [] };
};

function trial(strategy: Strategy, q0: number, runs: number): { rate: number; mean: number } {
  let wins = 0;
  let sum = 0;
  for (let i = 0; i < runs; i++) {
    const rng = mulberry32(1000 + i * 7919);
    const region = makeRegions(5, rng)[Math.floor(rng() * 5)];
    const regional = strategy(region, rng);
    const res = runElection({ round: 1, regions: [region], parties: [{ id: "p", name: "P", home: 0, regional }], seed: 5000 + i, q0, headlinesPerTick: 0 }).results;
    const share = res.parties.p.share;
    sum += share;
    if (share >= RULES.qualifyShare) wins++;
  }
  return { rate: wins / runs, mean: sum / runs };
}

const RUNS = 3000;
const report = (q0: number) => {
  console.log(`\nq0 = ${q0.toFixed(3)}   (${RUNS} regional elections per strategy)`);
  for (const [name, s] of [["sensible", sensible], ["expert", expert], ["random", random], ["all-collectivist", extreme("left")], ["all-free-market", extreme("right")]] as [string, Strategy][]) {
    const t = trial(s, q0, RUNS);
    console.log(`  ${name.padEnd(18)} qualifies ${(t.rate * 100).toFixed(1).padStart(5)}%   mean share ${(t.mean * 100).toFixed(1)}%`);
  }
};

report(MODEL.q0);

if (process.argv.includes("--tune")) {
  let lo = -1.5;
  let hi = 2.5;
  const target = 0.55;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (trial(sensible, mid, 1500).rate > target) lo = mid;
    else hi = mid;
  }
  const q0 = Math.round(((lo + hi) / 2) * 100) / 100;
  console.log(`\nSuggested q0 for a ${(target * 100).toFixed(1)}% sensible-campaign success rate: ${q0}`);
  report(q0);
}
