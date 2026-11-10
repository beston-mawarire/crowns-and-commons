// Trade and Treachery, browser side. The page skeleton is built once when the game starts;
// after that only the changing parts are redrawn, so typing in the chat or filling in an
// offer is never interrupted by other players' moves.

let api = null; // helpers lent by app.js
let built = false;
const T = () => api.st().trade;
const el = (id) => document.getElementById(id);
const name = (id) => api.st().players.find((p) => p.id === id)?.name ?? "?";
const color = (id) => api.hex(api.st().players.find((p) => p.id === id)?.color);
const RAWLIST = ["timber", "ore", "wool", "grain", "coal"];
const ORDER = ["gold", ...RAWLIST, "amber", "planks", "cloth", "tools", "food", "electricity", "furniture", "machinery", "workshop", "sawmill", "forge", "loom", "mill", "power", "garrison", "share_wood", "share_metal", "share_farm", "share_energy"];
const low = (k) => T().names[k].toLowerCase();

/** The same sum the server uses: gold, goods at usual prices, raw materials at the floor, buildings at cost, shares at today's price. */
function worthOf(inv) {
  const t = T();
  let total = inv.gold ?? 0;
  for (const [g, r] of Object.entries(t.recipes)) total += (inv[g] ?? 0) * r.price;
  for (const r of [...RAWLIST, "amber"]) total += (inv[r] ?? 0) * t.rules.rawFloor;
  for (const [b, price] of Object.entries(t.rules.buildingPrice)) total += (inv[b] ?? 0) * price;
  for (const [id, st] of Object.entries(t.stocks)) total += (inv["share_" + id] ?? 0) * st.price;
  return Math.round(total);
}

/** A tiny line chart of worth over time. */
function spark(values, w = 120, h = 26) {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
}
const list = (inv) => !inv ? "hidden" : ORDER.filter((k) => inv[k] > 0).map((k) => `${T().names[k]} ${inv[k]}`).join(" · ") || "nothing";
const words = (inv) => ORDER.filter((k) => inv[k] > 0).map((k) => `${inv[k]} ${low(k)}`).join(", ") || "nothing";

/** Only touch the page when something has changed, so a click is never lost to a redraw. */
const drawn = {};
function setHTML(id, html) {
  const node = el(id);
  if (!node || (drawn[id] === html && node.dataset.drawn)) return;
  drawn[id] = html;
  node.dataset.drawn = "1";
  node.innerHTML = html;
}
const signed = (n) => (n > 0 ? `<span class="up">+${n.toLocaleString()}</span>` : n < 0 ? `<span class="down">−${Math.abs(n).toLocaleString()}</span>` : `<span class="muted">0</span>`);
const arrow = (now, was) => (now > was ? `<span class="up">▲</span>` : now < was ? `<span class="down">▼</span>` : `<span class="muted">•</span>`);

/** What a country's worth is made of, in the same five piles the results use. */
const PILES = [["gold", "Gold"], ["raws", "Raw materials"], ["goods", "Goods"], ["buildings", "Buildings"], ["shares", "Shares"]];
const GROUPS = { raws: [...RAWLIST, "amber"], goods: ["planks", "cloth", "tools", "food", "electricity", "furniture", "machinery"], buildings: ["workshop", "sawmill", "forge", "loom", "mill", "power", "garrison"], shares: ["share_wood", "share_metal", "share_farm", "share_energy"] };
function pilesOf(inv) {
  const t = T();
  const sum = (keys, price) => keys.reduce((a, k) => a + (inv[k] ?? 0) * price(k), 0);
  return {
    gold: inv.gold ?? 0,
    raws: sum(GROUPS.raws, () => t.rules.rawFloor),
    goods: sum(GROUPS.goods, (g) => t.recipes[g].price),
    buildings: sum(GROUPS.buildings, (b) => t.rules.buildingPrice[b]),
    shares: sum(GROUPS.shares, (k) => t.stocks[k.slice(6)].price),
  };
}
/** A bar split into the five piles. `scale` is the worth that would fill the whole width. */
function pileBar(piles, scale) {
  const total = PILES.reduce((a, [k]) => a + piles[k], 0) || 1;
  return `<div class="t-bar" style="width:${Math.max(4, Math.round((total / (scale || total)) * 100))}%">${PILES.map(([k, label]) => (piles[k] > 0 ? `<i class="k-${k}" style="flex:${piles[k]}" title="${label}: ${Math.round(piles[k]).toLocaleString()}"></i>` : "")).join("")}</div>`;
}
const pileKey = (piles) => `<div class="t-key">${PILES.map(([k, label]) => `<span><i class="k-${k}"></i>${label} <b>${Math.round(piles[k]).toLocaleString()}</b></span>`).join("")}</div>`;

