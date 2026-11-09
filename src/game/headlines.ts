// The news ticker. Headlines never show numbers; they describe how the people are
// reacting, and every reaction is driven by the real hidden weights, so an attentive
// player can learn what each group likes.

import { ACTIONS, G, GROUP_KEYS, MODEL } from "./data";
import type { Law } from "./laws";
import { LAW_BY_ID } from "./laws";
import { shortfall, type Contender, type StoryFacts } from "./sim";

export interface Headline {
  text: string;
  kind: "good" | "bad" | "mixed" | "event" | "friction" | "flavour";
  /** party the headline is about, if any */
  p?: string;
  /** when to show it within its counting period, 0..1 */
  at: number;
}

const ACTORS: string[][] = [
  ["Ploughmen", "Washerwomen", "Cottagers", "Shepherds", "Ditch-diggers"],
  ["Wool merchants", "Moneylenders", "Spice traders", "Shipowners", "Vintners"],
  ["Weavers", "Masons", "Blacksmiths", "Coopers", "Tanners"],
  ["Friars", "Parish priests", "Abbey cellarers", "Choirmasters", "Nuns of the hill convent"],
  ["Garrison sergeants", "Veteran pikemen", "Gate wardens", "Bowmen", "Old campaigners"],
  ["Barons", "Dowager countesses", "Landed knights", "Heirs to great houses", "Stewards of the great estates"],
];

const LAW_T = {
  strongGood: [
    "{Actor} of {place} toast the {law}; {party} is the name on every lip",
    "'At last, someone who means it,' say {actor} in {place} of the {law}",
    "{Actor} carry a {party} banner through {place} after word of the {law}",
    "Bonfires in {place}: {actor} celebrate the {law}",
  ],
  mildGood: [
    "{Actor} in {place} nod along to the {law}: 'could be worse'",
    "Cautious approval among {actor} of {place} for the {law}",
    "{Actor} of {place} call the {law} 'a start'",
  ],
  strongBad: [
    "{Actor} of {place} spit at the mention of the {law}",
    "'Over our dead bodies,' say {actor} in {place} of the {law}",
    "{Actor} in {place} bar their doors as {party} criers announce the {law}",
    "Angry meeting of {actor} in {place}: a copy of the {law} is thrown on the fire",
  ],
  mildBad: [
    "{Actor} of {place} grumble about the {law}",
    "Raised eyebrows among {actor} in {place} over the {law}",
    "{Actor} in {place} call the {law} 'not what we were hoping for'",
  ],
  downside: [
    "Second thoughts in {place}: {actor} are whispering about the {law}. {down}",
    "The shine comes off the {law} in {place}, {actor} say. {down}",
    "{Actor} of {place} have a complaint about the {law}. {down}",
  ],
  unfunded: [
    "Who pays for it? The {law} sits half-funded while {party}'s coffers echo",
    "{Actor} in {place} are still waiting on the {law}; the treasury pleads poverty",
  ],
};

const CAMPAIGN_T: Record<string, { good: string[]; meh: string[]; bad: string[] }> = {
  speech: {
    good: ["{party} speaks from a cart in {place}; {actor} cheer themselves hoarse"],
    meh: ["{party} speaks in {place}; {actor} listen politely and drift away"],
    bad: ["{party} speaks in {place}; {actor} do not look up from their business"],
  },
  visit: {
    good: ["{party} rides into {place}; {actor} line the road"],
    meh: ["{party} visits {place}; a few {actor} turn out"],
    bad: ["{party} visits {place}; {actor} discover urgent business elsewhere"],
  },
  notices: {
    good: ["{party} notices on every door in {place}; {actor} read them twice"],
    meh: ["{party} notices go up in {place}; some {actor} stop to read"],
    bad: ["{party} notices go up in {place}; {actor} use them to light fires"],
  },
  lobby: {
    good: ["A {party} envoy dines with {actor} near {place}; the wine is declared excellent"],
    meh: ["A {party} envoy calls on {actor} near {place}, who promise to think about it"],
    bad: ["{party} sends an envoy to win over {actor} of {place}; it does not go well"],
  },
  relief: {
    good: ["{party} carts hand out bread in {place}; {actor} bless the name"],
    meh: ["{party} hands out relief in {place}; {actor} take it and keep their counsel"],
    bad: ["{party} offers relief to {actor} of {place}, who are rather insulted"],
  },
  feast: {
    good: ["{party} feast in {place}: {actor} dance until dawn and three bards lose their voices"],
    meh: ["{party} throws a feast in {place}; {actor} eat well and promise nothing"],
    bad: ["{party} throws a feast in {place}; {actor} disapprove loudly from a distance"],
  },
};

const REPEAT_T = ["Another {party} {action} in {place}; {actor} say they have heard it all before"];

const TAX_T = {
  high: [
    "Tax collectors in {place} ask for an armed escort after {party} names its rate",
    "{Actor} of {place} count their coins twice since {party} announced its taxes",
  ],
  low: ["{party} promises feather-light taxes; {actor} of {place} dare to hope"],
  soldiers: ["{Actor} in {place} ask who will pay the garrison under {party}'s light taxes"],
};

