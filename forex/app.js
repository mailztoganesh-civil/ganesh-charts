/* Forex CRT – screener for Candle Range Theory setups on forex pairs.
 * Data: data/crt.json, written every 30 minutes by .github/workflows/forex_crt.yml
 * (scripts/forex_crt.py). This file only reads and draws it.
 */
(() => {
"use strict";
const TFS = ["1H", "4H", "D", "W", "M"];
const TF_NAME = { "1H": "1H", "4H": "4H", D: "Daily", W: "Weekly", M: "Monthly" };
const TF_SHORT = { "1H": "1H", "4H": "4H", D: "D", W: "W", M: "M" };
const M1_TF = { M: "Daily", W: "4H", D: "1H", "4H": "15m", "1H": "5m" };
const ORDER = { formed: 0, c3close: 1, forming: 2, sweeping: 3, anticipated: 4, done: 5, failed: 6, none: 7 };
const SETUP = ["formed", "c3close", "forming", "sweeping", "anticipated"];
const $ = s => document.querySelector(s);
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
             set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

let req = Object.assign({ c1: true, key: true, bias: false, sweep: true, reject: true, kz: false }, ls.get("fx-req", {})), showWeak = false, view = ls.get("fx-view", "single"), data = null, tf = ls.get("fx-tf", "4H"), st = ls.get("fx-st", "all"), dir = 0, detail = null;

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
  return c ? c[0] * 1000 + (t === "W" ? 5 : t === "M" ? 30.4 : 1) * 86400000 : null;
}
function label(r, short) {
  const up = r.dir === 1, a = up ? "▲" : "▼";
  switch (r.status) {
    case "formed": return short ? `${a} ${r.c2Back === 2 ? "C4" : "C3"}` : `${a} Formed${r.c2Back === 2 ? " · C4" : ""}`;
    case "c3close": return short ? `${a} C4` : `${a} C3 closure`;
    case "forming": return short ? `${a} C2` : `${a} C2 forming`;
    case "sweeping": return short ? `${a} Swp` : up ? "▲ Sweeping low" : "▼ Sweeping high";
    case "anticipated": return short ? `${a} Near` : up ? "▲ Near low" : "▼ Near high";
    case "done": return short ? "hit" : "✓ Target hit";
    case "failed": return short ? "fail" : "✕ Failed";
    default: return short ? "–" : r.code && CODE_NAME[r.code] ? "– " + CODE_NAME[r.code] : "–";
  }
}
const cls = r => `s-${r.status} ${r.dir === 1 ? "up" : r.dir === -1 ? "dn" : ""}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- load: live prices through the forex-proxy Worker, GitHub scan as backup ---------- */
const DEFAULT_LIVE = "https://forex-proxy.mailztoganesh.workers.dev";
let liveUrl = ls.get("fx-live-url", DEFAULT_LIVE), liveOn = ls.get("fx-live", true), liveOk = null, busy = false;
async function loadGithub(force) {
  const res = await fetch(`data/crt.json?t=${force ? Date.now() : Math.floor(Date.now() / 60000)}`, { cache: "no-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
async function load(force) {
  if (busy) return; busy = true;
  try {
    let d = null;
    if (liveOn && liveUrl && window.FXLive) {
      try { d = await window.FXLive.load(liveUrl); liveOk = true; } catch (e) { liveOk = false; }
    }
    if (!d) d = await loadGithub(force);
    data = d;
    $("#nearTxt").textContent = Math.round((data.near || .25) * 100) + "%";
    render(); liveStatus();
    window.FXApp = { data }; window.dispatchEvent(new CustomEvent("fxdata", { detail: data }));   // the 4H Sweep tab listens
  } catch (e) {
    $("#upd").textContent = data ? "Offline – showing last data" : "Couldn’t load prices. Try ↻ later.";
  } finally { busy = false; }
}
function ago() {
  if (!data) return;
  const t = new Date(data.updated);
  if (data.live) { $("#upd").innerHTML = `● Live${data.missing ? ` (${data.missing} missing)` : ""}<br>${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`; return; }
  const m = Math.round((Date.now() - t) / 60000);
  $("#upd").innerHTML = `GitHub scan ${m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.floor(m / 60) + "h " + (m % 60) + "m ago"}<br>${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}
function liveStatus() {
  const el = $("#liveState"); if (!el) return;
  el.textContent = !liveOn ? "Off – using the GitHub scan (can be hours late)." :
    liveOk ? "Working – prices update every minute." :
    liveOk === false ? "Not reachable – using the GitHub scan. Check the Worker is deployed at this address." : "Checking…";
  $("#liveOn").checked = liveOn; $("#liveUrl").value = liveUrl;
}

/* ---------- render ---------- */
function render() {
  if (!data) return;
  ago();
  document.querySelectorAll("#tfSeg button").forEach(b => b.classList.toggle("on", b.dataset.tf === tf));
  const rows = data.pairs.map(p => ({ p, r: p.tf[tf] })).filter(x => x.r);
  // chips with counts
  const count = s => rows.filter(x => match(x.r, s)).length;
  const chips = [["all", "All setups"], ["m1", "Model-1 ✓"], ["m1p", "Model-1 pending"], ["formed", "Formed"], ["c3close", "C3 closure"], ["forming", "Forming"], ["sweeping", "Sweeping"], ["anticipated", "Anticipated"]];
  $("#stChips").innerHTML = chips.map(([k, n]) => `<button class="chip${st === k ? " on" : ""}" data-st="${k}">${n}<b>${count(k)}</b></button>`).join("");
  // list
  const hidden = rows.filter(x => match(x.r, st, true)).length - rows.filter(x => match(x.r, st)).length;
  $("#weakNote").innerHTML = hidden > 0 ? `${hidden} setup${hidden > 1 ? "s" : ""} hidden – they don't meet your C1/C2 rules. <button class="chip" id="showWeak" type="button">Show</button>` :
    showWeak ? `Showing all setups, including weak ones. <button class="chip" id="showWeak" type="button">Hide weak</button>` : "";
  const show = rows.filter(x => match(x.r, st))
    .sort((a, b) => m1rank(a.r) - m1rank(b.r) || ORDER[a.r.status] - ORDER[b.r.status] || a.p.sym.localeCompare(b.p.sym));
  $("#list").innerHTML = show.length ? show.map(x => card(x.p, x.r)).join("")
    : `<div class="card empty">No ${st === "all" ? "" : st === "m1" ? "confirmed Model-1 " : st === "m1p" ? "pending Model-1 " : st + " "}setups on ${TF_NAME[tf]} right now.</div>`;
  // matrix
  $("#mx").innerHTML = `<thead><tr><th>Pair</th>${TFS.map(t => `<th>${TF_SHORT[t]}</th>`).join("")}</tr></thead><tbody>` +
    data.pairs.map(p => `<tr><td>${esc(p.sym)}</td>${TFS.map(t => {
      const r = p.tf[t]; if (!r) return "<td></td>";
      const m = r.m1 && !r.m1.hit ? (r.m1.confirmed ? "<br><small>M1 ✓</small>" : "<br><small>M1 …</small>") : "";
      const g = r.q && SETUP.includes(r.status) ? ` <small>${grade(r)}</small>` : "";
      return `<td><button class="dot ${cls(r)}${SETUP.includes(r.status) && !passes(r) ? " weak" : ""}" data-sym="${esc(p.sym)}" data-tf="${t}">${label(r, true)}${g}${m}</button></td>`;
    }).join("")}</tr>`).join("") + "</tbody>";
  if (detail) drawDetail();
}
function passes(r) {            // C1 rules chosen in settings
  const q = r.q;
  const q2 = r.q2, swept = ["formed", "c3close", "forming", "sweeping"].includes(r.status);
  if (!q) return !(req.c1 || req.key || req.bias);
  const c1ok = (!req.c1 || (q.size && !q.inside)) && (!req.key || !!q.key) && (!req.bias || q.bias === true);
  const c2ok = !swept || !q2 || ((!req.sweep || q2.sweep) && (!req.reject || q2.reject) && (!req.kz || q2.kz !== false));
  return c1ok && c2ok;
}
const CODE_NAME = { FORMED: "C2 confirmed", FORMING: "C2 forming (open)", SWEEPING: "C2 sweeping (open)", ANTICIPATED: "Near C1, no sweep",
  C3_CLOSURE: "C3 closure", BREAKOUT: "Rejected – closed outside C1", REJECTED: "Rejected – closed on C1's edge",
  AMBIGUOUS: "Ambiguous – swept both sides", NO_SWEEP: "No sweep", INVALID_DATA: "Bad data" };
function failReasons(r) {      // which of the screener rules a setup fails (identification itself is unchanged)
  const q = r.q || {}, q2 = r.q2, out = [], swept = ["formed", "c3close", "forming", "sweeping"].includes(r.status);
  if (!r.q) { if (req.c1 || req.key || req.bias) out.push("no C1 checks"); return out; }
  if (req.c1 && !(q.size && !q.inside)) out.push(q.inside ? "C1 is an inside bar" : "C1 too small");
  if (req.key && !q.key) out.push("no key level");
  if (req.bias && q.bias !== true) out.push("HTF bias not with it");
  if (swept && q2) { if (req.sweep && !q2.sweep) out.push("sweep too small/deep"); if (req.reject && !q2.reject) out.push("weak rejection close");
    if (req.kz && q2.kz === false) out.push("outside kill zone"); }
  return out;
}
function match(r, s, ignoreRules) {
  if (dir !== 0 && r.dir !== dir) return false;
  if (!ignoreRules && !showWeak && SETUP.includes(r.status) && !passes(r)) return false;
  if (s === "all") return SETUP.includes(r.status);
  if (s === "m1") return !!(r.m1 && r.m1.confirmed && !r.m1.hit);
  if (s === "m1p") return !!(r.m1 && !r.m1.confirmed);
  return r.status === s;
}
const m1rank = r => r.m1 && r.m1.confirmed && !r.m1.hit ? 0 : r.m1 && !r.m1.confirmed ? 1 : 2;
function ago2(t) { const m = Math.round((Date.now() / 1000 - t) / 60); return m < 60 ? m + " min ago" : m < 1440 ? Math.floor(m / 60) + "h ago" : Math.floor(m / 1440) + "d ago"; }
function m1line(p, r, t) {
  const m = r.m1; if (!m) return "";
  const a = m.dir === 1 ? "▲" : "▼", tfn = M1_TF[t];
  if (m.confirmed && m.hit) return `<span class="m1 done">Model-1 (${tfn}) reached target</span>`;
  if (m.confirmed) return `<span class="m1 ok">${a} Model-1 ✓ on ${tfn} · ${ago2(m.tConf)} · entry <b>${fmt(p, m.entry)}</b> · SL <b>${fmt(p, m.ext)}</b> · TP <b>${fmt(p, m.target)}</b>${m.rr != null ? ` · R:R <b>${m.rr}</b>` : ""}</span>`;
  return `<span class="m1 wait">Model-1 pending on ${tfn}: needs a close ${m.dir === 1 ? "above" : "below"} <b>${fmt(p, m.level)}</b> (${m.need} pips)</span>`;
}
function grade(r) {            // C1 grade, one step lower when C2 is not a clean sweep with a rejection close
  const q = r.q; if (!q) return null;
  const q2 = r.q2, swept = ["formed", "c3close", "forming", "sweeping"].includes(r.status);
  if (!swept || !q2 || (q2.sweep && q2.reject)) return q.grade;
  return q.grade === "A" ? "B" : "C";
}
function qline(r) {
  const q = r.q; if (!q) return "";
  const ck = (ok, txt) => `<span class="${ok === true ? "ok" : ok === false ? "no" : "na"}">${ok === true ? "✓" : ok === false ? "✗" : "–"} ${txt}</span>`;
  const g = grade(r);
  let out = `<div class="q"><b class="g g${g}">${g}</b><i>C1</i>${ck(q.size, "size")}${ck(!q.inside, "not inside bar")}${ck(!!q.key, q.key ? "at " + q.key : "key level")}${ck(q.bias, "HTF bias")}</div>`;
  const q2 = r.q2;
  if (q2 && ["formed", "c3close", "forming", "sweeping"].includes(r.status))
    out += `<div class="q"><b class="g" style="background:transparent"></b><i>C2</i>${ck(q2.sweep, `clean sweep (${q2.depth} pips)`)}${ck(q2.reject, "rejection close")}${q2.kz === null ? "" : ck(q2.kz, q2.kzName ? q2.kzName + " kill zone" : "kill zone")}${q2.outside ? '<span class="na">outside bar</span>' : ""}</div>`;
  return out;
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
  } else if (r.status === "c3close") {
    d.push(`C2 closed outside C1, C3 closed back through C2’s open → C4 continuation`);
    d.push(`Target C1 ${opp} <b>${fmt(p, r.t2)}</b> (${Math.abs(r.toT2)} pips)`);
    d.push(`Invalid ${r.dir === 1 ? "below" : "above"} <b>${fmt(p, r.inv)}</b>`);
    if (r.rr != null) d.push(`R:R from here <b>${r.rr}</b>`);
  } else if (r.status === "forming") {
    d.push(`Swept C1 ${side} <b>${fmt(p, r.level)}</b>, back inside`);
    d.push(`Target <b>${fmt(p, r.t2)}</b>`);
    d.push(`Closes in <b>${left(endOf(r, tf))}</b>`);
  } else if (r.status === "sweeping") {
    d.push(`${pips(p, r.price, r.level).toFixed(1)} pips beyond C1 ${side} <b>${fmt(p, r.level)}</b>`);
    d.push(`Needs to close back inside · closes in <b>${left(endOf(r, tf))}</b>`);
  } else if (r.status === "anticipated") {
    d.push(`<b>${r.dist}</b> pips from C1 ${side} <b>${fmt(p, r.level)}</b>`);
    d.push(`Closes in <b>${left(endOf(r, tf))}</b>`);
  } else if (r.status === "done" || r.status === "failed") {
    d.push(r.status === "done" ? `Reached target ${fmt(p, r.t2)}` : `Went beyond the sweep ${fmt(p, r.inv)}`);
  }
  const ins = insideCount(r);
  if (ins > 0) d.push(`<span class="muted">C1 is ${ins + (r.status === "anticipated" ? 1 : 1)} candles back (${ins} candle${ins > 1 ? "s" : ""} inside its range)</span>`);
  return `<button class="row" data-sym="${esc(p.sym)}" data-tf="${tf}" style="text-align:left;font:inherit;color:inherit">
    <div class="top"><span class="pair">${esc(p.sym)}</span><span class="badge ${cls(r)}">${label(r)}</span><span class="px">${fmt(p, r.price)}</span></div>
    <div class="det">${d.map(x => `<span>${x}</span>`).join("")}</div>${qline(r)}${m1line(p, r, tf)}</button>`;
}

/* ---------- detail sheet + chart ---------- */
function openDetail(sym, t) {
  detail = { sym, tf: t };
  const p = data.pairs.find(x => x.sym === sym), r = p && p.tf[t];
  if (r && r.m1) view = "split";              // Model-1 lives on the lower timeframe: show both charts
  document.querySelectorAll("#dView button").forEach(x => x.classList.toggle("on", x.dataset.v === view));
  $("#sheet").hidden = false; drawDetail();
}
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
  const cs0 = r.candles || [], mp = cMap(r, cs0.length - 1, cs0), when = i => {
    const c = cs0[i]; if (!c) return "–"; const d = new Date(c[0] * 1000), t = detail.tf;
    if (t === "M") return d.toLocaleDateString([], { month: "short", year: "numeric" });
    if (t === "W") return "wk of " + d.toLocaleDateString([], { day: "2-digit", month: "short" });
    if (t === "D") return d.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" });
    return d.toLocaleString([], { day: "2-digit", month: "short" }) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  if (mp.C1 != null && mp.C1 >= 0) L.push(["C1 candle", when(mp.C1)]);
  if (mp.C2 != null && mp.C2 >= 0) L.push(["C2 candle (sweep)", when(mp.C2) + (c2BackOf(r) ? "" : " · still open")]);
  if (insideCount(r)) L.push(["Inside candles", insideCount(r)]);
  if (r.t1 != null) L.push(["Mid (T1)", fmt(p, r.t1) + (r.hit1 ? " ✓" : "")]);
  if (r.t2 != null) L.push(["Target (T2)", fmt(p, r.t2)]);
  if (r.inv != null) L.push(["Invalid", fmt(p, r.inv)]);
  if (r.t2 != null) L.push(["Pips to T2", pips(p, r.price, r.t2).toFixed(1)]);
  if (r.rr != null) L.push(["R:R from here", r.rr]);
  L.push(["Candle closes in", left(endOf(r, detail.tf))]);
  if (r.code) L.push(["Identification", (CODE_NAME[r.code] || r.code) + (r.dir ? (r.dir === 1 ? " · bullish" : " · bearish") : "")], ["State", r.state || "–"], ["Why", r.reason || "–"]);
  if (r.sigt) L.push(["Signal (C2 closed)", when(cs0.findIndex(c => c[0] === r.sigt))], ["C3 open (entry ref.)", fmt(p, r.entry)]);
  if (SETUP.includes(r.status) && !passes(r)) L.push(["Screener", "hidden by your rules: " + failReasons(r).join(", ")]);
  if (r.q) L.push(["Grade", grade(r) + (r.q.key ? " · " + r.q.key : "")]);
  if (r.q2 && ["formed", "c3close", "forming", "sweeping"].includes(r.status)) L.push(["C2 sweep", r.q2.depth + " pips" + (r.q2.sweep ? " ✓" : " ✗")], ["T-spot (C2 wick 50%)", fmt(p, r.q2.tspot)]);
  if (r.m1) {
    const m = r.m1;
    L.push([`Model-1 (${M1_TF[detail.tf]})`, m.confirmed ? (m.hit ? "✓ hit target" : "✓ confirmed") : "pending"], ["Model-1 level", fmt(p, m.level) + (m.wick ? " (wick)" : "")]);
    if (m.confirmed) L.push(["Entry", fmt(p, m.entry)], ["Stop (sweep)", fmt(p, m.ext)], ["Target", fmt(p, m.target)], ["R:R", m.rr ?? "–"]);
  }
  $("#dLv").innerHTML = L.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join("");
  $("#dNote").textContent = `Prices from Yahoo Finance (${p.src}). Scanned ${new Date(data.updated).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}.`;
  chart(p, r);
}
const LTF_OF = { M: ["D", "Daily"], W: ["4H", "4H"], D: ["1H", "1H"], "4H": ["15m", "15m"], "1H": ["5m", "5m"] };
const C2_BACK = { formed: 1, done: 1, failed: 1, c3close: 2 };      // fallback for old scan files without c2Back
const c2BackOf = r => r.c2Back ?? C2_BACK[r.status] ?? 0;
/* positions of C1 (the range candle), the candles inside it, C2, C3, C4 in cs - located by the scanner's own C1/C2
 * timestamps (c1t / c2t), so the chart marks exactly the candles the scanner used */
function cMap(r, last, cs) {
  if (r.c1Back == null) return {};
  const at = t => { if (t == null || !cs) return null; const k = cs.findIndex(c => c[0] === t); return k < 0 ? null : k; };
  const c1 = at(r.c1t) ?? last - r.c1Back, st = r.status;   // cs ends at the current candle (index last)
  if (st === "anticipated") return { C1: c1 };
  const c2 = at(r.c2t) ?? last - c2BackOf(r), m = { C1: c1 };
  for (let i = c1 + 1; i < c2; i++) m["in" + (i - c1)] = i;     // inside bars between C1 and C2
  m.C2 = c2;
  if (c2 + 1 <= last) m.C3 = c2 + 1;
  if (c2 + 2 <= last) m.C4 = c2 + 2;
  return m;
}
const insideCount = r => r.c1Back == null ? 0 : Math.max(0, r.c1Back - c2BackOf(r) - (r.status === "anticipated" ? 0 : 1));
function marksOf(map) {               // C1 / inside run / C2 / C3 / C4 positions for the drawing
  const ins = Object.entries(map).filter(([k, i]) => k.startsWith("in") && i >= 0).map(([, i]) => i);
  const ok = i => i != null && i >= 0 ? i : null;
  return { c1: ok(map.C1), c2: ok(map.C2), c3: ok(map.C3), c4: ok(map.C4), ins: ins.length ? [Math.min(...ins), Math.max(...ins)] : null };
}
function chart(p, r) {
  const split = view === "split" && LTF_OF[detail.tf];
  $("#cvWrap2").hidden = !split;
  $("#charts").classList.toggle("two", !!split);
  const W = $("#cv").clientWidth;
  const all = r.candles || [], n = all.length;
  // zoom so the CRT candles are big: a few candles of context before C1, then everything up to now
  const maxN = split ? (W < 500 ? 16 : 30) : (W < 500 ? 26 : 50), minN = split ? 12 : (W < 500 ? 16 : 24);
  let s0 = Math.max(0, n - maxN);
  if (r.c1Back != null) s0 = Math.max(0, Math.min(n - 1 - r.c1Back - 5, n - minN));
  const cs = all.slice(s0);
  if (cs.length < 3) return;
  const last = cs.length - 1, map = cMap(r, last, cs);
  $("#cap1").textContent = `${TF_NAME[detail.tf]} (higher timeframe)`;
  draw($("#cv"), p, r, cs, { from: map.C1 ?? last, intraday: detail.tf === "1H" || detail.tf === "4H", marks: marksOf(map) });
  if (!split) return;
  // lower timeframe: candles since the start of C1 (or the last 3 higher-TF candles)
  const [key, name] = LTF_OF[detail.tf];
  let src = key === "15m" || key === "5m" ? (p.ltf && p.ltf[key]) : (p.tf[key] && p.tf[key].candles);
  $("#cap2").textContent = `${name} (lower timeframe) inside the ${TF_NAME[detail.tf]} candles`;
  // sections of the higher-timeframe candles: C1, the candles inside its range (one group), C2, C3, C4
  const secs = [];
  for (const [k, i] of Object.entries(map)) {
    if (i < 0) continue;
    if (k.startsWith("in")) { if (!secs.length || secs[secs.length - 1].k !== "inside") secs.push({ k: "inside", t: cs[i][0] }); }
    else secs.push({ k, t: cs[i][0] });
  }
  if (!secs.length) secs.push({ k: "", t: cs[last][0] });
  const srcAll = src || [], ltN = W < 500 ? 110 : 180;
  src = srcAll.slice(-ltN);                        // keep the lower-timeframe chart readable on a phone
  const t0 = src.length ? src[0][0] : Infinity;
  // drop sections that end before the lower-timeframe data begins; the first kept one starts at the data start
  let first = 0;
  for (let j = 0; j < secs.length; j++) if (secs[j].t <= t0) first = j;
  const shown = secs.slice(first);
  const lt = src.filter(c => c[0] >= Math.max(shown[0].t, t0));
  if (lt.length < 3) { draw($("#cv2"), p, r, [], { empty: `No ${name} candles in this scan yet — they arrive with the next scan.` }); return; }
  const idxOf = t => { const k = lt.findIndex(c => c[0] >= t); return k < 0 ? lt.length : k; };
  const starts = shown.map((x, j) => ({ k: x.k, i: j === 0 ? 0 : idxOf(x.t) }));
  const bands = starts.map((x, j) => ({ k: x.k, i0: x.i, i1: (j + 1 < starts.length ? starts[j + 1].i : lt.length) - 1 })).filter(b => b.k && b.i1 >= b.i0);
  if (first > 0) $("#cap2").textContent += ` (from ${secs[first].k === "inside" ? "the inside candles" : secs[first].k}; earlier candles not shown)`;
  draw($("#cv2"), p, r, lt, { from: starts[0].i, intraday: key !== "D", bands, seps: starts.map(x => x.i), m1: r.m1 });
}
const FONT = "-apple-system,Segoe UI,Roboto,sans-serif";
function draw(cv, p, r, cs, o) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const C = { ink: css("--ink"), sec: css("--sec"), line: css("--line"), up: css("--green"), dn: css("--red"), blue: css("--blue"), amber: css("--amber"), tint: css("--tint") };
  if (o.empty) { g.fillStyle = C.sec; g.font = "13px " + FONT; g.fillText(o.empty, 10, H / 2); return; }
  const last = cs.length - 1, M = o.marks || {};
  const padR = 64, padB = 22, padT = (o.marks || o.bands) ? 42 : 18, plotW = W - padR - 6, plotH = H - padB - padT;
  const lv = [r.t1, r.t2, r.inv, r.level, r.c1h, r.c1l, o.m1 && o.m1.level, o.m1 && o.m1.ext, r.q && r.q.keyLvl].filter(v => v != null);
  let hi = Math.max(...cs.map(c => c[2]), ...lv), lo = Math.min(...cs.map(c => c[3]), ...lv);
  const padY = (hi - lo) * 0.06 || hi * 0.001; hi += padY; lo -= padY;
  const step = plotW / (cs.length + 4), bw = Math.max(1.5, step * 0.62);
  const X = i => 6 + step * (i + 0.5), Y = v => padT + (hi - v) / (hi - lo) * plotH;
  const ROLE = { C1: C.amber, C2: C.dn, C3: C.blue, C4: C.blue, inside: C.sec };
  g.font = "11px " + FONT; g.fillStyle = C.sec; g.strokeStyle = C.line; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); g.beginPath(); g.moveTo(0, y); g.lineTo(plotW + 6, y); g.stroke(); g.fillText(fmt(p, v), plotW + 10, y + 4); }
  const x0 = X(o.from) - step / 2;
  if (r.c1h != null) { g.fillStyle = C.tint; g.globalAlpha = .9; g.fillRect(x0, Y(r.c1h), plotW + 6 - x0, Y(r.c1l) - Y(r.c1h)); g.globalAlpha = 1; }
  // coloured columns behind the CRT candles: C1 amber, C2 red, C3/C4 purple
  const band = (i0, i1, col, a) => { g.save(); g.globalAlpha = a; g.fillStyle = col; g.fillRect(X(i0) - step / 2, padT - 4, (i1 - i0 + 1) * step, plotH + 4); g.restore(); };
  if (M.c1 != null) band(M.c1, M.c1, C.amber, .2);
  if (M.c2 != null) band(M.c2, M.c2, C.dn, .14);
  if (M.c3 != null) band(M.c3, M.c3, C.blue, .08);
  (o.bands || []).forEach(b => { if (b.k !== "inside") band(b.i0, b.i1, ROLE[b.k] || C.sec, b.k === "C1" ? .12 : b.k === "C2" ? .1 : .05); });
  // higher-timeframe candle dividers (lower-timeframe chart)
  g.save(); g.strokeStyle = C.sec; g.setLineDash([3, 4]);
  (o.seps || []).forEach(i => { const x = X(i) - step / 2; g.beginPath(); g.moveTo(x, padT - 4); g.lineTo(x, H - padB); g.stroke(); });
  g.restore();
  const inIns = i => M.ins && i >= M.ins[0] && i <= M.ins[1];
  cs.forEach((c, i) => {
    const up = c[4] >= c[1]; g.strokeStyle = g.fillStyle = up ? C.up : C.dn;
    g.globalAlpha = inIns(i) ? .4 : 1;              // candles inside C1 are noise: dim them
    g.beginPath(); g.moveTo(X(i), Y(c[2])); g.lineTo(X(i), Y(c[3])); g.stroke();
    const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4]));
    g.fillRect(X(i) - bw / 2, y1, bw, Math.max(1, y2 - y1));
  });
  g.globalAlpha = 1;
  if (M.c1 != null) {             // outline the C1 range candle
    const c = cs[M.c1]; g.save(); g.strokeStyle = C.amber; g.lineWidth = 2;
    g.strokeRect(X(M.c1) - step / 2 + 1, Y(c[2]) - 3, step - 2, Y(c[3]) - Y(c[2]) + 6); g.restore();
  }
  if (M.c2 != null && r.c1h != null) {   // C2: the part of its wick beyond C1 = the sweep (turtle soup)
    const c = cs[M.c2], x = X(M.c2);
    g.save(); g.strokeStyle = C.dn; g.lineWidth = Math.max(3, bw * 0.35); g.lineCap = "round";
    [[c[2] > r.c1h, r.c1h, c[2]], [c[3] < r.c1l, r.c1l, c[3]]].forEach(([sw, a, b]) => { if (!sw) return;
      g.beginPath(); g.moveTo(x, Y(a)); g.lineTo(x, Y(b)); g.stroke(); g.fillStyle = C.dn; g.beginPath(); g.arc(x, Y(b), 4, 0, 7); g.fill(); });
    g.restore();
  }
  const tags = [];
  const hline = (v, col, txt, dash) => { if (v == null) return; const y = Y(v); g.save(); g.strokeStyle = col; g.setLineDash(dash ? [5, 4] : []); g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(plotW + 6, y); g.stroke(); g.restore(); tags.push([y, col, txt]); };
  // CRT range: target side in blue, swept side in amber
  if (r.c1h != null) {
    hline(r.c1h, r.dir === 1 ? C.blue : C.amber, r.dir === 1 ? "TP CRT H" : "CRT High");
    hline(r.c1l, r.dir === 1 ? C.amber : C.blue, r.dir === 1 ? "CRT Low" : "TP CRT L");
    hline((r.c1h + r.c1l) / 2, C.sec, "50%", true);
  }
  if (r.q && r.q.keyLvl != null && r.q.keyT != null) {   // swept swing: line from the swing candle to C2, "Sweep D"
    const q = r.q, sc = r.dir === 1 ? C.up : C.dn, y = Y(q.keyLvl);
    let iS = cs.length && cs[0][0] > q.keyT ? -1 : cs.findIndex(c => c[0] >= q.keyT); const xs = iS < 0 ? 0 : X(iS);   // swing older than the chart: line from the left edge
    const c2b = (o.bands || []).find(b => b.k === "C2");
    const xe = M.c2 != null ? X(M.c2) + step / 2 : c2b ? X(c2b.i1) + step / 2 : plotW + 6;
    g.save(); g.strokeStyle = sc; g.lineWidth = 1.6; g.beginPath(); g.moveTo(xs, y); g.lineTo(xe, y); g.stroke();
    if (iS >= 0) { g.fillStyle = sc; g.beginPath(); g.arc(X(iS), y, 3, 0, 7); g.fill(); }
    g.setLineDash([2, 3]); g.globalAlpha = .6; g.beginPath(); g.moveTo(xe, y); g.lineTo(plotW + 6, y); g.stroke(); g.restore();
    if (o.marks) { g.save(); g.font = "bold 10px " + FONT; g.fillStyle = sc;   // label beside the swing point (higher-TF chart)
      g.fillText(q.key + " · swept by C2", xs + 6, r.dir === 1 ? y + 13 : y - 5); g.restore(); }
    tags.push([y, sc, q.key]);
  } else if (r.q && r.q.keyLvl != null) hline(r.q.keyLvl, C.sec, r.q.key, true);
  const sweepPx = r.status === "formed" || r.status === "done" || r.status === "failed" || r.status === "c3close" ? r.inv : r.sweep;
  if (sweepPx != null && !o.m1) hline(sweepPx, C.dn, "Sweep", true);
  // Model-1 marks (lower-timeframe chart)
  const m = o.m1;
  if (m) {
    const idx = t => cs.findIndex(c => c[0] === t);
    const iR0 = idx(m.tRun), iR1 = idx(m.tRunEnd), iX = idx(m.tExt), iC = m.confirmed ? idx(m.tConf) : -1;
    const mc = m.dir === 1 ? C.up : C.dn;
    hline(m.ext, C.dn, "SL", true);
    if (iR0 >= 0) {            // Model-1 line from the opposite candle(s)
      const y = Y(m.level); g.save(); g.strokeStyle = mc; g.lineWidth = 2;
      g.beginPath(); g.moveTo(X(iR0) - step / 2, y); g.lineTo(plotW + 6, y); g.stroke(); g.restore(); tags.push([y, mc, "Model-1"]);
      const hi2 = Math.max(...cs.slice(iR0, iR1 + 1).map(c => c[2])), lo2 = Math.min(...cs.slice(iR0, iR1 + 1).map(c => c[3]));
      g.save(); g.strokeStyle = C.amber; g.lineWidth = 2; g.strokeRect(X(iR0) - step / 2, Y(hi2) - 3, (iR1 - iR0 + 1) * step, Y(lo2) - Y(hi2) + 6); g.restore();
      g.fillStyle = C.amber; g.font = "bold 10px " + FONT; g.textAlign = "center";
      g.fillText("M1 candle", X(iR0) + (iR1 - iR0) * step / 2, m.dir === 1 ? Y(hi2) - 7 : Y(lo2) + 15); g.textAlign = "left";
    } else tags.push([Y(m.level), mc, "Model-1"]);
    if (iX >= 0) {             // sweep extreme
      const yx = Y(m.ext); g.fillStyle = C.dn; g.beginPath(); g.arc(X(iX), yx, 4, 0, 7); g.fill();
      g.font = "bold 10px " + FONT; g.textAlign = "center";
      g.fillText("Sweep", X(iX), m.dir === 1 ? yx + 15 : yx - 8); g.textAlign = "left";
    }
    if (iC >= 0) {             // confirmation candle = entry
      const c = cs[iC], up = m.dir === 1, ya = up ? Y(c[3]) + 8 : Y(c[2]) - 8;
      g.fillStyle = mc; g.beginPath();
      if (up) { g.moveTo(X(iC), ya); g.lineTo(X(iC) - 6, ya + 10); g.lineTo(X(iC) + 6, ya + 10); }
      else { g.moveTo(X(iC), ya); g.lineTo(X(iC) - 6, ya - 10); g.lineTo(X(iC) + 6, ya - 10); }
      g.fill(); g.font = "bold 11px " + FONT; g.textAlign = "center";
      g.fillText("Entry", X(iC), up ? ya + 22 : ya - 14); g.textAlign = "left";
      g.save(); g.strokeStyle = mc; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(iC), Y(c[4])); g.lineTo(plotW + 6, Y(c[4])); g.stroke(); g.restore();
    }
  }
  // role pills above the chart; a second row is used when neighbours would overlap
  const placed = [];
  const pill = (txt, xc, col, small, x1, x2) => {
    g.font = (small ? "600 10px " : "bold 11px ") + FONT;
    const w = g.measureText(txt).width + 10; let row = 0;
    while (row < 1 && placed.some(q => q.row === row && Math.abs(q.x - xc) < (q.w + w) / 2 + 2)) row++;
    placed.push({ x: xc, w, row });
    const y = 4 + row * 18;
    if (x1 != null && x2 - x1 > w + 6) {        // bracket under the pill for a span of candles
      g.save(); g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x1 + 2, y + 13); g.lineTo(x1 + 2, y + 16); g.lineTo(x2 - 2, y + 16); g.lineTo(x2 - 2, y + 13); g.stroke(); g.restore(); }
    g.fillStyle = col; g.beginPath(); if (g.roundRect) g.roundRect(xc - w / 2, y, w, 15, 7); else g.rect(xc - w / 2, y, w, 15); g.fill();
    g.fillStyle = "#fff"; g.textAlign = "center"; g.fillText(txt, xc, y + 11); g.textAlign = "left";
  };
  if (o.marks) {
    if (M.c1 != null) pill("C1", X(M.c1), C.amber);
    if (M.ins) { const k = M.ins[1] - M.ins[0] + 1; pill(k > 1 ? `inside ×${k}` : "in", (X(M.ins[0]) + X(M.ins[1])) / 2, C.sec, true, X(M.ins[0]) - step / 2, X(M.ins[1]) + step / 2); }
    if (M.c2 != null) pill("C2", X(M.c2), C.dn);
    if (M.c3 != null) pill("C3", X(M.c3), C.blue);
    if (M.c4 != null) pill("C4", X(M.c4), C.blue);
  }
  (o.bands || []).forEach(b => { const x1 = X(b.i0) - step / 2, x2 = X(b.i1) + step / 2;
    pill(b.k === "inside" ? "inside C1" : b.k, (x1 + x2) / 2, ROLE[b.k] || C.sec, b.k === "inside", x1, x2); });
  g.font = "10px " + FONT; g.fillStyle = C.sec;
  const every = Math.max(1, Math.ceil(cs.length / 4));
  cs.forEach((c, i) => { if (i % every === 1 || every === 1) { const d = new Date(c[0] * 1000);
    const t = o.intraday ? d.toLocaleString([], { day: "2-digit", month: "short" }) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : d.toLocaleDateString([], { day: "2-digit", month: "short" });
    g.fillText(t, X(i), H - 6); } });
  g.textAlign = "left";
  tags.push([Y(r.price), C.blue, fmt(p, cs[last] ? cs[last][4] : r.price)]);
  tags.sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < tags.length; k++) if (tags[k][0] - tags[k - 1][0] < 17) tags[k][0] = tags[k - 1][0] + 17;
  g.font = "bold 10px " + FONT;
  tags.forEach(([y, col, txt]) => { g.fillStyle = col; g.fillRect(plotW + 6, y - 8, padR, 16); g.fillStyle = "#fff"; g.fillText(txt, plotW + 10, y + 4); });
}