/** Where a change in worth came from. Making and selling are shown together. */
const CAUSES = [
  ["goods", "Making and selling goods"],
  ["deals", "Deals, gifts and loans"],
  ["dividends", "Share payouts"],
  ["shares", "Share prices moving"],
  ["events", "Events (finds, raids, aid, disasters)"],
];
const causes = (l) => ({ ...l, goods: (l.made ?? 0) + (l.market ?? 0) });

/** My holdings including goods that have finished since the server last spoke. */
function myInv() {
  const st = api.st();
  const inv = { ...T().holdings[st.you.id] };
  for (const j of T().me?.jobs ?? []) {
    const due = Math.min(j.count, Math.max(j.made, Math.floor((Math.min(api.now(), T().endsAt) - j.startedAt) / j.per)));
    inv[j.good] = (inv[j.good] ?? 0) + due - j.made;
  }
  return inv;
}

/** Every section can be folded away by clicking its heading; the choice is remembered on this device. */
const folded = new Set((() => { try { return JSON.parse(localStorage.getItem("tt:folded") || "[]"); } catch { return []; } })());
function foldable(root) {
  for (const card of root.querySelectorAll(".t-card[data-sec]")) {
    const h = card.querySelector(":scope > h3");
    if (!h || h.dataset.fold) continue;
    h.dataset.fold = "1";
    h.tabIndex = 0;
    h.setAttribute("role", "button");
    const set = () => {
      const min = folded.has(card.dataset.sec);
      card.classList.toggle("min", min);
      h.setAttribute("aria-expanded", String(!min));
    };
    const flip = (e) => {
      if (e.target.closest("button, a, input, select")) return;
      folded.has(card.dataset.sec) ? folded.delete(card.dataset.sec) : folded.add(card.dataset.sec);
      try { localStorage.setItem("tt:folded", JSON.stringify([...folded])); } catch { /* private mode */ }
      set();
    };
    h.addEventListener("click", flip);
    h.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), flip(e)));
    set();
  }
}

export function leaveTrade() {
  built = false;
}

export function renderTrade(helpers) {
  api = helpers;
  if (T().over) {
    built = false;
    return drawResult();
  }
  if (!built) build();
  update();
}

// ---------------------------------------------------------------- skeleton

