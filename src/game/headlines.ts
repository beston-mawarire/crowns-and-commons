// The news ticker. Headlines never show numbers; they describe how the people are
// reacting, and every reaction is driven by the real hidden weights, so an attentive
// player can learn what each group likes.

import { G, GROUP_KEYS, MODEL } from "./data";
import type { Law } from "./laws";
import { LAW_BY_ID } from "./laws";
import { shortfall, weights, type Contender, type StoryFacts } from "./sim";

export interface Headline {
  text: string;
  kind: "good" | "bad" | "mixed" | "event" | "friction" | "flavour";
  /** party the headline is about, if any */
  p?: string;
  /** when to show it within its counting period, 0..1 */
  at: number;
}

const ACTORS: string[][] = [
  ["Farmers", "Labourers", "Villagers", "Shepherds", "Market sellers"],
  ["Wool traders", "Moneylenders", "Spice traders", "Ship owners", "Wine sellers"],
  ["Weavers", "Builders", "Blacksmiths", "Carpenters", "Bakers"],
  ["Priests", "Monks", "Nuns", "Church leaders", "Preachers"],
  ["Soldiers", "Old soldiers", "Town guards", "Archers", "Army officers"],
  ["Nobles", "Rich landowners", "Knights", "Old noble families", "Estate managers"],
];

const LAW_T = {
  strongGood: [
    "{Actor} in {place} are celebrating the {law}; everyone is talking about {party}",
    "'Finally, someone who means it,' say {actor} in {place} about the {law}",
    "{Actor} march through {place} waving {party} flags after hearing about the {law}",
    "Street parties in {place}: {actor} love the {law}",
  ],
  mildGood: [
    "{Actor} in {place} are fine with the {law}: 'could be worse'",
    "{Actor} in {place} cautiously approve of the {law}",
    "{Actor} in {place} call the {law} 'a good start'",
  ],
  strongBad: [
    "{Actor} in {place} are furious about the {law}",
    "'Over our dead bodies,' say {actor} in {place} about the {law}",
    "{Actor} in {place} slam their doors when {party} announces the {law}",
    "Angry meeting of {actor} in {place}: a copy of the {law} is thrown on the fire",
  ],
  mildBad: [
    "{Actor} in {place} are grumbling about the {law}",
    "{Actor} in {place} are not sure about the {law}",
    "{Actor} in {place} say the {law} is 'not what we hoped for'",
  ],
  downside: [
    "Second thoughts in {place}: {actor} are worried about the {law}. {down}",
    "The {law} is losing its shine in {place}, say {actor}. {down}",
    "{Actor} in {place} have a complaint about the {law}. {down}",
  ],
  unfunded: [
    "Who is paying for it? The {law} is only half-funded because {party}'s taxes are too low",
    "{Actor} in {place} are still waiting for the {law}; there is no money for it",
  ],
};

const CAMPAIGN_T: Record<string, { good: string[]; meh: string[]; bad: string[] }> = {
  speech: {
    good: ["{party} gives a speech in {place}; {actor} cheer until they lose their voices"],
    meh: ["{party} gives a speech in {place}; {actor} listen politely and wander off"],
    bad: ["{party} gives a speech in {place}; {actor} do not even look up"],
  },
  visit: {
    good: ["{party} visits {place}; {actor} line the streets to say hello"],
    meh: ["{party} visits {place}; a few {actor} show up"],
    bad: ["{party} visits {place}; {actor} suddenly have somewhere else to be"],
  },
  notices: {
    good: ["{party} posters on every door in {place}; {actor} read them twice"],
    meh: ["{party} posters go up in {place}; some {actor} stop to read"],
    bad: ["{party} posters go up in {place}; {actor} use them to light fires"],
  },
  lobby: {
    good: ["{party} has dinner with {actor} near {place}; it goes very well"],
    meh: ["{party} has dinner with {actor} near {place}, who promise to think about it"],
    bad: ["{party} tries to win over {actor} in {place} over dinner; it does not go well"],
  },
  relief: {
    good: ["{party} hands out free food in {place}; {actor} are grateful"],
    meh: ["{party} hands out free food in {place}; {actor} take it and say nothing"],
    bad: ["{party} offers free food to {actor} in {place}, who are insulted"],
  },
  feast: {
    good: ["{party} throws a feast in {place}: {actor} dance until sunrise"],
    meh: ["{party} throws a feast in {place}; {actor} eat well and promise nothing"],
    bad: ["{party} throws a feast in {place}; {actor} complain loudly from a distance"],
  },
};

const REPEAT_T = ["{party} tries the same thing again in {place}; {actor} say they have heard it all before"];

