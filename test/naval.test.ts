import { describe, expect, it } from "vitest";
import { createRoom, handle, join, nextAlarm, onAlarm, view, type Player, type Store } from "../src/game/game";
import { NAVAL, cellsOf, coord, gridSize, type NavalState } from "../src/game/naval";

let n = 0;
const newId = () => `n${++n}`;

/** A started battle with the ships put in known places, well apart, all pointing north. */
function battle(players = 3, seed = 42) {
  const store: Store = { room: createRoom("NAVAL", seed, 1000) };
  const ps: Player[] = [];
  for (let i = 0; i < players; i++) ps.push(join(store.room, newId, `Captain ${i}`) as Player);
  expect(handle(store, ps[0].id, { type: "start" }, 2000, newId)).toBeNull();
  const t = store.room.naval!;
  // Most tests want full range, so that they are about one rule at a time.
  ps.forEach((p, i) => Object.assign(t.ships[p.id], { x: 4 + i * 4, y: 9, dir: 0, guns: NAVAL.fireRange, radar: NAVAL.radarRange }));
  return { store, ps, t, a: ps[0], b: ps[1], c: ps[2] };
}
const act = (store: Store, p: Player, msg: object, now = 3000) => handle(store, p.id, msg, now, newId);
const see = (store: Store, p: Player, now = 3001) => view(store.room, p.id, now).naval!;
const last = (store: Store, p: Player) => see(store, p).news.at(-1)!.text;
function runTo(store: Store, until: number) {
  for (let i = 0; i < 400 && store.room.phase === "battle" && nextAlarm(store.room)! <= until; i++) onAlarm(store, nextAlarm(store.room)!);
}
const turns = (k: number) => 2000 + k * NAVAL.turnMs;

describe("Silent Fleet: setting up", () => {
  it("needs two to eight players, each with a country of their own", () => {
    const store: Store = { room: createRoom("SOLO1", 1, 1000) };
    const first = join(store.room, newId) as Player;
    expect(handle(store, first.id, { type: "start" }, 2000, newId)).toMatch(/two players/);
    const more = [1, 2, 3, 4, 5, 6, 7].map(() => join(store.room, newId) as Player);
    expect(join(store.room, newId)).toMatch(/full/);
    expect(new Set(store.room.players.map((p) => p.country)).size).toBe(8);
    expect(handle(store, more[0].id, { type: "profile", country: first.country }, 1500, newId)).toMatch(/already taken/);
    expect(handle(store, more[0].id, { type: "profile", country: "za" }, 1500, newId) ?? "ok").toMatch(/ok|already taken/);
    expect(handle(store, first.id, { type: "start" }, 2000, newId)).toBeNull();
    expect(store.room.phase).toBe("battle");
    expect(handle(store, more[0].id, { type: "profile", country: "jp" }, 2500, newId)).toMatch(/fixed/);
  });

  it("uses a sea bigger than 15 by 15, growing with the number of ships", () => {
    expect([2, 4, 8].map(gridSize)).toEqual([18, 22, 26]);
    for (let seed = 1; seed <= 20; seed++) {
      const store: Store = { room: createRoom("S" + seed, seed * 97, 1000) };
      const ps = [0, 1, 2, 3, 4, 5, 6, 7].map(() => join(store.room, newId) as Player);
      handle(store, ps[0].id, { type: "start" }, 2000 + seed, newId);
      const t = store.room.naval!;
      const cells = Object.values(t.ships).flatMap((s) => cellsOf(s).map(([x, y]) => `${x},${y}`));
      expect(new Set(cells).size).toBe(24); // three squares each, none shared
      for (const s of Object.values(t.ships)) for (const [x, y] of cellsOf(s)) expect(x >= 2 && y >= 2 && x < t.size - 2 && y < t.size - 2).toBe(true);
    }
  });

  it("shows each captain only their own ship", () => {
    const { store, a, b } = battle();
    const v = see(store, a);
    expect(v.me!.cells).toEqual([[4, 10], [4, 9], [4, 8]]);
    expect(v.ships.filter((s) => s.cells)).toHaveLength(0);
    expect(v.ships.find((s) => s.id === b.id)).toMatchObject({ alive: true, cells: null, hull: null, dir: null });
    expect(JSON.stringify(v)).not.toContain('"x":8'); // nothing about the ship at column 8 leaks
  });
});