function build() {
  built = true;
  for (const k of Object.keys(drawn)) delete drawn[k];
  const st = api.st();
  const t = T();
  const others = st.players.filter((p) => p.id !== st.you.id);
  const who = (first) => `<option value="">${first}</option>` + others.map((p) => `<option value="${p.id}">${api.esc(p.name)}</option>`).join("");
  const itemOptions = `<option value="">nothing</option>` + ORDER.map((k) => `<option value="${k}">${t.names[k]}</option>`).join("");
  const row = (id) => `<div class="t-row"><input id="${id}-n" type="number" min="1" value="1" aria-label="How many" /><select id="${id}-k" aria-label="What">${itemOptions}</select></div>`;

  el("left").innerHTML = `<h3>Countries</h3><div id="t-countries"></div>
    <h3>How it works</h3>
    <ul class="t-how">
      <li><b class="w-make">Make</b> goods from raw materials. You need a workshop and the right building.</li>
      <li><b class="w-market">Sell</b> goods to the market. It usually buys five at a time.</li>
      <li><b class="w-deals">Deal</b> with other countries. A safe swap happens all at once. Sending is a gift, and a promise is only a promise.</li>
      <li><b class="w-stocks">Shares</b> pay out ${Math.round(t.rules.dividend * 100)}% of their price every minute. Each company has only ${t.rules.shareSupply}, so they are worth fighting over. Prices follow the news.</li>
      <li>The country that <b>grows the most</b> wins.</li>
    </ul>
    <p class="small muted">${t.open ? "Everyone can see what every country holds." : "<b>Holdings are hidden.</b> You only know what others tell you, and they may not be telling the truth."} ${t.autoReturn ? "A lent building comes back by itself when the loan ends." : "<b>A lent building only comes back if the borrower returns it.</b>"}</p>`;

  el("tradeboard").innerHTML = `
    <div id="t-alert"></div>
    <div class="t-two">
      <section class="t-card c-country" data-sec="worth"><h3>Your country</h3><div id="t-worth"></div></section>
      <section class="t-card c-people" data-sec="pay"><h3>Payday <span id="t-pay-in"></span></h3><div id="t-pay"></div></section>
    </div>
    <section class="t-card c-stocks" data-sec="stocks"><h3>The stock exchange</h3><p class="small muted">Every payday each share pays out <b>${Math.round(t.rules.dividend * 100)}% of its price</b>. Each company has only ${t.rules.shareSupply} shares: every one bought makes the next dearer, every one sold makes it cheaper. Once they are all owned, buy them from other countries.</p><div id="t-stocks"></div></section>
    <section class="t-card c-country" data-sec="hold"><h3>What you hold</h3><div id="t-inv"></div></section>
    <section class="t-card c-make" data-sec="make"><h3>Make goods</h3><div id="t-jobs"></div><div id="t-make"></div></section>
    <section class="t-card c-market" data-sec="market"><h3>The market</h3><div id="t-market"></div></section>
    <section class="t-card c-build" data-sec="build"><h3>Build</h3><div id="t-build"></div></section>
    <section class="t-card c-news" data-sec="news"><h3>News <span class="muted">(newest first)</span></h3><ol id="t-news" class="t-scroll"></ol></section>`;

  el("right").innerHTML = `
    <section class="t-card c-deals" data-sec="offers"><h3>Offers on the table</h3><div id="t-offers"></div></section>
    <section class="t-card c-talk" data-sec="talk"><h3>Talk</h3>
    <div id="t-chat" class="t-scroll"></div>
    <div class="t-say"><select id="t-chat-to" aria-label="Say to">${who("Everyone")}</select><input id="t-chat-text" maxlength="200" placeholder="Make a deal…" aria-label="Message" /></div></section>
    <section class="t-card c-deals" data-sec="swap"><h3>Propose a safe swap</h3>
    <div class="field"><label for="t-to">To</label><select id="t-to">${who("Anyone who accepts first")}</select></div>
    <div class="field"><label>I give</label>${row("t-g1")}${row("t-g2")}</div>
    <div class="field"><label>I want</label>${row("t-w1")}${row("t-w2")}</div>
    <button class="btn wide" id="t-offer">Put this offer on the table</button></section>
    <section class="t-card c-deals" data-sec="send"><h3>Send something <span class="muted">(no guarantee)</span></h3>
    <p class="small muted">A straight gift. Use it for aid, loans, or deals made on trust.</p>
    <div class="field"><select id="t-send-to" aria-label="Send to">${others.map((p) => `<option value="${p.id}">to ${api.esc(p.name)}</option>`).join("")}</select></div>
    ${row("t-s1")}
    <button class="btn ghost wide" id="t-send">Send it</button>
    <h3>Lend a building</h3>
    <p class="small muted">${t.autoReturn ? "It comes back by itself when the time is up." : "Getting it back depends on the borrower keeping their word."}</p>
    <div class="t-row"><select id="t-lend-min" aria-label="For how long">${[1, 2, 3, 5].map((m) => `<option value="${m}">${m} min</option>`).join("")}</select><select id="t-lend-b" aria-label="Building">${Object.keys(t.rules.buildingPrice).map((b) => `<option value="${b}">${t.names[b]}</option>`).join("")}</select></div>
    <div class="field"><select id="t-lend-to" aria-label="Lend to">${others.map((p) => `<option value="${p.id}">to ${api.esc(p.name)}</option>`).join("")}</select></div>
    <button class="btn ghost wide" id="t-lend">Lend it</button>
    <div id="t-loans"></div></section>`;

  foldable(el("tradeboard"));
  foldable(el("right"));
  const read = (id) => {
    const k = el(id + "-k").value;
    const n = Math.floor(Number(el(id + "-n").value));
    return k && n > 0 ? { [k]: n } : {};
  };
  el("t-offer").onclick = () => api.send({ type: "t.offer", to: el("t-to").value || null, give: { ...read("t-g1"), ...read("t-g2") }, want: { ...read("t-w1"), ...read("t-w2") } });
  el("t-lend").onclick = () => api.send({ type: "t.lend", to: el("t-lend-to").value, building: el("t-lend-b").value, minutes: Number(el("t-lend-min").value) });
  el("t-send").onclick = () => api.send({ type: "t.send", to: el("t-send-to").value, give: read("t-s1") });
  el("t-chat-text").onkeydown = (e) => {
    if (e.key !== "Enter" || !e.target.value.trim()) return;
    api.send({ type: "t.chat", to: el("t-chat-to").value || null, text: e.target.value });
    e.target.value = "";
  };
  // One listener for every button that is redrawn.
  for (const id of ["tradeboard", "right"])
    el(id).addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]");
      if (!b || b.disabled) return;
      const d = b.dataset;
      if (d.t === "make") api.send({ type: "t.make", good: d.good, count: Number(d.n) });
      if (d.t === "sell") api.send({ type: "t.sell", good: d.good, amber: el("t-amber")?.checked });
      if (d.t === "raw") api.send({ type: "t.sellRaw", item: d.item, n: 1 });
      if (d.t === "buy") api.send({ type: "t.buy", building: d.building });
      if (d.t === "stock") api.send({ type: "t.stock", id: d.id, n: Number(d.n) });
      if (d.t === "aid") api.send({ type: "t.aid", accept: d.accept === "1" });
      if (d.t === "accept") api.send({ type: "t.accept", id: Number(d.id) });
      if (d.t === "cancel") api.send({ type: "t.cancel", id: Number(d.id) });
      if (d.t === "giveback") api.send({ type: "t.send", to: d.to, give: { [d.b]: 1 } });
    });
}

