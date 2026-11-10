import { describe, expect, it } from "vitest";
import { createRoom, handle, join, nextAlarm, onAlarm, view, type Player, type Store } from "../src/game/game";
import { TRADE, wealth } from "../src/game/trade";

let n = 0;
const newId = () => `t${++n}`;

function table(players = 3) {
  const store: Store = { room: createRoom("TRADE", 777, 1000, "trade"), timeline: null };
  const ps: Player[] = [];
  for (let i = 0; i < players; i++) ps.push(join(store.room, newId, `Country ${"ABCDE"[i]}`) as Player);
  handle(store, ps[0].id, { type: "settings", tradeSec: 600 }, 1000, newId);
  return { store, ps };
}
function started(players = 3) {
  const made = table(players);
  expect(handle(made.store, made.ps[0].id, { type: "start" }, 2000, newId)).toBeNull();
  const t = made.store.room.trade!;
  const by = (tier: string) => made.ps.find((p) => t.players[p.id].tier === tier)!;
  fixStarts(t);
  return { ...made, t, rich: by("A"), raw: by("B"), poor: by("C") };
}
/** Starts vary from game to game; most tests want a known one. */
function fixStarts(t: any) {
  const fixed: Record<string, Record<string, number>> = {
    A: { gold: 600, workshop: 2, sawmill: 1, forge: 1, loom: 1, timber: 2, ore: 1, wool: 1, housing: 1 },
    B: { gold: 200, timber: 16, ore: 14, wool: 14, amber: 2, housing: 1 },
    C: { gold: 200, timber: 6, ore: 4, wool: 5, housing: 1 },
  };
  for (const p of Object.values(t.players) as any[]) {
    p.inv = { ...fixed[p.tier] };
    p.start = { ...fixed[p.tier] };
    p.history = [wealth(p.inv)];
  }
}
/** Run the clock to a given moment, alarm by alarm. */
function runTo(store: Store, until: number) {
  for (let i = 0; i < 400 && store.room.phase === "trading" && nextAlarm(store.room)! <= until; i++) onAlarm(store, nextAlarm(store.room)!);
}
const act = (store: Store, p: Player, msg: object, now: number) => handle(store, p.id, msg, now, newId);

