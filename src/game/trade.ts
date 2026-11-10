// Trade and Treachery: the second game mode.
//
// Inspired by Christian Aid's Trading Game. Every player is one country. Countries start
// unequal (nobody is told so): one has the industry and the money, the others have the raw
// materials or very little at all. Raw materials are made into goods, goods are sold to the
// market in batches of five, and everything else is up to the players: what to trade, at
// what price, and whether to keep their word. It is played live against a single clock.
//
// Like game.ts, this file is plain functions over a plain object.

import { mulberry32, shuffle } from "./sim";

// ---------------------------------------------------------------- the economy

export const RAWS = ["timber", "ore", "wool"] as const;
export const BUILDINGS = ["workshop", "sawmill", "forge", "loom"] as const;
export const GOODS = ["planks", "cloth", "tools", "furniture", "machinery"] as const;
const ITEMS: string[] = ["gold", ...RAWS, "amber", ...GOODS, ...BUILDINGS];

export const NAMES: Record<string, string> = {
  gold: "Gold", timber: "Timber", ore: "Ore", wool: "Wool", amber: "Amber",
  planks: "Planks", cloth: "Cloth", tools: "Tools", furniture: "Furniture", machinery: "Machinery",
  workshop: "Workshop", sawmill: "Sawmill", forge: "Forge", loom: "Loom",
};

/** What each good is made from, which buildings it needs besides a workshop, and how long one takes. */
export const RECIPES: Record<string, { uses: Record<string, number>; needs: string[]; price: number; seconds: number }> = {
  planks: { uses: { timber: 1 }, needs: ["sawmill"], price: 150, seconds: 6 },
  cloth: { uses: { wool: 1 }, needs: ["loom"], price: 200, seconds: 7 },
  tools: { uses: { ore: 1 }, needs: ["forge"], price: 200, seconds: 7 },
  furniture: { uses: { timber: 1, wool: 1 }, needs: ["sawmill", "loom"], price: 300, seconds: 9 },
  machinery: { uses: { ore: 1, timber: 1 }, needs: ["forge", "sawmill"], price: 500, seconds: 12 },
};

export const TRADE = {
  minPlayers: 3,
  lengths: [600, 900, 1200],
  defaultLength: 900,
  batch: 5,
  /** The market will always buy raw materials, but for very little. */
  rawFloor: 25,
  buildingPrice: { workshop: 900, sawmill: 600, forge: 600, loom: 600 } as Record<string, number>,
  amberMultiplier: 4,
  strikeMs: 45_000,
  tariffCut: 0.3,
  aidShare: 0.3,
  maxOffers: 5,
};

type Inv = Record<string, number>;

/** The three kinds of start. A is the industrial country; B is rich in raw materials; C has little of anything. */
const STARTS: Record<string, Inv> = {
  A: { gold: 600, workshop: 2, sawmill: 1, forge: 1, loom: 1, timber: 2, ore: 1, wool: 1 },
  B: { gold: 200, timber: 16, ore: 14, wool: 14, amber: 2 },
  C: { gold: 200, timber: 6, ore: 4, wool: 5 },
};
const TIERS: Record<number, string[]> = { 3: ["A", "B", "C"], 4: ["A", "B", "B", "C"], 5: ["A", "B", "B", "C", "C"] };

export interface Job {
  id: number;
  good: string;
  count: number;
  made: number;
  startedAt: number;
  per: number;
}

export interface TradePlayer {
  tier: string;
  inv: Inv;
  start: Inv;
  jobs: Job[];
  knowsAmber: boolean;
  strikeUntil: number;
  aid: "none" | "offered" | "accepted" | "declined";
}

export interface Offer {
  id: number;
  from: string;
  /** null means anyone may accept */
  to: string | null;
  give: Inv;
  want: Inv;
}

export interface Deal {
  t: number;
  kind: "swap" | "gift";
  from: string;
  to: string;
  give: Inv;
  want: Inv;
}

export interface TradeState {
  startedAt: number;
  endsAt: number;
  prices: Record<string, number>;
  players: Record<string, TradePlayer>;
  offers: Offer[];
  chat: { id: number; from: string; to: string | null; text: string; t: number }[];
  news: { id: number; t: number; text: string; to: string | null }[];
  events: { at: number; kind: string; done: boolean }[];
  tariffUntil: number;
  deals: Deal[];
  nextId: number;
  seed: number;
  over: boolean;
}