const FRICTION_T = [
  "{party} clerks deny that the {lawR} and the {lawN} 'cannot both be true'",
  "Confusion in {place}: {party} passed the {lawR} at home and now promises the {lawN}",
  "'Which is it?' ask {actor} of {place}, holding up the {lawR} and the {lawN}",
];

const TREND_T = {
  up: ["Tavern talk in {place} says {party} is gaining ground", "A late surge for {party}? The alehouses of {place} think so"],
  down: ["Tavern talk in {place} says {party} has had a bad week", "Fewer {party} ribbons seen in {place} than a week ago"],
};

const EVENT_FOLLOW = {
  good: ["{party} is praised for foresight: {actor} of {place} say its laws were made for times like these"],
  bad: ["As trouble bites, {actor} of {place} ask what {party} ever planned to do about it"],
};

const FLAVOUR_T = [
  "A two-headed calf is born in {place}; every candidate claims it as a good omen",
  "Rain in {place}. Turnout among ducks is reported to be high",
  "A comet is seen over {region}; the priests cannot agree whom it favours",
  "The queue at the voting oak in {place} now reaches the alehouse, to nobody's displeasure",
  "Bellringers of {place} demand to be paid by the vote",
  "A juggler in {place} is mistaken for a candidate and gathers a small following",
  "The town crier of {place} loses his voice; democracy continues in whispers",
  "Old men of {place} agree that elections were better in their day",
];

interface Candidate {
  weight: number;
  /** earliest and latest counting period this may appear in */
  from: number;
  to: number;
  party?: string;
  make: () => Headline;
}