describe("Silent Fleet: sailing", () => {
  it("moves forwards and backwards along the ship's length, for one point each", () => {
    const { store, t, a } = battle();
    t.ships[a.id].ap = 3;
    expect(act(store, a, { type: "n.move", dir: 1 })).toBeNull();
    expect(t.ships[a.id]).toMatchObject({ x: 4, y: 8, ap: 2 });
    act(store, a, { type: "n.move", dir: -1 });
    act(store, a, { type: "n.move", dir: -1 });
    expect(t.ships[a.id]).toMatchObject({ x: 4, y: 10, ap: 0 });
    expect(act(store, a, { type: "n.move", dir: 1 })).toMatch(/costs 1 action point. You have 0/);
  });

  it("turns on its middle square, between upright and sideways", () => {
    const { store, t, a } = battle();
    t.ships[a.id].ap = 3;
    act(store, a, { type: "n.turn", dir: 1 });
    expect(t.ships[a.id].dir).toBe(1);
    expect(cellsOf(t.ships[a.id])).toEqual([[3, 9], [4, 9], [5, 9]]);
    act(store, a, { type: "n.move", dir: 1 });
    expect(t.ships[a.id].x).toBe(5); // forwards is now east
    act(store, a, { type: "n.turn", dir: -1 });
    expect(t.ships[a.id].dir).toBe(0);
  });

  it("cannot leave the map, and gives itself away by bumping into another ship", () => {
    const { store, t, a, b } = battle();
    Object.assign(t.ships[a.id], { x: 0, y: 5, dir: 0, ap: 5 });
    expect(act(store, a, { type: "n.turn", dir: 1 })).toMatch(/no room to turn/);
    Object.assign(t.ships[a.id], { x: 4, y: 1, dir: 0 });
    expect(act(store, a, { type: "n.move", dir: 1 })).toMatch(/edge of the map/);
    expect(t.ships[a.id].ap).toBe(5); // neither cost anything
    Object.assign(t.ships[a.id], { x: 8, y: 12, dir: 0 }); // right behind b, which sits at 8,8 to 8,10
    expect(act(store, a, { type: "n.move", dir: 1 })).toBeNull();
    expect(t.ships[a.id]).toMatchObject({ y: 12, ap: 4 });
    expect(last(store, a)).toMatch(/bump into another ship/);
    expect(last(store, b)).toMatch(/bumped into yours/);
  });
});