export interface Who {
  id: string;
  name: string;
}

// ---------------------------------------------------------------- helpers

const has = (inv: Inv, items: Inv) => Object.entries(items).every(([k, n]) => (inv[k] ?? 0) >= n);
function move(from: Inv, to: Inv, items: Inv) {
  for (const [k, n] of Object.entries(items)) {
    from[k] = (from[k] ?? 0) - n;
    to[k] = (to[k] ?? 0) + n;
  }
}

/** Clean up a list of items sent by a browser: known things only, whole positive numbers, at most four kinds. */
function items(input: unknown): Inv | null {
  if (!input || typeof input !== "object") return null;
  const out: Inv = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const n = Math.floor(Number(v));
    if (!ITEMS.includes(k) || !Number.isFinite(n) || n <= 0 || n > 100000) continue;
    out[k] = n;
  }
  const kinds = Object.keys(out).length;
  return kinds > 0 && kinds <= 4 ? out : null;
}

export const describe = (inv: Inv) =>
  Object.entries(inv)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => (k === "gold" ? `${n} gold` : `${n} ${NAMES[k].toLowerCase()}`))
    .join(", ") || "nothing";

/** What a country is worth: gold, goods at their usual price, raw materials at the market floor, buildings at cost. */
export function wealth(inv: Inv): number {
  let total = inv.gold ?? 0;
  for (const g of GOODS) total += (inv[g] ?? 0) * RECIPES[g].price;
  for (const r of [...RAWS, "amber"]) total += (inv[r] ?? 0) * TRADE.rawFloor;
  for (const b of BUILDINGS) total += (inv[b] ?? 0) * TRADE.buildingPrice[b];
  return total;
}

function say(t: TradeState, now: number, text: string, to: string | null = null) {
  t.news.push({ id: t.nextId++, t: now, text, to });
  if (t.news.length > 80) t.news.shift();
}

// ---------------------------------------------------------------- start

export function startTrade(players: Who[], lengthSec: number, seed: number, now: number): TradeState {
  const rng = mulberry32(seed);
  const tiers = shuffle(TIERS[Math.min(5, Math.max(3, players.length))], rng);
  const length = lengthSec * 1000;
  const t: TradeState = {
    startedAt: now,
    endsAt: now + length,
    prices: Object.fromEntries(GOODS.map((g) => [g, RECIPES[g].price])),
    players: {},
    offers: [],
    chat: [],
    news: [],
    // The "leader's interventions" of the original game, on a timetable with a little give in it.
    events: [
      ["secret", 0.12], ["deposit", 0.3], ["crash", 0.42], ["strike", 0.52], ["aid", 0.62], ["tariff", 0.72], ["boom", 0.85],
    ].map(([kind, f]) => ({ kind: kind as string, at: now + Math.round(length * ((f as number) + (rng() - 0.5) * 0.06)), done: false })),
    tariffUntil: 0,
    deals: [],
    nextId: 1,
    seed,
    over: false,
  };
  players.forEach((p, i) => {
    const inv = { ...STARTS[tiers[i]] };
    t.players[p.id] = { tier: tiers[i], inv, start: { ...inv }, jobs: [], knowsAmber: false, strikeUntil: 0, aid: "none" };
  });
  say(t, now, "The market is open. Make goods, sell them in batches of five, and trade with each other however you like.");
  return t;
}

// ---------------------------------------------------------------- time

/** Finish whatever production is due. */
function settle(t: TradeState, now: number) {
  const at = Math.min(now, t.endsAt);
  for (const p of Object.values(t.players)) {
    for (const job of p.jobs) {
      const due = Math.min(job.count, Math.max(job.made, Math.floor((at - job.startedAt) / job.per)));
      if (due > job.made) {
        p.inv[job.good] = (p.inv[job.good] ?? 0) + (due - job.made);
        job.made = due;
      }
    }
    p.jobs = p.jobs.filter((j) => j.made < j.count);
  }
}

