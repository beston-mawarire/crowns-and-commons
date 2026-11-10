// Trade and Treachery: the second game mode.
//
// Inspired by Christian Aid's Trading Game. Every player is one country. Countries start
// unequal (nobody is told so): one has the industry and the money, the others have the raw
// materials or very little at all. Raw materials are made into goods, goods are sold to the
// market in batches of five, and everything else is up to the players: what to trade, at
// what price, and whether to keep their word. It is played live against a single clock.
//
// Around that core sit a few systems that give players more to argue about: a stock
// exchange, a payday every minute (income, dividends, feeding the people, tax), borders that
// can be guarded or not, and events that reward or punish those choices.
//
// Like game.ts, this file is plain functions over a plain object.

import { mulberry32, shuffle, type Rng } from "./sim";

// ---------------------------------------------------------------- the economy

export const RAWS = ["timber", "ore", "wool", "grain", "coal"] as const;
export const BUILDINGS = ["workshop", "sawmill", "forge", "loom", "mill", "power", "garrison", "housing"] as const;
/** Buildings that turn one thing into another (a workshop is needed as well). */
const PROCESSORS = ["sawmill", "forge", "loom", "mill", "power"];
export const GOODS = ["planks", "cloth", "tools", "food", "electricity", "furniture", "machinery"] as const;
export const STOCKS = ["wood", "metal", "farm", "energy"] as const;
const SHARE = (id: string) => "share_" + id;
const ITEMS: string[] = ["gold", ...RAWS, "amber", ...GOODS, ...BUILDINGS, ...STOCKS.map(SHARE)];

export const NAMES: Record<string, string> = {
  gold: "Gold", timber: "Timber", ore: "Ore", wool: "Wool", grain: "Grain", coal: "Coal", amber: "Amber",
  planks: "Planks", cloth: "Cloth", tools: "Tools", food: "Food", electricity: "Electricity", furniture: "Furniture", machinery: "Machinery",
  workshop: "Workshop", sawmill: "Sawmill", forge: "Forge", loom: "Loom", mill: "Mill", power: "Power plant", garrison: "Border guard", housing: "Housing",
  share_wood: "Timber Co shares", share_metal: "Ironworks shares", share_farm: "Farm & Loom shares", share_energy: "Coal & Power shares",
};
export const STOCK_NAMES: Record<string, string> = { wood: "Timber Co", metal: "Ironworks", farm: "Farm & Loom", energy: "Coal & Power" };
/** Which company's shares move when something happens to a raw material or a product. */
const SECTOR: Record<string, string> = {
  timber: "wood", planks: "wood", furniture: "wood",
  ore: "metal", tools: "metal", machinery: "metal",
  wool: "farm", cloth: "farm", grain: "farm", food: "farm",
  coal: "energy", electricity: "energy",
};

/** What each good is made from, which buildings it needs besides a workshop, and how long one takes. */
export const RECIPES: Record<string, { uses: Record<string, number>; needs: string[]; price: number; seconds: number }> = {
  planks: { uses: { timber: 1 }, needs: ["sawmill"], price: 150, seconds: 6 },
  cloth: { uses: { wool: 1 }, needs: ["loom"], price: 200, seconds: 7 },
  tools: { uses: { ore: 1 }, needs: ["forge"], price: 200, seconds: 7 },
  food: { uses: { grain: 1 }, needs: ["mill"], price: 40, seconds: 4 },
  electricity: { uses: { coal: 1 }, needs: ["power"], price: 130, seconds: 5 },
  furniture: { uses: { timber: 1, wool: 1 }, needs: ["sawmill", "loom"], price: 300, seconds: 9 },
  machinery: { uses: { ore: 1, timber: 1, electricity: 1 }, needs: ["forge", "sawmill"], price: 700, seconds: 12 },
};

export const TRADE = {
  minPlayers: 3,
  lengths: [600, 900, 1200],
  defaultLength: 900,
  batch: 5,
  /** The market will always buy raw materials, but for very little. */
  rawFloor: 25,
  buildingPrice: { workshop: 900, sawmill: 600, forge: 600, loom: 600, mill: 400, power: 600, garrison: 200, housing: 300 } as Record<string, number>,
  amberMultiplier: 4,
  strikeMs: 45_000,
  tariffCut: 0.3,
  aidShare: 0.3,
  maxOffers: 5,
  /** Share prices move this often; payday comes this often. */
  stockStepMs: 30_000,
  paydayMs: 60_000,
  /** Every home holds ten people. Each full home earns this much every payday, and pays this much tax. */
  homeIncome: 80,
  homeTax: 10,
  dividend: 0.03,
  /** Every ten people eat one food each payday. A missing meal is bought in at the market's food price plus this. */
  foodMarkup: 10,
  /** A trade fair: for a while the market pays this much more for goods. */
  fairBonus: 0.25,
  fairMs: 60_000,
  generousValue: 100,
  startPopulation: 10,
  migrants: 10,
};