// ---------------------------------------------------------------- the parts that change

function update() {
  const st = api.st();
  const t = T();
  const esc = api.esc;
  const meId = st.you.id;

  setHTML(
    "t-countries",
    st.players
      .map((p) => `<div class="party"><span class="swatch" style="background:${api.hex(p.color)}"></span><span class="name"><span class="n">${esc(p.name)}</span>${p.id === meId ? `<span class="tag solid">you</span>` : ""}${!p.connected ? `<span class="tag">away</span>` : ""}</span><span></span><span class="meta">${list(p.id === meId ? myInv() : t.holdings[p.id])}</span></div>`)
      .join(""),
  );

  let alert = "";
  if (t.me.aid === "offered")
    alert += `<div class="locked-note"><b>Aid offer.</b> The market's bankers will give you a workshop and a mill for free. In return they keep ${t.rules.aidShare * 100}% of everything you sell to the market for the rest of the game.<div class="t-buttons"><button class="btn small" data-t="aid" data-accept="1">Accept the aid</button><button class="btn ghost small" data-t="aid" data-accept="0">Turn it down</button></div></div>`;
  if (t.me.aid === "accepted") alert += `<p class="t-flag bad">You accepted aid: the bankers keep ${t.rules.aidShare * 100}% of your market sales.</p>`;
  if (t.tariff) alert += `<p class="t-flag bad"><b>Tariff in force:</b> the market pays ${t.rules.tariffCut * 100}% less for goods from countries that started without a workshop.</p>`;
  if (t.fair) alert += `<p class="t-flag good"><b>Trade fair:</b> the market is paying ${t.rules.fairBonus * 100}% more for all goods. Sell now.</p>`;
  setHTML("t-alert", alert);

  // Offers
  const offers = t.offers
    .map((o) => {
      const mine = o.from === meId;
      const whoTo = o.to ? (o.to === meId ? "you" : esc(name(o.to))) : "anyone";
      return `<div class="t-offer"><i class="dot" style="background:${color(o.from)}"></i><div><b>${mine ? "You" : esc(name(o.from))}</b> ${mine ? "offer" : "offers"} ${whoTo}: <b>${words(o.give)}</b> for <b>${words(o.want)}</b></div>${
        mine ? `<button class="btn ghost small" data-t="cancel" data-id="${o.id}">Withdraw</button>` : `<span class="t-buttons"><button class="btn small" data-t="accept" data-id="${o.id}">Accept</button>${o.to === meId ? `<button class="btn ghost small" data-t="cancel" data-id="${o.id}">No</button>` : ""}</span>`
      }</div>`;
    })
    .join("");
  setHTML("t-offers", offers || `<p class="small muted">No offers yet. Make one below, or talk first.</p>`);

  setHTML(
    "t-loans",
    t.loans
      .map((l) => `<p class="hint">${l.from === meId ? `You lent a ${l.building} to ${esc(name(l.to))}` : `You hold a ${l.building} lent by ${esc(name(l.from))}`}, due ${api.now() >= l.due ? "now" : "in " + Math.ceil((l.due - api.now()) / 60000) + " min"}.${l.to === meId && !t.autoReturn ? ` <button class="btn ghost small" data-t="giveback" data-to="${l.from}" data-b="${l.building}">Give it back</button>` : ""}</p>`)
      .join(""),
  );

  // Chat (keep the view pinned to the newest message unless the reader has scrolled up)
  const chat = el("t-chat");
  const pinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 30;
  setHTML(
    "t-chat",
    t.chat.map((c) => `<p><i class="dot" style="background:${color(c.from)}"></i><b>${esc(name(c.from))}</b>${c.to ? ` <span class="tag">${c.to === meId ? "to you" : "to " + esc(name(c.to))}</span>` : ""} ${esc(c.text)}</p>`).join("") || `<p class="small muted">Nobody has said anything yet.</p>`,
  );
  if (pinned) chat.scrollTop = chat.scrollHeight;

  const label = { world: "world news", pay: "payday", market: "market" };
  setHTML(
    "t-news",
    t.news
      .slice()
      .reverse()
      .map((n) => `<li class="${n.to ? "private" : ""} ${n.kind ? "n-" + n.kind : ""}">${n.kind ? `<span class="tag solid">${label[n.kind]}</span> ` : n.to ? `<span class="tag solid">for your eyes only</span> ` : ""}${esc(n.text)}</li>`)
      .join(""),
  );

  tickTrade();
}

