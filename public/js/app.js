// Crowns & Commons, browser side. Plain modules, no build step, no framework.
// The server sends the whole visible state after every change; this file draws it.

import { buildMap, mapMarkup, fills, MAP_W, MAP_H } from "./map.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const pct = (x) => Math.round(x * 100) + "%";
const clone = (o) => JSON.parse(JSON.stringify(o));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: play on without it */ } },
};

const S = {
  code: null,
  ws: null,
  retry: 0,
  dead: false,
  info: null, // rules, catalogue, actions... sent once
  st: null, // latest state from the server
  offset: 0, // server clock minus ours
  draft: null,
  slots: [],
  draftKey: null,
  draftTimer: null,
  openCats: new Set([1]),
  map: null,
  mapKey: "",
  cells: [],
  shown: new Set(), // headline ids already displayed
  log: [],
  lastPhase: null,
  rightKey: "",
  modal: null,
};

const now = () => Date.now() + S.offset;
const send = (msg) => S.ws && S.ws.readyState === 1 && S.ws.send(JSON.stringify(msg));
const hex = (colorId) => S.info.colors.find((c) => c.id === colorId)?.hex ?? "#888";
const player = (id) => S.st.players.find((p) => p.id === id);
const me = () => player(S.st.you.id);
const law = (id) => S.info.catalogue.find((l) => l.id === id);
const tier = () => (S.st.round === 1 ? "R" : "N");
/** Votes needed in your own region to reach round two, as a whole percentage. */
const need = () => Math.round(S.info.rules.qualifyShare * 100) + "%";

// ------------------------------------------------------------------ boot

function boot() {
  const code = new URLSearchParams(location.search).get("room");
  if (code && /^[A-Za-z0-9]{5}$/.test(code)) {
    S.code = code.toUpperCase();
    connect();
  } else showHome();

  $("#create").onclick = async () => {
    $("#create").disabled = true;
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const data = await res.json();
      if (!data.code) throw new Error(data.error || "No room");
      location.href = "/?room=" + data.code;
    } catch {
      toast("Could not open a room. Please try again.");
      $("#create").disabled = false;
    }
  };
  $("#joinform").onsubmit = (e) => {
    e.preventDefault();
    const v = $("#joincode").value.trim().toUpperCase();
    if (/^[A-Z0-9]{5}$/.test(v)) location.href = "/?room=" + v;
    else toast("Room codes are five letters and numbers.");
  };
  $("#invite").onclick = async () => {
    const link = location.origin + "/?room=" + S.code;
    try {
      await navigator.clipboard.writeText(link);
      toast("Invitation link copied.");
    } catch {
      toast(link);
    }
  };
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeModal());
  setInterval(tick, 250);
}