const TAX_T = {
  high: [
    "Tax collectors in {place} ask for bodyguards after {party} announces its tax rate",
    "{Actor} in {place} are counting their coins twice since {party} announced its taxes",
  ],
  low: ["{party} promises very low taxes; {actor} in {place} dare to hope"],
  soldiers: ["{Actor} in {place} ask who will pay the army with {party}'s low taxes"],
};

const FRICTION_T = [
  "{party} denies that the {lawR} and the {lawN} contradict each other",
  "Confusion in {place}: {party} passed the {lawR} at home and now promises the {lawN}",
  "'Which is it?' ask {actor} in {place}, pointing at the {lawR} and the {lawN}",
];

const TREND_T = {
  up: ["People in {place} say {party} is gaining support", "Is {party} surging late? The pubs of {place} think so"],
  down: ["People in {place} say {party} has had a bad week", "Fewer {party} ribbons around {place} than a week ago"],
};

const EVENT_FOLLOW = {
  good: ["{party} is praised for planning ahead: {actor} in {place} say its laws were made for times like this"],
  bad: ["As trouble hits, {actor} in {place} ask what {party} ever planned to do about it"],
};

const ATTACK_T = {
  strong: ["{party} attacks {rival} over the {law}; {actor} in {place} are listening"],
  weak: ["{party} attacks {rival} in {place}; {actor} are not very interested"],
  backfire: ["{party}'s attack on {rival} backfires in {place}: {actor} call it dirty politics"],
};

const ENDORSE_T = ["{by}, knocked out of the race, tells its supporters in {region} to vote for {party}"];

const HALFTIME_T = {
  push: ["{party} makes a last-minute appeal to {actor} in {place}"],
  drop: ["{party} scraps the {law} at the last minute; rivals call it a U-turn"],
};

const FLAVOUR_T = [
  "A two-headed calf is born in {place}; every party calls it a good sign",
  "Rain in {place}. Turnout among ducks is reported to be high",
  "A comet is seen over {region}; priests cannot agree which party it supports",
  "The voting queue in {place} now reaches the pub, and nobody minds",
  "Bell-ringers in {place} demand to be paid per vote",
  "A juggler in {place} is mistaken for a candidate and gains a few fans",
  "The town crier of {place} loses his voice; the election goes on in whispers",
  "Old men in {place} agree that elections were better in their day",
];

interface Candidate {
  weight: number;
  /** earliest and latest counting period this may appear in */
  from: number;
  to: number;
  party?: string;
  /** the law the headline is about, so it can be retired if that law is scrapped at half-time */
  law?: string;
  make: () => Headline;
}

