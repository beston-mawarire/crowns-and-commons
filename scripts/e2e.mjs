// End-to-end check against a running server (default: `npm run dev` on port 8787).
// Two humans and a bot play a whole match over real WebSockets. The first count runs
// on the real clock (one minute) to prove the alarms tick; later counts are hastened.
//
//   npm run dev        (in one terminal)
//   npm run e2e        (in another)        or: node scripts/e2e.mjs https://your-deployment

import WebSocket from "ws";

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const wsBase = base.replace(/^http/, "ws");
const assert = (cond, msg) => {
  if (!cond) {
    console.error("FAILED: " + msg);
    process.exit(1);
  }
  console.log("  ok  " + msg);
};

const { code } = await (await fetch(base + "/api/rooms", { method: "POST" })).json();
assert(/^[A-Z2-9]{5}$/.test(code), `room opened (${code})`);

function client(name, token) {
  const c = { name, ws: new WebSocket(`${wsBase}/ws/${code}`), info: null, st: null, errors: [], raw: [], waiters: [] };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.until = (test, label, ms = 90_000) =>
    new Promise((resolve, reject) => {
      if (c.st && test(c.st)) return resolve(c.st);
      const timer = setTimeout(() => reject(new Error(`${name}: timed out waiting for ${label}`)), ms);
      c.waiters.push({ test, done: (st) => (clearTimeout(timer), resolve(st)) });
    });
  c.ws.on("open", () => c.send({ type: "hello", name, token }));
  c.ws.on("message", (data) => {
    const text = data.toString();
    c.raw.push(text);
    const msg = JSON.parse(text);
    if (msg.type === "welcome") c.info = msg;
    if (msg.type === "error") c.errors.push(msg);
    if (msg.type === "state") {
      c.st = msg;
      c.waiters = c.waiters.filter((w) => (w.test(msg) ? (w.done(msg), false) : true));
    }
  });
  return c;
}

/** A dull but legal platform: the two middle laws in every field. */
function platform(c) {
  const tier = c.st.round === 1 ? "R" : "N";
  const laws = c.info.categories.flatMap((cat) => {
    const options = c.info.catalogue.filter((l) => l.tier === tier && l.cat === cat.id);
    const mid = Math.floor(options.length / 2);
    return [options[mid - 1].id, options[mid].id];
  });
  const target = c.st.round === 2 ? { r: c.st.you.home } : {};
  return { laws, tax: 12, actions: [{ a: "visit", g: 0, ...target }, { a: "notices", g: 1, ...target }] };
}

const ann = client("The Anvil Party");
await ann.until((s) => s.phase === "lobby", "lobby");
const ben = client("Ben's Barley League");
await ben.until((s) => s.players.length === 2, "second player");
assert(ann.st.hostId === ann.st.you.id && ben.st.you.mayHost === false, "first to arrive is the host");

ann.send({ type: "addBot" });
ann.send({ type: "settings", simSec: 60, planSec: 0 });
ben.send({ type: "settings", simSec: 300 });
await ann.until((s) => s.players.length === 3 && s.settings.simSec === 60, "bot and settings");
assert(ben.errors.some((e) => /host/.test(e.message)) && ann.st.settings.simSec === 60, "only the host can change settings");
assert(new Set(ann.st.players.map((p) => p.color)).size === 3, "three parties, three colours");

ann.send({ type: "start" });
await ann.until((s) => s.phase === "planning", "planning");
assert(ann.st.regions.length === 3 && ann.st.you.gold === 60, "three regions for three parties, 60 gold each");
assert(ann.st.players.find((p) => p.bot).locked, "the bot locks in at once");

const stranger = client("Late arrival");
await new Promise((r) => setTimeout(r, 800));
assert(stranger.errors.some((e) => e.fatal), "nobody new can join or watch once the match has started");

ann.send({ type: "lock", platform: { laws: ["R1.1"], tax: 10, actions: [] } });
await new Promise((r) => setTimeout(r, 300));
assert(ann.errors.some((e) => /at least 2/.test(e.message)), "an incomplete platform is refused");

ann.send({ type: "lock", platform: platform(ann) });
await ann.until((s) => s.you.locked, "ann locked");
assert(ann.st.phase === "planning", "the count waits for everyone");
ben.send({ type: "lock", platform: platform(ben) });
await ann.until((s) => s.phase === "counting", "counting");
assert(ann.st.you.gold === 30, "campaign actions are paid for (60 - 15 - 15)");

// Drop Ben mid-count and bring him back with his token.
const benToken = ben.info.you.token;
ben.ws.close();
await ann.until((s) => s.players.find((p) => p.name.startsWith("Ben")).connected === false, "ben shown as away", 10_000);
const ben2 = client("ignored", benToken);
await ben2.until((s) => s.phase === "counting", "ben back in");
assert(ben2.st.you.id === ben.st.you.id && ben2.st.players.length === 3, "a dropped player returns to the same seat");

console.log("  ... letting a one-minute count run on the real clock");
const seen = new Set();
let maxPainted = 0;
const watch = setInterval(() => {
  for (const h of ann.st.ticker) seen.add(h.id);
  const painted = ann.st.paint?.reduce((a, r) => a + r.old + Object.values(r.p).reduce((x, y) => x + y, 0), 0) ?? 0;
  maxPainted = Math.max(maxPainted, painted);
}, 500);
const after1 = await ann.until((s) => s.phase !== "counting", "end of the regional count", 100_000);
clearInterval(watch);
assert(seen.size >= 8, `the ticker carried news during the count (${seen.size} headlines)`);
assert(maxPainted > 1, "the map filled in as votes were counted");
assert(after1.results1 && Object.keys(after1.results1.parties).length === 3, "regional results for all three parties");
const beforeFinal = [...ann.raw, ...ben2.raw].join("\n");
assert(!/"w":|"down":|"tags":|"sat0?":|"lean":/.test(beforeFinal), "no hidden weights or satisfaction numbers were sent to browsers");
assert(!beforeFinal.includes(benToken.slice(0, 12)) || !ann.raw.join("").includes(benToken), "other players' tokens stay private");

// Play on to the end, whatever the voters decided.
const players = [ann, ben2];
for (let guard = 0; guard < 12 && ann.st.phase !== "final"; guard++) {
  if (ann.st.phase === "results") {
    console.log(`  ... regional outcome: ${ann.st.outcome.kind}`);
    ann.send({ type: "next" });
    await ann.until((s) => s.phase !== "results", "next phase");
  } else if (ann.st.phase === "planning") {
    for (const c of players) if (!c.st.you.eliminated && !c.st.you.locked) c.send({ type: "lock", platform: platform(c) });
    await ann.until((s) => s.phase !== "planning", "count to start");
  } else if (ann.st.phase === "counting") {
    for (const c of players) c.send({ type: "hasten" });
    await ann.until((s) => s.phase !== "counting", "hastened count", 15_000);
  }
}
assert(ann.st.phase === "final", `the match reached a final result (${ann.st.outcome.kind})`);
assert(ann.st.players.some((p) => p.id === ann.st.outcome.winner), "a winner is named");
assert(ann.st.report && ann.st.reveal, "the laws' hidden costs are revealed at the end");
if (ann.st.results2) assert(ann.st.results2.regions.every((r) => r.oldShare > 0), "the Old Order stays on the ballot in round two");

ann.send({ type: "newGame" });
await ann.until((s) => s.phase === "lobby", "back to lobby");
assert(ann.st.players.length === 3, "everyone is still seated for a rematch");
console.log("\nAll end-to-end checks passed.");
process.exit(0);