function showHome(message) {
  $("#game").hidden = true;
  $("#home").hidden = false;
  if (message) toast(message, 6000);
}

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws/${S.code}`);
  S.ws = ws;
  ws.onopen = () => {
    S.retry = 0;
    $("#lost").hidden = true;
    send({ type: "hello", token: store.get("cc:token:" + S.code), name: store.get("cc:name") });
  };
  ws.onmessage = (e) => {
    if (e.data === "pong") return;
    const msg = JSON.parse(e.data);
    if (msg.type === "welcome") {
      S.info = msg;
      store.set("cc:token:" + S.code, msg.you.token);
    } else if (msg.type === "state") {
      S.st = msg;
      S.offset = msg.now - Date.now();
      render();
    } else if (msg.type === "error") {
      if (msg.fatal) {
        S.dead = true;
        ws.close();
        history.replaceState(null, "", "/");
        showHome(msg.message);
      } else toast(msg.message);
    }
  };
  ws.onclose = () => {
    if (S.dead) return;
    $("#lost").hidden = false;
    setTimeout(connect, Math.min(8000, 500 * 2 ** S.retry++));
  };
}
setInterval(() => S.ws && S.ws.readyState === 1 && S.ws.send("ping"), 25000);

let toastTimer;
function toast(text, ms = 3500) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// ------------------------------------------------------------------ drafts

function syncDraft() {
  const st = S.st;
  if (st.phase !== "planning") {
    if (st.phase === "lobby") S.draftKey = null;
    return;
  }
  const key = `${st.round}:${st.attempt}`;
  if (S.draftKey === key) return;
  S.draftKey = key;
  S.draft = clone(st.you.draft);
  S.slots = [0, 1, 2].map((i) => {
    const a = S.draft.actions[i];
    return a ? { a: a.a, g: a.g, r: a.r ?? st.you.home } : { a: "", g: 0, r: st.you.home };
  });
  S.openCats = new Set([1]);
}

function draftChanged() {
  S.draft.actions = S.slots.filter((s) => s.a).map((s) => (S.st.round === 2 ? { a: s.a, g: s.g, r: s.r } : { a: s.a, g: s.g }));
  clearTimeout(S.draftTimer);
  S.draftTimer = setTimeout(() => send({ type: "draft", platform: S.draft }), 1200);
}

const lawsIn = (cat) => S.draft.laws.filter((id) => law(id).cat === cat);
const spent = () => S.slots.reduce((a, s) => a + (S.info.actions.find((x) => x.id === s.a)?.cost ?? 0), 0);

/** Why a law cannot be ticked right now, or "" if it can. */
function blocked(l) {
  const mine = lawsIn(l.cat).map(law);
  if (mine.length >= S.info.rules.maxLawsPerCategory) return "You can pick at most three laws in each area.";
  if (mine.some((m) => Math.abs(m.pos - l.pos) > S.info.rules.maxSpread)) return "This clashes with a law you already picked here.";
  return "";
}

function missing() {
  return S.info.categories.filter((c) => lawsIn(c.id).length < S.info.rules.minLawsPerCategory).map((c) => c.name);
}

// ------------------------------------------------------------------ render

function render() {
  const st = S.st;
  if (!S.info || !st) return;
  $("#home").hidden = true;
  $("#game").hidden = false;
  syncDraft();

  if (S.lastPhase !== st.phase) {
    if (st.phase === "counting") flash(st.round === 1 ? "Voting begins" : "The whole country votes", "People are heading out to vote.");
    if (st.phase === "planning" || st.phase === "lobby") {
      S.shown.clear();
      S.log = [];
      setHeadline(null);
    }
    if (S.lastPhase === "counting" && (st.phase === "results" || st.phase === "final")) {
      for (const h of st.ticker) S.shown.add(h.id); // nothing more to report once the count is in
      setHeadline({ text: st.phase === "final" ? "The count is complete. A winner is declared." : "The count is complete.", kind: "event" });
      setTimeout(() => S.st.phase !== "planning" && openResults(), 2600);
    }
    if (st.phase === "planning") closeModal();
    S.lastPhase = st.phase;
  }

  renderTop();
  renderLeft();
  renderCentre();
  renderRight();
  if (S.modal) drawResults();
}

const ROUND_NAME = { 1: "Round 1 · Regional election", 2: "Round 2 · National election" };

function renderTop() {
  const st = S.st;
  const again = st.round === 1 && st.attempt > 1 ? ` · attempt ${st.attempt}` : "";
  const label = {
    lobby: "The lobby",
    planning: `${ROUND_NAME[st.round]}${again} · choose your laws`,
    counting: `${ROUND_NAME[st.round]} · the votes are coming in`,
    results: `${ROUND_NAME[st.round]} · the result`,
    final: "The game is over",
  }[st.phase];
  $("#phase").textContent = label;
  $("#invite").textContent = `Room ${st.code} · copy link`;
}

function statusOf(p) {
  const st = S.st;
  if (!p.bot && !p.connected) return "away";
  if (st.phase === "lobby") return "ready";
  if (p.eliminated) return "watching";
  if (st.phase === "planning") return p.locked ? "locked in" : "deciding…";
  if (st.phase === "counting") return "waiting for results";
  if (st.outcome?.winner === p.id) return "winner";
  if (st.phase === "results" && st.round === 1) return p.qualified ? "qualified" : "did not qualify";
  return "";
}

function renderLeft() {
  const st = S.st;
  const host = st.you.mayHost;
  let html = `<h3>Parties (${st.players.length}/${S.info.rules.maxPlayers})</h3>`;
  for (const p of st.players) {
    const region = st.regions[p.home];
    const bits = [region ? region.name : null, statusOf(p)].filter(Boolean).join(" · ");
    const tags =
      (p.id === st.you.id ? `<span class="tag solid">you</span>` : "") +
      (p.id === st.hostId ? `<span class="tag">host</span>` : "") +
      (p.bot ? `<span class="tag">bot</span>` : "");
    const x = st.phase === "lobby" && host && p.id !== st.you.id ? `<button class="x" data-remove="${p.id}" title="Remove" aria-label="Remove ${esc(p.name)}">×</button>` : "<span></span>";
    html += `<div class="party ${p.eliminated ? "out" : ""}"><span class="swatch" style="background:${hex(p.color)}"></span><span class="name"><span class="n">${esc(p.name)}</span>${tags}</span>${x}<span class="meta">${esc(bits)}</span></div>`;
  }
  html += `<div class="stack">`;
  if (st.phase === "lobby" && host) html += `<button class="btn ghost" data-act="addBot" ${st.players.length >= S.info.rules.maxPlayers ? "disabled" : ""}>Add a bot party</button>`;
  if (st.phase === "planning" && host) html += `<button class="btn ghost small" data-act="forceLock" title="Lock everyone in now. Any missing laws are filled in automatically.">End planning now</button>`;
  if ((st.phase === "final" || st.phase === "results") && host) html += `<button class="btn ghost small" data-act="newGame">Back to the lobby</button>`;
  html += `</div>`;
  if (st.phase !== "lobby") {
    html += `<h3>How to read the map</h3><p class="small muted">Each region fills with a party's colour as its votes are counted. Striped areas are votes for the Old Order: people who would rather keep things as they are. In round one you need ${need()} of the votes in your own region.</p>`;
  }
  const el = $("#left");
  el.innerHTML = html;
  el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => send({ type: b.dataset.act })));
  el.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = () => send({ type: "remove", id: b.dataset.remove })));
}