describe("Trade and Treachery", () => {
  it("is for three or more people, with no bots", () => {
    const two = table(2);
    expect(act(two.store, two.ps[0], { type: "start" }, 2000)).toMatch(/three players/);
    const withBot = table(3);
    act(withBot.store, withBot.ps[0], { type: "addBot" }, 1500);
    expect(act(withBot.store, withBot.ps[0], { type: "start" }, 2000)).toMatch(/people only/);
  });

  it("deals unequal starts without saying so", () => {
    const { store, t, rich, raw, poor } = started();
    expect(store.room.phase).toBe("trading");
    expect(t.players[rich.id].inv.workshop).toBe(2);
    expect(t.players[raw.id].inv.workshop).toBeUndefined();
    expect(wealth(t.players[rich.id].inv)).toBeGreaterThan(wealth(t.players[raw.id].inv));
    expect(wealth(t.players[raw.id].inv)).toBeGreaterThan(wealth(t.players[poor.id].inv));
    expect(JSON.stringify(view(store.room, poor.id, 2000))).not.toContain('"tier"');
  });

  it("makes goods over time, only with the right buildings, and sells them in fives", () => {
    const { store, t, rich, raw } = started();
    expect(act(store, raw, { type: "t.make", good: "planks", count: 1 }, 2100)).toMatch(/workshop/);
    expect(act(store, rich, { type: "t.make", good: "planks", count: 3 }, 2100)).toMatch(/materials/);
    t.players[rich.id].inv.timber = 5;
    expect(act(store, rich, { type: "t.make", good: "planks", count: 5 }, 2100)).toBeNull();
    expect(t.players[rich.id].inv.timber).toBe(0);
    expect(act(store, rich, { type: "t.sell", good: "planks" }, 2100 + 12_000)).toMatch(/batches of 5/); // only two are ready
    expect(t.players[rich.id].inv.planks).toBe(2);
    const gold = t.players[rich.id].inv.gold;
    expect(act(store, rich, { type: "t.sell", good: "planks" }, 2100 + 31_000)).toBeNull();
    expect(t.players[rich.id].inv.gold).toBe(gold + 5 * 150);
  });

  it("makes a safe swap all at once, and lets a promise be broken", () => {
    const { store, t, rich, raw } = started();
    expect(act(store, rich, { type: "t.offer", to: raw.id, give: { gold: 9999 }, want: { timber: 1 } }, 3000)).toMatch(/do not have/);
    expect(act(store, rich, { type: "t.offer", to: raw.id, give: { gold: 100 }, want: { timber: 4 } }, 3000)).toBeNull();
    const offer = t.offers[0];
    expect(view(store.room, raw.id, 3000).trade!.offers).toHaveLength(1);
    expect(act(store, raw, { type: "t.accept", id: offer.id }, 3100)).toBeNull();
    expect(t.players[rich.id].inv).toMatchObject({ gold: 500, timber: 6 });
    expect(t.players[raw.id].inv).toMatchObject({ gold: 300, timber: 12 });
    // "Send me ore and I'll pay you after": the ore arrives, the gold never does. Nothing stops it.
    expect(act(store, raw, { type: "t.send", to: rich.id, give: { ore: 5 } }, 3200)).toBeNull();
    expect(t.players[rich.id].inv.ore).toBe(6);
    expect(t.players[raw.id].inv.gold).toBe(300);
    expect(t.deals.map((d) => d.kind)).toEqual(["swap", "gift"]);
  });

  it("keeps whispers and private news private", () => {
    const { store, t, rich, raw, poor } = started();
    act(store, rich, { type: "t.chat", to: raw.id, text: "just between <b>us</b>" }, 3000);
    act(store, rich, { type: "t.chat", text: "hello all" }, 3001);
    expect(view(store.room, raw.id, 3002).trade!.chat).toHaveLength(2);
    expect(view(store.room, poor.id, 3002).trade!.chat).toHaveLength(1);
    expect(t.chat[0].text).not.toContain("<");
    // The secret of the amber goes only to the industrial country.
    const secret = t.events.find((e) => e.kind === "secret")!;
    runTo(store, secret.at);
    expect(view(store.room, rich.id, secret.at).trade!.me!.knowsAmber).toBe(true);
    expect(view(store.room, raw.id, secret.at).trade!.me!.knowsAmber).toBe(false);
    expect(view(store.room, raw.id, secret.at).trade!.news.some((x) => x.text.includes("amber"))).toBe(false);
    // Amber quadruples a batch for whoever uses it.
    t.players[rich.id].inv = { ...t.players[rich.id].inv, cloth: 5, amber: 1, gold: 0 };
    act(store, rich, { type: "t.sell", good: "cloth", amber: true }, secret.at + 10);
    expect(t.players[rich.id].inv.gold).toBe(5 * 200 * TRADE.amberMultiplier);
  });

  it("runs its events on the clock and ends with the biggest grower as winner", () => {
    const { store, t, ps, poor } = started();
    expect(nextAlarm(store.room)).toBe(2000 + TRADE.stockStepMs); // share prices move first
    runTo(store, t.endsAt);
    expect(store.room.phase).toBe("final");
    expect(t.events.every((e) => e.done)).toBe(true);
    expect(t.news.some((x) => x.text.startsWith("Strike"))).toBe(true);
    expect(act(store, poor, { type: "t.sellRaw", item: "timber", n: 1 }, t.endsAt + 5000)).toBeNull(); // too late: ignored
    const result = view(store.room, poor.id, t.endsAt + 5000).trade!.result!;
    expect(result.rows).toHaveLength(3);
    const best = result.rows.reduce((a, b) => (b.growth > a.growth ? b : a));
    expect(result.winner).toBe(best.id);
    expect(result.rows.find((r) => r.id === poor.id)!.tier).toBe("C"); // the starts are revealed at the end
    act(store, ps[0], { type: "newGame" }, t.endsAt + 9000);
    expect(store.room.phase).toBe("lobby");
    expect(store.room.trade).toBeNull();
  });
});