describe("Silent Fleet: radar and guns", () => {
  it("pings to find ships in range, and tells them they were seen", () => {
    const { store, t, a, b, c } = battle();
    expect(act(store, a, { type: "n.ping" })).toBeNull();
    const v = see(store, a);
    expect(v.me!.ap).toBe(NAVAL.apStart - NAVAL.cost.ping);
    expect(v.me!.sightings).toEqual([{ id: b.id, cells: [[8, 10], [8, 9], [8, 8]], turn: 0 }]); // c, 8 squares away, is out of range
    expect(last(store, b)).toMatch(/swept your position from the west/);
    expect(see(store, c).news.some((x) => /Radar/.test(x.text))).toBe(false);
    // a sighting is a snapshot: it does not follow the ship, and it fades
    act(store, b, { type: "n.move", dir: 1 });
    expect(see(store, a).me!.sightings[0].cells[1]).toEqual([8, 9]);
    runTo(store, turns(NAVAL.sightingTurns));
    expect(see(store, a, turns(NAVAL.sightingTurns) + 1).me!.sightings).toHaveLength(0);
    expect(t.ships[a.id].pings).toBe(1);
  });

  it("fires blind at any square in range: three hits sink a ship", () => {
    const { store, t, a, b } = battle();
    t.ships[a.id].ap = 10;
    expect(act(store, a, { type: "n.fire", x: 11, y: 9 })).toMatch(/out of range/);
    expect(act(store, a, { type: "n.fire", x: 4, y: 9 })).toMatch(/your own ship/);
    expect(act(store, a, { type: "n.fire", x: 6, y: 6 })).toBeNull();
    expect(last(store, a)).toBe(`You fire at ${coord(6, 6)}: a miss.`);
    expect(act(store, a, { type: "n.fire", x: 8, y: 9 })).toBeNull();
    expect(last(store, a)).toMatch(/a hit!/);
    expect(last(store, b)).toMatch(/You have been hit! The shot came from the west. 2 more hits/);
    expect(see(store, b).me!.damaged).toEqual([1]); // the middle of the ship, and it stays marked when the ship moves
    act(store, b, { type: "n.move", dir: 1 });
    expect(see(store, b).me).toMatchObject({ damaged: [1], y: 8 });
    act(store, b, { type: "n.move", dir: -1 });
    expect(see(store, a).me!.marks.map((m) => m.kind)).toEqual(["miss", "hit"]);
    expect(see(store, a).ships.find((s) => s.id === b.id)!.cells).toBeNull(); // a hit does not show the ship
    act(store, a, { type: "n.fire", x: 8, y: 9 });
    t.ships[a.id].ap = NAVAL.cost.fire;
    act(store, a, { type: "n.fire", x: 8, y: 10 });
    expect(t.ships[b.id]).toMatchObject({ alive: false, sunkBy: a.id, place: 3 });
    expect(t.ships[a.id].ap).toBe(NAVAL.sinkBonus);
    expect(see(store, a).news.at(-1)!.text).toMatch(/has been sunk by/);
    expect(act(store, b, { type: "n.ping" })).toMatch(/only watch/);
    expect(see(store, b).ships.filter((s) => s.cells)).toHaveLength(2); // the sunk captain watches the whole sea
  });

  it("lets a ship near a miss see the shell land", () => {
    const { store, t, a, b, c } = battle();
    t.ships[a.id].ap = NAVAL.cost.fire;
    act(store, a, { type: "n.fire", x: 7, y: 7 }); // one square from b's bow
    expect(t.ships[a.id].ap).toBe(0);
    expect(act(store, a, { type: "n.fire", x: 7, y: 7 })).toMatch(/costs 3 action points/);
    expect(last(store, b)).toMatch(/shell lands in the water at H8/);
    expect(see(store, b).me!.marks).toEqual([{ x: 7, y: 7, kind: "splash", turn: 0 }]);
    expect(see(store, c).me!.marks).toHaveLength(0);
  });
});

describe("Silent Fleet: action points", () => {
  it("hands out points every thirty seconds, up to a limit", () => {
    const { store, t, a } = battle();
    expect(nextAlarm(store.room)).toBe(2000 + 30_000);
    runTo(store, turns(1));
    expect(t.ships[a.id].ap).toBe(NAVAL.apStart + NAVAL.apPerTurn);
    expect(see(store, a, turns(1) + 1)).toMatchObject({ turn: 1, nextTurn: turns(2) });
    runTo(store, turns(8));
    expect(t.ships[a.id].ap).toBe(NAVAL.apMax);
  });

  it("lets a captain send points to another ship", () => {
    const { store, t, a, b } = battle();
    expect(act(store, a, { type: "n.give", to: b.id, n: 1 })).toBeNull();
    expect([t.ships[a.id].ap, t.ships[b.id].ap]).toEqual([1, 3]);
    expect(act(store, a, { type: "n.give", to: b.id, n: 5 })).toMatch(/do not have/);
  });
});