// ------------------------------------------------------------------ centre: banner, map, legend

function renderCentre() {
  const st = S.st;
  const names = (ids) => {
    const list = ids.map((id) => esc(player(id).name));
    return list.length > 1 ? list.slice(0, -1).join(", ") + " and " + list.at(-1) : list[0];
  };
  let banner = "";
  if (st.phase === "lobby") banner = `<h2>Waiting for players</h2><p>Send your friends the link (top right). A game needs two to five parties, and the map is split into one region for each.</p>`;
  else if (st.phase === "planning" && st.you.eliminated) banner = `<h2>The national election</h2><p>The remaining parties are choosing their national laws.</p>`;
  else if (st.phase === "planning" && st.round === 1) banner = `<h2>Your region: ${esc(st.regions[st.you.home].name)}</h2><p>${esc(st.regions[st.you.home].blurb)}. Win ${need()} of its votes to reach the national election.</p>`;
  else if (st.phase === "planning") banner = `<h2>Now it's the whole country</h2><p>Your regional laws stay. Add national laws and campaign in any region.</p>`;
  else if (st.phase === "counting") banner = `<h2>Counting the votes</h2><p>Watch the news. The numbers come at the end.</p>`;
  else if (st.outcome?.kind === "none") banner = `<h2>Nobody got enough votes</h2><p>No party reached ${need()} in its own region, so the regional election will be run again. The Old Order gets a little weaker each time.</p>`;
  else if (st.outcome?.kind === "advance") {
    const through = st.players.filter((p) => p.qualified).map((p) => p.id);
    const out = st.players.filter((p) => !p.qualified).map((p) => p.id);
    banner = `<h2>${names(through)} move on</h2><p>${out.length ? names(out) + " did not get enough votes and will watch the national election." : "Every party qualified for the national election."}</p>`;
  } else if (st.outcome?.kind === "single") banner = `<h2>${names([st.outcome.winner])} wins the game</h2><p>The only party to reach ${need()} in its own region.</p>`;
  else if (st.outcome?.kind === "national") banner = `<h2>${names([st.outcome.winner])} wins the election</h2><p>With ${pct(st.results2.parties[st.outcome.winner].share)} of all votes across the country.</p>`;
  $("#banner").innerHTML = banner;

  // Map: one region per party. In the lobby it previews the split.
  const n = Math.min(5, Math.max(2, st.regions.length || st.players.length));
  const key = n + "|" + st.regions.map((r) => r.name).join(",");
  const svg = $("#map");
  if (S.mapKey !== key) {
    S.mapKey = key;
    S.map = buildMap(n);
    svg.setAttribute("viewBox", `-6 -6 ${MAP_W + 12} ${MAP_H + 12}`);
    svg.innerHTML = mapMarkup(S.map, st.regions.map((r) => r.name));
    S.cells = [...svg.querySelectorAll(".cell")];
  }
  const colors = Object.fromEntries(st.players.map((p) => [p.id, hex(p.color)]));
  const f = fills(S.map, st.regions.length ? st.paint : null, colors);
  S.cells.forEach((cell, i) => (cell.style.fill = f[i]));
  svg.querySelectorAll(".outline").forEach((path) => {
    const owner = st.players.find((p) => p.home === Number(path.dataset.region));
    path.style.stroke = owner && st.regions.length && st.round === 1 ? hex(owner.color) : "transparent";
  });
  svg.querySelectorAll(".region-name").forEach((t) => t.classList.toggle("mine", Number(t.dataset.region) === st.you.home));

  let legend = st.players.map((p) => `<span><i class="key" style="background:${hex(p.color)}"></i>${esc(p.name)}</span>`).join("");
  if (st.phase !== "lobby" && st.phase !== "planning") legend += `<span><i class="key old"></i>Old Order</span><span><i class="key"></i>Not yet counted</span>`;
  $("#legend").innerHTML = legend;

  let actions = "";
  if (st.phase === "counting") actions += `<button class="btn ghost small" data-act="hasten" ${st.you.hasten ? "disabled" : ""}>${st.you.hasten ? "Waiting for the others to agree…" : "Skip to the result (everyone must agree)"}</button>`;
  if (st.results1 || st.results2) actions += `<button class="btn" id="view-results">View results</button>`;
  if (st.phase === "results" && st.you.mayHost) actions += `<button class="btn" data-act="next">${st.outcome.kind === "none" ? "Run the regional election again" : "Continue to the national election"}</button>`;
  if (st.phase === "results" && !st.you.mayHost) actions += `<span class="hint">Waiting for the host to continue…</span>`;
  if (st.phase === "final" && st.you.mayHost) actions += `<button class="btn ghost" data-act="newGame">Play again</button>`;
  const el = $("#mapactions");
  el.innerHTML = actions;
  el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => send({ type: b.dataset.act })));
  if ($("#view-results")) $("#view-results").onclick = () => openResults();
}