describe("Trade and Treachery: the host's two switches", () => {
  function custom(settings: object) {
    const made = table(3);
    handle(made.store, made.ps[0].id, { type: "settings", ...settings }, 1500, newId);
    handle(made.store, made.ps[0].id, { type: "start" }, 2000, newId);
    const t = made.store.room.trade!;
    const by = (tier: string) => made.ps.find((p) => t.players[p.id].tier === tier)!;
    fixStarts(t);
    return { ...made, t, rich: by("A"), poor: by("C") };
  }

  it("can hide everyone else's holdings, and keeps deal details out of the news", () => {
    const { store, t, rich, poor } = custom({ tradeOpen: false });
    const seen = view(store.room, poor.id, 2100).trade!;
    expect(Object.keys(seen.holdings)).toEqual([poor.id]);
    act(store, rich, { type: "t.offer", to: poor.id, give: { gold: 50 }, want: { timber: 1 } }, 2200);
    act(store, poor, { type: "t.accept", id: t.offers[0].id }, 2300);
    act(store, rich, { type: "t.buy", building: "loom" }, 2400);
    const news = t.news.filter((x) => x.to === null).map((x) => x.text).join(" | ");
    expect(news).toContain("have made a deal");
    expect(news).not.toMatch(/50 gold|builds/);
    runTo(store, t.endsAt);
    expect(Object.keys(view(store.room, poor.id, t.endsAt + 1).trade!.holdings)).toHaveLength(3); // revealed at the end
  });

  it("brings a lent building back by itself when that is switched on", () => {
    const { store, t, rich, poor } = custom({ tradeAutoReturn: true });
    expect(act(store, rich, { type: "t.lend", to: poor.id, building: "workshop", minutes: 1 }, 3000)).toBeNull();
    expect(t.players[poor.id].inv.workshop).toBe(1);
    runTo(store, 63_000);
    expect(t.players[poor.id].inv.workshop).toBe(0);
    expect(t.players[rich.id].inv.workshop).toBe(2);
    expect(t.loans[0].status).toBe("returned");
  });

  it("lets a poor country keep a borrowed building, and win by it, when that is switched off", () => {
    const { store, t, rich, poor } = custom({ tradeAutoReturn: false });
    act(store, rich, { type: "t.lend", to: poor.id, building: "workshop", minutes: 1 }, 3000);
    runTo(store, 63_000);
    expect(t.players[poor.id].inv.workshop).toBe(1); // still there: returning it is a choice
    expect(t.news.some((x) => x.to === poor.id && x.text.includes("or do not"))).toBe(true);
    runTo(store, t.endsAt);
    const result = view(store.room, poor.id, t.endsAt + 1).trade!.result!;
    expect(result.loans[0].status).toBe("kept");
    expect(result.winner).toBe(poor.id);
    expect(result.rows.find((r) => r.id === poor.id)!.growth).toBeGreaterThan(2);
  });

  it("settles the loan when the borrower does send it back", () => {
    const { store, t, rich, poor } = custom({ tradeAutoReturn: false });
    act(store, rich, { type: "t.lend", to: poor.id, building: "forge", minutes: 2 }, 3000);
    act(store, poor, { type: "t.send", to: rich.id, give: { forge: 1 } }, 9000);
    expect(t.loans[0].status).toBe("returned");
    expect(view(store.room, rich.id, 9001).trade!.loans).toHaveLength(0);
  });
});

describe("the two games are separate", () => {
  it("fixes a room's game when it is opened: nothing in the lobby can change it", () => {
    const tradeRoom = table(3);
    handle(tradeRoom.store, tradeRoom.ps[0].id, { type: "settings", mode: "election" }, 1500, newId);
    handle(tradeRoom.store, tradeRoom.ps[1].id, { type: "settings", mode: "election" }, 1500, newId);
    expect(view(tradeRoom.store.room, tradeRoom.ps[0].id, 1600).mode).toBe("trade");
    handle(tradeRoom.store, tradeRoom.ps[0].id, { type: "start" }, 2000, newId);
    expect(tradeRoom.store.room.phase).toBe("trading");
    expect(view(tradeRoom.store.room, tradeRoom.ps[2].id, 2001).trade).not.toBeNull();

    const store: Store = { room: createRoom("ELECT", 5, 1000), timeline: null };
    const ps = [0, 1, 2].map((i) => join(store.room, newId, "P" + i) as Player);
    handle(store, ps[0].id, { type: "settings", mode: "trade" }, 1500, newId);
    handle(store, ps[0].id, { type: "start" }, 2000, newId);
    expect(store.room.phase).toBe("planning");
    expect(view(store.room, ps[0].id, 2001)).toMatchObject({ mode: "election", trade: null });
  });
});