/** Bring the game up to date: production, timed events, and the final whistle. */
export function tradeTick(t: TradeState, who: Who[], now: number) {
  if (t.over) return;
  settle(t, now);
  const name = (id: string) => who.find((w) => w.id === id)?.name ?? "A country";
  const ids = Object.keys(t.players);
  for (const ev of t.events) {
    if (ev.done || now < ev.at || now >= t.endsAt) continue;
    ev.done = true;
    const rng = mulberry32(t.seed + ev.at);
    const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
    const rich = ids.filter((id) => t.players[id].tier === "A");
    const others = ids.filter((id) => t.players[id].tier !== "A");
    if (ev.kind === "secret") {
      for (const id of rich) {
        t.players[id].knowsAmber = true;
        say(t, now, `A private report reaches you: a batch of goods set with 1 amber sells for ${TRADE.amberMultiplier} times the price. Others hold amber and do not know what it is worth.`, id);
      }
    } else if (ev.kind === "deposit") {
      const id = pick(others.length ? others : ids);
      const raw = pick([...RAWS]);
      t.players[id].inv[raw] = (t.players[id].inv[raw] ?? 0) + 10;
      say(t, now, `Discovery! A large new deposit of ${raw} has been found in ${name(id)}.`);
    } else if (ev.kind === "crash") {
      const good = GOODS.reduce((a, b) => (t.prices[a] >= t.prices[b] ? a : b));
      t.prices[good] = Math.round(t.prices[good] / 2);
      say(t, now, `Prices fall: the market is flooded with ${good}, which now sells for ${t.prices[good]} each.`);
    } else if (ev.kind === "boom") {
      const good = GOODS.reduce((a, b) => (t.prices[a] <= t.prices[b] ? a : b));
      t.prices[good] = Math.round(t.prices[good] * 1.6);
      say(t, now, `Prices rise: ${good} is suddenly in fashion and now sells for ${t.prices[good]} each.`);
    } else if (ev.kind === "strike") {
      const id = pick(ids.filter((x) => (t.players[x].inv.workshop ?? 0) > 0));
      if (id) {
        const p = t.players[id];
        p.strikeUntil = now + TRADE.strikeMs;
        for (const job of p.jobs) job.startedAt += TRADE.strikeMs;
        say(t, now, `Strike! Workers in ${name(id)} have walked out. Its workshops stand still for ${TRADE.strikeMs / 1000} seconds.`);
      }
    } else if (ev.kind === "aid") {
      const poor = ids.filter((x) => !(t.players[x].inv.workshop ?? 0)).sort((a, b) => wealth(t.players[a].inv) - wealth(t.players[b].inv))[0];
      if (poor) {
        t.players[poor].aid = "offered";
        say(t, now, `The market's bankers offer you aid: a workshop and a sawmill, free. The condition: they keep ${TRADE.aidShare * 100}% of everything you sell to the market from then on.`, poor);
        say(t, now, `The market's bankers have offered aid to ${name(poor)}, with conditions.`);
      }
    } else if (ev.kind === "tariff") {
      t.tariffUntil = now + (t.endsAt - t.startedAt) * 0.12;
      say(t, now, `New tariff: for a while, the market pays ${TRADE.tariffCut * 100}% less for goods from countries that started without industry. Raw materials are not affected.`);
    }
  }
  if (now >= t.endsAt) {
    t.over = true;
    t.offers = [];
    say(t, t.endsAt, "The market has closed.");
  }
}

/** When this game next needs the clock: the next event, the next finished item is not needed (it is worked out on demand). */
export function tradeAlarm(t: TradeState): number {
  return Math.min(t.endsAt, ...t.events.filter((e) => !e.done).map((e) => e.at));
}

// ---------------------------------------------------------------- what players can do