function flash(title, sub) {
  const el = $("#flash");
  el.innerHTML = `<div>${esc(title)}<small>${esc(sub)}</small></div>`;
  el.hidden = false;
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  setTimeout(() => (el.hidden = true), 4600);
}

// ------------------------------------------------------------------ clock and ticker

function tick() {
  const st = S.st;
  if (!st || !S.info) return;
  const clock = $("#clock");
  let end = null;
  if (st.phase === "planning") end = st.deadline;
  if (st.phase === "counting" && st.count) end = st.count.startedAt + st.count.total * st.count.periodMs;
  if (end) {
    const left = Math.max(0, Math.ceil((end - now()) / 1000));
    clock.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    clock.classList.toggle("low", st.phase === "planning" && left <= 30);
  } else {
    clock.textContent = st.phase === "planning" ? "no limit" : "";
    clock.classList.remove("low");
  }

  // Headlines arrive a little ahead of time; show each one when it is due.
  for (const h of st.ticker) {
    if (S.shown.has(h.id) || h.t > now()) continue;
    S.shown.add(h.id);
    setHeadline(h);
  }
}

function setHeadline(h) {
  const el = $("#headline");
  if (!h) {
    el.className = "";
    el.innerHTML = `<span class="muted">${S.st?.phase === "lobby" ? "No news yet." : "No news yet. The parties are still choosing their laws."}</span>`;
    $("#newslog").innerHTML = "";
    $("#newsbox").hidden = true;
    return;
  }
  const dot = h.p && player(h.p) ? `<i class="dot" style="background:${hex(player(h.p).color)}"></i>` : "";
  el.className = h.kind === "event" ? "event fresh" : "fresh";
  el.innerHTML = dot + `<span>${esc(h.text)}</span>`;
  void el.offsetWidth;
  S.log.unshift(dot + `<span>${esc(h.text)}</span>`);
  S.log = S.log.slice(0, 80);
  // The full list, newest first, in a box you can scroll back through.
  const list = $("#newslog");
  list.innerHTML = S.log.map((x) => `<li>${x}</li>`).join("");
  list.scrollTop = 0;
  $("#newsbox").hidden = false;
}

// ------------------------------------------------------------------ right-hand panel

/** The panel is only rebuilt when something it shows has changed, so it never jumps under your hands. */
function rightKey() {
  const st = S.st;
  const base = [st.phase, st.round, st.attempt, st.you.locked, st.you.eliminated, st.you.gold, st.you.mayHost];
  if (st.phase === "lobby") base.push(JSON.stringify(st.settings), st.players.map((p) => p.id + p.color + p.name).join("|"));
  if (st.phase === "planning") base.push(st.players.filter((p) => !p.eliminated && !p.locked).length * (st.you.locked ? 1 : 0));
  if (st.phase === "results" || st.phase === "final") base.push(JSON.stringify(st.outcome));
  return base.join("~");
}

function renderRight(force) {
  const st = S.st;
  const el = $("#right");
  const key = rightKey();
  if (!force && key === S.rightKey) return;
  S.rightKey = key;
  const typing = document.activeElement?.id === "pname" ? document.activeElement.value : null;
  const scroll = el.scrollTop;
  if (st.phase === "lobby") el.innerHTML = lobbyPanel();
  else if (st.phase === "planning" && !st.you.eliminated) el.innerHTML = st.you.locked ? lockedPanel(true) : planPanel();
  else if (st.phase === "counting" && !st.you.eliminated) el.innerHTML = lockedPanel(false);
  else if (st.phase === "results" || st.phase === "final") el.innerHTML = standingsPanel();
  else el.innerHTML = galleryPanel();
  wireRight(el);
  el.scrollTop = scroll;
  if (typing !== null && el.querySelector("#pname")) {
    el.querySelector("#pname").value = typing;
    el.querySelector("#pname").focus();
  }
}