/* ---------- events ---------- */
$("#tfSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; tf = b.dataset.tf; ls.set("fx-tf", tf); render(); });
$("#stChips").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; st = b.dataset.st; ls.set("fx-st", st); render(); });
$("#dirChips").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; dir = +b.dataset.dir;
  document.querySelectorAll("#dirChips .chip").forEach(x => x.classList.toggle("on", x === b)); render(); });
document.addEventListener("click", e => { const b = e.target.closest("[data-sym]"); if (b && !b.closest("#sheet")) openDetail(b.dataset.sym, b.dataset.tf); });
$("#dTf").addEventListener("click", e => { const b = e.target.closest("button"); if (!b || !detail) return; detail.tf = b.dataset.tf; drawDetail(); });
$("#dClose").onclick = closeDetail;
$("#dView").addEventListener("click", e => { const b = e.target.closest("button"); if (!b || !detail) return; view = b.dataset.v; ls.set("fx-view", view);
  document.querySelectorAll("#dView button").forEach(x => x.classList.toggle("on", x === b)); drawDetail(); });
document.querySelectorAll("#dView button").forEach(x => x.classList.toggle("on", x.dataset.v === view));
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeDetail(); });
$("#refresh").onclick = () => load(true);
document.addEventListener("click", e => { if (e.target.id === "showWeak") { showWeak = !showWeak; render(); } });
const REQ_ID = { reqC1: "c1", reqKey: "key", reqBias: "bias", reqSweep: "sweep", reqReject: "reject", reqKz: "kz" };
Object.entries(REQ_ID).forEach(([id, k]) => { const el = $("#" + id); el.checked = req[k];
  el.onchange = () => { Object.entries(REQ_ID).forEach(([i, kk]) => req[kk] = $("#" + i).checked); ls.set("fx-req", req); render(); }; });
addEventListener("resize", () => { if (detail) drawDetail(); });
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (detail) drawDetail(); }); } catch (e) {}
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
setInterval(ago, 30000);
setInterval(() => { if (!document.hidden) load(); }, liveOn ? 60000 : 5 * 60000);
$("#liveSave").onclick = () => { liveUrl = $("#liveUrl").value.trim().replace(/\/+$/, ""); liveOn = $("#liveOn").checked; ls.set("fx-live-url", liveUrl); ls.set("fx-live", liveOn); liveOk = null; liveStatus(); load(true); };
setInterval(() => { if (data) render(); }, 60000);   // countdowns
load();
})();