describe("Silent Fleet: alliances", () => {
  const allies = () => {
    const made = battle();
    const { store, t, a, b } = made;
    expect(act(store, a, { type: "n.propose", to: b.id })).toBeNull();
    expect(see(store, b).proposals).toHaveLength(1);
    expect(act(store, b, { type: "n.accept", id: t.proposals[0].id })).toBeNull();
    return made;
  };

  it("shows allies each other's ships, live, but does not stop them firing", () => {
    const { store, a, b, c } = allies();
    expect(see(store, a).ships.find((s) => s.id === b.id)).toMatchObject({ ally: true, cells: [[8, 10], [8, 9], [8, 8]], hull: 3 });
    expect(see(store, b).ships.find((s) => s.id === a.id)!.cells).toEqual([[4, 10], [4, 9], [4, 8]]);
    expect(see(store, c).ships.filter((s) => s.cells)).toHaveLength(0); // the alliance is secret
    expect(see(store, c).alliances).toHaveLength(0);
    act(store, b, { type: "n.move", dir: 1 });
    expect(see(store, a).ships.find((s) => s.id === b.id)!.cells![1]).toEqual([8, 8]);
    expect(see(store, a).alliances).toEqual([{ with: b.id }]);
    store.room.naval!.ships[a.id].ap = 5;
    expect(act(store, a, { type: "n.fire", x: 8, y: 8 })).toBeNull();
    expect(see(store, b).me!.hull).toBe(2);
    expect(see(store, a).alliances).toHaveLength(1); // the alliance itself still stands
  });

  it("has no time limit: it lasts until someone breaks it", () => {
    const { store, t, a, b } = allies();
    t.stormOn = false; // so that the game is still going long afterwards
    runTo(store, turns(40));
    expect(t.alliances).toHaveLength(1);
    expect(see(store, a, turns(40) + 1).ships.find((s) => s.id === b.id)!.cells).not.toBeNull();
    expect(t.news.some((x) => /run out/.test(x.text))).toBe(false);
  });

  it("can be broken at any moment, and then the guns are free", () => {
    const { store, t, a, b } = allies();
    t.ships[a.id].ap = 5;
    expect(act(store, a, { type: "n.break", with: b.id })).toBeNull();
    expect(last(store, b)).toMatch(/has broken the alliance with you/);
    expect(see(store, b).ships.find((s) => s.id === a.id)!.cells).toBeNull();
    expect(act(store, a, { type: "n.fire", x: 8, y: 9 })).toBeNull();
    expect(t.ships[b.id].hull).toBe(2);
  });

  it("can be turned down, and cannot exist once only two ships are left", () => {
    const { store, t, a, b, c } = battle();
    act(store, a, { type: "n.propose", to: b.id });
    act(store, b, { type: "n.decline", id: t.proposals[0].id });
    expect(t.proposals).toHaveLength(0);
    expect(last(store, a)).toMatch(/turns down your offer/);
    act(store, a, { type: "n.propose", to: b.id });
    act(store, b, { type: "n.accept", id: t.proposals[0].id });
    Object.assign(t.ships[a.id], { ap: 10 });
    t.ships[c.id].hull = 1;
    act(store, a, { type: "n.fire", x: 12, y: 9 }); // out of range
    Object.assign(t.ships[a.id], { x: 8, y: 13 }); // within reach of c at 12,9
    act(store, a, { type: "n.fire", x: 12, y: 9 });
    expect(t.ships[c.id].alive).toBe(false);
    expect(t.alliances).toHaveLength(0);
    expect(see(store, b).news.at(-1)!.text).toMatch(/Only two ships are left/);
    expect(act(store, a, { type: "n.propose", to: b.id })).toMatch(/Only two ships/);
  });
});