function lobbyPanel() {
  const st = S.st;
  const mine = me();
  const taken = new Set(st.players.filter((p) => p.id !== mine.id).map((p) => p.color));
  const host = st.you.mayHost;
  const opt = (list, cur, fmt) => list.map((v) => `<option value="${v}" ${v === cur ? "selected" : ""}>${fmt(v)}</option>`).join("");
  const mins = (s) => (s === 0 ? "No limit (wait for everyone)" : s < 120 ? "1 minute" : s / 60 + " minutes");
  return `
    <h3>Your party</h3>
    <div class="field"><label for="pname">Party name</label><input id="pname" maxlength="28" value="${esc(mine.name)}" /></div>
    <div class="field"><label>Colour</label><div class="swatches">${S.info.colors
      .map((c) => `<button data-color="${c.id}" style="background:${c.hex}" aria-label="${c.id}" aria-pressed="${mine.color === c.id}" ${taken.has(c.id) ? "disabled" : ""}></button>`)
      .join("")}</div></div>
    <h3>Game settings</h3>
    <div class="field"><label for="plan">Time to choose laws</label><select id="plan" ${host ? "" : "disabled"}>${opt(S.info.rules.planChoices, st.settings.planSec, mins)}</select></div>
    <div class="field"><label for="sim">Length of each vote count</label><select id="sim" ${host ? "" : "disabled"}>${opt(S.info.rules.simChoices, st.settings.simSec, mins)}</select></div>
    ${
      host
        ? `<button class="btn big wide" id="start" ${st.players.length < S.info.rules.minPlayers ? "disabled" : ""}>Start the game</button>
           ${st.players.length < S.info.rules.minPlayers ? `<p class="hint">You need at least two parties. Invite a friend, or add a bot on the left.</p>` : ""}`
        : `<p class="hint">Waiting for the host to start the game.</p>`
    }
    <h3>How to play</h3>
    <ol class="plain-list">
      <li>Everyone gets a random region and ${S.info.rules.startGold} gold.</li>
      <li>Pick two or three laws in each of nine areas, set your tax rate, and choose up to three campaign actions. Then lock in.</li>
      <li>When everyone has locked in, the votes are counted. The news tells you how people are reacting; the numbers come at the end.</li>
      <li>Get ${need()} of the votes in your own region and you move on to the national election. There you add new laws on top of your regional ones and campaign across the whole map.</li>
      <li>The party with the most votes in the national election wins. If only one party qualifies, it wins straight away. If nobody does, the regional round is run again.</li>
    </ol>`;
}

function regionCard(r, title) {
  const rows = S.info.groups.map((g, i) => `<span>${g}</span><span class="bar"><i style="width:${Math.min(100, r.mix[i] * 2.2)}%"></i></span><span class="num">${r.mix[i]}%</span><span class="muted">${r.mood[i]}</span>`).join("");
  return `<h3>${esc(title)}</h3><p class="small muted">${esc(r.blurb)}. ${r.pop.toLocaleString()} voters.</p><div class="mix">${rows}</div>`;
}

function realmTable() {
  const st = S.st;
  const head = st.regions.map((r, i) => `<th>${esc(r.name)}${i === st.you.home ? "*" : ""}</th>`).join("");
  const rows = S.info.groups.map((g, gi) => `<tr><td>${g}</td>${st.regions.map((r) => `<td class="num">${r.mix[gi]}%</td>`).join("")}</tr>`).join("");
  return `<h3>The country: who lives where</h3><table class="realm"><tr><th></th>${head}</tr>${rows}</table><p class="small muted">* your home region</p>`;
}

function planPanel() {
  const st = S.st;
  const t = tier();
  const rules = S.info.rules;
  const gold = st.you.gold;
  const left = gold - spent();
  let html = st.round === 1 ? regionCard(st.regions[st.you.home], "Your region: " + st.regions[st.you.home].name) : realmTable();

  html += `<h3>${st.round === 1 ? "Laws for your region" : "Laws for the whole country"}</h3>
    <p class="small muted">Choose ${rules.minLawsPerCategory} or ${rules.maxLawsPerCategory} in every area. You can see what each law promises. Its downside is hidden: you will find out from the news.</p>`;
  for (const cat of S.info.categories) {
    const options = S.info.catalogue.filter((l) => l.tier === t && l.cat === cat.id);
    const chosen = lawsIn(cat.id);
    const record = st.round === 2 ? (me().regional?.laws ?? []).map(law).filter((l) => l.cat === cat.id) : [];
    html += `<details class="cat ${chosen.length >= rules.minLawsPerCategory ? "done" : ""}" data-cat="${cat.id}" ${S.openCats.has(cat.id) ? "open" : ""}>
      <summary><span class="t">${esc(cat.name)}</span><span class="count">${chosen.length} of ${rules.minLawsPerCategory}–${rules.maxLawsPerCategory}</span></summary>
      <div class="axis"><span>← ${esc(cat.axis[0])}</span><span>${esc(cat.axis[1])} →</span></div>
      ${record.length ? `<div class="record">Your regional laws here: ${record.map((l) => esc(l.name)).join(", ")}</div>` : ""}`;
    for (const l of options) {
      const on = chosen.includes(l.id);
      const why = on ? "" : blocked(l);
      html += `<label class="law ${on ? "on" : ""} ${why ? "off" : ""}"><input type="checkbox" data-law="${l.id}" ${on ? "checked" : ""} ${why ? "disabled" : ""}/><b>${esc(l.name)}</b><span>${esc(l.desc)}${why ? ` <span class="why">${why}</span>` : ""}</span></label>`;
    }
    html += `</details>`;
  }

  html += `<h3>${st.round === 1 ? "Tax rate in your region" : "Tax rate for the whole country"}</h3>
    <div class="tax"><input type="range" id="tax" min="${rules.taxMin}" max="${rules.taxMax}" step="1" value="${S.draft.tax}" aria-label="Tax rate"/><output id="taxout">${S.draft.tax}%</output></div>
    <p class="small muted">Low taxes are popular, but laws that cost money need taxes to pay for them.</p>`;

  html += `<h3>Campaign (up to ${rules.actionsPerRound} actions)</h3><div class="purse"><span>Gold left</span><b>${left}</b></div>`;
  S.slots.forEach((slot, i) => {
    const own = S.info.actions.find((a) => a.id === slot.a)?.cost ?? 0;
    const acts = S.info.actions.map((a) => `<option value="${a.id}" ${slot.a === a.id ? "selected" : ""} ${a.cost > left + own ? "disabled" : ""}>${esc(a.name)} · ${a.cost} gold</option>`).join("");
    const groups = S.info.groups.map((g, gi) => `<option value="${gi}" ${slot.g === gi ? "selected" : ""}>for the ${g.toLowerCase()}</option>`).join("");
    const regions = st.round === 2 ? `<select data-slot="${i}" data-field="r" ${slot.a ? "" : "disabled"} aria-label="Region">${st.regions.map((r, ri) => `<option value="${ri}" ${slot.r === ri ? "selected" : ""}>in ${esc(r.name)}</option>`).join("")}</select>` : "";
    html += `<div class="slot ${st.round === 2 ? "three" : ""}"><select data-slot="${i}" data-field="a" aria-label="Campaign action ${i + 1}"><option value="">No action</option>${acts}</select><select data-slot="${i}" data-field="g" ${slot.a ? "" : "disabled"} aria-label="Audience">${groups}</select>${regions}</div>`;
  });
  html += `<p class="small muted">Each action targets one group. Repeating the same action works less well each time. Gold you don't spend carries over to the next round, and you can't borrow.</p>`;

  const miss = missing();
  html += `<button class="btn big wide" id="lock" ${miss.length ? "disabled" : ""}>Lock in</button>`;
  html += miss.length ? `<p class="hint">You still need two laws in: ${miss.map(esc).join(", ")}.</p>` : `<p class="hint">When every party has locked in, voting begins.</p>`;
  return html;
}