type Inv = Record<string, number>;

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
  population: number;
  /** Value given away since the last payday, and whether a building was lent: both earn a tax holiday. */
  given: number;
  lent: boolean;
  /** Worth at each payday, for the growth chart. */
  history: number[];
  /** Where the change in worth came from, by cause (see CATS). */
  ledger: Record<string, number>;
}

export interface Offer {
  id: number;
  from: string;
  /** null means anyone may accept */
  to: string | null;
  give: Inv;
  want: Inv;
}

export interface Loan {
  id: number;
  from: string;
  to: string;
  building: string;
  due: number;
  status: "out" | "returned" | "kept";
  /** whether the due date has been dealt with */
  called: boolean;
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
  stocks: Record<string, { price: number; prev: number; hist: number[] }>;
  /** How many of each product the market wants at a time: usually five, now and then three or one. */
  batch: Record<string, number>;
  fairUntil: number;
  nextStep: number;
  nextPay: number;
  players: Record<string, TradePlayer>;
  offers: Offer[];
  chat: { id: number; from: string; to: string | null; text: string; t: number }[];
  news: { id: number; t: number; text: string; to: string | null; kind?: string }[];
  events: { at: number; kind: string; done: boolean }[];
  tariffUntil: number;
  deals: Deal[];
  nextId: number;
  seed: number;
  over: boolean;
  /** Host settings: can everyone see everyone's holdings, and do lent buildings come back by themselves? */
  open: boolean;
  autoReturn: boolean;
  loans: Loan[];
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

/**
 * What a country is worth: gold, goods at their usual price, raw materials at the market
 * floor, buildings at cost, and shares at today's price (or 100 each if no prices are given).
 */
export function wealth(inv: Inv, stocks?: TradeState["stocks"]): number {
  let total = inv.gold ?? 0;
  for (const g of GOODS) total += (inv[g] ?? 0) * RECIPES[g].price;
  for (const r of [...RAWS, "amber"]) total += (inv[r] ?? 0) * TRADE.rawFloor;
  for (const b of BUILDINGS) total += (inv[b] ?? 0) * TRADE.buildingPrice[b];
  for (const s of STOCKS) total += (inv[SHARE(s)] ?? 0) * (stocks?.[s].price ?? 100);
  return Math.round(total);
}

/** The causes a change in worth is filed under. Whatever is left over is share prices moving. */
const CATS = ["made", "market", "deals", "income", "dividends", "food", "tax", "events"];
const note = (p: TradePlayer, cat: string, n: number) => (p.ledger[cat] = (p.ledger[cat] ?? 0) + n);
/** Do something to one or more countries and file the change in their worth under a cause. */
function book(t: TradeState, ids: string[], cat: string, fn: () => void, stocks = t.stocks) {
  const before = ids.map((id) => wealth(t.players[id].inv, stocks));
  fn();
  ids.forEach((id, i) => note(t.players[id], cat, wealth(t.players[id].inv, stocks) - before[i]));
}
function breakdown(t: TradeState, p: TradePlayer): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(CATS.map((c) => [c, Math.round(p.ledger[c] ?? 0)]));
  out.shares = wealth(p.inv, t.stocks) - wealth(p.start) - CATS.reduce((a, c) => a + out[c], 0);
  return out;
}
/** What a country's worth is made of. */
function parts(inv: Inv, stocks?: TradeState["stocks"]) {
  const sum = (keys: readonly string[], price: (k: string) => number) => keys.reduce((a, k) => a + (inv[k] ?? 0) * price(k), 0);
  return {
    gold: inv.gold ?? 0,
    raws: sum([...RAWS, "amber"], () => TRADE.rawFloor),
    goods: sum(GOODS, (g) => RECIPES[g].price),
    buildings: sum(BUILDINGS, (b) => TRADE.buildingPrice[b]),
    shares: STOCKS.reduce((a, x) => a + (inv[SHARE(x)] ?? 0) * (stocks?.[x].price ?? 100), 0),
  };
}

function say(t: TradeState, now: number, text: string, to: string | null = null, kind?: string) {
  t.news.push({ id: t.nextId++, t: now, text, to, kind });
  if (t.news.length > 100) t.news.shift();
}

// ---------------------------------------------------------------- start

