// Browser side of the room: the front page, the connection, and the lobby. Plain modules, no
// build step, no framework. The server sends the whole visible state after every change;
// the two games draw themselves in naval.js and trade.js.

import { renderTrade, tickTrade, leaveTrade } from "./trade.js";
import { renderNaval, tickNaval, leaveNaval } from "./naval.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: play on without it */ } },
};

const S = {
  code: null,
  ws: null,
  retry: 0,
  dead: false,
  info: null, // rules, colours, countries: sent once
  st: null, // latest state from the server
  offset: 0, // server clock minus ours
  homeGame: "naval",
  rightKey: "",
  news: null,
  version: null, // the deployment this page was loaded from
  lastSeen: 0, // when the server last said anything
  retryTimer: null,
  updating: false,
};

const GAMES = {
  naval: { title: "Silent Fleet", html: `Silent <span class="amp">Fleet</span>` },
  trade: { title: "Trade and Treachery", html: `Trade <span class="amp">and</span> Treachery` },
};

const now = () => Date.now() + S.offset;
const send = (msg) => S.ws && S.ws.readyState === 1 && S.ws.send(JSON.stringify(msg));
const hex = (colorId) => S.info.colors.find((c) => c.id === colorId)?.hex ?? "#888";
const country = (id) => S.info.countries.find((c) => c.id === id) ?? { name: "", flag: "" };
const me = () => S.st.players.find((p) => p.id === S.st.you.id);

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
      const res = await fetch("/api/rooms?game=" + (S.homeGame === "trade" ? "trade" : "naval"), { method: "POST" });
      const data = await res.json();
      if (!data.code) throw new Error(data.error || "No room");
      location.href = "/?room=" + data.code;
    } catch {
      toast("Could not open a room. Please try again.");
      $("#create").disabled = false;
    }
  };
  // The two games, as tabs on the front page.
  document.querySelectorAll(".gametabs [data-game]").forEach(
    (tab) =>
      (tab.onclick = () => {
        S.homeGame = tab.dataset.game;
        document.querySelectorAll(".gametabs [data-game]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
        document.querySelectorAll("#home [data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== S.homeGame));
      }),
  );
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
  $("#leave").onclick = () => {
    const playing = S.st && S.st.phase !== "lobby";
    if (!confirm(playing ? "Leave this game? It carries on without you, and your place stays on the board." : "Leave this room?")) return;
    send({ type: "leave" });
    store.set("cc:token:" + S.code, "");
    store.set("cc:last", "");
    S.dead = true;
    setTimeout(() => (location.href = "/"), 150);
  };
  $("#tolobby").onclick = () => confirm("End this game for everyone and go back to the lobby?") && send({ type: "newGame" });
  setInterval(tick, 250);

  // Keep the page fresh without anyone pressing reload: notice new versions, and recover
  // quickly when a phone wakes up or the network comes back.
  checkVersion();
  setInterval(checkVersion, 120000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && wake());
  window.addEventListener("online", wake);
  window.addEventListener("pageshow", (e) => e.persisted && wake());
}

/** Ask which version is live. If it is newer than this page, reload to get it. */
async function checkVersion() {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (res.ok) sawVersion((await res.json()).version);
  } catch {
    // Offline or mid-deploy: the next check will catch it.
  }
}

function sawVersion(version) {
  if (!version || S.updating) return;
  if (!S.version) S.version = version;
  else if (version !== S.version) {
    // Never reload twice for the same update. Right after a deployment different parts of the
    // server can report different versions for a while, and that must not turn into a loop.
    let already = null;
    try { already = sessionStorage.getItem("cc:reloaded"); } catch { /* private mode */ }
    if (already === version) return void (S.version = version);
    try { sessionStorage.setItem("cc:reloaded", version); } catch { return void (S.version = version); }
    S.updating = true;
    toast("The game has been updated. Reloading…", 5000);
    // Nothing is lost: the game lives on the server and your seat is remembered.
    setTimeout(() => location.reload(), 1200);
  }
}