function platformSummary(platform) {
  if (!platform) return "";
  let html = "";
  for (const cat of S.info.categories) {
    const ls = platform.laws.map(law).filter((l) => l.cat === cat.id);
    if (ls.length) html += `<li><b>${esc(cat.name)}:</b> ${ls.map((l) => esc(l.name)).join(", ")}</li>`;
  }
  html += `<li><b>Tax rate:</b> ${platform.tax}%</li>`;
  if (platform.actions.length)
    html += `<li><b>Campaign:</b> ${platform.actions
      .map((a) => {
        const def = S.info.actions.find((x) => x.id === a.a);
        const where = a.r !== undefined && S.st.regions[a.r] ? " in " + esc(S.st.regions[a.r].name) : "";
        return `${esc(def.name)} for the ${S.info.groups[a.g].toLowerCase()}${where}`;
      })
      .join("; ")}</li>`;
  return html;
}

function lockedPanel(canUnlock) {
  const st = S.st;
  const waiting = st.players.filter((p) => !p.eliminated && !p.locked).length;
  // While planning, the plan for this round is still our draft; once counting starts it is on the record.
  const current = canUnlock ? S.draft : st.round === 1 ? me().regional : me().national;
  return `
    <div class="locked-note">
      <b>${canUnlock ? "Locked in." : "Voting has started."}</b>
      ${canUnlock ? ` Waiting for ${waiting} more ${waiting === 1 ? "party" : "parties"}.` : " Your choices are final. Watch the map and the news."}
      ${canUnlock ? `<div class="stack"><button class="btn ghost small" id="unlock">Change my mind</button></div>` : ""}
    </div>
    <div class="greyed">
      <div class="purse"><span>Gold left</span><b>${canUnlock ? st.you.gold - spent() : st.you.gold}</b></div>
      ${st.round === 2 ? `<h3>Your national laws</h3><ul class="plain-list">${platformSummary(current)}</ul>` : ""}
      <h3>Your regional laws</h3><ul class="plain-list">${platformSummary(st.round === 2 ? me().regional : current)}</ul>
    </div>`;
}

function galleryPanel() {
  const st = S.st;
  const r = st.regions[st.you.home];
  const share = st.results1?.parties[st.you.id]?.share;
  return `
    <div class="locked-note"><b>You are out of the running.</b> ${share !== undefined ? `Your party got ${pct(share)} of the votes in ${esc(r.name)} and needed ${need()}.` : ""} You can still watch the national election, the map and the news.</div>
    ${realmTable()}`;
}