/**
 * Deal the starts. Three kinds, with the details different every game:
 *  A  the industrial country: two workshops and three of the five processing buildings, money, almost no raw materials
 *  B  rich in three of the five raw materials, no workshop
 *  C  a little of two raw materials and not much else
 * Nobody can do everything alone, and a poorer country may hold the one building the rich one lacks.
 */
function dealStart(tier: string, rng: Rng): Inv {
  const raws = shuffle([...RAWS], rng);
  const procs = shuffle(PROCESSORS, rng);
  if (tier === "A") {
    const inv: Inv = { gold: 600, workshop: 2, housing: 1 };
    for (const b of procs.slice(0, 3)) inv[b] = 1;
    for (const r of raws.slice(0, 3)) inv[r] = 1 + Math.floor(rng() * 2);
    return inv;
  }
  if (tier === "B") {
    const inv: Inv = { gold: 200, amber: 2, housing: 1 };
    for (const r of raws.slice(0, 3)) inv[r] = 12 + Math.floor(rng() * 5);
    inv[raws[3]] = 2;
    if (rng() < 0.5) inv[procs[0]] = 1;
    return inv;
  }
  const inv: Inv = { gold: 200, housing: 1 };
  for (const r of raws.slice(0, 2)) inv[r] = 4 + Math.floor(rng() * 3);
  inv[raws[2]] = 2;
  if (rng() < 0.6) inv[procs[0]] = 1;
  return inv;
}
const TIERS: Record<number, string[]> = { 3: ["A", "B", "C"], 4: ["A", "B", "B", "C"], 5: ["A", "B", "B", "C", "C"] };

export function startTrade(players: Who[], lengthSec: number, seed: number, now: number, opts: { open: boolean; autoReturn: boolean } = { open: true, autoReturn: true }): TradeState {
  const rng = mulberry32(seed);
  const tiers = shuffle(TIERS[Math.min(5, Math.max(3, players.length))], rng);
  const length = lengthSec * 1000;
  const t: TradeState = {
    startedAt: now,
    endsAt: now + length,
    prices: Object.fromEntries(GOODS.map((g) => [g, RECIPES[g].price])),
    stocks: Object.fromEntries(STOCKS.map((s) => [s, { price: 100, prev: 100, hist: [100] }])),
    batch: Object.fromEntries(GOODS.map((g) => [g, TRADE.batch])),
    fairUntil: 0,
    nextStep: now + TRADE.stockStepMs,
    nextPay: now + TRADE.paydayMs,
    players: {},
    offers: [],
    chat: [],
    news: [],
    // The "leader's interventions" of the original game, on a timetable with a little give in it.
    events: (
      [
        ["secret", 0.1], ["deposit", 0.2], ["migrationWarning", 0.27], ["migration", 0.34], ["crash", 0.42], ["strike", 0.5],
        ["raidWarning", 0.55], ["raid", 0.63], ["aid", 0.69], ["tariff", 0.76], ["boom", 0.86],
      ] as [string, number][]
    ).map(([kind, f]) => ({ kind, at: now + Math.round(length * (f + (rng() - 0.5) * 0.03)), done: false })),
    tariffUntil: 0,
    deals: [],
    nextId: 1,
    seed,
    over: false,
    open: opts.open,
    autoReturn: opts.autoReturn,
    loans: [],
  };
  players.forEach((p, i) => {
    const inv = dealStart(tiers[i], rng);
    t.players[p.id] = { tier: tiers[i], inv, start: { ...inv }, jobs: [], knowsAmber: false, strikeUntil: 0, aid: "none", population: TRADE.startPopulation, given: 0, lent: false, history: [wealth(inv)], ledger: {} };
  });
  // World events: a few each game, picked at random, at times nobody can plan for.
  const worldCount = Math.max(2, Math.round(lengthSec / 300) + 1);
  for (const kind of shuffle([...WORLD], rng).slice(0, worldCount)) t.events.push({ kind: "w:" + kind, at: now + Math.round(length * (0.14 + rng() * 0.8)), done: false });
  say(t, now, "The market is open. Make goods, sell them to the market, and trade with each other however you like.");
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
        note(p, "made", (due - job.made) * RECIPES[job.good].price);
        job.made = due;
      }
    }
    p.jobs = p.jobs.filter((j) => j.made < j.count);
  }
}

function shock(t: TradeState, sector: string | null, factor: number) {
  for (const s of STOCKS) if (!sector || s === sector) t.stocks[s].price = Math.max(10, Math.round(t.stocks[s].price * factor));
}