/** The page has come back to the front or the network has returned: make sure we are still connected. */
function wake() {
  checkVersion();
  if (!S.code || S.dead) return;
  if (!S.ws || S.ws.readyState > 1) return connect();
  if (S.ws.readyState !== 1) return;
  const asked = Date.now();
  S.ws.send("ping");
  setTimeout(() => S.lastSeen < asked && reconnect(), 4000);
}

/** Drop a connection that has gone quiet and start a new one. */
function reconnect() {
  if (S.dead) return;
  if (S.ws) {
    S.ws.onclose = null;
    try {
      S.ws.close();
    } catch {
      // already gone
    }
  }
  $("#lost").hidden = false;
  connect();
}

function showHome(message) {
  $("#game").hidden = true;
  $("#home").hidden = false;
  const last = store.get("cc:last");
  if (last && /^[A-Z0-9]{5}$/.test(last)) {
    $("#resume").hidden = false;
    $("#resume-link").href = "/?room=" + last;
    $("#resume-link").textContent = `Go back to your game in room ${last}`;
  }
  if (message) toast(message, 6000);
}

function connect() {
  clearTimeout(S.retryTimer);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws/${S.code}`);
  S.ws = ws;
  ws.onopen = () => {
    S.retry = 0;
    S.lastSeen = Date.now();
    $("#lost").hidden = true;
    send({ type: "hello", token: store.get("cc:token:" + S.code), name: store.get("cc:name") });
  };
  ws.onmessage = (e) => {
    if (ws !== S.ws) return; // a connection we have already replaced
    S.lastSeen = Date.now();
    if (e.data === "pong") return;
    const msg = JSON.parse(e.data);
    if (msg.type === "welcome") {
      // The room can lag behind a new deployment, so its version is not compared directly:
      // it is only a cue to ask the front door, which is the one source of truth.
      if (msg.version !== S.version) checkVersion();
      S.info = msg;
      store.set("cc:token:" + S.code, msg.you.token);
      store.set("cc:last", S.code);
    } else if (msg.type === "state") {
      S.st = msg;
      S.offset = msg.now - Date.now();
      render();
    } else if (msg.type === "error") {
      if (msg.fatal) {
        S.dead = true;
        if (store.get("cc:last") === S.code) store.set("cc:last", "");
        ws.close();
        history.replaceState(null, "", "/");
        showHome(msg.message);
      } else toast(msg.message);
    }
  };
  ws.onclose = () => {
    if (S.dead || ws !== S.ws) return;
    $("#lost").hidden = false;
    S.retryTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** S.retry++));
  };
}
// Heartbeat: a ping every 25 seconds, and a fresh connection if the server has been silent for a minute.
setInterval(() => {
  if (!S.ws || S.ws.readyState !== 1) return;
  if (Date.now() - S.lastSeen > 60000) reconnect();
  else S.ws.send("ping");
}, 25000);

let toastTimer;
function toast(text, ms = 3500) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// ------------------------------------------------------------------ drawing

function headline(item) {
  if (!item || item.id === S.news) return;
  S.news = item.id;
  const h = $("#headline");
  h.className = "";
  void h.offsetWidth; // restart the little animation
  h.className = "fresh";
  h.innerHTML = `<span>${esc(item.text)}</span>`;
}

function render() {
  const st = S.st;
  if (!S.info || !st) return;
  $("#home").hidden = true;
  $("#game").hidden = false;

  // Each room plays one game. Show its name at the top so nobody is in doubt.
  const game = GAMES[st.mode] ?? GAMES.naval;
  $(".brand").innerHTML = game.html;
  document.title = game.title;
  $("#invite").textContent = `Room ${st.code} · copy link`;
  $("#tolobby").hidden = !(st.you.mayHost && st.phase !== "lobby");

  const trading = st.mode === "trade" && st.phase !== "lobby" && !!st.trade;
  const sailing = st.mode === "naval" && st.phase !== "lobby" && !!st.naval;
  document.body.classList.toggle("trade-mode", trading);
  document.body.classList.toggle("naval-mode", sailing);
  $("#tradeboard").hidden = !trading;
  $("#navalboard").hidden = !sailing;
  $("#lobbyinfo").hidden = trading || sailing;
  const api = { st: () => S.st, info: () => S.info, send, esc, hex, now, toast, country };

  if (trading) {
    S.rightKey = "";
    leaveNaval();
    $("#phase").textContent = st.trade.over ? "The market has closed" : "The market is open";
    headline(st.trade.news.at(-1));
    return renderTrade(api);
  }
  if (sailing) {
    S.rightKey = "";
    leaveTrade();
    $("#phase").textContent = st.naval.over ? "The battle is over" : `Turn ${st.naval.turn + 1} · the battle is on`;
    headline(st.naval.news.at(-1));
    return renderNaval(api);
  }
  leaveTrade();
  leaveNaval();
  $("#phase").textContent = "The lobby";
  if (S.news !== "lobby") {
    S.news = "lobby";
    $("#headline").innerHTML = `<span>Waiting for everyone to arrive.</span>`;
  }
  renderLeft();
  renderLobbyInfo();
  renderRight();
}

function renderLeft() {
  const st = S.st;
  const host = st.you.mayHost;
  const naval = st.mode === "naval";
  let html = `<h3>${naval ? "Captains" : "Players"} (${st.players.length}/${st.maxPlayers})</h3>`;
  for (const p of st.players) {
    const c = country(p.country);
    const tags = (p.id === st.you.id ? `<span class="tag solid">you</span>` : "") + (p.id === st.hostId ? `<span class="tag">host</span>` : "");
    const x = host && p.id !== st.you.id ? `<button class="x" data-remove="${p.id}" title="Remove" aria-label="Remove ${esc(p.name)}">×</button>` : "<span></span>";
    html += `<div class="party"><span class="swatch" style="background:${hex(p.color)}"></span><span class="name"><span class="n">${naval ? `${c.flag} ${esc(c.name)}` : esc(p.name)}</span>${tags}</span>${x}<span class="meta">${naval ? esc(p.name) + " · " : ""}${p.connected ? "ready" : "away"}</span></div>`;
  }
  const el = $("#left");
  el.innerHTML = html;
  el.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = () => send({ type: "remove", id: b.dataset.remove })));
}

function renderLobbyInfo() {
  const st = S.st;
  const link = location.origin + "/?room=" + st.code;
  $("#lobbyinfo").innerHTML = `<div class="t-banner"><h2>${GAMES[st.mode].html}</h2><p>${
    st.mode === "naval" ? "A hidden-ships battle for two to eight captains." : "A live trading game for three to five countries."
  }</p></div>
  <p class="lobby-link">Send your friends this link, or the room code <b>${st.code}</b>:<br><span class="num">${esc(link)}</span></p>`;
}

function renderRight() {
  const st = S.st;
  const el = $("#right");
  const key = [st.mode, st.you.mayHost, JSON.stringify(st.settings), st.players.map((p) => p.id + p.color + p.name + p.country).join("|")].join("~");
  if (key === S.rightKey) return;
  S.rightKey = key;
  const typing = document.activeElement?.id === "pname" ? document.activeElement.value : null;
  const scroll = el.scrollTop;
  el.innerHTML = lobbyPanel();
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
  const others = st.players.filter((p) => p.id !== mine.id);
  const takenColor = new Set(others.map((p) => p.color));
  const takenCountry = new Set(others.map((p) => p.country));
  const host = st.you.mayHost;
  const naval = st.mode === "naval";
  return `
    <h3>${naval ? "Your ship" : "Your country"}</h3>
    <div class="field"><label for="pname">${naval ? "Your name" : "Country name"}</label><input id="pname" maxlength="28" value="${esc(mine.name)}" /></div>
    ${
      naval
        ? `<div class="field"><label>Your country</label><div class="countries">${S.info.countries
            .map((c) => `<button data-country="${c.id}" aria-pressed="${mine.country === c.id}" ${takenCountry.has(c.id) ? "disabled" : ""}><span class="flag">${c.flag}</span> ${esc(c.name)}</button>`)
            .join("")}</div></div>`
        : ""
    }
    <div class="field"><label>${naval ? "Ship colour" : "Colour"}</label><div class="swatches">${S.info.colors
      .map((c) => `<button data-color="${c.id}" style="background:${c.hex}" aria-label="${c.id}" aria-pressed="${mine.color === c.id}" ${takenColor.has(c.id) ? "disabled" : ""}></button>`)
      .join("")}</div></div>
    ${naval ? navalLobby(host) : tradeLobby(host)}`;
}

function startButton(host, ready, need) {
  return host
    ? `<button class="btn big wide" id="start" ${ready ? "" : "disabled"}>Start the game</button>${ready ? "" : `<p class="hint">You need at least ${need} players. Send your friends the link.</p>`}`
    : `<p class="hint">Waiting for the host to start the game.</p>`;
}

function navalLobby(host) {
  const st = S.st;
  const r = S.info.navalRules;
  const auto = st.players.length <= 3 ? 18 : st.players.length <= 5 ? 22 : 26;
  const size = st.settings.navalSize || 0;
  const storm = st.settings.navalStorm !== false;
  return `
    <h3>Game settings</h3>
    <div class="field"><label for="nsize">Size of the map</label><select id="nsize" ${host ? "" : "disabled"}><option value="0" ${size ? "" : "selected"}>Automatic: ${auto} by ${auto} for ${st.players.length} ${st.players.length === 1 ? "player" : "players"}</option>${r.sizes.map((v) => `<option value="${v}" ${v === size ? "selected" : ""}>${v} by ${v}</option>`).join("")}</select></div>
    <div class="field"><label for="nstorm">The storm</label><select id="nstorm" ${host ? "" : "disabled"}><option value="1" ${storm ? "selected" : ""}>On: the edges close in from turn ${r.stormStart}</option><option value="0" ${storm ? "" : "selected"}>Off: the game lasts until one ship is left</option></select></div>
    ${startButton(host, st.players.length >= r.minPlayers, r.minPlayers)}
    <h3>How to play</h3>
    <ol class="plain-list">
      <li>You command one ship, three squares long, on a big map. You can see your own ship and nothing else.</li>
      <li>Every ${r.turnMs / 1000} seconds you get ${r.apPerTurn} action points (you can hold ${r.apMax}). Spend them whenever you like.</li>
      <li><b>Sail</b> one square forwards or backwards along your ship's length (${r.cost.move} point). <b>Turn</b> to switch between upright and sideways (${r.cost.turn} point).</li>
      <li><b>Radar</b> (${r.cost.ping} points) shows whatever parts of other ships are within reach, as they are at that moment. Those ships are told someone has seen them.</li>
      <li><b>Fire</b> (${r.cost.fire} points) at any square within reach. You are told if you hit. ${r.hull} hits sink a ship.</li>
      <li>Guns and radar start by reaching only ${r.rangeStart} squares from your ship. <b>Increase range</b> (${r.cost.range} points) adds a square to both, up to ${r.fireRange} for guns and ${r.radarRange} for radar.</li>
      <li><b>Alliances:</b> two captains can agree to be allies for a number of turns. Allies see each other's ships. That is all: nothing stops an ally from firing on you. Either can break it at any time.</li>
      ${storm ? "<li>After a while a storm closes in from the edges, so stay away from them.</li>" : ""}
      <li>The last ship afloat wins.</li>
    </ol>`;
}

function tradeLobby(host) {
  const st = S.st;
  const r = S.info.tradeRules;
  return `
    <h3>Game settings</h3>
    <div class="field"><label for="tlen">Length of the game</label><select id="tlen" ${host ? "" : "disabled"}>${r.lengths.map((v) => `<option value="${v}" ${v === (st.settings.tradeSec ?? r.defaultLength) ? "selected" : ""}>${v / 60} minutes</option>`).join("")}</select></div>
    <div class="field"><label for="topen">Can you see what other countries hold?</label><select id="topen" ${host ? "" : "disabled"}><option value="1" ${st.settings.tradeOpen === false ? "" : "selected"}>Yes: everyone's holdings are visible</option><option value="0" ${st.settings.tradeOpen === false ? "selected" : ""}>No: you only know what others tell you</option></select></div>
    <div class="field"><label for="tret">Lent buildings</label><select id="tret" ${host ? "" : "disabled"}><option value="1" ${st.settings.tradeAutoReturn === false ? "" : "selected"}>Come back by themselves when the loan ends</option><option value="0" ${st.settings.tradeAutoReturn === false ? "selected" : ""}>Only come back if the borrower returns them</option></select></div>
    ${startButton(host, st.players.length >= r.minPlayers, r.minPlayers)}
    <h3>How to play</h3>
    <ol class="plain-list">
      <li>Every player is one country. Each country starts with different things. Look at what you have, and at what the others have.</li>
      <li>Turn raw materials (timber, ore, wool, grain, coal) into goods. You need a workshop, plus the right building for each product.</li>
      <li>Sell goods to the market. It is not a player: it always buys, at its own prices, usually ${r.batch} at a time and now and then 3 or 1.</li>
      <li>Trade anything with anyone. A safe swap happens all at once. Sending is a gift, so a promise to send something back is only a promise.</li>
      <li>Buy shares on the stock exchange. Every minute they pay out part of their price: over a whole game, about twice what a share cost. But prices can crash, and a company in trouble stops paying. Each company has only ${r.shareSupply} shares, so once they are gone you must trade for them.</li>
      <li>Things will happen, and no two games are the same: prices move, workers strike, raiders gather, droughts and booms hit the whole world, and good or bad luck can strike any one country. Some news is for your eyes only.</li>
      <li>It all runs live against one clock. When the market closes, the country that has grown the most wins.</li>
    </ol>`;
}

function wireRight(el) {
  const name = el.querySelector("#pname");
  if (name)
    name.onchange = () => {
      store.set("cc:name", name.value.trim());
      send({ type: "profile", name: name.value });
    };
  el.querySelectorAll("[data-color]").forEach((b) => (b.onclick = () => send({ type: "profile", color: b.dataset.color })));
  el.querySelectorAll("[data-country]").forEach((b) => (b.onclick = () => send({ type: "profile", country: b.dataset.country })));
  const on = (id, fn) => el.querySelector(id) && (el.querySelector(id).onchange = fn);
  on("#topen", (e) => send({ type: "settings", tradeOpen: e.target.value === "1" }));
  on("#tret", (e) => send({ type: "settings", tradeAutoReturn: e.target.value === "1" }));
  on("#nsize", (e) => send({ type: "settings", navalSize: Number(e.target.value) }));
  on("#nstorm", (e) => send({ type: "settings", navalStorm: e.target.value === "1" }));
  on("#tlen", (e) => send({ type: "settings", tradeSec: Number(e.target.value) }));
  if (el.querySelector("#start")) el.querySelector("#start").onclick = () => send({ type: "start" });
}

// ------------------------------------------------------------------ the clock

function tick() {
  const st = S.st;
  if (!st || !S.info) return;
  const clock = $("#clock");
  let end = null;
  if (st.phase === "trading" && st.trade && !st.trade.over) end = st.trade.endsAt;
  if (st.phase === "battle" && st.naval && !st.naval.over) end = st.naval.nextTurn;
  if (st.trade) tickTrade();
  if (st.naval) tickNaval();
  if (end) {
    const left = Math.max(0, Math.ceil((end - now()) / 1000));
    clock.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    clock.classList.toggle("low", st.phase === "trading" && left <= 30);
  } else {
    clock.textContent = "";
    clock.classList.remove("low");
  }
}

boot();
