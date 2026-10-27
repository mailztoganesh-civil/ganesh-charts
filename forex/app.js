/* Forex CRT – screener for Candle Range Theory setups on forex pairs.
 * Data: data/crt.json, written every 30 minutes by .github/workflows/forex_crt.yml
 * (scripts/forex_crt.py). This file only reads and draws it.
 */
(() => {
"use strict";
const TFS = ["1H", "4H", "D", "W"];
const TF_NAME = { "1H": "1H", "4H": "4H", D: "Daily", W: "Weekly" };
const ORDER = { formed: 0, forming: 1, sweeping: 2, anticipated: 3, done: 4, failed: 5, none: 6 };
const SETUP = ["formed", "forming", "sweeping", "anticipated"];
const $ = s => document.querySelector(s);
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
             set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

let data = null, tf = ls.get("fx-tf", "4H"), st = ls.get("fx-st", "all"), dir = 0, detail = null;

/* ---------- formatting ---------- */
const digits = p => p.pip >= 0.1 ? 2 : p.pip >= 0.01 ? 3 : 5;
const fmt = (p, v) => v == null ? "–" : Number(v).toFixed(digits(p));
const pips = (p, a, b) => Math.abs(a - b) / p.pip;
function left(ms) {
  if (ms == null) return "–";
  let s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function endOf(r, t) {
  if (r.end) return r.end;
  const c = r.candles && r.candles[r.candles.length - 1];
  return c ? c[0] * 1000 + (t === "W" ? 5 : 1) * 86400000 : null;
}
function label(r, short) {
  const up = r.dir === 1, a = up ? "▲" : "▼";
  switch (r.status) {
    case "formed": return `${a} Formed`;
    case "forming": return short ? `${a} Forming` : `${a} C2 forming`;
    case "sweeping": return short ? `${a} Sweep` : up ? "▲ Sweeping low" : "▼ Sweeping high";
    case "anticipated": return short ? `${a} Near` : up ? "▲ Near low" : "▼ Near high";
    case "done": return short ? "hit" : "✓ Target hit";
    case "failed": return short ? "fail" : "✕ Failed";
    default: return "–";
  }
}
const cls = r => `s-${r.status} ${r.dir === 1 ? "up" : r.dir === -1 ? "dn" : ""}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- load ---------- */
async function load(force) {
  try {
    const res = await fetch(`data/crt.json?t=${force ? Date.now() : Math.floor(Date.now() / 60000)}`, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
    $("#nearTxt").textContent = Math.round((data.near || .25) * 100) + "%";
    render();
  } catch (e) {
    $("#upd").textContent = data ? "Offline – showing last scan" : "Couldn’t load the scan. Pull to refresh later.";
  }
}
function ago() {
  if (!data) return;
  const m = Math.round((Date.now() - Date.parse(data.updated)) / 60000);
  $("#upd").innerHTML = `Scanned ${m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.floor(m / 60) + "h " + (m % 60) + "m ago"}<br>${new Date(data.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/* ---------- render ---------- */
function render() {
  if (!data) return;
  ago();
  document.querySelectorAll("#tfSeg button").forEach(b => b.classList.toggle("on", b.dataset.tf === tf));
  const rows = data.pairs.map(p => ({ p, r: p.tf[tf] })).filter(x => x.r);
  // chips with counts
  const count = s => rows.filter(x => (s === "all" ? SETUP.includes(x.r.status) : x.r.status === s) && (dir === 0 || x.r.dir === dir)).length;
  const chips = [["all", "All setups"], ["formed", "Formed"], ["forming", "Forming"], ["sweeping", "Sweeping"], ["anticipated", "Anticipated"]];
  $("#stChips").innerHTML = chips.map(([k, n]) => `<button class="chip${st === k ? " on" : ""}" data-st="${k}">${n}<b>${count(k)}</b></button>`).join("");
  // list
  const show = rows.filter(x => (st === "all" ? SETUP.includes(x.r.status) : x.r.status === st) && (dir === 0 || x.r.dir === dir))
    .sort((a, b) => ORDER[a.r.status] - ORDER[b.r.status] || a.p.sym.localeCompare(b.p.sym));
  $("#list").innerHTML = show.length ? show.map(x => card(x.p, x.r)).join("")
    : `<div class="card empty">No ${st === "all" ? "" : st + " "}setups on ${TF_NAME[tf]} right now.</div>`;
  // matrix
  $("#mx").innerHTML = `<thead><tr><th>Pair</th>${TFS.map(t => `<th>${TF_NAME[t]}</th>`).join("")}</tr></thead><tbody>` +
    data.pairs.map(p => `<tr><td>${esc(p.sym)}</td>${TFS.map(t => {
      const r = p.tf[t]; if (!r) return "<td></td>";
      return `<td><button class="dot ${cls(r)}" data-sym="${esc(p.sym)}" data-tf="${t}">${label(r, true)}</button></td>`;
    }).join("")}</tr>`).join("") + "</tbody>";
  if (detail) drawDetail();
}
function card(p, r) {
  const d = [];
  const side = r.dir === 1 ? "low" : "high", opp = r.dir === 1 ? "high" : "low";
  if (r.status === "formed") {
    d.push(`Target C1 ${opp} <b>${fmt(p, r.t2)}</b> (${Math.abs(r.toT2)} pips)`);
    d.push(`Mid <b>${fmt(p, r.t1)}</b>${r.hit1 ? " ✓" : ""}`);
    d.push(`Invalid ${r.dir === 1 ? "below" : "above"} <b>${fmt(p, r.inv)}</b>`);
    if (r.rr != null) d.push(`R:R from here <b>${r.rr}</b>`);
    if (r.also) d.push(`<span class="muted">current candle ${r.also === "forming" ? "is forming a new C2" : "is sweeping"}</span>`);
  } else if (r.status === "forming") {
    d.push(`Swept previous ${side} <b>${fmt(p, r.level)}</b>, back inside`);
    d.push(`Target <b>${fmt(p, r.t2)}</b>`);
    d.push(`Closes in <b>${left(endOf(r, tf))}</b>`);
  } else if (r.status === "sweeping") {
    d.push(`${pips(p, r.price, r.level).toFixed(1)} pips beyond previous ${side} <b>${fmt(p, r.level)}</b>`);
    d.push(`Needs to close back inside · closes in <b>${left(endOf(r, tf))}</b>`);
  } else if (r.status === "anticipated") {
    d.push(`<b>${r.dist}</b> pips from previous ${side} <b>${fmt(p, r.level)}</b>`);
    d.push(`Closes in <b>${left(endOf(r, tf))}</b>`);
  } else if (r.status === "done" || r.status === "failed") {
    d.push(r.status === "done" ? `Reached target ${fmt(p, r.t2)}` : `Went beyond the sweep ${fmt(p, r.inv)}`);
  }
  return `<button class="row" data-sym="${esc(p.sym)}" data-tf="${tf}" style="text-align:left;font:inherit;color:inherit">
    <div class="top"><span class="pair">${esc(p.sym)}</span><span class="badge ${cls(r)}">${label(r)}</span><span class="px">${fmt(p, r.price)}</span></div>
    <div class="det">${d.map(x => `<span>${x}</span>`).join("")}</div></button>`;
}

/* ---------- detail sheet + chart ---------- */
function openDetail(sym, t) { detail = { sym, tf: t }; $("#sheet").hidden = false; drawDetail(); }
function closeDetail() { detail = null; $("#sheet").hidden = true; }
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function drawDetail() {
  const p = data.pairs.find(x => x.sym === detail.sym); if (!p) return closeDetail();
  const r = p.tf[detail.tf]; if (!r) return;
  $("#dTitle").textContent = `${p.sym} · ${TF_NAME[detail.tf]}`;
  const b = $("#dBadge"); b.textContent = label(r); b.className = "badge " + cls(r);
  document.querySelectorAll("#dTf button").forEach(x => x.classList.toggle("on", x.dataset.tf === detail.tf));
  // levels
  const L = [["Price", fmt(p, r.price)]];
  if (r.c1h != null) L.push(["C1 high", fmt(p, r.c1h)], ["C1 low", fmt(p, r.c1l)]);
  if (r.t1 != null) L.push(["Mid (T1)", fmt(p, r.t1) + (r.hit1 ? " ✓" : "")]);
  if (r.t2 != null) L.push(["Target (T2)", fmt(p, r.t2)]);
  if (r.inv != null) L.push(["Invalid", fmt(p, r.inv)]);
  if (r.t2 != null) L.push(["Pips to T2", pips(p, r.price, r.t2).toFixed(1)]);
  if (r.rr != null) L.push(["R:R from here", r.rr]);
  L.push(["Candle closes in", left(endOf(r, detail.tf))]);
  $("#dLv").innerHTML = L.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join("");
  $("#dNote").textContent = `Prices from Yahoo Finance (${p.src}). Scanned ${new Date(data.updated).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}.`;
  chart(p, r);
}
function chart(p, r) {
  const cv = $("#cv"), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const C = { ink: css("--ink"), sec: css("--sec"), line: css("--line"), up: css("--green"), dn: css("--red"), blue: css("--blue"), amber: css("--amber"), tint: css("--tint") };
  const all = r.candles || []; const n = Math.min(all.length, W < 500 ? 36 : 56); const cs = all.slice(-n);
  if (cs.length < 3) return;
  const padR = 64, padB = 22, padT = 10, plotW = W - padR - 6, plotH = H - padB - padT;
  const lv = [r.t1, r.t2, r.inv, r.level, r.c1h, r.c1l].filter(v => v != null);
  let hi = Math.max(...cs.map(c => c[2]), ...lv), lo = Math.min(...cs.map(c => c[3]), ...lv);
  const padY = (hi - lo) * 0.06 || hi * 0.001; hi += padY; lo -= padY;
  const step = plotW / (cs.length + 5), bw = Math.max(2, step * 0.62);
  const X = i => 6 + step * (i + 0.5), Y = v => padT + (hi - v) / (hi - lo) * plotH;
  // grid + price labels
  g.font = "11px -apple-system,Segoe UI,Roboto,sans-serif"; g.fillStyle = C.sec; g.strokeStyle = C.line; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); g.beginPath(); g.moveTo(0, y); g.lineTo(plotW + 6, y); g.stroke(); g.fillText(fmt(p, v), plotW + 10, y + 4); }
  // which candles are C1/C2/C3
  const last = cs.length - 1;
  const map = r.status === "formed" || r.status === "done" || r.status === "failed" ? { C1: last - 2, C2: last - 1, C3: last } :
              (r.status === "forming" || r.status === "sweeping") ? { C1: last - 1, C2: last } :
              r.status === "anticipated" ? { C1: last - 1 } : {};
  if (map.C1 != null && r.c1h != null) {           // C1 range box
    g.fillStyle = C.tint; g.globalAlpha = .9;
    g.fillRect(X(map.C1) - step / 2, Y(r.c1h), plotW + 6 - (X(map.C1) - step / 2), Y(r.c1l) - Y(r.c1h)); g.globalAlpha = 1;
  }
  // candles
  cs.forEach((c, i) => {
    const up = c[4] >= c[1]; g.strokeStyle = g.fillStyle = up ? C.up : C.dn;
    g.beginPath(); g.moveTo(X(i), Y(c[2])); g.lineTo(X(i), Y(c[3])); g.stroke();
    const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4]));
    g.fillRect(X(i) - bw / 2, y1, bw, Math.max(1, y2 - y1));
  });
  // levels
  const tags = [];
  const hline = (v, col, txt, dash) => { if (v == null) return; const y = Y(v); g.save(); g.strokeStyle = col; g.setLineDash(dash ? [5, 4] : []); g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(X(map.C1 ?? last) - step / 2, y); g.lineTo(plotW + 6, y); g.stroke(); g.restore(); tags.push([y, col, txt]); };
  if (r.t2 != null) hline(r.t2, C.blue, "T2");
  if (r.t1 != null) hline(r.t1, C.sec, "Mid", true);
  if (r.inv != null) hline(r.inv, C.dn, "Inv", true);
  if (r.level != null && r.status !== "formed") hline(r.level, C.amber, r.dir === 1 ? "Low" : "High", true);
  // C labels
  g.font = "bold 12px -apple-system,Segoe UI,Roboto,sans-serif"; g.fillStyle = C.ink; g.textAlign = "center";
  Object.entries(map).forEach(([k, i]) => { if (i >= 0) { const c = cs[i]; const below = r.dir === 1; g.fillText(k, X(i), below ? Math.min(H - padB - 2, Y(c[3]) + 15) : Math.max(12, Y(c[2]) - 6)); } });
  // time labels
  g.font = "10px -apple-system,Segoe UI,Roboto,sans-serif"; g.fillStyle = C.sec;
  const every = Math.ceil(cs.length / 4);
  cs.forEach((c, i) => { if (i % every === 1 || every === 1) { const d = new Date(c[0] * 1000);
    const t = detail.tf === "1H" || detail.tf === "4H" ? d.toLocaleString([], { day: "2-digit", month: "short" }) + " " + String(d.getHours()).padStart(2, "0") + "h" : d.toLocaleDateString([], { day: "2-digit", month: "short" });
    g.fillText(t, X(i), H - 6); } });
  g.textAlign = "left";
  // price marker + level tags on the price axis (spread so they never overlap)
  tags.push([Y(r.price), C.blue, fmt(p, r.price), true]);
  tags.sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < tags.length; k++) if (tags[k][0] - tags[k - 1][0] < 17) tags[k][0] = tags[k - 1][0] + 17;
  g.font = "bold 11px -apple-system,Segoe UI,Roboto,sans-serif";
  tags.forEach(([y, col, txt, isPx]) => { g.fillStyle = col; g.fillRect(plotW + 6, y - 8, padR, 16); g.fillStyle = "#fff"; g.fillText(isPx ? txt : txt, plotW + 10, y + 4); });
}

/* ---------- events ---------- */
$("#tfSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; tf = b.dataset.tf; ls.set("fx-tf", tf); render(); });
$("#stChips").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; st = b.dataset.st; ls.set("fx-st", st); render(); });
$("#dirChips").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; dir = +b.dataset.dir;
  document.querySelectorAll("#dirChips .chip").forEach(x => x.classList.toggle("on", x === b)); render(); });
document.addEventListener("click", e => { const b = e.target.closest("[data-sym]"); if (b && !b.closest("#sheet")) openDetail(b.dataset.sym, b.dataset.tf); });
$("#dTf").addEventListener("click", e => { const b = e.target.closest("button"); if (!b || !detail) return; detail.tf = b.dataset.tf; drawDetail(); });
$("#dClose").onclick = closeDetail;
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeDetail(); });
$("#refresh").onclick = () => load(true);
addEventListener("resize", () => { if (detail) drawDetail(); });
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (detail) drawDetail(); }); } catch (e) {}
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
setInterval(ago, 30000);
setInterval(() => load(), 5 * 60000);
setInterval(() => { if (data) render(); }, 60000);   // countdowns
load();
})();