describe("Silent Fleet: the end", () => {
  it("is won by the last ship afloat, and then shows everything", () => {
    const { store, t, a, b } = battle(2);
    t.ships[b.id].hull = 1;
    t.ships[a.id].ap = NAVAL.cost.fire;
    act(store, a, { type: "n.fire", x: 8, y: 9 });
    expect(store.room.phase).toBe("final");
    const v = see(store, b);
    expect(v).toMatchObject({ over: true, winner: a.id });
    expect(v.result!.rows.map((r) => [r.id, r.place])).toEqual([[a.id, 1], [b.id, 2]]);
    expect(v.result!.rows[0]).toMatchObject({ shots: 1, hits: 1 });
    expect(act(store, a, { type: "n.ping" })).toBeNull(); // ignored once the battle is over
    handle(store, a.id, { type: "newGame" }, 9000, newId);
    expect(store.room.phase).toBe("lobby");
    expect(store.room.naval).toBeNull();
  });

  it("closes a storm in from the edges so that no game lasts for ever", () => {
    const { store, t, a, b, c } = battle();
    Object.assign(t.ships[a.id], { x: 0, y: 5 }); // on the edge
    Object.assign(t.ships[b.id], { x: 2, y: 9 }); // three rows in
    runTo(store, turns(NAVAL.stormStart - 2));
    expect(t.news.at(-1)!.text).toMatch(/storm is gathering/);
    expect(see(store, c, turns(NAVAL.stormStart - 2) + 1).stormNext).toBe(NAVAL.stormStart);
    runTo(store, turns(NAVAL.stormStart));
    expect(t.storm).toBe(1);
    expect(t.ships[a.id].hull).toBe(2);
    expect(t.ships[b.id].hull).toBe(3);
    runTo(store, turns(NAVAL.stormStart + 2));
    expect(t.ships[a.id]).toMatchObject({ alive: false, sunkBy: null }); // three turns in the storm
    // left alone, everyone is driven together and the game ends by itself
    runTo(store, turns(200));
    expect(store.room.phase).toBe("final");
    expect(t).toMatchObject({ over: true, winner: c.id }); // the ship nearest the middle outlasts the rest
    expect(t.ships[b.id].sunkBy).toBeNull();
  });

  it("never tells one captain about another's private news or messages", () => {
    const { store, a, b, c } = battle();
    act(store, a, { type: "n.chat", to: b.id, text: "Let us sink the third one" });
    act(store, a, { type: "n.chat", text: "Hello all" });
    expect(see(store, b).chat).toHaveLength(2);
    expect(see(store, c).chat.map((m) => m.text)).toEqual(["Hello all"]);
    act(store, a, { type: "n.ping" });
    expect(see(store, c).news.every((x) => x.to === null || x.to === c.id)).toBe(true);
  });
});

describe("Silent Fleet: the host's settings", () => {
  const room = (settings: object, players = 3) => {
    const store: Store = { room: createRoom("SET01", 9, 1000) };
    const ps = Array.from({ length: players }, () => join(store.room, newId) as Player);
    expect(handle(store, ps[1].id, { type: "settings", ...settings }, 1500, newId)).toMatch(/Only the host/);
    expect(handle(store, ps[0].id, { type: "settings", ...settings }, 1500, newId)).toBeNull();
    handle(store, ps[0].id, { type: "start" }, 2000, newId);
    return { store, ps, t: store.room.naval! };
  };

  it("keeps the storm and the automatic map size unless the host changes them", () => {
    const { t, store, ps } = room({});
    expect(t).toMatchObject({ size: 18, stormOn: true });
    expect(see(store, ps[0])).toMatchObject({ stormOn: true, stormNext: NAVAL.stormStart });
  });

  it("lets the host choose the size of the map", () => {
    expect(room({ navalSize: 30 }).t.size).toBe(30);
    expect(room({ navalSize: 26 }, 2).t.size).toBe(26);
    expect(room({ navalSize: 17 }).t.size).toBe(18); // not one of the choices: ignored
    const back = room({ navalSize: 0 }, 5);
    expect(back.t.size).toBe(22);
    expect(coord(27, 0)).toBe("AB1");
    const big = room({ navalSize: 30 }, 8).t;
    for (const s of Object.values(big.ships)) for (const [x, y] of cellsOf(s)) expect(x >= 0 && y >= 0 && x < 30 && y < 30).toBe(true);
  });

  it("lets the host switch the storm off, so the edges stay safe for the whole game", () => {
    const { store, ps, t } = room({ navalStorm: false });
    Object.assign(t.ships[ps[0].id], { x: 0, y: 5, dir: 0 });
    runTo(store, turns(NAVAL.stormStart + 20));
    expect(t.storm).toBe(0);
    expect(t.ships[ps[0].id].hull).toBe(NAVAL.hull);
    expect(t.news.some((x) => /storm/i.test(x.text))).toBe(false);
    expect(see(store, ps[0], turns(40))).toMatchObject({ stormOn: false, stormNext: null, over: false });
    expect(store.room.phase).toBe("battle");
  });
});

