// Silent Fleet, browser side. The page skeleton is built once when the battle starts; after
// that only the parts that change are redrawn, so typing a message is never interrupted.

let api = null; // helpers lent by app.js
let built = false;
let wired = false; // the click listener is in place
let target = null; // the square the guns are aimed at
let lastHull = null; // to notice the moment the ship is hit
let flashTimer = null;
const N = () => api.st().naval;
const el = (id) => document.getElementById(id);
const player = (id) => api.st().players.find((p) => p.id === id);
const color = (id) => api.hex(player(id)?.color);
const flag = (id) => api.country(player(id)?.country).flag;
const nation = (id) => api.country(player(id)?.country).name || player(id)?.name || "A ship";
const full = (id) => `${flag(id)} ${api.esc(nation(id))}`;
const col = (x) => (x < 26 ? "" : "A") + String.fromCharCode(65 + (x % 26));
const coord = (x, y) => col(x) + (y + 1);
const ARROW = ["▲", "▶", "▼", "◀"];
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Only touch the page when something has changed, so a tap is never lost to a redraw. */
const drawn = {};
function setHTML(id, html) {
  const node = el(id);
  if (!node || (drawn[id] === html && node.dataset.drawn)) return;
  drawn[id] = html;
  node.dataset.drawn = "1";
  node.innerHTML = html;
}

export function leaveNaval() {
  built = false;
  target = null;
}

export function renderNaval(helpers) {
  api = helpers;
  if (!built) build();
  update();
}

/** How many squares from the nearest part of my ship to a square. */
const reach = (x, y) => Math.min(...N().me.cells.map(([cx, cy]) => Math.max(Math.abs(cx - x), Math.abs(cy - y))));
const canAct = () => built && api && N() && !N().over && N().me?.alive;

// ---------------------------------------------------------------- skeleton