describe("Trade and Treachery: the wider economy", () => {
  it("deals different starts every game, with nobody able to do everything alone", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const store: Store = { room: createRoom("VARY" + seed, seed * 31, 1000, "trade"), timeline: null };
      const ps = [0, 1, 2, 3].map((i) => join(store.room, newId, "C" + i) as Player);
      handle(store, ps[0].id, { type: "start" }, 2000 + seed, newId);
      const t = store.room.trade!;
      const rich = Object.values(t.players).find((p) => p.tier === "A")!;
      expect(rich.inv.workshop).toBe(2);
      expect(["sawmill", "forge", "loom", "mill", "power"].filter((b) => rich.inv[b]).length).toBe(3); // three of the five
      for (const p of Object.values(t.players)) if (p.tier !== "A") expect(p.inv.workshop).toBeUndefined();
      seen.add(JSON.stringify(Object.values(t.players).map((p) => p.inv)));
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it("makes food from grain and needs electricity for machinery", () => {
    const { store, t, rich } = started();
    Object.assign(t.players[rich.id].inv, { mill: 1, power: 1, grain: 2, coal: 1, ore: 1, timber: 1 });
    expect(act(store, rich, { type: "t.make", good: "machinery", count: 1 }, 2100)).toMatch(/materials/); // no electricity yet
    expect(act(store, rich, { type: "t.make", good: "electricity", count: 1 }, 2100)).toBeNull();
    expect(act(store, rich, { type: "t.make", good: "food", count: 2 }, 2100)).toBeNull();
    expect(act(store, rich, { type: "t.make", good: "machinery", count: 1 }, 2100 + 11_000)).toBeNull();
    expect(t.players[rich.id].inv).toMatchObject({ food: 2, electricity: 0 });
  });

  it("pays out and collects every minute: homes, dividends, food and tax", () => {
    const { store, t, rich, raw, poor } = started();
    act(store, rich, { type: "t.stock", id: "wood", n: 2 }, 2100); // 200 gold of shares at 100
    expect(t.players[rich.id].inv).toMatchObject({ gold: 400, share_wood: 2 });
    t.players[raw.id].inv.food = 3;
    runTo(store, 62_000);
    const buyFood = t.prices.food + TRADE.foodMarkup;
    const dividends = Math.round(2 * t.stocks.wood.price * TRADE.dividend);
    expect(t.players[rich.id].inv.gold).toBe(400 + TRADE.homeIncome + dividends - buyFood - TRADE.homeTax);
    // fed from its own stores
    expect(t.players[raw.id].inv).toMatchObject({ gold: 200 + TRADE.homeIncome - TRADE.homeTax, food: 2 });
    expect(t.players[poor.id].inv.gold).toBe(200 + TRADE.homeIncome - buyFood - TRADE.homeTax);
    expect(t.players[rich.id].history).toHaveLength(2);
    expect(view(store.room, rich.id, 62_001).trade!.news.at(-1)!.text).toMatch(/^Payday/);
  });

  it("waives tax for a country that has been generous since the last payday", () => {
    const { store, t, rich, poor } = started();
    act(store, rich, { type: "t.send", to: poor.id, give: { gold: 100 } }, 3000);
    expect(view(store.room, rich.id, 3001).trade!.me!.taxFree).toBe(true);
    runTo(store, 62_000);
    const each = TRADE.homeIncome - (t.prices.food + TRADE.foodMarkup);
    expect(t.players[rich.id].inv.gold).toBe(500 + each); // no tax taken
    runTo(store, 122_000);
    expect(t.players[rich.id].inv.gold).toBe(500 + each * 2 - TRADE.homeTax); // taxed again the minute after
  });

  it("grows a country through housing: more people, more income, more food, more tax", () => {
    const { store, t, poor } = started();
    t.players[poor.id].inv.gold = 1000;
    expect(act(store, poor, { type: "t.buy", building: "housing" }, 2100)).toBeNull();
    expect(t.players[poor.id].population).toBe(20);
    runTo(store, 62_000);
    expect(t.players[poor.id].inv.gold).toBe(700 + 2 * (TRADE.homeIncome - TRADE.homeTax - t.prices.food - TRADE.foodMarkup));
  });

  it("leaves migrants without homes, eating but not earning, until housing is built for them", () => {
    const { store, t, poor } = started();
    const p = t.players[poor.id];
    p.population = 20; // as after a migration
    p.inv.gold = 1000;
    runTo(store, 62_000);
    const food = t.prices.food + TRADE.foodMarkup;
    expect(p.inv.gold).toBe(1000 + TRADE.homeIncome - TRADE.homeTax - 2 * food); // one home earns, two groups eat
    expect(view(store.room, poor.id, 62_001).trade!.news.at(-1)!.text).toMatch(/10 of your people have no home/);
    act(store, poor, { type: "t.buy", building: "housing" }, 63_000);
    expect(p.population).toBe(20); // the newcomers moved in; nobody new arrived
    expect(p.inv.housing).toBe(2);
  });

  it("explains every change in worth: the causes add up to the total", () => {
    const { store, t, rich, raw, poor } = started();
    act(store, rich, { type: "t.make", good: "planks", count: 2 }, 2100);
    act(store, rich, { type: "t.stock", id: "farm", n: 3 }, 2200);
    act(store, raw, { type: "t.send", to: poor.id, give: { timber: 4 } }, 2300);
    act(store, raw, { type: "t.offer", to: rich.id, give: { ore: 5 }, want: { gold: 90 } }, 2400);
    act(store, rich, { type: "t.accept", id: t.offers[0].id }, 2500);
    runTo(store, t.endsAt);
    const rows = view(store.room, rich.id, t.endsAt + 1).trade!.result!.rows;
    for (const row of rows) {
      const sum = Object.values(row.ledger as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(sum).toBe(row.wealth - row.startWealth);
      const parts = Object.values(row.partsEnd as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(Math.round(parts)).toBe(row.wealth);
    }
    const mine = rows.find((r) => r.id === rich.id)!.ledger;
    expect(mine.made).toBe(2 * 150 - 2 * 25); // two planks from two timber
    expect(mine.deals).toBe(5 * 25 - 90); // paid 90 for ore the market values at 125
    expect(rows.find((r) => r.id === raw.id)!.ledger.deals).toBe(-100 + 90 - 125);
    expect(mine.income).toBeGreaterThan(0);
    expect(mine.tax).toBeLessThan(0);
  });

  it("sometimes has the market ask for three or one at a time", () => {
    const { store, t, rich } = started();
    t.players[rich.id].inv.cloth = 4;
    expect(act(store, rich, { type: "t.sell", good: "cloth" }, 2100)).toMatch(/batches of 5/);
    t.batch.cloth = 3;
    expect(act(store, rich, { type: "t.sell", good: "cloth" }, 2200)).toBeNull();
    expect(t.players[rich.id].inv).toMatchObject({ cloth: 1, gold: 600 + 3 * 200 });
    t.batch.cloth = 1;
    expect(act(store, rich, { type: "t.sell", good: "cloth" }, 2300)).toBeNull();
    expect(view(store.room, rich.id, 2301).trade!.batch.cloth).toBe(1);
    // over many games the order size does change by itself, and five stays the usual size
    let odd = 0;
    let steps = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const s: Store = { room: createRoom("B" + seed, seed * 17, 1000, "trade"), timeline: null };
      const ps = [0, 1, 2].map((i) => join(s.room, newId, "C" + i) as Player);
      handle(s, ps[0].id, { type: "start" }, 2000, newId);
      const tr = s.room.trade!;
      for (let at = 32_000; at < tr.endsAt; at += 30_000) {
        runTo(s, at);
        steps += 7;
        odd += Object.values(tr.batch).filter((n) => n !== 5).length;
      }
    }
    expect(odd).toBeGreaterThan(0);
    expect(odd / steps).toBeLessThan(0.25);
  });

  it("picks a few world events for each game, and they move prices, shares and stores", () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 15; seed++) {
      const s: Store = { room: createRoom("W" + seed, seed * 13, 1000, "trade"), timeline: null };
      const ps = [0, 1, 2].map((i) => join(s.room, newId, "C" + i) as Player);
      handle(s, ps[0].id, { type: "start" }, 2000 + seed, newId);
      const world = s.room.trade!.events.filter((e) => e.kind.startsWith("w:"));
      expect(world).toHaveLength(4); // a 15-minute game
      world.forEach((e) => kinds.add(e.kind));
      runTo(s, s.room.trade!.endsAt); // and every one of them runs without trouble
      expect(s.room.trade!.over).toBe(true);
    }
    expect(kinds.size).toBeGreaterThan(8);

    const { store, t, raw } = started();
    t.events = [
      { kind: "w:drought", at: 5000, done: false },
      { kind: "w:panic", at: 6000, done: false },
      { kind: "w:fair", at: 7000, done: false },
    ];
    t.players[raw.id].inv.grain = 9;
    t.players[raw.id].inv.cloth = 5;
    runTo(store, 6000);
    expect(t.players[raw.id].inv.grain).toBe(6);
    expect(t.prices.food).toBe(60);
    expect(t.stocks.metal.price).toBe(70);
    expect(t.players[raw.id].ledger.events).toBe(-3 * 25);
    runTo(store, 7000);
    act(store, raw, { type: "t.sell", good: "cloth" }, 7100);
    expect(t.players[raw.id].inv.gold).toBe(200 + 5 * 200 * 1.25);
    expect(view(store.room, raw.id, 7101).trade!.news.filter((n) => n.kind === "world")).toHaveLength(3);
  });

  it("moves share prices with the news, and lets shares be traded like anything else", () => {
    const { store, t, rich, raw } = started();
    act(store, rich, { type: "t.stock", id: "metal", n: 1 }, 2100);
    expect(act(store, rich, { type: "t.stock", id: "metal", n: -2 }, 2200)).toMatch(/do not own/);
    expect(act(store, rich, { type: "t.send", to: raw.id, give: { share_metal: 1 } }, 2300)).toBeNull();
    expect(t.players[raw.id].inv.share_metal).toBe(1);
    const crash = t.events.find((e) => e.kind === "crash")!;
    runTo(store, crash.at - 1);
    const beforeCrash = t.stocks.metal.price; // machinery is the dearest good, so Ironworks takes the hit
    onAlarm(store, crash.at);
    expect(t.stocks.metal.price).toBeLessThan(beforeCrash * 0.8);
    expect(t.prices.machinery).toBe(350);
  });

  it("sends migrants and raiders to countries with no border guard", () => {
    const { store, t, rich, raw, poor } = started();
    t.players[rich.id].inv.gold = 1000;
    expect(act(store, rich, { type: "t.buy", building: "garrison" }, 2100)).toBeNull();
    const raid = t.events.find((e) => e.kind === "raid")!;
    runTo(store, raid.at - 1);
    expect(t.players[rich.id].population).toBe(TRADE.startPopulation);
    expect(t.players[raw.id].population).toBe(TRADE.startPopulation + TRADE.migrants);
    const timber = { [raw.id]: t.players[raw.id].inv.timber, [poor.id]: t.players[poor.id].inv.timber };
    onAlarm(store, raid.at);
    const hit = [raw, poor].filter((p) => t.players[p.id].inv.timber < timber[p.id]);
    expect(hit).toHaveLength(1); // exactly one unguarded country is raided
    expect(t.news.some((x) => x.text.startsWith("Invasion"))).toBe(true);
    expect(t.news.some((x) => x.text.includes("Scouts report"))).toBe(true); // and there was a warning
  });

  it("counts shares at today's price when working out worth", () => {
    const { t } = started();
    t.stocks.wood.price = 250;
    expect(wealth({ gold: 10, share_wood: 2 }, t.stocks)).toBe(510);
  });
});

describe("Leaving and going back to the lobby", () => {
  it("lets the host end a running game for everyone, and nobody else", () => {
    const { store, ps } = started();
    expect(handle(store, ps[1].id, { type: "newGame" }, 5000, newId)).toMatch(/Only the host/);
    expect(handle(store, ps[0].id, { type: "newGame" }, 5000, newId)).toBeNull();
    expect(store.room.phase).toBe("lobby");
    expect(store.room.trade).toBeNull();
    expect(store.room.players).toHaveLength(3);
  });

  it("frees the seat when someone leaves the lobby, and keeps the country when they leave a game", () => {
    const { store, ps } = started();
    handle(store, ps[0].id, { type: "leave" }, 5000, newId);
    expect(store.room.players).toHaveLength(3); // the country stays on the board
    expect(store.room.hostId).toBe(ps[1].id); // and the room passes on
    handle(store, ps[1].id, { type: "newGame" }, 6000, newId);
    handle(store, ps[2].id, { type: "leave" }, 7000, newId);
    expect(store.room.players.map((p) => p.id)).toEqual([ps[0].id, ps[1].id]);
  });
});