export function buildHeadlines(facts: StoryFacts, K: number, perTick: number): Headline[][] {
  const { input, rng, world } = facts;
  const { regions, parties, round } = input;
  const reactions = input.reactions ?? {};
  const H = facts.halfAt;
  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const placeIn = (r: number) => pick([regions[r].capital, ...regions[r].places]);
  const fill = (t: string, v: Record<string, string>) => {
    const s = t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
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
    // In the national round the regional laws still get talked about now and then.
    const record: Law[] = round === 2 ? p.regional.laws.map((id) => LAW_BY_ID[id]).filter(Boolean) : [];
    const short = shortfall(platform);

    for (const [law, scale] of [...lawSet.map((l) => [l, 1] as const), ...record.map((l) => [l, 0.35] as const)]) {
      const eff = weights(law, world);
      const mine = scale === 1 ? law.id : undefined;
      for (let g = 0; g < G; g++) {
        const w = eff.w[g];
        if (Math.abs(w) >= 0.5) {
          const r = pick(where);
          const bank = w >= 1.5 ? LAW_T.strongGood : w > 0 ? LAW_T.mildGood : w > -1.5 ? LAW_T.mildBad : LAW_T.strongBad;
          pool.push({
            weight: Math.min(3, Math.abs(w)) * regions[r].mix[g] * 6 * scale,
            from: 0,
            to: K - 1,
            party: p.id,
            law: mine,
            make: () => ({ text: fill(pick(bank), vars(p, r, g, { law: law.name })), kind: w > 0 ? "good" : "bad", p: p.id, at: 0 }),
          });
        }
        if (eff.d[g] < 0 && scale === 1) {
          const r = pick(where);
          pool.push({
            weight: Math.min(3, Math.abs(eff.d[g])) * regions[r].mix[g] * 5,
            from: half,
            to: K - 1,
            party: p.id,
            law: mine,
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
          law: mine,
          make: () => ({ text: fill(pick(LAW_T.unfunded), vars(p, r, 0, { law: law.name })), kind: "bad", p: p.id, at: 0 }),
        });
      }
    }

    for (const c of facts.campaigns[p.id]) {
      const bank = c.repeat ? REPEAT_T : c.fit >= 1 ? CAMPAIGN_T[c.pick.a].good : c.fit >= 0.3 ? CAMPAIGN_T[c.pick.a].meh : CAMPAIGN_T[c.pick.a].bad;
      pool.push({
        weight: 2.2,
        from: 0,
        to: Math.max(2, Math.floor(K * 0.6)),
        party: p.id,
        make: () => ({ text: fill(pick(bank), vars(p, c.region, c.pick.g)), kind: c.repeat || c.fit < 0.3 ? "bad" : c.fit >= 1 ? "good" : "mixed", p: p.id, at: 0 }),
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
        law: f.national.id,
        make: () => ({ text: fill(pick(FRICTION_T), vars(p, r, g, { lawR: f.regional.name, lawN: f.national.name })), kind: "friction", p: p.id, at: 0 }),
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

  // From here on, nothing may draw a random number while the pool is being built. A count is
  // run twice (see runElection) and the first half must come out the same both times, so
  // everything that can differ between the two runs is added last and only opens late.
  for (const a of facts.attacks) {
    const bank = a.backfired ? ATTACK_T.backfire : a.law ? ATTACK_T.strong : ATTACK_T.weak;
    pool.push({
      weight: 3,
      from: 0,
      to: Math.max(2, Math.floor(K * 0.6)),
      party: a.by.id,
      make: () => ({ text: fill(pick(bank), vars(a.by, a.region, a.g, { rival: a.on.name, law: a.law?.name ?? "" })), kind: a.backfired ? "bad" : "mixed", p: a.by.id, at: 0 }),
    });
  }
  for (const p of parties)
    for (const e of p.endorsements ?? [])
      pool.push({
        weight: 3,
        from: 0,
        to: Math.max(2, Math.floor(K / 2)),
        party: p.id,
        make: () => ({ text: fill(pick(ENDORSE_T), vars(p, e.region, 0, { by: e.by })), kind: "good", p: p.id, at: 0 }),
      });
  for (const p of parties) {
    const where = stands(p);
    const t = facts.trend[p.id];
    const mid = Math.floor(K / 2);
    const early = t.slice(0, mid).reduce((a, b) => a + b, 0) / Math.max(1, mid);
    const late = t.slice(mid).reduce((a, b) => a + b, 0) / Math.max(1, K - mid);
    if (Math.abs(late - early) > 0.012)
      pool.push({
        weight: 3,
        from: Math.max(H, Math.floor(K * 0.6)),
        to: K - 1,
        party: p.id,
        make: () => ({ text: fill(pick(late > early ? TREND_T.up : TREND_T.down), vars(p, pick(where), 0)), kind: late > early ? "good" : "bad", p: p.id, at: 0 }),
      });
  }

  // Half-time moves always make the news, straight after the restart.
  const halfTime: (() => Headline)[] = [];
  for (const p of parties) {
    const move = reactions[p.id];
    if (move?.kind === "push") halfTime.push(() => ({ text: fill(pick(HALFTIME_T.push), vars(p, round === 1 ? p.home : move.r ?? p.home, move.g)), kind: "mixed", p: p.id, at: 0 }));
    if (move?.kind === "drop" && LAW_BY_ID[move.law])
      halfTime.push(() => ({ text: fill(pick(HALFTIME_T.drop), vars(p, pick(stands(p)), 0, { law: LAW_BY_ID[move.law].name })), kind: "mixed", p: p.id, at: 0 }));
  }

  /** A law scrapped at half-time stops making news about itself. */
  const retired = (c: Candidate, k: number) => {
    const move = c.party ? reactions[c.party] : null;
    return k >= H && !!c.law && move?.kind === "drop" && move.law === c.law;
  };

  // Deal the pool out across the counting periods, spreading attention between parties.
  const out: Headline[][] = [];
  const shown: Record<string, number> = {};
  for (let k = 0; k < K; k++) {
    const list: Headline[] = [];
    if (facts.event && facts.event.tick === k) {
      const ev = facts.event;
      const r = ev.region ?? 0;
      const text = fill(pick(ev.region === null ? ev.def.national : ev.def.regional), { region: regions[r].name, capital: regions[r].capital });
      list.push({ text: "Breaking news: " + text, kind: "event", at: 0 });
    }
    if (k === H) for (const make of halfTime) list.push(make());
    while (list.length < perTick) {
      const open = pool.filter((c) => c.from <= k && c.to >= k && !retired(c, k));
      if (!open.length) break;
      const least = Math.min(...parties.map((p) => shown[p.id] ?? 0));
      const weights2 = open.map((c) => c.weight * (c.party && (shown[c.party] ?? 0) > least + 1 ? 0.25 : 1));
      let roll = rng() * weights2.reduce((a, b) => a + b, 0);
      let idx = 0;
      while (idx < open.length - 1 && (roll -= weights2[idx]) > 0) idx++;
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