function build() {
  built = true;
  target = null;
  lastHull = N().me?.hull ?? null; // nothing flashes for damage taken before the page was opened
  for (const k of Object.keys(drawn)) delete drawn[k];
  const st = api.st();
  const r = N().rules;
  const others = st.players.filter((p) => p.id !== st.you.id);
  const pick = (first) => (first ? `<option value="">${first}</option>` : "") + others.map((p) => `<option value="${p.id}">${full(p.id)}</option>`).join("");

  el("left").innerHTML = `<h3>The fleets</h3><div id="n-fleets"></div>
    <h3>How it works</h3>
    <ul class="t-how">
      <li>You see only your own ship. <b>Radar</b> shows the parts of ships inside the blue line, and warns them.</li>
      <li><b>Sail</b> forwards or backwards along your ship. <b>Turn</b> to switch between upright and sideways.</li>
      <li><b>Fire</b> at any square in the red area. ${r.hull} hits sink a ship.</li>
      <li>Both start at ${r.rangeStart} squares. <b>Increase range</b> to reach further (guns up to ${r.fireRange}, radar up to ${r.radarRange}).</li>
      <li>You get <b>${r.apPerTurn} action points every ${r.turnMs / 1000} seconds</b>, and can hold ${r.apMax}.</li>
      <li><b>Allies</b> see each other's ships. They can still fire on each other.</li>
      ${N().stormOn ? "<li>Keep away from the edges: a <b>storm</b> closes in later.</li>" : "<li>There is <b>no storm</b> in this game.</li>"}
    </ul>
    <p class="small muted">Keyboard: arrow keys to sail and turn, R for radar, F or Enter to fire.</p>`;

  el("navalboard").innerHTML = `
    <div id="n-banner"></div>
    <div id="n-status"></div>
    <div class="n-mapbox"><div class="n-mapwrap"><div id="n-map" class="n-map" style="--n:${N().size}"></div></div><div id="n-flash" hidden></div></div>
    <div id="n-controls"></div>
    <div id="n-legend" class="n-legend"></div>
    <div id="n-result"></div>`;

  el("right").innerHTML = `
    <section class="t-card c-deals"><h3>Alliances</h3><div id="n-allies"></div>
      <div id="n-allyform"><div class="t-row n-row"><select id="n-ally-turns" aria-label="For how long">${r.allianceTurns.map((n) => `<option value="${n}" ${n === 4 ? "selected" : ""}>${n} turns</option>`).join("")}</select><select id="n-ally-to" aria-label="With whom">${pick()}</select></div>
      <button class="btn ghost wide" id="n-propose">Offer an alliance</button>
      <p class="small muted">Allies see each other's ships, and nothing more: an ally can still fire on you. Either side can break it at any time.</p></div></section>
    <section class="t-card c-talk"><h3>Talk</h3>
      <div id="n-chat" class="t-scroll"></div>
      <div class="t-say" id="n-say"><select id="n-chat-to" aria-label="Say to">${pick("Everyone")}</select><input id="n-chat-text" maxlength="200" placeholder="Say something…" aria-label="Message" /></div></section>
    <section class="t-card c-people" id="n-givebox"><h3>Send action points</h3>
      <div class="t-row n-row"><select id="n-give-n" aria-label="How many">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join("")}</select><select id="n-give-to" aria-label="To whom">${pick()}</select></div>
      <button class="btn ghost wide" id="n-give">Send them</button></section>
    <section class="t-card c-news"><h3>Ship's log <span class="muted">(newest first)</span></h3><ol id="n-news" class="t-scroll tall"></ol></section>
    <div id="n-host"></div>`;

  el("n-propose").onclick = () => api.send({ type: "n.propose", to: el("n-ally-to").value, turns: Number(el("n-ally-turns").value) });
  el("n-give").onclick = () => api.send({ type: "n.give", to: el("n-give-to").value, n: Number(el("n-give-n").value) });
  el("n-chat-text").onkeydown = (e) => {
    if (e.key !== "Enter" || !e.target.value.trim()) return;
    api.send({ type: "n.chat", to: el("n-chat-to").value || null, text: e.target.value });
    e.target.value = "";
  };
  // One listener for everything that is redrawn.
  // These panels outlive a single game, so the listener is attached once only: a second copy
  // would send every tap twice.
  if (wired) return;
  wired = true;
  for (const id of ["navalboard", "right"])
    el(id).addEventListener("click", (e) => {
      const cell = e.target.closest("[data-x]");
      if (cell) return aim(Number(cell.dataset.x), Number(cell.dataset.y));
      const b = e.target.closest("[data-n]");
      if (!b || b.disabled) return;
      const d = b.dataset;
      if (d.n === "move") api.send({ type: "n.move", dir: Number(d.dir) });
      if (d.n === "turn") api.send({ type: "n.turn", dir: Number(d.dir) });
      if (d.n === "ping") api.send({ type: "n.ping" });
      if (d.n === "range") api.send({ type: "n.range" });
      if (d.n === "fire") fire();
      if (d.n === "accept") api.send({ type: "n.accept", id: Number(d.id) });
      if (d.n === "decline") api.send({ type: "n.decline", id: Number(d.id) });
      if (d.n === "break" && confirm(`Break your alliance with ${nation(d.id)}? They will be told at once.`)) api.send({ type: "n.break", with: d.id });
      if (d.n === "lobby") api.send({ type: "newGame" });
    });
}

function aim(x, y) {
  if (!canAct()) return;
  const me = N().me;
  if (me.cells.some(([cx, cy]) => cx === x && cy === y)) return void (target = null), update();
  if (reach(x, y) > me.guns) return api.toast(`Out of range. Your guns reach ${plural(me.guns, "square")}.${me.guns < N().rules.fireRange ? " Increase your range to reach further." : ""}`);
  target = target && target.x === x && target.y === y ? null : { x, y };
  update();
}

function fire() {
  if (canAct() && target) api.send({ type: "n.fire", x: target.x, y: target.y });
}