describe("Silent Fleet: range", () => {
  const fresh = () => {
    const made = battle();
    for (const s of Object.values(made.t.ships)) Object.assign(s, { guns: NAVAL.rangeStart, radar: NAVAL.rangeStart, ap: 10 });
    return made;
  };

  it("starts with guns and radar that reach only two squares from the ship", () => {
    const store: Store = { room: createRoom("RANGE", 3, 1000) };
    const ps = [0, 1].map(() => join(store.room, newId) as Player);
    handle(store, ps[0].id, { type: "start" }, 2000, newId);
    expect(see(store, ps[0]).me).toMatchObject({ guns: 2, radar: 2, ap: 2 }); // and two action points

    const { store: s, t, a, b } = fresh(); // a lies on column 4, rows 8 to 10
    expect(act(s, a, { type: "n.fire", x: 7, y: 9 })).toMatch(/out of range. Your guns reach 2 squares. Increase your range/);
    expect(act(s, a, { type: "n.fire", x: 6, y: 9 })).toBeNull();
    expect(act(s, a, { type: "n.fire", x: 4, y: 6 })).toBeNull(); // two squares beyond the bow: counted from the nearest part
    expect(act(s, a, { type: "n.fire", x: 4, y: 5 })).toMatch(/out of range/);
    act(s, a, { type: "n.ping" });
    expect(see(s, a).me!.sightings).toHaveLength(0); // b is four squares away
    Object.assign(t.ships[b.id], { x: 6, y: 12 }); // its bow is now two squares away, diagonally
    act(s, a, { type: "n.ping" });
    expect(see(s, a).me!.sightings.map((x) => x.id)).toEqual([b.id]);
  });

  it("buys more range a square at a time, up to the old ranges", () => {
    const { store, t, a } = fresh();
    expect(act(store, a, { type: "n.range" })).toBeNull();
    expect(t.ships[a.id]).toMatchObject({ guns: 3, radar: 3, ap: 10 - NAVAL.cost.range });
    expect(last(store, a)).toMatch(/guns now reach 3 squares and your radar 3/);
    expect(act(store, a, { type: "n.fire", x: 7, y: 9 })).toBeNull();
    for (let i = 0; i < 3; i++) {
      t.ships[a.id].ap = 10;
      expect(act(store, a, { type: "n.range" })).toBeNull();
    }
    expect(t.ships[a.id]).toMatchObject({ guns: NAVAL.fireRange, radar: NAVAL.radarRange });
    expect(act(store, a, { type: "n.range" })).toMatch(/as far as they can/);
    t.ships[a.id].ap = 2;
    t.ships[a.id].guns = 2;
    expect(act(store, a, { type: "n.range" })).toMatch(/costs 3 action points/);
  });
});

describe("Silent Fleet: partial radar", () => {
  it("shows only the squares of a ship that lie inside radar range", () => {
    const { store, t, a, b } = battle();
    Object.assign(t.ships[a.id], { radar: 2, ap: 10 }); // a lies on column 4, rows 8 to 10
    Object.assign(t.ships[b.id], { x: 7, y: 9, dir: 1 }); // b lies along row 9, columns 6 to 8
    act(store, a, { type: "n.ping" });
    expect(see(store, a).me!.sightings).toEqual([{ id: b.id, cells: [[6, 9]], turn: 0 }]); // just its stern
    expect(last(store, b)).toMatch(/swept your position/); // b is still warned
    t.ships[a.id].radar = 3;
    act(store, a, { type: "n.ping" });
    expect(see(store, a).me!.sightings[0].cells).toEqual([[6, 9], [7, 9]]);
    t.ships[a.id].radar = 4;
    act(store, a, { type: "n.ping" });
    expect(see(store, a).me!.sightings[0].cells).toHaveLength(3);
    expect(JSON.stringify(see(store, a).ships)).not.toContain("[8,9]"); // nothing else gives the rest away
  });
});
