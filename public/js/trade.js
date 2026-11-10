// Trade and Treachery, browser side. The page skeleton is built once when the game starts;
// after that only the changing parts are redrawn, so typing in the chat or filling in an
// offer is never interrupted by other players' moves.

let api = null; // helpers lent by app.js
let built = false;
const T = () => api.st().trade;
const el = (id) => document.getElementById(id);
const name = (id) => api.st().players.find((p) => p.id === id)?.name ?? "?";
const color = (id) => api.hex(api.st().players.find((p) => p.id === id)?.color);
const ORDER = ["gold", "timber", "ore", "wool", "amber", "planks", "cloth", "tools", "furniture", "machinery", "workshop", "sawmill", "forge", "loom"];
const list = (inv) => !inv ? "hidden" : ORDER.filter((k) => inv[k] > 0).map((k) => `${T().names[k]} ${inv[k]}`).join(" · ") || "nothing";
const words = (inv) => ORDER.filter((k) => inv[k] > 0).map((k) => `${inv[k]} ${k === "gold" ? "gold" : T().names[k].toLowerCase()}`).join(", ") || "nothing";

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
  const st = api.st();
  const t = T();
  const others = st.players.filter((p) => p.id !== st.you.id);
  const who = (first) => `<option value="">${first}</option>` + others.map((p) => `<option value="${p.id}">${api.esc(p.name)}</option>`).join("");
  const itemOptions = `<option value="">nothing</option>` + ORDER.map((k) => `<option value="${k}">${t.names[k]}</option>`).join("");
  const row = (id) => `<div class="t-row"><input id="${id}-n" type="number" min="1" value="1" aria-label="How many" /><select id="${id}-k" aria-label="What">${itemOptions}</select></div>`;

  el("left").innerHTML = `<h3>Countries</h3><div id="t-countries"></div>
    <h3>How it works</h3>
    <p class="small muted">Turn raw materials into goods and sell them to the market in batches of ${t.rules.batch}. You need a workshop, plus the right building for each product. Everything can be traded: materials, gold, goods, even buildings. A <b>safe swap</b> happens all at once. <b>Sending</b> is a gift: if someone promises to send something back, that is only a promise. Whoever grows their country the most wins.</p>
    <p class="small muted">${t.open ? "Everyone can see what every country holds." : "<b>Holdings are hidden.</b> You only know what others tell you, and they may not be telling the truth."} ${t.autoReturn ? "A lent building comes back by itself when the loan ends." : "<b>A lent building only comes back if the borrower returns it.</b>"}</p>`;

  el("tradeboard").innerHTML = `
    <div id="t-alert"></div>
    <h3>Your country</h3><div id="t-inv" class="t-inv"></div>
    <h3>Make goods</h3><div id="t-make"></div><div id="t-jobs"></div>
    <h3>The market</h3><div id="t-market"></div>
    <h3>News <span class="muted">(newest first)</span></h3><ol id="t-news" class="t-scroll"></ol>`;

  el("right").innerHTML = `
    <h3>Offers on the table</h3><div id="t-offers"></div>
    <h3>Propose a safe swap</h3>
    <div class="field"><label for="t-to">To</label><select id="t-to">${who("Anyone who accepts first")}</select></div>
    <div class="field"><label>I give</label>${row("t-g1")}${row("t-g2")}</div>
    <div class="field"><label>I want</label>${row("t-w1")}${row("t-w2")}</div>
    <button class="btn wide" id="t-offer">Put this offer on the table</button>
    <h3>Send something <span class="muted">(no guarantee)</span></h3>
    <p class="small muted">A straight gift. Use it for aid, loans, or deals made on trust.</p>
    <div class="field"><select id="t-send-to" aria-label="Send to">${others.map((p) => `<option value="${p.id}">to ${api.esc(p.name)}</option>`).join("")}</select></div>
    ${row("t-s1")}
    <button class="btn ghost wide" id="t-send">Send it</button>
    <h3>Lend a building</h3>
    <p class="small muted">${t.autoReturn ? "It comes back by itself when the time is up." : "Getting it back depends on the borrower keeping their word."}</p>
    <div class="t-row"><select id="t-lend-min" aria-label="For how long">${[1, 2, 3, 5].map((m) => `<option value="${m}">${m} min</option>`).join("")}</select><select id="t-lend-b" aria-label="Building">${["workshop", "sawmill", "forge", "loom"].map((b) => `<option value="${b}">${t.names[b]}</option>`).join("")}</select></div>
    <div class="field"><select id="t-lend-to" aria-label="Lend to">${others.map((p) => `<option value="${p.id}">to ${api.esc(p.name)}</option>`).join("")}</select></div>
    <button class="btn ghost wide" id="t-lend">Lend it</button>
    <div id="t-loans"></div>
    <h3>Talk</h3>
    <div id="t-chat" class="t-scroll"></div>
    <div class="t-say"><select id="t-chat-to" aria-label="Say to">${who("Everyone")}</select><input id="t-chat-text" maxlength="200" placeholder="Make a deal…" aria-label="Message" /></div>`;

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

  el("t-countries").innerHTML = st.players
    .map((p) => `<div class="party"><span class="swatch" style="background:${api.hex(p.color)}"></span><span class="name"><span class="n">${esc(p.name)}</span>${p.id === meId ? `<span class="tag solid">you</span>` : ""}${!p.connected ? `<span class="tag">away</span>` : ""}</span><span></span><span class="meta">${list(p.id === meId ? myInv() : t.holdings[p.id])}</span></div>`)
    .join("");

  let alert = "";
  if (t.me.aid === "offered")
    alert += `<div class="locked-note"><b>Aid offer.</b> The market's bankers will give you a workshop and a sawmill for free. In return they keep ${t.rules.aidShare * 100}% of everything you sell to the market for the rest of the game.<div class="t-buttons"><button class="btn small" data-t="aid" data-accept="1">Accept the aid</button><button class="btn ghost small" data-t="aid" data-accept="0">Turn it down</button></div></div>`;
  if (t.me.aid === "accepted") alert += `<p class="hint">You accepted aid: the bankers keep ${t.rules.aidShare * 100}% of your market sales.</p>`;
  if (t.tariff) alert += `<p class="hint"><b>Tariff in force:</b> the market pays ${t.rules.tariffCut * 100}% less for goods from countries that started without industry.</p>`;
  el("t-alert").innerHTML = alert;

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
  el("t-offers").innerHTML = offers || `<p class="small muted">No offers yet. Make one below, or talk first.</p>`;

  el("t-loans").innerHTML = t.loans
    .map((l) => `<p class="hint">${l.from === meId ? `You lent a ${l.building} to ${esc(name(l.to))}` : `You hold a ${l.building} lent by ${esc(name(l.from))}`}, due ${api.now() >= l.due ? "now" : "in " + Math.ceil((l.due - api.now()) / 60000) + " min"}.${l.to === meId && !t.autoReturn ? ` <button class="btn ghost small" data-t="giveback" data-to="${l.from}" data-b="${l.building}">Give it back</button>` : ""}</p>`)
    .join("");

  // Chat (keep the view pinned to the newest message unless the reader has scrolled up)
  const chat = el("t-chat");
  const pinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 30;
  chat.innerHTML =
    t.chat.map((c) => `<p><i class="dot" style="background:${color(c.from)}"></i><b>${esc(name(c.from))}</b>${c.to ? ` <span class="tag">${c.to === meId ? "to you" : "to " + esc(name(c.to))}</span>` : ""} ${esc(c.text)}</p>`).join("") ||
    `<p class="small muted">Nobody has said anything yet.</p>`;
  if (pinned) chat.scrollTop = chat.scrollHeight;

  el("t-news").innerHTML = t.news
    .slice()
    .reverse()
    .map((n) => `<li class="${n.to ? "private" : ""}">${n.to ? `<span class="tag solid">for your eyes only</span> ` : ""}${esc(n.text)}</li>`)
    .join("");

  tickTrade();
}

