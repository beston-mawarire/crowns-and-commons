// Monte Carlo check of how hard the regional round is.
// Usage: npm run calibrate            (report with the current constants)
//        npm run calibrate -- --tune  (also search for the q0 that hits the target)
//
// It reports how often different kinds of platform reach the qualifying share
// (RULES.qualifyShare). The Old Order's pull, q0, was originally tuned for a 50% bar;
// with the bar at 30% nearly every platform qualifies. Use --tune to find the q0 at which
// a "sensible" campaign (a thoughtful newcomer) qualifies 55% of the time at the current bar.

import { CATEGORIES, G, MODEL, RULES } from "../src/game/data";
import { lawsOf } from "../src/game/laws";
import { clerk, randomLean } from "../src/game/rules";
import { makeRegions, mulberry32, runElection, shuffle, type Contender, type Platform, type Region, type Rng } from "../src/game/sim";

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

// ---- the nationwide round, played by bots as they play in the real game
console.log(`\nNationwide round between bots (q0 shifted by -${MODEL.q0NationalShift}):`);
for (const n of [2, 3, 4, 5]) {
  let qualified = 0;
  let games = 0;
  let old = 0;
  let winner = 0;
  const runs = 400;
  for (let i = 0; i < runs; i++) {
    const rng = mulberry32(77 + i * 131 + n);
    const regions = makeRegions(n, rng);
    const parties: Contender[] = regions.map((_, h) => ({
      id: "p" + h,
      name: "P",
      home: h,
      regional: clerk({ round: 1, regions: [regions[h]], home: 0, gold: RULES.startGold, rng, noise: 5, lean: randomLean(rng), full: true }),
    }));
    const first = runElection({ round: 1, regions, parties, seed: i * 3 + 1, q0: MODEL.q0, headlinesPerTick: 0 });
    const through = parties.filter((p) => first.results.parties[p.id].share >= RULES.qualifyShare);
    qualified += through.length / n;
    if (through.length < 2) continue;
    regions.forEach((r, k) => (r.sat = first.satAfter[k]));
    for (const p of through) p.national = clerk({ round: 2, regions, home: p.home, gold: 70, rng, noise: 5, lean: randomLean(rng), full: true });
    const second = runElection({ round: 2, regions, parties: through, seed: i * 3 + 2, q0: MODEL.q0 - MODEL.q0NationalShift, headlinesPerTick: 0 }).results;
    games++;
    old += second.old.share;
    winner += Math.max(...through.map((p) => second.parties[p.id].share));
  }
  console.log(
    `  ${n} parties: bots qualify ${((qualified / runs) * 100).toFixed(0)}% of the time; a national round happens in ${((games / runs) * 100).toFixed(0)}% of matches; ` +
      `Old Order takes ${((old / games) * 100).toFixed(0)}%, the winner ${((winner / games) * 100).toFixed(0)}%`,
  );
}