/** Redrawn several times a second: anything that depends on the clock or on finished production. */
export function tickTrade() {
  if (!built || !api || !T() || T().over) return;
  const t = T();
  const R = t.rules;
  const inv = myInv();
  const gold = inv.gold ?? 0;
  const striking = t.me.strikeUntil > api.now();
  const busy = t.me.jobs.filter((j) => j.made < j.count && api.now() < j.startedAt + j.count * j.per).length;

  // ---- worth
  const worth = worthOf(inv);
  const pct = Math.round((worth / t.me.startWorth - 1) * 100);
  const piles = pilesOf(inv);
  const led = causes(t.me.ledger);
  const ledOpen = el("t-led")?.open;
  setHTML(
    "t-worth",
    `<div class="t-worth"><div><b class="big">${worth.toLocaleString()}</b><br><span class="${pct >= 0 ? "up" : "down"}">${pct > 0 ? "▲ +" : pct < 0 ? "▼ −" : "• "}${Math.abs(pct)}%</span> <span class="small muted">since the start (${t.me.startWorth.toLocaleString()})</span></div>${spark([...t.me.history, worth])}</div>
    ${pileBar(piles)}${pileKey(piles)}
    <details id="t-led" ${ledOpen ? "open" : ""}><summary class="small">Where your growth has come from</summary>${CAUSES.map(([k, text]) => `<div class="t-led"><span>${text}</span><span class="num">${signed(led[k] ?? 0)}</span></div>`).join("")}</details>`,
  );

  // ---- payday and borders
  const payouts = Object.entries(t.stocks).map(([id, st]) => [id, (inv["share_" + id] ?? 0) * Math.round(st.price * R.dividend)]).filter(([, n]) => n > 0);
  const payTotal = payouts.reduce((a, [, n]) => a + n, 0);
  const guarded = (inv.garrison ?? 0) > 0;
  setHTML("t-pay-in", `in ${Math.max(0, Math.ceil((t.nextPay - api.now()) / 1000))}s`);
  setHTML(
    "t-pay",
    (payouts.length
      ? payouts.map(([id, n]) => `<div class="t-led"><span><i class="sq s-${id}"></i>${t.stockNames[id]} <span class="muted">${inv["share_" + id]} × ${Math.round(t.stocks[id].price * R.dividend)}</span></span><span class="num">${signed(n)}</span></div>`).join("")
      : `<p class="small muted">You own no shares, so payday brings you nothing. Buy some on the stock exchange, or trade for them.</p>`) +
      `<div class="t-led total"><span>Next payday</span><span class="num">${signed(payTotal)} gold</span></div>
    <p class="small">${guarded ? `<span class="up">Border guarded.</span> Raiders will pass you by.` : `<span class="down">Border not guarded.</span> Raiders can get in.`}</p>
    ${guarded ? "" : `<div class="t-buttons left"><button class="btn small" data-t="buy" data-building="garrison" ${gold >= R.buildingPrice.garrison ? "" : "disabled"}>Build a border guard · ${R.buildingPrice.garrison} gold</button></div>`}`,
  );

  // ---- holdings, in groups
  const chips = (keys) => keys.filter((k) => inv[k] > 0).map((k) => `<span><b>${inv[k]}</b> ${t.names[k]}</span>`).join("");
  setHTML(
    "t-inv",
    `<div class="t-group k-gold"><label>Gold</label><div class="t-inv"><span><b>${gold}</b> Gold</span></div></div>` +
      PILES.slice(1)
        .map(([k, text]) => `<div class="t-group k-${k}"><label>${text}</label><div class="t-inv">${chips(GROUPS[k]) || `<em class="muted small">none</em>`}</div></div>`)
        .join(""),
  );

  // ---- make
  const usual = (g) => t.recipes[g].price;
  const priceOf = (g) => `${t.prices[g]}${t.prices[g] !== usual(g) ? ` ${arrow(t.prices[g], usual(g))}` : ""}`;
  let ready = "";
  let later = "";
  for (const [good, r] of Object.entries(t.recipes)) {
    const missing = ["workshop", ...r.needs].filter((b) => !(inv[b] > 0)).map(low);
    const can = Math.min(...Object.entries(r.uses).map(([k, n]) => Math.floor((inv[k] ?? 0) / n)));
    const why = missing.length ? `missing: ${missing.join(", ")}` : striking ? "workers on strike" : busy >= (inv.workshop ?? 0) ? "workshops busy" : can < 1 ? "not enough materials" : "";
    const needs = ["workshop", ...r.needs].map((b) => (inv[b] > 0 ? low(b) : `<s>${low(b)}</s>`)).join(" + ");
    const btn = (n, text) => `<button class="btn small" data-t="make" data-good="${good}" data-n="${n}" ${why || can < n ? "disabled" : ""}>${text}</button>`;
    const line = `<div class="t-line"><div><b>${t.names[good]}</b> <span class="muted">from ${words(r.uses)} · sells for</span> <b class="num">${priceOf(good)}</b><br><span class="small">Needs: ${needs}</span>${why ? ` <span class="small down">(${why})</span>` : ""}</div><span class="t-buttons">${btn(1, "Make 1")}${btn(5, "Make 5")}</span></div>`;
    if (missing.length) later += line;
    else ready += line;
  }
  const moreOpen = el("t-more") ? el("t-more").open : !ready;
  setHTML("t-make", (ready || `<p class="small muted">You cannot make anything yet. You need a workshop and the right building: build, borrow or bargain for them.</p>`) + (later ? `<details id="t-more" ${moreOpen ? "open" : ""}><summary class="small">Things you cannot make yet (${later.split("t-line").length - 1})</summary>${later}</details>` : ""));

  setHTML(
    "t-jobs",
    (striking ? `<p class="t-flag bad"><b>Strike!</b> Your workshops are standing still for another ${Math.ceil((t.me.strikeUntil - api.now()) / 1000)} seconds.</p>` : "") +
      t.me.jobs
        .map((j) => {
          const done = Math.min(1, Math.max(0, (api.now() - j.startedAt) / (j.count * j.per)));
          return done < 1 ? `<div class="t-job"><span>Making ${j.count} ${t.names[j.good].toLowerCase()}</span><span class="bar"><i style="width:${Math.round(done * 20) * 5}%"></i></span></div>` : "";
        })
        .join(""),
  );

  // ---- market
  const keep = el("t-amber")?.checked;
  let market = "";
  const goods = Object.keys(t.recipes).filter((g) => inv[g] > 0);
  for (const g of goods) {
    const size = t.batch[g];
    market += `<div class="t-line"><div><b>${inv[g]} ${t.names[g]}</b> <span class="muted">at</span> <b class="num">${priceOf(g)}</b> <span class="muted">each</span>${size !== R.batch ? ` <span class="tag solid t-odd">market wants ${size} at a time</span>` : ""}</div><button class="btn small" data-t="sell" data-good="${g}" ${inv[g] >= size ? "" : "disabled"}>Sell ${size} for ${Math.round(t.prices[g] * size * (t.fair ? 1 + R.fairBonus : 1))}</button></div>`;
  }
  if (!goods.length) market += `<p class="small muted">You have no goods to sell yet. The market usually buys ${R.batch} at a time, and now and then 3 or 1.</p>`;
  if (inv.amber > 0 && goods.length) market += `<label class="t-check"><input type="checkbox" id="t-amber" ${keep ? "checked" : ""}/> Set 1 amber into the next sale ${t.me.knowsAmber ? `<b>(sells for ${R.amberMultiplier} times the price)</b>` : `<span class="muted">(nobody has told you what this does)</span>`}</label>`;
  market += `<div class="t-line"><div class="small">Sell raw materials for only ${R.rawFloor} gold each</div><span class="t-buttons">${RAWLIST.filter((k) => inv[k] > 0).map((k) => `<button class="btn ghost small" data-t="raw" data-item="${k}">1 ${k}</button>`).join("") || `<span class="small muted">none to sell</span>`}</span></div>`;
  setHTML("t-market", market);

  setHTML(
    "t-build",
    `<div class="t-buttons left">${Object.entries(R.buildingPrice)
      .filter(([b]) => b !== "garrison")
      .map(([b, price]) => `<button class="btn ghost small" data-t="buy" data-building="${b}" ${gold >= price ? "" : "disabled"}>${t.names[b]} · ${price}</button>`)
      .join("")}</div><p class="small muted">A workshop makes one thing at a time. Each other building lets your workshops make new products.</p>`,
  );

  // ---- stock exchange
  const follows = { wood: "timber, planks, furniture", metal: "ore, tools, machinery", farm: "wool, cloth, grain, food", energy: "coal, electricity" };
  /** What n shares would cost (n > 0) or fetch (n < 0), as each one moves the price. */
  const cost = (price, n) => {
    let total = 0;
    for (let i = 0; i < Math.abs(n); i++) {
      total += price;
      price = Math.max(10, Math.round(price * (n > 0 ? 1 + R.shareImpact : 1 - R.shareImpact)));
    }
    return total;
  };
  setHTML(
    "t-stocks",
    Object.entries(t.stocks)
      .map(([id, st]) => {
        const own = inv["share_" + id] ?? 0;
        const change = Math.round((st.price / st.prev - 1) * 100);
        const trend = st.price >= st.hist[0] ? "up" : "down";
        const b = (n, text, ok, cls = "ghost") => `<button class="btn ${cls} small" data-t="stock" data-id="${id}" data-n="${n}" ${ok ? "" : "disabled"} title="${n > 0 ? "Costs" : "Fetches"} ${cost(st.price, n)} gold">${text}</button>`;
        const buy5 = Math.min(5, st.left);
        return `<div class="t-stock s-${id}"><div class="who"><b>${t.stockNames[id]}</b><br><span class="small muted">${follows[id]}</span><br><span class="small ${st.left ? "" : "down"}">${st.left ? `${st.left} of ${R.shareSupply} for sale` : "all owned"}</span></div>
          <div class="px"><b class="num">${st.price}</b> <span class="${change >= 0 ? "up" : "down"}">${change > 0 ? "▲ +" : change < 0 ? "▼ −" : "• "}${Math.abs(change)}%</span><br><span class="small">pays <b>${Math.round(st.price * R.dividend)}</b> a share</span><br><span class="${trend}">${spark(st.hist.length > 1 ? st.hist : [st.price, st.price], 90, 20)}</span></div>
          <div class="own small">${own ? `You own <b>${own}</b><br>worth ${(own * st.price).toLocaleString()}<br>pays <b>${own * Math.round(st.price * R.dividend)}</b> each payday` : `<span class="muted">You own none</span>`}</div>
          <span class="t-buttons">${b(1, `Buy 1 · ${st.price}`, st.left >= 1 && gold >= st.price, "")}${buy5 > 1 ? b(buy5, `Buy ${buy5} · ${cost(st.price, buy5)}`, gold >= cost(st.price, buy5), "") : ""}${b(-1, "Sell 1", own >= 1)}${own > 1 ? b(-own, `Sell all · ${cost(st.price, -own)}`, true) : ""}</span></div>`;
      })
      .join(""),
  );
}