/** People in tens, and how many of those tens have a home. */
export function homes(p: { population: number; inv: Inv }) {
  const groups = Math.ceil(p.population / 10);
  return { groups, housed: Math.min(groups, p.inv.housing ?? 0) };
}
const isGenerous = (t: TradeState, id: string) => t.players[id].lent || t.players[id].given >= TRADE.generousValue || t.loans.some((l) => l.from === id && l.status === "out");

/** Once a minute: homes earn, shares pay, people eat, homes are taxed. */
function payday(t: TradeState, at: number) {
  const importPrice = t.prices.food + TRADE.foodMarkup;
  for (const [id, p] of Object.entries(t.players)) {
    const { groups, housed } = homes(p);
    const income = housed * TRADE.homeIncome;
    const dividends = Math.round(STOCKS.reduce((a, s) => a + (p.inv[SHARE(s)] ?? 0) * t.stocks[s].price, 0) * TRADE.dividend);
    let gold = (p.inv.gold ?? 0) + income + dividends;
    const eaten = Math.min(groups, p.inv.food ?? 0);
    p.inv.food = (p.inv.food ?? 0) - eaten;
    const imports = Math.min(gold, (groups - eaten) * importPrice);
    gold -= imports;
    const generous = isGenerous(t, id);
    const tax = generous ? 0 : Math.min(gold, housed * TRADE.homeTax);
    p.inv.gold = gold - tax;
    note(p, "income", income);
    note(p, "dividends", dividends);
    note(p, "food", -imports - eaten * RECIPES.food.price);
    note(p, "tax", -tax);
    p.given = 0;
    p.lent = false;
    p.history.push(wealth(p.inv, t.stocks));
    const net = income + dividends - imports - tax;
    say(
      t,
      at,
      `Payday: +${income} from your homes` +
        (dividends ? `, +${dividends} from shares` : "") +
        (imports ? `, −${imports} to buy food` : "") +
        (eaten ? `, ${eaten} food eaten from your stores` : "") +
        (generous ? ", no tax (you were generous)" : `, −${tax} tax`) +
        `. ${net >= 0 ? "You gained" : "You lost"} ${Math.abs(net)} gold.` +
        (groups > housed ? ` ${(groups - housed) * 10} of your people have no home: they eat but earn nothing.` : ""),
      id,
      "pay",
    );
  }
}

/** Things that happen to the whole world. A few are picked for each game. */
const WORLD = ["winter", "drought", "fire", "invention", "panic", "rally", "fair", "festival", "windfall", "relief", "fashion"];
function world(t: TradeState, kind: string, now: number, name: (id: string) => string) {
  const all = Object.values(t.players);
  const price = (good: string, f: number) => (t.prices[good] = Math.round(t.prices[good] * f));
  const byWorth = Object.keys(t.players).sort((a, b) => wealth(t.players[a].inv, t.stocks) - wealth(t.players[b].inv, t.stocks));
  const tell = (text: string) => say(t, now, text, null, "world");
  if (kind === "winter") {
    price("electricity", 1.5);
    shock(t, "energy", 1.25);
    tell(`A hard winter. Everyone wants power: electricity now sells for ${t.prices.electricity} each, and Coal & Power shares climb.`);
  } else if (kind === "drought") {
    for (const p of all) p.inv.grain = Math.ceil(((p.inv.grain ?? 0) * 2) / 3);
    price("food", 1.5);
    shock(t, "farm", 0.85);
    tell(`Drought. Every country loses a third of its grain. Food now sells for ${t.prices.food}, so feeding your people costs more too. Farm & Loom shares fall.`);
  } else if (kind === "fire") {
    for (const p of all) p.inv.timber = Math.ceil((p.inv.timber ?? 0) * 0.75);
    price("planks", 1.25);
    price("furniture", 1.25);
    shock(t, "wood", 0.85);
    tell(`Forest fires. Every country loses a quarter of its timber. Planks and furniture sell for more (${t.prices.planks} and ${t.prices.furniture}), but Timber Co shares fall.`);
  } else if (kind === "invention") {
    price("tools", 1.3);
    price("machinery", 1.3);
    shock(t, "metal", 1.3);
    tell(`A new invention. Tools and machinery are in demand (${t.prices.tools} and ${t.prices.machinery} each), and Ironworks shares soar.`);
  } else if (kind === "fashion") {
    price("cloth", 1.4);
    shock(t, "farm", 1.2);
    tell(`A new fashion sweeps the world. Cloth now sells for ${t.prices.cloth} each, and Farm & Loom shares rise.`);
  } else if (kind === "panic") {
    shock(t, null, 0.7);
    tell("Panic on the stock exchange! Every share loses close to a third of its value.");
  } else if (kind === "rally") {
    shock(t, null, 1.25);
    tell("Good times on the stock exchange: every share jumps by a quarter.");
  } else if (kind === "fair") {
    t.fairUntil = now + TRADE.fairMs;
    tell(`A great trade fair opens. For the next ${TRADE.fairMs / 1000} seconds the market pays ${TRADE.fairBonus * 100}% more for all goods.`);
  } else if (kind === "festival") {
    for (const p of all) p.inv.gold = (p.inv.gold ?? 0) + homes(p).housed * 30;
    tell("A festival year. Every country earns 30 gold for each full home.");
  } else if (kind === "windfall") {
    const id = byWorth.at(-1)!;
    const take = Math.round((t.players[id].inv.gold ?? 0) * 0.1);
    t.players[id].inv.gold -= take;
    tell(`A world tax on the richest: ${name(id)} is worth the most and pays a tenth of its gold (${take}).`);
  } else if (kind === "relief") {
    const id = byWorth[0];
    t.players[id].inv.gold = (t.players[id].inv.gold ?? 0) + 100;
    t.players[id].inv.food = (t.players[id].inv.food ?? 0) + 3;
    tell(`Relief for the poorest: ${name(id)} is worth the least and is sent 100 gold and 3 food, no strings attached.`);
  }
}