/** Redrawn several times a second: anything that depends on the clock or on finished production. */
export function tickTrade() {
  if (!built || !api || !T() || T().over) return;
  const t = T();
  const inv = myInv();
  const striking = t.me.strikeUntil > api.now();
  const busy = t.me.jobs.filter((j) => j.made < j.count && api.now() < j.startedAt + j.count * j.per).length;

  el("t-inv").innerHTML = ORDER.map((k) => `<span class="${inv[k] > 0 ? "" : "zero"}"><b>${inv[k] ?? 0}</b> ${t.names[k]}</span>`).join("");

  const key = JSON.stringify([inv, t.prices, striking, busy, t.me.knowsAmber, t.tariff]);
  if (key !== tickTrade.key) {
    tickTrade.key = key;
    const keep = el("t-amber")?.checked;
    let make = "";
    for (const [good, r] of Object.entries(t.recipes)) {
      const missing = ["workshop", ...r.needs].filter((b) => !(inv[b] > 0));
      const can = Math.min(...Object.entries(r.uses).map(([k, n]) => Math.floor((inv[k] ?? 0) / n)));
      const why = missing.length ? `you are missing: ${missing.join(" and ")}` : striking ? "workers on strike" : busy >= (inv.workshop ?? 0) ? "workshops busy" : can < 1 ? "no raw materials" : "";
      // Always show everything the product needs, so the list reads the same for every player.
      const needs = ["workshop", ...r.needs].map((b) => (inv[b] > 0 ? b : `<s>${b}</s>`)).join(" + ");
      const btn = (n, label) => `<button class="btn small" data-t="make" data-good="${good}" data-n="${n}" ${why || can < n ? "disabled" : ""}>${label}</button>`;
      make += `<div class="t-line"><div><b>${t.names[good]}</b> <span class="muted">from ${words(r.uses)} · sells for ${t.prices[good]}</span><br><span class="small">Needs: ${needs}</span>${why ? ` <span class="small why">(${why})</span>` : ""}</div><span class="t-buttons">${btn(1, "Make 1")}${btn(5, "Make 5")}</span></div>`;
    }
    el("t-make").innerHTML = make;

    let market = "";
    const goods = Object.keys(t.recipes).filter((g) => inv[g] > 0);
    for (const g of goods)
      market += `<div class="t-line"><div><b>${inv[g]} ${t.names[g]}</b></div><button class="btn small" data-t="sell" data-good="${g}" ${inv[g] >= t.rules.batch ? "" : "disabled"}>Sell ${t.rules.batch} for ${t.prices[g] * t.rules.batch}</button></div>`;
    if (!goods.length) market += `<p class="small muted">You have no goods to sell yet. The market buys goods in batches of ${t.rules.batch}.</p>`;
    if (inv.amber > 0 && goods.length) market += `<label class="t-check"><input type="checkbox" id="t-amber" ${keep ? "checked" : ""}/> Set 1 amber into the next batch ${t.me.knowsAmber ? `<b>(sells for ${t.rules.amberMultiplier} times the price)</b>` : `<span class="muted">(nobody has told you what this does)</span>`}</label>`;
    market += `<div class="t-line"><div class="small">Sell raw materials to the market for only ${t.rules.rawFloor} gold each</div><span class="t-buttons">${["timber", "ore", "wool"].map((k) => `<button class="btn ghost small" data-t="raw" data-item="${k}" ${inv[k] > 0 ? "" : "disabled"}>1 ${k}</button>`).join("")}</span></div>`;
    market += `<div class="t-line"><div class="small">Build industry</div><span class="t-buttons">${Object.entries(t.rules.buildingPrice).map(([b, price]) => `<button class="btn ghost small" data-t="buy" data-building="${b}" ${(inv.gold ?? 0) >= price ? "" : "disabled"}>${t.names[b]} ${price}</button>`).join("")}</span></div>`;
    el("t-market").innerHTML = market;
  }

  el("t-jobs").innerHTML =
    (striking ? `<p class="hint"><b>Strike!</b> Your workshops are standing still for another ${Math.ceil((t.me.strikeUntil - api.now()) / 1000)} seconds.</p>` : "") +
    t.me.jobs
      .map((j) => {
        const done = Math.min(1, Math.max(0, (api.now() - j.startedAt) / (j.count * j.per)));
        return done < 1 ? `<div class="t-job"><span>Making ${j.count} ${t.names[j.good].toLowerCase()}</span><span class="bar"><i style="width:${Math.round(done * 100)}%"></i></span></div>` : "";
      })
      .join("");
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
  const startKind = { A: "Industry and money, hardly any raw materials", B: "Plenty of raw materials, no industry", C: "A little of everything, no industry" };
  const rows = r.rows.slice().sort((a, b) => b.growth - a.growth);
  el("left").innerHTML = `<h3>Countries</h3>` + st.players.map((p) => `<div class="party"><span class="swatch" style="background:${api.hex(p.color)}"></span><span class="name"><span class="n">${esc(p.name)}</span></span><span></span><span class="meta">${list(t.holdings[p.id])}</span></div>`).join("");
  el("tradeboard").innerHTML = `
    <div class="t-banner"><h2>${esc(name(r.winner))} wins</h2><p>Their country grew the most from where it started.${r.richest !== r.winner ? ` The richest country at the end was ${esc(name(r.richest))}.` : " It also ended up the richest."}</p></div>
    <h3>Where everyone started, and where they ended</h3>
    <table class="grid"><tr><th>Country</th><th>Started with</th><th>Worth at start</th><th>Worth at end</th><th>Growth</th></tr>
    ${rows.map((x) => `<tr><td><i class="key" style="background:${color(x.id)}"></i> ${esc(name(x.id))}${x.id === st.you.id ? ` <span class="tag solid">you</span>` : ""}</td><td style="text-align:left"><b>${startKind[x.tier]}</b><br><span class="small muted">${list(x.start)}</span></td><td class="num">${x.startWealth}</td><td class="num">${x.wealth}</td><td class="num ${x.id === r.winner ? "top" : ""}">× ${x.growth.toFixed(2)}</td></tr>`).join("")}</table>
    <p class="small muted">Worth counts gold, goods at their usual price, raw materials at the market's low price, and buildings at cost. Nobody was told the starts were unequal.</p>
    <h3>What happened</h3>
    <p>${r.swaps} safe ${r.swaps === 1 ? "swap" : "swaps"} and ${r.gifts} ${r.gifts === 1 ? "thing" : "things"} sent on trust.
    ${rawLine(r, t)}</p>
    ${r.loans.length ? `<p><b>Loans:</b> ${r.loans.map((l) => `${esc(name(l.from))} lent a ${l.building} to ${esc(name(l.to))}, and it ${l.status === "returned" ? "came back" : "<b>never came back</b>"}`).join("; ")}.</p>` : ""}
    <p class="small muted">${t.open ? "Holdings were visible to everyone." : "Holdings were hidden during the game."} ${t.autoReturn ? "Lent buildings came back by themselves." : "Lent buildings only came back if the borrower returned them."}</p>
    <h3>Worth talking about</h3>
    <ol class="plain-list">
      <li>Was it fair? Who could make goods from the first second, and who could not?</li>
      <li>Who really set the price of raw materials: the countries selling them, or the country buying?</li>
      <li>Did anyone break a promise, or keep quiet about what something was worth?</li>
      <li>Much of world trade works like this. What would have made the game fairer, and would the richest player have agreed to it?</li>
    </ol>
    <h3>Every deal, in order</h3>
    <ol class="t-scroll" id="t-news">${r.deals.map((d) => `<li>${d.kind === "swap" ? `${esc(name(d.from))} gave ${words(d.give)} to ${esc(name(d.to))} for ${words(d.want)}` : `${esc(name(d.from))} sent ${words(d.give)} to ${esc(name(d.to))} on trust`}</li>`).join("") || "<li>No deals were made.</li>"}</ol>`;
  el("right").innerHTML = `<h3>The conversation</h3><div class="t-scroll tall">${t.chat.map((c) => `<p><i class="dot" style="background:${color(c.from)}"></i><b>${esc(name(c.from))}</b> ${esc(c.text)}</p>`).join("") || `<p class="small muted">Nothing was said.</p>`}</div>
    ${st.you.mayHost ? `<div class="stack"><button class="btn wide" id="t-again">Back to the lobby</button></div>` : `<p class="hint">Waiting for the host.</p>`}
    <p class="small muted" style="margin-top:14px">Trade and Treachery is inspired by Christian Aid's Trading Game.</p>`;
  if (el("t-again")) el("t-again").onclick = () => api.send({ type: "newGame" });
}