function standingsPanel() {
  const st = S.st;
  const res = st.results2 ?? st.results1;
  const order = st.outcome?.ranking ?? [];
  let html = `<h3>${st.results2 ? "National results" : "Regional results"}</h3>`;
  order.forEach((id, i) => {
    const p = player(id);
    const tag = st.outcome.winner === id ? `<span class="tag solid">winner</span>` : !st.results2 && p.qualified ? `<span class="tag">qualified</span>` : "";
    html += `<div class="standing"><span class="num">${i + 1}.</span><span class="key" style="background:${hex(p.color)}"></span><span><b>${esc(p.name)}</b>${tag}<br><span class="small muted">${st.results2 ? "of all votes" : "in " + esc(st.regions[p.home].name)}</span></span><span class="pct">${pct(res.parties[id].share)}</span></div>`;
  });
  if (st.results2) html += `<div class="standing"><span></span><span class="key old"></span><span><b>The Old Order</b><br><span class="small muted">wanted to keep things as they are</span></span><span class="pct">${pct(res.old.share)}</span></div>`;
  if (st.results2) {
    const gone = st.players.filter((p) => p.eliminated);
    if (gone.length) html += `<p class="small muted" style="margin-top:8px">Knocked out in the regional round: ${gone.map((p) => esc(p.name)).join(", ")}.</p>`;
  }
  if (res.event) html += `<p class="small" style="margin-top:10px"><b>Surprise event this election:</b> ${esc(res.event.name.toLowerCase())}${res.event.region !== null ? " in " + esc(st.regions[res.event.region].name) : " across the country"}.</p>`;

  if (st.phase === "final" && st.report) {
    html += `<h3>How people felt about the laws</h3><p class="small muted">Now that the game is over, here is the hidden downside of each party's least popular laws.</p>`;
    for (const id of order) {
      const rep = st.report[id];
      if (!rep) continue;
      const p = player(id);
      const li = (lid, withCost) => `<li>${esc(law(lid).name)}${withCost ? `<em>${esc(st.reveal[lid])}</em>` : ""}</li>`;
      html += `<div class="card" style="margin-bottom:10px"><h4><i class="key" style="background:${hex(p.color)}"></i>${esc(p.name)}</h4>
        <div class="verdicts"><div><h5>Most popular</h5><ul>${rep.best.map((l) => li(l, false)).join("")}</ul></div><div><h5>Least popular</h5><ul>${rep.worst.map((l) => li(l, true)).join("")}</ul></div></div></div>`;
    }
  } else if (st.phase === "results") {
    html += `<p class="hint" style="margin-top:12px">${st.outcome.kind === "none" ? "Everyone keeps their laws as a starting point, gains " + S.info.rules.roundIncome + " gold, and tries again." : "Parties that qualified get " + S.info.rules.roundIncome + " more gold for the national campaign. Press View results to see which groups voted for whom."}</p>`;
  }
  return html;
}

function wireRight(el) {
  const rerender = () => {
    draftChanged();
    renderRight(true);
  };
  const name = el.querySelector("#pname");
  if (name)
    name.onchange = () => {
      store.set("cc:name", name.value.trim());
      send({ type: "profile", name: name.value });
    };
  el.querySelectorAll("[data-color]").forEach((b) => (b.onclick = () => send({ type: "profile", color: b.dataset.color })));
  if (el.querySelector("#plan")) el.querySelector("#plan").onchange = (e) => send({ type: "settings", planSec: Number(e.target.value) });
  if (el.querySelector("#sim")) el.querySelector("#sim").onchange = (e) => send({ type: "settings", simSec: Number(e.target.value) });
  if (el.querySelector("#start")) el.querySelector("#start").onclick = () => send({ type: "start" });

  el.querySelectorAll("details.cat").forEach((d) =>
    d.addEventListener("toggle", () => {
      const id = Number(d.dataset.cat);
      if (d.open) S.openCats.add(id);
      else S.openCats.delete(id);
    }),
  );
  el.querySelectorAll("[data-law]").forEach(
    (box) =>
      (box.onchange = () => {
        const id = box.dataset.law;
        if (box.checked) {
          if (blocked(law(id))) return;
          S.draft.laws.push(id);
        } else S.draft.laws = S.draft.laws.filter((x) => x !== id);
        rerender();
      }),
  );
  const tax = el.querySelector("#tax");
  if (tax) {
    tax.oninput = () => {
      S.draft.tax = Number(tax.value);
      el.querySelector("#taxout").textContent = tax.value + "%";
    };
    tax.onchange = draftChanged;
  }
  el.querySelectorAll("[data-slot]").forEach(
    (sel) =>
      (sel.onchange = () => {
        const slot = S.slots[Number(sel.dataset.slot)];
        slot[sel.dataset.field] = sel.dataset.field === "a" ? sel.value : Number(sel.value);
        rerender();
      }),
  );
  if (el.querySelector("#lock"))
    el.querySelector("#lock").onclick = () => {
      draftChanged();
      clearTimeout(S.draftTimer);
      send({ type: "lock", platform: S.draft });
    };
  if (el.querySelector("#unlock")) el.querySelector("#unlock").onclick = () => send({ type: "unlock" });
}

// ------------------------------------------------------------------ results window