// ---------------------------------------------------------------- when the market closes

/** How the price of raw materials moved between the two halves of the game. */
function rawLine(r, t) {
  const each = (n) => `<b>${n} gold each</b>`;
  const floor = ` The market itself only ever paid ${t.rules.rawFloor}.`;
  if (r.rawEarly !== null && r.rawLate !== null) return `Raw materials changed hands for about ${each(r.rawEarly)} in the first half and ${each(r.rawLate)} in the second.` + floor;
  if (r.rawEarly !== null) return `Raw materials changed hands for about ${each(r.rawEarly)} in the first half, and none were sold for gold after that.` + floor;
  if (r.rawLate !== null) return `Nobody sold raw materials for gold until the second half, when they went for about ${each(r.rawLate)}.` + floor;
  return "Nobody sold raw materials for gold in a safe swap.";
}

function drawResult() {
  const st = api.st();
  const t = T();
  const r = t.result;
  const esc = api.esc;
  const startKind = { A: "Workshops, industry and money, hardly any raw materials", B: "Plenty of raw materials, no workshop", C: "A little raw material, no workshop" };
  const rows = r.rows.slice().sort((a, b) => b.growth - a.growth);
  const who = (x) => `<i class="key" style="background:${color(x.id)}"></i> ${esc(name(x.id))}${x.id === st.you.id ? ` <span class="tag solid">you</span>` : ""}`;
  const top = Math.max(...rows.map((x) => Math.max(x.wealth, x.startWealth)));
  const short = { goods: "Goods", deals: "Deals", dividends: "Share payouts", shares: "Share prices", events: "Events" };
  /** One sentence on what made and what cost each country the most. */
  const story = (x) => {
    const l = causes(x.ledger);
    const sorted = CAUSES.map(([k, text]) => [text, l[k] ?? 0]).sort((a, b) => b[1] - a[1]);
    const best = sorted[0];
    const worst = sorted.at(-1);
    return `${best[1] > 0 ? `Gained most from <b>${best[0].toLowerCase()}</b> (${signed(best[1])}).` : "Gained from nothing."} ${worst[1] < 0 ? `Lost most to <b>${worst[0].toLowerCase()}</b> (${signed(worst[1])}).` : ""}`;
  };
  el("left").innerHTML = `<h3>Countries</h3>` + st.players.map((p) => `<div class="party"><span class="swatch" style="background:${api.hex(p.color)}"></span><span class="name"><span class="n">${esc(p.name)}</span></span><span></span><span class="meta">${list(t.holdings[p.id])}</span></div>`).join("");
  el("tradeboard").innerHTML = `
    <div class="t-banner"><h2>${esc(name(r.winner))} wins</h2><p>Their country grew the most from where it started.${r.richest !== r.winner ? ` The richest country at the end was ${esc(name(r.richest))}.` : " It also ended up the richest."}</p></div>
    <section class="t-card c-country" data-sec="r-start"><h3>Where everyone started, and where they ended</h3>
    <table class="grid"><tr><th>Country</th><th>Started with</th><th>Worth at start</th><th>Worth at end</th><th>Growth</th></tr>
    ${rows.map((x) => `<tr><td>${who(x)}</td><td style="text-align:left"><b>${startKind[x.tier]}</b><br><span class="small muted">${list(x.start)}</span></td><td class="num">${x.startWealth.toLocaleString()}</td><td class="num">${x.wealth.toLocaleString()}<br>${spark(x.history, 80, 22)}</td><td class="num ${x.id === r.winner ? "top" : ""}">× ${x.growth.toFixed(2)}<br>${signed(x.wealth - x.startWealth)}</td></tr>`).join("")}</table>
    <p class="small muted">The small lines show each country's worth at every payday. Nobody was told the starts were unequal.</p></section>

    <section class="t-card c-make" data-sec="r-causes"><h3>Where each country's growth came from</h3>
    <div class="t-wide"><table class="grid t-causes"><tr><th>Country</th>${CAUSES.map(([k]) => `<th>${short[k]}</th>`).join("")}<th>Total</th></tr>
    ${rows.map((x) => { const l = causes(x.ledger); return `<tr><td>${who(x)}</td>${CAUSES.map(([k]) => `<td class="num">${signed(l[k] ?? 0)}</td>`).join("")}<td class="num top">${signed(x.wealth - x.startWealth)}</td></tr>`; }).join("")}</table></div>
    ${rows.map((x) => `<p class="small">${who(x)}: ${story(x)}</p>`).join("")}
    <p class="small muted"><b>Goods</b>: what making and selling added. <b>Deals</b>: swaps, gifts and loans with other countries, counted at what the things were worth. <b>Share payouts</b>: gold paid out every payday. <b>Share prices</b>: shares rising or falling in value. <b>Events</b>: finds, raids, aid and disasters.</p></section>

    <section class="t-card c-stocks" data-sec="r-made"><h3>What each country's worth is made of</h3>
    ${rows.map((x) => `<div class="t-made"><div>${who(x)}</div><div><span class="small muted">Start · ${x.startWealth.toLocaleString()}</span>${pileBar(x.partsStart, top)}<span class="small muted">End · ${x.wealth.toLocaleString()}</span>${pileBar(x.partsEnd, top)}${pileKey(x.partsEnd)}</div></div>`).join("")}
    <p class="small muted">Worth counts gold, goods at their usual price, raw materials at the market's low price, buildings at cost and shares at their final price.</p></section>

    <section class="t-card c-deals" data-sec="r-happened"><h3>What happened</h3>
    <p>${r.swaps} safe ${r.swaps === 1 ? "swap" : "swaps"} and ${r.gifts} ${r.gifts === 1 ? "thing" : "things"} sent on trust.
    ${rawLine(r, t)}</p>
    ${r.loans.length ? `<p><b>Loans:</b> ${r.loans.map((l) => `${esc(name(l.from))} lent a ${l.building} to ${esc(name(l.to))}, and it ${l.status === "returned" ? "came back" : "<b>never came back</b>"}`).join("; ")}.</p>` : ""}
    <p class="small muted">${t.open ? "Holdings were visible to everyone." : "Holdings were hidden during the game."} ${t.autoReturn ? "Lent buildings came back by themselves." : "Lent buildings only came back if the borrower returned them."}</p>
    <h3>Every deal, in order</h3>
    <ol class="t-scroll" id="t-news">${r.deals.map((d) => `<li>${d.kind === "swap" ? `${esc(name(d.from))} gave ${words(d.give)} to ${esc(name(d.to))} for ${words(d.want)}` : `${esc(name(d.from))} sent ${words(d.give)} to ${esc(name(d.to))} on trust`}</li>`).join("") || "<li>No deals were made.</li>"}</ol></section>

    <section class="t-card c-talk" data-sec="r-talkabout"><h3>Worth talking about</h3>
    <ol class="plain-list">
      <li>Was it fair? Who could make goods from the first second, and who could not?</li>
      <li>Who really set the price of raw materials: the countries selling them, or the country buying?</li>
      <li>Did anyone break a promise, or keep quiet about what something was worth?</li>
      <li>Much of world trade works like this. What would have made the game fairer, and would the richest player have agreed to it?</li>
    </ol></section>`;
  el("right").innerHTML = `<h3>The conversation</h3><div class="t-scroll tall">${t.chat.map((c) => `<p><i class="dot" style="background:${color(c.from)}"></i><b>${esc(name(c.from))}</b> ${esc(c.text)}</p>`).join("") || `<p class="small muted">Nothing was said.</p>`}</div>
    ${st.you.mayHost ? `<div class="stack"><button class="btn wide" id="t-again">Back to the lobby</button></div>` : `<p class="hint">Waiting for the host.</p>`}
    <h3>What the news said</h3><ol class="t-scroll tall">${t.news.filter((n) => n.kind === "world" || (!n.kind && !n.to)).slice().reverse().map((n) => `<li class="${n.kind ? "n-" + n.kind : ""}">${esc(n.text)}</li>`).join("")}</ol>
    <p class="small muted" style="margin-top:14px">Trade and Treachery is inspired by Christian Aid's Trading Game.</p>`;
  foldable(el("tradeboard"));
  if (el("t-again")) el("t-again").onclick = () => api.send({ type: "newGame" });
}