export function buildHeadlines(facts: StoryFacts, K: number, perTick: number): Headline[][] {
  const { input, rng } = facts;
  const { regions, parties, round } = input;
  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const placeIn = (r: number) => pick([regions[r].capital, ...regions[r].places]);
  const fill = (t: string, v: Record<string, string>) => {
    let s = t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const vars = (p: Contender | undefined, r: number, g: number, extra: Record<string, string> = {}) => {
    const actor = pick(ACTORS[g]);
    return { Actor: actor, actor: actor.charAt(0).toLowerCase() + actor.slice(1), place: placeIn(r), region: regions[r].name, party: p?.name ?? "", ...extra };
  };
  const stands = (p: Contender) => (round === 1 ? [p.home] : regions.map((_, r) => r));
  const half = Math.ceil(K * MODEL.downsideFrom) + 1;
  const pool: Candidate[] = [];

  for (const p of parties) {
    const platform = round === 1 ? p.regional : p.national!;
    const where = stands(p);
    const lawSet: Law[] = platform.laws.map((id) => LAW_BY_ID[id]).filter(Boolean);
    // In round 2 the regional record still gets talked about now and then.
    const record: Law[] = round === 2 ? p.regional.laws.map((id) => LAW_BY_ID[id]).filter(Boolean) : [];
    const short = shortfall(platform);

    for (const [law, scale] of [...lawSet.map((l) => [l, 1] as const), ...record.map((l) => [l, 0.35] as const)]) {
      for (let g = 0; g < G; g++) {
        const w = law.w[g];
        if (w !== 0) {
          const r = pick(where);
          const bank = w >= 2 ? LAW_T.strongGood : w === 1 ? LAW_T.mildGood : w === -1 ? LAW_T.mildBad : LAW_T.strongBad;
          pool.push({
            weight: Math.abs(w) * regions[r].mix[g] * 6 * scale,
            from: 0,
            to: K - 1,
            party: p.id,
            make: () => ({ text: fill(pick(bank), vars(p, r, g, { law: law.name })), kind: w > 0 ? "good" : "bad", p: p.id, at: 0 }),
          });
        }
        if (law.d[g] < 0 && scale === 1) {
          const r = pick(where);
          pool.push({
            weight: Math.abs(law.d[g]) * regions[r].mix[g] * 5,
            from: half,
            to: K - 1,
            party: p.id,
            make: () => ({ text: fill(pick(LAW_T.downside), vars(p, r, g, { law: law.name, down: law.down })), kind: "bad", p: p.id, at: 0 }),
          });
        }
      }
      if (scale === 1 && short > 0.2 && law.tags.includes("spend")) {
        const r = pick(where);
        pool.push({
          weight: 1.5 * short,
          from: half,
          to: K - 1,
          party: p.id,
          make: () => ({ text: fill(pick(LAW_T.unfunded), vars(p, r, 0, { law: law.name })), kind: "bad", p: p.id, at: 0 }),
        });
      }
    }

    for (const c of facts.campaigns[p.id]) {
      const def = ACTIONS.find((a) => a.id === c.pick.a)!;
      const bank = c.repeat ? REPEAT_T : c.fit >= 1 ? CAMPAIGN_T[c.pick.a].good : c.fit >= 0.3 ? CAMPAIGN_T[c.pick.a].meh : CAMPAIGN_T[c.pick.a].bad;
      pool.push({
        weight: 2.2,
        from: 0,
        to: Math.max(2, Math.floor(K * 0.6)),
        party: p.id,
        make: () => ({
          text: fill(pick(bank), vars(p, c.region, c.pick.g, { action: def.name.toLowerCase() })),
          kind: c.repeat || c.fit < 0.3 ? "bad" : c.fit >= 1 ? "good" : "mixed",
          p: p.id,
          at: 0,
        }),
      });
    }

    const tax = platform.tax;
    if (tax >= 25 || tax <= 8) {
      const r = pick(where);
      const g = tax >= 25 ? pick([0, 1, 5]) : pick([0, 1, 2, 5]);
      pool.push({
        weight: 2,
        from: 0,
        to: K - 1,
        party: p.id,
        make: () => ({ text: fill(pick(tax >= 25 ? TAX_T.high : TAX_T.low), vars(p, r, g)), kind: tax >= 25 ? "bad" : "good", p: p.id, at: 0 }),
      });
      if (short > 0.2)
        pool.push({
          weight: 2.5 * short,
          from: half,
          to: K - 1,
          party: p.id,
          make: () => ({ text: fill(pick(TAX_T.soldiers), vars(p, r, 4)), kind: "bad", p: p.id, at: 0 }),
        });
    }

    for (const f of facts.friction[p.id]) {
      const r = pick(where);
      const gs = GROUP_KEYS.map((_, g) => g).filter((g) => Math.abs(f.regional.w[g]) >= 2 || Math.abs(f.national.w[g]) >= 2);
      const g = gs.length ? pick(gs) : 0;
      pool.push({
        weight: 2.5 * f.strength,
        from: 0,
        to: K - 1,
        party: p.id,
        make: () => ({ text: fill(pick(FRICTION_T), vars(p, r, g, { lawR: f.regional.name, lawN: f.national.name })), kind: "friction", p: p.id, at: 0 }),
      });
    }

    // A qualitative read on momentum, late in the count.
    const t = facts.trend[p.id];
    const early = t.slice(0, Math.floor(K / 2)).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(K / 2));
    const late = t.slice(Math.floor(K / 2)).reduce((a, b) => a + b, 0) / Math.max(1, K - Math.floor(K / 2));
    if (Math.abs(late - early) > 0.012) {
      const r = pick(where);
      pool.push({
        weight: 3,
        from: Math.floor(K * 0.6),
        to: K - 1,
        party: p.id,
        make: () => ({ text: fill(pick(late > early ? TREND_T.up : TREND_T.down), vars(p, r, 0)), kind: late > early ? "good" : "bad", p: p.id, at: 0 }),
      });
    }

    if (facts.event) {
      const ev = facts.event;
      const tagged = [...p.regional.laws, ...(p.national?.laws ?? [])].some((id) => LAW_BY_ID[id]?.tags.includes(ev.def.tag));
      const r = ev.region ?? pick(where);
      if (where.includes(r)) {
        const g = GROUP_KEYS.indexOf(pick(ev.def.groups));
        pool.push({
          weight: 4,
          from: ev.tick,
          to: K - 1,
          party: p.id,
          make: () => ({ text: fill(pick(tagged ? EVENT_FOLLOW.good : EVENT_FOLLOW.bad), vars(p, r, g)), kind: tagged ? "good" : "bad", p: p.id, at: 0 }),
        });
      }
    }
  }

  for (let i = 0; i < 4; i++) {
    const r = Math.floor(rng() * regions.length);
    pool.push({ weight: 0.9, from: 0, to: K - 1, make: () => ({ text: fill(pick(FLAVOUR_T), vars(undefined, r, 0)), kind: "flavour", at: 0 }) });
  }

  // Deal the pool out across the counting periods, spreading attention between parties.
  const out: Headline[][] = [];
  const shown: Record<string, number> = {};
  for (let k = 0; k < K; k++) {
    const list: Headline[] = [];
    if (facts.event && facts.event.tick === k) {
      const ev = facts.event;
      const r = ev.region ?? 0;
      const text = fill(pick(ev.region === null ? ev.def.national : ev.def.regional), { region: regions[r].name, capital: regions[r].capital });
      list.push({ text: "By proclamation: " + text, kind: "event", at: 0 });
    }
    while (list.length < perTick) {
      const open = pool.filter((c) => c.from <= k && c.to >= k);
      if (!open.length) break;
      const least = Math.min(...parties.map((p) => shown[p.id] ?? 0));
      const weights = open.map((c) => c.weight * (c.party && (shown[c.party] ?? 0) > least + 1 ? 0.25 : 1));
      let roll = rng() * weights.reduce((a, b) => a + b, 0);
      let idx = 0;
      while (idx < open.length - 1 && (roll -= weights[idx]) > 0) idx++;
      const chosen = open[idx];
      pool.splice(pool.indexOf(chosen), 1);
      if (chosen.party) shown[chosen.party] = (shown[chosen.party] ?? 0) + 1;
      list.push(chosen.make());
    }
    list.forEach((h, i) => (h.at = Math.min(0.97, (i + 0.15 + rng() * 0.5) / list.length)));
    out.push(list);
  }
  return out;
}