/** Bring the game up to date: production, share prices, paydays, timed events, and the final whistle. */
export function tradeTick(t: TradeState, who: Who[], now: number) {
  if (t.over) return;
  settle(t, now);
  const name = (id: string) => who.find((w) => w.id === id)?.name ?? "A country";
  const ids = Object.keys(t.players);

  while (t.nextStep <= now && t.nextStep < t.endsAt) {
    const rng = mulberry32(t.seed + t.nextStep);
    for (const s of STOCKS) {
      const st = t.stocks[s];
      st.prev = st.price;
      st.price = Math.max(10, Math.round(st.price * (1.01 + (rng() - 0.5) * 0.14)));
      st.hist = [...st.hist, st.price].slice(-16);
    }
    // The size of the market's orders: usually five at a time, now and then three or one.
    for (const g of GOODS) {
      const roll = rng();
      if (t.batch[g] !== TRADE.batch) {
        if (roll < 0.4) {
          t.batch[g] = TRADE.batch;
          say(t, t.nextStep, `The market is buying ${g} in batches of ${TRADE.batch} again.`, null, "market");
        }
      } else if (roll < 0.05) {
        t.batch[g] = roll < 0.03 ? 3 : 1;
        say(t, t.nextStep, t.batch[g] === 1 ? `A buyer in a hurry: for now the market will take ${g} one at a time.` : `Small orders: for now the market buys ${g} in batches of 3.`, null, "market");
      }
    }
    t.nextStep += TRADE.stockStepMs;
  }
  while (t.nextPay <= now && t.nextPay < t.endsAt) {
    payday(t, t.nextPay);
    t.nextPay += TRADE.paydayMs;
  }

  for (const ev of t.events) {
    if (ev.done || now < ev.at || now >= t.endsAt) continue;
    ev.done = true;
    // Share prices are held still while the damage is counted, so that it is filed as an event and not as shares moving.
    const held = structuredClone(t.stocks);
    const before = ids.map((id) => wealth(t.players[id].inv, held));
    const rng = mulberry32(t.seed + ev.at);
    const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
    const rich = ids.filter((id) => t.players[id].tier === "A");
    const others = ids.filter((id) => t.players[id].tier !== "A");
    const unguarded = ids.filter((id) => !(t.players[id].inv.garrison ?? 0));
    if (ev.kind === "secret") {
      for (const id of rich) {
        t.players[id].knowsAmber = true;
        say(t, now, `A private report reaches you: a batch of goods set with 1 amber sells for ${TRADE.amberMultiplier} times the price. Others hold amber and do not know what it is worth.`, id);
      }
    } else if (ev.kind === "deposit") {
      const id = pick(others.length ? others : ids);
      const raw = pick([...RAWS]);
      t.players[id].inv[raw] = (t.players[id].inv[raw] ?? 0) + 10;
      shock(t, SECTOR[raw], 1.15);
      say(t, now, `Discovery! A large new deposit of ${raw} has been found in ${name(id)}. ${STOCK_NAMES[SECTOR[raw]]} shares jump.`);
    } else if (ev.kind === "crash") {
      const good = GOODS.reduce((a, b) => (t.prices[a] >= t.prices[b] ? a : b));
      t.prices[good] = Math.round(t.prices[good] / 2);
      shock(t, SECTOR[good], 0.65);
      say(t, now, `Prices fall: the market is flooded with ${good}, which now sells for ${t.prices[good]} each. ${STOCK_NAMES[SECTOR[good]]} shares tumble.`);
    } else if (ev.kind === "boom") {
      const good = GOODS.reduce((a, b) => (t.prices[a] <= t.prices[b] ? a : b));
      t.prices[good] = Math.round(t.prices[good] * 1.6);
      shock(t, SECTOR[good], 1.4);
      say(t, now, `Prices rise: ${good} is suddenly in demand and now sells for ${t.prices[good]} each. ${STOCK_NAMES[SECTOR[good]]} shares soar.`);
    } else if (ev.kind === "strike") {
      const id = pick(ids.filter((x) => (t.players[x].inv.workshop ?? 0) > 0));
      if (id) {
        const p = t.players[id];
        p.strikeUntil = now + TRADE.strikeMs;
        for (const job of p.jobs) job.startedAt += TRADE.strikeMs;
        shock(t, null, 0.95);
        say(t, now, `Strike! Workers in ${name(id)} have walked out. Its workshops stand still for ${TRADE.strikeMs / 1000} seconds.`);
      }
    } else if (ev.kind === "migrationWarning") {
      say(t, now, `Reports from the borders: large numbers of people are on the move. Countries without a border guard (${TRADE.buildingPrice.garrison} gold) should expect new arrivals, who will need food and homes.`);
    } else if (ev.kind === "migration") {
      for (const id of unguarded) t.players[id].population += TRADE.migrants;
      say(t, now, unguarded.length ? `Migration: ${unguarded.map(name).join(", ")} ${unguarded.length === 1 ? "has" : "have"} no border guard and each take in ${TRADE.migrants} new people. They have no homes: they eat every payday but earn nothing until housing is built for them.` : "A wave of migrants finds every border guarded and moves on.");
    } else if (ev.kind === "raidWarning") {
      say(t, now, "Scouts report raiders gathering beyond the frontier. They will strike a country that has no border guard.");
    } else if (ev.kind === "raid") {
      const id = pick(unguarded);
      if (id) {
        const inv = t.players[id].inv;
        inv.gold = Math.floor((inv.gold ?? 0) * 0.8);
        for (const r of RAWS) inv[r] = Math.floor((inv[r] ?? 0) * 0.75);
        shock(t, null, 0.92);
        say(t, now, `Invasion! Raiders cross into ${name(id)}, which had no border guard, and carry off a fifth of its gold and a quarter of its raw materials.`);
      } else say(t, now, "The raiders find every border guarded and turn back.");
    } else if (ev.kind === "aid") {
      const poor = ids.filter((x) => !(t.players[x].inv.workshop ?? 0)).sort((a, b) => wealth(t.players[a].inv, t.stocks) - wealth(t.players[b].inv, t.stocks))[0];
      if (poor) {
        t.players[poor].aid = "offered";
        say(t, now, `The market's bankers offer you aid: a workshop and a mill, free. The condition: they keep ${TRADE.aidShare * 100}% of everything you sell to the market from then on.`, poor);
        say(t, now, `The market's bankers have offered aid to ${name(poor)}, with conditions.`);
      }
    } else if (ev.kind === "tariff") {
      t.tariffUntil = now + (t.endsAt - t.startedAt) * 0.12;
      say(t, now, `New tariff: for a while, the market pays ${TRADE.tariffCut * 100}% less for goods from countries that started without a workshop. Raw materials are not affected.`);
    } else if (ev.kind.startsWith("w:")) world(t, ev.kind.slice(2), now, name);
    ids.forEach((id, i) => note(t.players[id], "events", wealth(t.players[id].inv, held) - before[i]));
  }
  // Loans falling due.
  for (const loan of t.loans) {
    if (loan.called || loan.status !== "out" || now < loan.due || now >= t.endsAt) continue;
    loan.called = true;
    const borrower = t.players[loan.to];
    if (!t.autoReturn) {
      say(t, now, `The loan of your ${loan.building} to ${name(loan.to)} is due. Whether it comes back is up to them.`, loan.from);
      say(t, now, `Your loan of a ${loan.building} from ${name(loan.from)} is due. Send it back, or do not.`, loan.to);
    } else if ((borrower.inv[loan.building] ?? 0) > 0) {
      book(t, [loan.from, loan.to], "deals", () => move(borrower.inv, t.players[loan.from].inv, { [loan.building]: 1 }));
      loan.status = "returned";
      say(t, now, `The ${loan.building} you lent to ${name(loan.to)} has come back.`, loan.from);
      say(t, now, `The ${loan.building} you borrowed from ${name(loan.from)} has gone back.`, loan.to);
    } else {
      loan.status = "kept";
      say(t, now, `The ${loan.building} you lent to ${name(loan.to)} could not be returned: they no longer have it.`, loan.from);
    }
  }
  if (now >= t.endsAt) {
    for (const loan of t.loans) if (loan.status === "out") loan.status = "kept";
    for (const p of Object.values(t.players)) p.history.push(wealth(p.inv, t.stocks));
    t.over = true;
    t.offers = [];
    say(t, t.endsAt, "The market has closed.");
  }
}