function openResults(tab) {
  if (!S.st.results1 && !S.st.results2) return;
  S.modal = { tab: tab ?? (S.st.results2 ? 2 : 1) };
  drawResults();
}

function closeModal() {
  S.modal = null;
  $("#modal").hidden = true;
}

function groupBars(values, color, cls = "") {
  return S.info.groups
    .map((g, i) => `<div class="gbar"><span>${g}</span><span class="track"><i class="${cls}" style="width:${Math.round(values[i] * 100)}%;${color ? "background:" + color : ""}"></i></span><span class="num">${pct(values[i])}</span></div>`)
    .join("");
}

function drawResults() {
  const st = S.st;
  if (!st.results1 && !st.results2) return closeModal();
  if (S.modal.tab === 2 && !st.results2) S.modal.tab = 1;
  if (S.modal.tab === 1 && !st.results1) S.modal.tab = 2;
  const round = S.modal.tab;
  const res = round === 2 ? st.results2 : st.results1;
  const ids = Object.keys(res.parties).sort((a, b) => res.parties[b].share - res.parties[a].share);

  let body = "";
  if (round === 2) {
    const head = ids.map((id) => `<th><i class="key" style="background:${hex(player(id).color)}"></i> ${esc(player(id).name)}</th>`).join("");
    const rows = res.regions
      .map((r, ri) => {
        const top = ids.reduce((a, b) => (r.share[a] >= r.share[b] ? a : b));
        return `<tr><td>${esc(st.regions[ri].name)}</td>${ids.map((id) => `<td class="num ${id === top && r.share[id] > r.oldShare ? "top" : ""}">${pct(r.share[id])}</td>`).join("")}<td class="num">${pct(r.oldShare)}</td><td class="num">${pct(r.turnout)}</td></tr>`;
      })
      .join("");
    body += `<table class="grid"><tr><th>Region</th>${head}<th>Old Order</th><th>Turnout</th></tr>${rows}
      <tr><th>Whole country</th>${ids.map((id) => `<th class="num">${pct(res.parties[id].share)}</th>`).join("")}<th class="num">${pct(res.old.share)}</th><th></th></tr></table>`;
  }

  body += `<p class="small muted">Each bar shows what share of that group's votes the party got${round === 1 ? " in its own region" : " across the country"}.</p><div class="cards">`;
  for (const id of ids) {
    const p = player(id);
    const pr = res.parties[id];
    const region = res.regions[p.home];
    const verdict =
      round === 1
        ? `${pr.share >= S.info.rules.qualifyShare ? "Qualified" : "Did not qualify"} · ${esc(st.regions[p.home].name)} · turnout ${pct(region.turnout)}`
        : st.outcome?.winner === id
          ? "Winner"
          : "of all votes";
    const showN = round === 2 && p.national;
    body += `<div class="card"><h4><i class="key" style="background:${hex(p.color)}"></i>${esc(p.name)}${id === st.you.id ? `<span class="tag solid">you</span>` : ""}</h4>
      <div class="share">${pct(pr.share)}</div><div class="verdict">${verdict}</div>
      ${groupBars(pr.byGroup, hex(p.color))}
      ${p.regional ? `<details><summary>See their laws</summary>${showN ? `<p style="margin:6px 0 0"><b>National laws</b></p><ul>${platformSummary(p.national)}</ul><p style="margin:6px 0 0"><b>Regional laws</b></p>` : ""}<ul>${platformSummary(p.regional)}</ul></details>` : ""}
    </div>`;
  }
  if (round === 2) body += `<div class="card"><h4><i class="key old"></i>The Old Order</h4><div class="share">${pct(res.old.share)}</div><div class="verdict">wanted to keep things as they are</div>${groupBars(res.old.byGroup, "", "old")}</div>`;
  body += `</div>`;

  const tabs = st.results1 && st.results2 ? `<div class="tabs"><button class="btn ghost small" data-tab="1" aria-selected="${round === 1}">Round 1 · Regional</button><button class="btn ghost small" data-tab="2" aria-selected="${round === 2}">Round 2 · National</button></div>` : "";
  const modal = $("#modal");
  const keep = modal.querySelector(".sheet")?.scrollTop ?? 0;
  const open = [...modal.querySelectorAll(".card details")].map((d) => d.open);
  modal.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Election results"><div class="sheet-head"><h2>${round === 1 ? "Regional election results" : "National election results"}</h2><button class="btn ghost small" id="close-modal">Close</button></div>${tabs}${body}</div>`;
  modal.hidden = false;
  modal.querySelector(".sheet").scrollTop = keep;
  modal.querySelectorAll(".card details").forEach((d, i) => (d.open = !!open[i]));
  modal.onclick = (e) => e.target === modal && closeModal();
  $("#close-modal").onclick = closeModal;
  modal.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        S.modal.tab = Number(b.dataset.tab);
        modal.querySelectorAll(".card details").forEach((d) => (d.open = false));
        drawResults();
      }),
  );
}

boot();