export function tradeHandle(t: TradeState, who: Who[], me: string, msg: any, now: number): string | null {
  tradeTick(t, who, now);
  if (t.over) return "The market has closed.";
  const p = t.players[me];
  if (!p) return "You are not in this game.";
  const name = (id: string) => who.find((w) => w.id === id)?.name ?? "A country";

  switch (msg?.type) {
    case "t.make": {
      const recipe = RECIPES[msg.good];
      const count = Math.floor(Number(msg.count));
      if (!recipe || !(count >= 1 && count <= 50)) return "Choose something to make.";
      if (!(p.inv.workshop ?? 0)) return "You need a workshop to make anything.";
      for (const b of recipe.needs) if (!(p.inv[b] ?? 0)) return `You need a ${b} to make ${msg.good}.`;
      if (p.strikeUntil > now) return "Your workers are on strike.";
      if (p.jobs.length >= p.inv.workshop) return "All your workshops are busy.";
      const uses = Object.fromEntries(Object.entries(recipe.uses).map(([k, n]) => [k, n * count]));
      if (!has(p.inv, uses)) return "You do not have enough raw materials for that.";
      move(p.inv, {}, uses);
      p.jobs.push({ id: t.nextId++, good: msg.good, count, made: 0, startedAt: now, per: recipe.seconds * 1000 });
      return null;
    }
    case "t.sell": {
      if (!RECIPES[msg.good]) return "Choose something to sell.";
      if ((p.inv[msg.good] ?? 0) < TRADE.batch) return `The market only buys goods in batches of ${TRADE.batch}.`;
      const amber = !!msg.amber && (p.inv.amber ?? 0) > 0;
      let pay = t.prices[msg.good] * TRADE.batch * (amber ? TRADE.amberMultiplier : 1);
      if (t.tariffUntil > now && p.tier !== "A") pay *= 1 - TRADE.tariffCut;
      if (p.aid === "accepted") pay *= 1 - TRADE.aidShare;
      pay = Math.round(pay);
      p.inv[msg.good] -= TRADE.batch;
      if (amber) {
        p.inv.amber -= 1;
        if (!p.knowsAmber) {
          p.knowsAmber = true;
          say(t, now, `The buyers gasp at the amber and pay ${TRADE.amberMultiplier} times the price. So that is what it is worth.`, me);
        }
      }
      p.inv.gold = (p.inv.gold ?? 0) + pay;
      say(t, now, `${name(me)} sells a batch of ${msg.good} to the market.`);
      return null;
    }
    case "t.sellRaw": {
      const n = Math.floor(Number(msg.n));
      if (![...RAWS, "amber"].includes(msg.item) || !(n >= 1) || (p.inv[msg.item] ?? 0) < n) return "You do not have that to sell.";
      p.inv[msg.item] -= n;
      p.inv.gold = (p.inv.gold ?? 0) + n * TRADE.rawFloor;
      return null;
    }
    case "t.buy": {
      const price = TRADE.buildingPrice[msg.building];
      if (!price) return "Choose a building.";
      if ((p.inv.gold ?? 0) < price) return `A ${msg.building} costs ${price} gold.`;
      p.inv.gold -= price;
      p.inv[msg.building] = (p.inv[msg.building] ?? 0) + 1;
      say(t, now, `${name(me)} builds a ${msg.building}.`);
      return null;
    }
    case "t.aid": {
      if (p.aid !== "offered") return null;
      p.aid = msg.accept ? "accepted" : "declined";
      if (msg.accept) {
        p.inv.workshop = (p.inv.workshop ?? 0) + 1;
        p.inv.sawmill = (p.inv.sawmill ?? 0) + 1;
      }
      say(t, now, `${name(me)} ${msg.accept ? "accepts the aid, and its conditions" : "turns the aid down"}.`);
      return null;
    }
    case "t.offer": {
      const give = items(msg.give);
      const want = items(msg.want);
      const to = typeof msg.to === "string" && t.players[msg.to] && msg.to !== me ? msg.to : null;
      if (!give || !want) return "Say what you will give and what you want in return.";
      if (!has(p.inv, give)) return "You do not have what you are offering.";
      if (t.offers.filter((o) => o.from === me).length >= TRADE.maxOffers) return "Withdraw one of your offers first.";
      t.offers.push({ id: t.nextId++, from: me, to, give, want });
      return null;
    }
    case "t.accept": {
      const offer = t.offers.find((o) => o.id === msg.id);
      if (!offer || offer.from === me || (offer.to && offer.to !== me)) return "That offer is no longer open.";
      const giver = t.players[offer.from];
      if (!has(giver.inv, offer.give)) {
        t.offers = t.offers.filter((o) => o !== offer);
        return `${name(offer.from)} no longer has what they offered.`;
      }
      if (!has(p.inv, offer.want)) return "You do not have what they are asking for.";
      move(giver.inv, p.inv, offer.give);
      move(p.inv, giver.inv, offer.want);
      t.offers = t.offers.filter((o) => o !== offer);
      t.deals.push({ t: now, kind: "swap", from: offer.from, to: me, give: offer.give, want: offer.want });
      say(t, now, `Deal: ${name(offer.from)} gives ${describe(offer.give)} to ${name(me)} for ${describe(offer.want)}.`);
      return null;
    }
    case "t.cancel": {
      const offer = t.offers.find((o) => o.id === msg.id);
      if (offer && (offer.from === me || offer.to === me)) t.offers = t.offers.filter((o) => o !== offer);
      return null;
    }
    case "t.send": {
      const give = items(msg.give);
      if (!give || !t.players[msg.to] || msg.to === me) return "Choose what to send and to whom.";
      if (!has(p.inv, give)) return "You do not have that to send.";
      move(p.inv, t.players[msg.to].inv, give);
      t.deals.push({ t: now, kind: "gift", from: me, to: msg.to, give, want: {} });
      say(t, now, `${name(me)} sends ${describe(give)} to ${name(msg.to)}.`);
      return null;
    }
    case "t.chat": {
      const text = String(msg.text ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 200);
      if (!text) return null;
      const to = typeof msg.to === "string" && t.players[msg.to] && msg.to !== me ? msg.to : null;
      t.chat.push({ id: t.nextId++, from: me, to, text, t: now });
      if (t.chat.length > 120) t.chat.shift();
      return null;
    }
    default:
      return "Unknown message.";
  }
}