/** When this game next needs the clock. (Finished production is worked out on demand.) */
export function tradeAlarm(t: TradeState): number {
  return Math.min(t.endsAt, t.nextStep, t.nextPay, ...t.events.filter((e) => !e.done).map((e) => e.at), ...t.loans.filter((l) => !l.called && l.status === "out").map((l) => l.due));
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
      for (const b of recipe.needs) if (!(p.inv[b] ?? 0)) return `You need a ${NAMES[b].toLowerCase()} to make ${msg.good}.`;
      if (p.strikeUntil > now) return "Your workers are on strike.";
      if (p.jobs.length >= p.inv.workshop) return "All your workshops are busy.";
      const uses = Object.fromEntries(Object.entries(recipe.uses).map(([k, n]) => [k, n * count]));
      if (!has(p.inv, uses)) return "You do not have enough materials for that.";
      move(p.inv, {}, uses);
      note(p, "made", -wealth(uses));
      p.jobs.push({ id: t.nextId++, good: msg.good, count, made: 0, startedAt: now, per: recipe.seconds * 1000 });
      return null;
    }
    case "t.sell": {
      if (!RECIPES[msg.good]) return "Choose something to sell.";
      const size = t.batch[msg.good];
      if ((p.inv[msg.good] ?? 0) < size) return `Right now the market buys ${msg.good} in batches of ${size}.`;
      const amber = !!msg.amber && (p.inv.amber ?? 0) > 0;
      let pay = t.prices[msg.good] * size * (amber ? TRADE.amberMultiplier : 1);
      if (t.fairUntil > now) pay *= 1 + TRADE.fairBonus;
      if (t.tariffUntil > now && p.tier !== "A") pay *= 1 - TRADE.tariffCut;
      if (p.aid === "accepted") pay *= 1 - TRADE.aidShare;
      pay = Math.round(pay);
      book(t, [me], "market", () => {
        p.inv[msg.good] -= size;
        if (amber) p.inv.amber -= 1;
        p.inv.gold = (p.inv.gold ?? 0) + pay;
      });
      if (amber && !p.knowsAmber) {
        p.knowsAmber = true;
        say(t, now, `The buyers gasp at the amber and pay ${TRADE.amberMultiplier} times the price. So that is what it is worth.`, me);
      }
      if (t.open) say(t, now, `${name(me)} sells ${size} ${msg.good} to the market for ${pay} gold.`);
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
      if ((p.inv.gold ?? 0) < price) return `A ${NAMES[msg.building].toLowerCase()} costs ${price} gold.`;
      p.inv.gold -= price;
      // New housing takes in people who have no home first; if everyone has one, ten new people move in.
      if (msg.building === "housing" && homes(p).groups <= (p.inv.housing ?? 0)) p.population += 10;
      p.inv[msg.building] = (p.inv[msg.building] ?? 0) + 1;
      if (t.open) say(t, now, `${name(me)} builds ${msg.building === "housing" ? "housing" : "a " + NAMES[msg.building].toLowerCase()}.`);
      return null;
    }
    case "t.stock": {
      const n = Math.floor(Number(msg.n));
      const st = t.stocks[msg.id];
      if (!st || !n || Math.abs(n) > 1000) return "Choose a company and how many shares.";
      const key = SHARE(msg.id);
      if (n > 0) {
        if ((p.inv.gold ?? 0) < n * st.price) return `You cannot afford ${n} ${n === 1 ? "share" : "shares"} at ${st.price} each.`;
        p.inv.gold -= n * st.price;
        p.inv[key] = (p.inv[key] ?? 0) + n;
      } else {
        if ((p.inv[key] ?? 0) < -n) return "You do not own that many shares.";
        p.inv[key] += n;
        p.inv.gold = (p.inv.gold ?? 0) - n * st.price;
      }
      return null;
    }
    case "t.aid": {
      if (p.aid !== "offered") return null;
      p.aid = msg.accept ? "accepted" : "declined";
      if (msg.accept)
        book(t, [me], "events", () => {
          p.inv.workshop = (p.inv.workshop ?? 0) + 1;
          p.inv.mill = (p.inv.mill ?? 0) + 1;
        });
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
      book(t, [offer.from, me], "deals", () => {
        move(giver.inv, p.inv, offer.give);
        move(p.inv, giver.inv, offer.want);
      });
      t.offers = t.offers.filter((o) => o !== offer);
      t.deals.push({ t: now, kind: "swap", from: offer.from, to: me, give: offer.give, want: offer.want });
      say(t, now, t.open ? `Deal: ${name(offer.from)} gives ${describe(offer.give)} to ${name(me)} for ${describe(offer.want)}.` : `${name(offer.from)} and ${name(me)} have made a deal.`);
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
      book(t, [me, msg.to], "deals", () => move(p.inv, t.players[msg.to].inv, give));
      p.given += wealth(give, t.stocks);
      t.deals.push({ t: now, kind: "gift", from: me, to: msg.to, give, want: {} });
      // Sending a borrowed building back to its owner settles the loan.
      for (const [k, n] of Object.entries(give)) {
        let left = n;
        for (const loan of t.loans) if (left > 0 && loan.status === "out" && loan.to === me && loan.from === msg.to && loan.building === k) [loan.status, left] = ["returned", left - 1];
      }
      if (t.open) say(t, now, `${name(me)} sends ${describe(give)} to ${name(msg.to)}.`);
      else say(t, now, `${name(me)} has sent you ${describe(give)}.`, msg.to);
      return null;
    }
    case "t.lend": {
      const minutes = Math.floor(Number(msg.minutes));
      if (!(BUILDINGS as readonly string[]).includes(msg.building) || !t.players[msg.to] || msg.to === me || !(minutes >= 1 && minutes <= 10)) return "Choose a building, a country and how long to lend it for.";
      if (!(p.inv[msg.building] ?? 0)) return "You do not have that building to lend.";
      book(t, [me, msg.to], "deals", () => move(p.inv, t.players[msg.to].inv, { [msg.building]: 1 }));
      p.lent = true;
      t.loans.push({ id: t.nextId++, from: me, to: msg.to, building: msg.building, due: now + minutes * 60_000, status: "out", called: false });
      const terms = t.autoReturn ? "It will come back by itself." : "Giving it back is up to the borrower.";
      const what = NAMES[msg.building].toLowerCase();
      say(t, now, `You lent a ${what} to ${name(msg.to)} for ${minutes} ${minutes === 1 ? "minute" : "minutes"}. ${terms}`, me);
      say(t, now, `${name(me)} has lent you a ${what} for ${minutes} ${minutes === 1 ? "minute" : "minutes"}. ${terms}`, msg.to);
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
    const rows = Object.entries(t.players).map(([id, q]) => {
      const startWealth = wealth(q.start);
      const end = wealth(q.inv, t.stocks);
      return { id, tier: q.tier, start: q.start, startWealth, wealth: end, growth: end / startWealth, population: q.population, history: q.history, ledger: breakdown(t, q), partsStart: parts(q.start), partsEnd: parts(q.inv, t.stocks) };
    });
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
      loans: t.loans,
      gifts: t.deals.filter((d) => d.kind === "gift").length,
      swaps: t.deals.filter((d) => d.kind === "swap").length,
    };
  }
  return {
    startedAt: t.startedAt,
    endsAt: t.endsAt,
    over: t.over,
    prices: t.prices,
    stocks: t.stocks,
    stockNames: STOCK_NAMES,
    nextPay: t.nextPay,
    batch: t.batch,
    importPrice: t.prices.food + TRADE.foodMarkup,
    fair: t.fairUntil > now,
    tariff: t.tariffUntil > now,
    recipes: RECIPES,
    names: NAMES,
    rules: TRADE,
    open: t.open,
    autoReturn: t.autoReturn,
    // With open books everyone sees everyone's holdings, like tables in a room. Otherwise only your own,
    // until the market closes.
    holdings: Object.fromEntries(Object.entries(t.players).filter(([id]) => t.open || t.over || id === me).map(([id, q]) => [id, q.inv])),
    loans: t.loans.filter((l) => l.status === "out" && (l.from === me || l.to === me)),
    me: p
      ? {
          jobs: p.jobs,
          strikeUntil: p.strikeUntil,
          knowsAmber: p.knowsAmber,
          aid: p.aid,
          population: p.population,
          startWorth: wealth(p.start),
          history: p.history,
          taxFree: isGenerous(t, me),
          ledger: breakdown(t, p),
        }
      : null,
    offers: t.offers.filter(mine),
    chat: t.chat.filter(mine),
    news: t.news.filter((n) => n.to === null || n.to === me),
    result,
  };
}