document.addEventListener("keydown", (e) => {
  if (!canAct() || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "")) return;
  const act = { ArrowUp: { type: "n.move", dir: 1 }, ArrowDown: { type: "n.move", dir: -1 }, ArrowLeft: { type: "n.turn", dir: -1 }, ArrowRight: { type: "n.turn", dir: 1 }, r: { type: "n.ping" }, R: { type: "n.ping" } }[e.key];
  if (act) {
    e.preventDefault();
    api.send(act);
  } else if ((e.key === "f" || e.key === "F" || e.key === "Enter") && target) {
    e.preventDefault();
    fire();
  }
});

// ---------------------------------------------------------------- the parts that change

function update() {
  const st = api.st();
  const t = N();
  const r = t.rules;
  const esc = api.esc;
  const meId = st.you.id;
  const me = t.me;
  const alive = !!me?.alive && !t.over;
  const allyOf = Object.fromEntries(t.alliances.map((a) => [a.with, a.until]));
  if (target && (!alive || reach(target.x, target.y) > me.guns)) target = null;

  // ---- the moment of being hit: a red shout over the map, gone after two seconds
  if (me && lastHull !== null && me.hull < lastHull) {
    const why = t.news.filter((n) => n.to === meId || n.kind === "sunk").at(-1)?.text ?? "";
    shout(!me.alive ? "You've been sunk!" : /storm/i.test(why) ? "The storm has damaged you!" : "You've been hit!");
  }
  if (me) lastHull = me.hull;

  // ---- fleets
  setHTML(
    "n-fleets",
    st.players
      .map((p) => {
        const s = t.ships.find((x) => x.id === p.id);
        const tags =
          (p.id === meId ? `<span class="tag solid">you</span>` : "") +
          (allyOf[p.id] ? `<span class="tag n-allytag">ally</span>` : "") +
          (!p.connected ? `<span class="tag">away</span>` : "");
        const status = !s ? "" : s.alive ? (t.over ? "winner" : allyOf[p.id] ? `allied for ${plural(allyOf[p.id] - t.turn, "more turn")}` : "afloat") : s.sunkBy ? `sunk by ${nation(s.sunkBy)}` : "lost in the storm";
        return `<div class="party ${s && !s.alive ? "out" : ""}"><span class="swatch" style="background:${color(p.id)}"></span><span class="name"><span class="n">${full(p.id)}</span>${tags}</span><span></span><span class="meta">${esc(p.name)} · ${esc(status)}</span></div>`;
      })
      .join(""),
  );

  // ---- banner
  let banner = "";
  if (t.over) banner = `<div class="t-banner"><h2>${t.winner ? `${full(t.winner)} wins` : "Nobody wins"}</h2><p>${t.winner ? `${esc(player(t.winner)?.name)} commands the last ship afloat, after ${plural(t.turn, "turn")}.` : "Every ship went down."}</p></div>`;
  else if (me && !me.alive) {
    const mine = t.ships.find((x) => x.id === meId);
    banner = `<p class="t-flag bad"><b>Your ship has been sunk${mine.sunkBy ? ` by ${esc(nation(mine.sunkBy))}` : " by the storm"}.</b> You can watch the rest of the battle, and you can now see every ship.</p>`;
  }
  setHTML("n-banner", banner);

  // ---- status
  if (me && alive) {
    const pips = (n, of, cls) => Array.from({ length: of }, (_, i) => `<i class="${i < n ? cls : ""}"></i>`).join("");
    setHTML(
      "n-status",
      `<div class="n-status"><div><span class="small muted">Hull</span><div class="n-pips hull">${pips(me.hull, r.hull, "on")}</div></div>
      <div><span class="small muted">Action points</span><div class="n-ap"><b>${me.ap}</b><div class="n-pips">${pips(me.ap, r.apMax, "on")}</div></div></div>
      <div><span class="small muted">Next points</span><div><b id="n-next" class="num"></b></div></div></div>
      ${t.storm ? `<p class="t-flag bad"><b>Storm:</b> the outer ${plural(t.storm, "row")} of the map ${t.storm === 1 ? "is" : "are"} deadly.${t.stormNext ? ` It closes in again on turn ${t.stormNext + 1}.` : ""}</p>` : t.stormNext !== null && t.stormNext - t.turn <= 4 ? `<p class="t-flag"><b>A storm is coming:</b> the edges of the map become deadly on turn ${t.stormNext + 1}. Move towards the middle.</p>` : ""}`,
    );
  } else setHTML("n-status", "");

  // ---- the map
  const size = t.size;
  const grid = {};
  const put = (x, y, o) => (grid[x + "," + y] = { ...(grid[x + "," + y] ?? {}), ...o });
  for (const s of me?.sightings ?? []) {
    const age = t.turn - s.turn;
    s.cells.forEach(([x, y], i) => put(x, y, { cls: "ghost", bg: color(s.id), text: i === Math.floor((s.cells.length - 1) / 2) ? flag(s.id) : "", title: `${nation(s.id)}, seen by radar ${age ? plural(age, "turn") + " ago" : "this turn"}` }));
  }
  for (const s of t.ships) if (s.cells) s.cells.forEach(([x, y], i) => put(x, y, { cls: "ship" + (s.damaged?.includes(i) ? " dmg" : ""), bg: color(s.id), text: i === 1 ? flag(s.id) : i === 2 && s.dir !== null ? ARROW[s.dir] : "", title: `${nation(s.id)}${s.ally ? " (your ally)" : ""}` }));
  for (const row of t.result?.rows ?? []) if (row.place > 1) row.cells.forEach(([x, y], i) => put(x, y, { cls: "wreck", bg: color(row.id), text: i === 1 ? flag(row.id) : "", title: `${nation(row.id)} went down here` }));
  for (const row of t.result?.rows ?? []) if (row.place === 1 && row.id !== meId) row.cells.forEach(([x, y], i) => put(x, y, { cls: "ship", bg: color(row.id), text: i === 1 ? flag(row.id) : "", title: nation(row.id) }));
  if (me && (me.alive || t.over)) me.cells.forEach(([x, y], i) => put(x, y, { cls: (me.alive ? "ship mine" : "wreck") + (me.alive && me.damaged.includes(i) ? " dmg" : ""), bg: color(meId), text: i === 2 && me.alive ? ARROW[me.dir] : i === 1 ? flag(meId) : "", title: me.damaged.includes(i) ? "Your ship: this part has been hit" : "Your ship" }));
  for (const m of me?.marks ?? []) put(m.x, m.y, { mark: m.kind, title: { hit: "You hit a ship here", miss: "Your shot missed here", splash: "A shell landed here" }[m.kind] });

  const box = me ? { x0: Math.min(...me.cells.map((c) => c[0])), x1: Math.max(...me.cells.map((c) => c[0])), y0: Math.min(...me.cells.map((c) => c[1])), y1: Math.max(...me.cells.map((c) => c[1])) } : null;
  let map = `<span class="h"></span>` + Array.from({ length: size }, (_, x) => `<span class="h">${col(x)}</span>`).join("");
  for (let y = 0; y < size; y++) {
    map += `<span class="h">${y + 1}</span>`;
    for (let x = 0; x < size; x++) {
      const g = grid[x + "," + y] ?? {};
      const d = alive ? reach(x, y) : 99;
      // Guns: a see-through red wash. Radar: a blue line round the edge of what it can see.
      const edge = d === me?.radar ? [y === box.y0 - d ? "et" : "", y === box.y1 + d ? "eb" : "", x === box.x0 - d ? "el" : "", x === box.x1 + d ? "er" : ""].join(" ") : "";
      const cls = ["c", g.cls, d <= (me?.guns ?? 0) ? "g" : "", edge, x < t.storm || y < t.storm || x >= size - t.storm || y >= size - t.storm ? "storm" : "", g.mark ? "m-" + g.mark : "", target && target.x === x && target.y === y ? "tgt" : ""].filter(Boolean).join(" ");
      const mark = g.mark === "hit" ? "✕" : g.mark === "miss" ? "•" : g.mark === "splash" ? "≈" : "";
      map += `<i class="${cls}" data-x="${x}" data-y="${y}"${g.bg ? ` style="--s:${g.bg}"` : ""}${g.title ? ` title="${esc(g.title)}"` : ""}>${mark || g.text || ""}</i>`;
    }
  }
  setHTML("n-map", map);

  // ---- controls
  if (alive) {
    const can = (cost) => (me.ap >= cost ? "" : "disabled");
    setHTML(
      "n-controls",
      `<div class="n-pad">
        <button class="btn" data-n="turn" data-dir="-1" ${can(r.cost.turn)}>↺ Turn left<small>${r.cost.turn} point</small></button>
        <button class="btn" data-n="move" data-dir="1" ${can(r.cost.move)}>${ARROW[me.dir]} Forward<small>${r.cost.move} point</small></button>
        <button class="btn" data-n="move" data-dir="-1" ${can(r.cost.move)}>${ARROW[(me.dir + 2) % 4]} Back<small>${r.cost.move} point</small></button>
        <button class="btn" data-n="turn" data-dir="1" ${can(r.cost.turn)}>↻ Turn right<small>${r.cost.turn} point</small></button>
        <button class="btn n-radar" data-n="ping" ${can(r.cost.ping)}>◎ Radar ping<small>${r.cost.ping} points</small></button>
        <button class="btn n-fire" data-n="fire" ${target ? can(r.cost.fire) : "disabled"}>${target ? `✸ Fire at ${coord(target.x, target.y)}` : "✸ Fire"}<small>${target ? `${r.cost.fire} points` : "tap a square to aim"}</small></button>
        ${me.guns >= r.fireRange && me.radar >= r.radarRange ? `<p class="n-range small muted">Guns reach ${me.guns} squares and radar ${me.radar}: as far as they can go.</p>` : `<button class="btn ghost n-range" data-n="range" ${can(r.cost.range)}>⤢ Increase range<small>guns ${me.guns} → ${Math.min(r.fireRange, me.guns + 1)}, radar ${me.radar} → ${Math.min(r.radarRange, me.radar + 1)} · ${r.cost.range} points</small></button>`}
      </div>`,
    );
  } else setHTML("n-controls", "");

  setHTML(
    "n-legend",
    alive
      ? `<span><i class="k g"></i>guns reach here (${me.guns})</span><span><i class="k rr"></i>radar sees inside this line (${me.radar})</span><span><i class="k ghost"></i>seen by radar (may have moved, and may be only part of the ship)</span><span><i class="k dmg"></i>part of your ship that was hit</span><span><b>✕</b> your hit</span><span><b>•</b> your miss</span><span><b>≈</b> a shell landed</span>${t.storm ? `<span><i class="k storm"></i>storm</span>` : ""}`
      : "",
  );

  // ---- alliances
  const mineOut = t.proposals.filter((p) => p.from === meId);
  const toMe = t.proposals.filter((p) => p.to === meId);
  setHTML(
    "n-allies",
    t.alliances.map((a) => `<div class="t-offer"><i class="dot" style="background:${color(a.with)}"></i><div><b>${full(a.with)}</b> is your ally for ${plural(a.until - t.turn, "more turn")}.</div><button class="btn ghost small" data-n="break" data-id="${a.with}">Break</button></div>`).join("") +
      toMe.map((p) => `<div class="t-offer"><i class="dot" style="background:${color(p.from)}"></i><div><b>${full(p.from)}</b> offers you an alliance for ${p.turns} turns.</div><span class="t-buttons"><button class="btn small" data-n="accept" data-id="${p.id}">Accept</button><button class="btn ghost small" data-n="decline" data-id="${p.id}">No</button></span></div>`).join("") +
      mineOut.map((p) => `<div class="t-offer"><i class="dot" style="background:${color(p.to)}"></i><div>You have offered <b>${full(p.to)}</b> an alliance for ${p.turns} turns.</div><button class="btn ghost small" data-n="decline" data-id="${p.id}">Withdraw</button></div>`).join("") ||
      `<p class="small muted">${t.over ? "The battle is over." : "You have no allies."}</p>`,
  );
  el("n-allyform").hidden = !alive || t.ships.filter((s) => s.alive).length <= 2;
  el("n-givebox").hidden = !alive;
  el("n-say").hidden = !alive;

  // ---- talk (keep the view pinned to the newest message unless the reader has scrolled up)
  const chat = el("n-chat");
  const pinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 30;
  setHTML(
    "n-chat",
    t.chat.map((c) => `<p><i class="dot" style="background:${color(c.from)}"></i><b>${full(c.from)}</b>${c.to ? ` <span class="tag">${c.to === meId ? "to you" : "to " + esc(nation(c.to))}</span>` : ""} ${esc(c.text)}</p>`).join("") || `<p class="small muted">Nobody has said anything yet.</p>`,
  );
  if (pinned) chat.scrollTop = chat.scrollHeight;

  setHTML(
    "n-news",
    t.news
      .slice()
      .reverse()
      .map((n) => `<li class="${n.kind ? "n-" + n.kind : ""} ${n.to ? "private" : ""}">${esc(n.text)}</li>`)
      .join(""),
  );

  // ---- the end
  if (t.over) {
    const rows = t.result.rows;
    setHTML(
      "n-result",
      `<section class="t-card c-country"><h3>How it ended</h3><div class="t-wide"><table class="grid"><tr><th>Place</th><th>Country</th><th>Captain</th><th>Shots</th><th>Hits</th><th>Radar pings</th><th>Fate</th></tr>
      ${rows.map((x) => `<tr><td class="num ${x.place === 1 ? "top" : ""}">${x.place}</td><td style="text-align:left"><i class="key" style="background:${color(x.id)}"></i> ${full(x.id)}${x.id === meId ? ` <span class="tag solid">you</span>` : ""}</td><td style="text-align:left">${esc(player(x.id)?.name)}</td><td class="num">${x.shots}</td><td class="num">${x.hits}</td><td class="num">${x.pings}</td><td style="text-align:left">${x.place === 1 && t.winner ? `afloat, hull ${x.hull} of ${r.hull}` : x.sunkBy ? `sunk by ${esc(nation(x.sunkBy))} on turn ${x.sunkTurn + 1}` : `lost in the storm on turn ${x.sunkTurn + 1}`}</td></tr>`).join("")}</table></div>
      <p class="small muted">The map above now shows where every ship was at the end.</p></section>`,
    );
    setHTML("n-host", st.you.mayHost ? `<div class="stack"><button class="btn wide" data-n="lobby">Back to the lobby</button></div>` : `<p class="hint">Waiting for the host to go back to the lobby.</p>`);
  } else {
    setHTML("n-result", "");
    setHTML("n-host", "");
  }
  tickNaval();
}

/** A short message over the top right of the map. */
function shout(text) {
  const node = el("n-flash");
  if (!node) return;
  node.textContent = text;
  node.hidden = false;
  node.classList.remove("go");
  void node.offsetWidth; // restart the fade
  node.classList.add("go");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (node.hidden = true), 2700);
}

/** Called several times a second: the countdown to the next action points. */
export function tickNaval() {
  if (!built || !api || !N()) return;
  const node = el("n-next");
  if (!node) return;
  const t = N();
  const left = Math.max(0, Math.ceil((t.nextTurn - api.now()) / 1000));
  const text = t.me.ap >= t.rules.apMax ? `full (${left}s)` : `+${Math.min(t.rules.apPerTurn, t.rules.apMax - t.me.ap)} in ${left}s`;
  if (node.textContent !== text) node.textContent = text;
}