// ---------------------------------------------------------------- what a browser may see

export function tradeView(t: TradeState, me: string, now: number) {
  const p = t.players[me];
  const mine = <T extends { from: string; to: string | null }>(x: T) => x.to === null || x.from === me || x.to === me;
  let result = null;
  if (t.over) {
    const rows = Object.entries(t.players).map(([id, q]) => ({ id, tier: q.tier, start: q.start, startWealth: wealth(q.start), wealth: wealth(q.inv), growth: wealth(q.inv) / wealth(q.start) }));
    // How the going rate for raw materials moved: gold paid per unit in straight raw-for-gold swaps.
    const rate = (from: number, to: number) => {
      let gold = 0;
      let units = 0;
      for (const d of t.deals) {
        if (d.kind !== "swap" || d.t < from || d.t >= to) continue;
        for (const [a, b] of [[d.give, d.want], [d.want, d.give]]) {
          const keys = Object.keys(a);
          if (Object.keys(b).length === 1 && b.gold && keys.every((k) => (RAWS as readonly string[]).includes(k))) {
            gold += b.gold;
            units += keys.reduce((s, k) => s + a[k], 0);
          }
        }
      }
      return units ? Math.round(gold / units) : null;
    };
    const mid = (t.startedAt + t.endsAt) / 2;
    result = {
      rows,
      winner: rows.reduce((a, b) => (b.growth > a.growth ? b : a)).id,
      richest: rows.reduce((a, b) => (b.wealth > a.wealth ? b : a)).id,
      rawEarly: rate(t.startedAt, mid),
      rawLate: rate(mid, t.endsAt + 1),
      deals: t.deals.slice(-60),
      gifts: t.deals.filter((d) => d.kind === "gift").length,
      swaps: t.deals.filter((d) => d.kind === "swap").length,
    };
  }
  return {
    startedAt: t.startedAt,
    endsAt: t.endsAt,
    over: t.over,
    prices: t.prices,
    tariff: t.tariffUntil > now,
    recipes: RECIPES,
    names: NAMES,
    rules: TRADE,
    // Like tables in a room: everyone can see what everyone else is holding.
    holdings: Object.fromEntries(Object.entries(t.players).map(([id, q]) => [id, q.inv])),
    me: p ? { jobs: p.jobs, strikeUntil: p.strikeUntil, knowsAmber: p.knowsAmber, aid: p.aid } : null,
    offers: t.offers.filter(mine),
    chat: t.chat.filter(mine),
    news: t.news.filter((n) => n.to === null || n.to === me),
    result,
  };
}
