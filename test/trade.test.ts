import { describe, expect, it } from "vitest";
import { createRoom, handle, join, nextAlarm, onAlarm, view, type Player, type Store } from "../src/game/game";
import { TRADE, wealth } from "../src/game/trade";

let n = 0;
const newId = () => `t${++n}`;

function table(players = 3) {
  const store: Store = { room: createRoom("TRADE", 777, 1000), timeline: null };
  const ps: Player[] = [];
  for (let i = 0; i < players; i++) ps.push(join(store.room, newId, `Country ${"ABCDE"[i]}`) as Player);
  handle(store, ps[0].id, { type: "settings", mode: "trade", tradeSec: 600 }, 1000, newId);
  return { store, ps };
}
function started(players = 3) {
  const made = table(players);
  expect(handle(made.store, made.ps[0].id, { type: "start" }, 2000, newId)).toBeNull();
  const t = made.store.room.trade!;
  const by = (tier: string) => made.ps.find((p) => t.players[p.id].tier === tier)!;
  return { ...made, t, rich: by("A"), raw: by("B"), poor: by("C") };
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
    expect(act(store, rich, { type: "t.make", good: "planks", count: 3 }, 2100)).toMatch(/raw materials/);
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
    onAlarm(store, secret.at);
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
    expect(nextAlarm(store.room)).toBe(Math.min(...t.events.map((e) => e.at)));
    for (let i = 0; i < 20 && store.room.phase === "trading"; i++) onAlarm(store, nextAlarm(store.room)!);
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
