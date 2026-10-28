/* ICT Sweep tab (1D -> 1H, 4H -> 15m, 2H -> 5m): screener tables (bullish / bearish), filters, detail charts, CSV export, Telegram alerts,
 * the CRT / 4H Sweep tab switch and the dark / light theme button. Detection itself is in forex/sweep.js
 * (phone) and scripts/sweep4h.py (GitHub scan); this file only reads the results (data.pairs[].sweep). */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
             set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const STATUS = { SWEEPING: "Sweeping", SWEEP: "Sweep only", NO_LTF: "Sweep only", CHOCH: "CHoCH formed", ENTRY_READY: "Entry ready",
  ENTERED: "In trade", TARGET_HIT: "Target hit", STOPPED: "Stopped", INVALIDATED: "Invalidated", MISSED: "Missed", EXPIRED: "Expired" };
const ORDST = { WAITING: "Waiting – active after the next candle closes", PENDING: "Pending (not filled)", FILLED: "Filled (simulated)", CANCELLED: "Cancelled" };
const ACTIVE = ["SWEEPING", "SWEEP", "NO_LTF", "CHOCH", "ENTRY_READY", "ENTERED"];
const ORDER = { ENTRY_READY: 0, ENTERED: 1, CHOCH: 2, SWEEP: 3, NO_LTF: 3, SWEEPING: 4, TARGET_HIT: 5, STOPPED: 6, INVALIDATED: 7, MISSED: 8, EXPIRED: 9 };
const CHIPS = [["a1", "★ A1 best"], ["active", "Active"], ["SWEEPING", "Sweeping"], ["sweep", "Sweep only"], ["CHOCH", "CHoCH formed"], ["ENTRY_READY", "Entry ready"],
  ["ENTERED", "In trade"], ["finished", "Finished"]];
const DEF = { sweep: 0.05, disp: 1.0, swing: 1.0, grade: "C", crt: false, finished: false, tt: false };
const GR = { A: 3, B: 2, C: 1 };
let F = Object.assign({}, DEF, ls.get("sw-f", {})), st = ls.get("sw-st", "active"), dir = 0, data = null, openId = null;
const TFS = ["D", "4H", "2H"], TFN = { D: "1D", "4H": "4H", "2H": "2H" }, LTFN = { D: "1H", "4H": "15m", "2H": "5m" }, SEC = { D: 86400, "4H": 14400, "2H": 7200 };
let tfSel = TFS.includes(ls.get("sw-tf", "4H")) ? ls.get("sw-tf", "4H") : "4H";
const unit = p => p.pip >= 1 ? "pts" : "pips";
const left = s => { const m = Math.max(0, Math.round((s.sweep.t + SEC[s.tf || tfSel] - Date.now() / 1000) / 60)); return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m"; };
const htfCandles = (p, tf) => tf === "2H" ? p.c2h || [] : (p.tf && p.tf[tf] && p.tf[tf].candles) || [];
const ltfCandles = (p, tf) => tf === "D" ? p.h1 || (p.tf && p.tf["1H"] && p.tf["1H"].candles) || [] : (p.ltf && p.ltf[tf === "2H" ? "5m" : "15m"]) || [];

/* ---------- helpers ---------- */
const digits = p => p.pip >= 0.1 ? 2 : p.pip >= 0.01 ? 3 : 5;
const fmt = (p, v) => v == null ? "–" : Number(v).toFixed(digits(p));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = t => { if (t == null) return "–"; const d = new Date(t * 1000);
  return d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const ago = t => { const m = Math.round((Date.now() / 1000 - t) / 60); return m < 60 ? m + "m" : m < 1440 ? Math.floor(m / 60) + "h" : Math.floor(m / 1440) + "d"; };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
/* A1 = the best setups: grade A (4-5 of the quality points) and the full TTrades checklist (5/5) */
const isA1 = s => s.q && s.q.grade === "A" && s.q.ttN === 5;
function crtOk(p, s) {             // the CRT engine on the same pair points the same way on 4H or 1H
  return ["4H", "1H"].some(tf => { const r = p.tf && p.tf[tf]; return r && r.dir === s.dir && ["formed", "forming", "sweeping", "c3close"].includes(r.status); });
}
function passes(p, s) {            // filters only hide setups, they never change what was detected
  if (s.sweep.depth < F.sweep || s.sweep.swingSize < F.swing) return false;
  if (s.disp != null && s.disp < F.disp) return false;
  if (GR[s.q.grade] < GR[F.grade]) return false;
  if (F.crt && !crtOk(p, s)) return false;
  if (F.tt && (s.q.ttN || 0) < 5) return false;
  return true;
}
function chipMatch(s, key) {
  if (key === "a1") return isA1(s) && ACTIVE.includes(s.status);
  if (key === "active") return ACTIVE.includes(s.status);
  if (key === "finished") return !ACTIVE.includes(s.status);
  if (key === "sweep") return s.status === "SWEEP" || s.status === "NO_LTF";
  return s.status === key;
}
function rows(tf) {
  tf = tf || tfSel; const out = [];
  for (const p of (data && data.pairs) || []) {
    const list = (p.sweeps && p.sweeps[tf]) || (tf === "4H" && p.sweep) || [];
    for (const s of list) { s.tf = tf; out.push({ p, s, tf, id: p.sym + "|" + tf + "|" + s.sweep.t }); }
  }
  return out;
}
const allRows = () => TFS.flatMap(t => rows(t));

/* ---------- screener ---------- */
function render() {
  if (!data) return;
  const all = rows();
  const visible = all.filter(x => (dir === 0 || x.s.dir === dir) && (F.finished || st === "finished" || ACTIVE.includes(x.s.status)));
  $("#swChips").innerHTML = CHIPS.map(([k, n]) => `<button class="chip${st === k ? " on" : ""}" data-st="${k}">${n}<b>${visible.filter(x => chipMatch(x.s, k) && passes(x.p, x.s)).length}</b></button>`).join("");
  const shown = visible.filter(x => chipMatch(x.s, st));
  const ok = shown.filter(x => passes(x.p, x.s)), hidden = shown.length - ok.length;
  const T = TFN[tfSel], any = all.length, idx = (data.pairs || []).filter(p => (p.sweeps && p.sweeps[tfSel]) || (tfSel === "4H" && p.sweep)).length;
  document.querySelectorAll("#swTf button").forEach(b => b.classList.toggle("on", b.dataset.tf === tfSel));
  $("#swNote").innerHTML = (!idx ? `No ${T} sweep data yet – it arrives with the next live update or scan.` :
    `${hidden ? `${hidden} setup${hidden > 1 ? "s" : ""} hidden by your filters. ` : ""}${any} ${T} sweep${any === 1 ? "" : "s"} in the last 12 ${T} candles across ${idx} symbols · CHoCH on ${LTFN[tfSel]}.`);
  const sorted = ok.sort((a, b) => ORDER[a.s.status] - ORDER[b.s.status] || b.s.sweep.t - a.s.sweep.t || a.p.sym.localeCompare(b.p.sym));
  $("#swBull").innerHTML = table(sorted.filter(x => x.s.dir === 1), `▲ Bullish ${T} sweeps`, "swing low swept → longs");
  $("#swBear").innerHTML = table(sorted.filter(x => x.s.dir === -1), `▼ Bearish ${T} sweeps`, "swing high swept → shorts");
  matrix();
  $("#swBull").hidden = dir === -1; $("#swBear").hidden = dir === 1;
  if (openId) drawDetail();
}
function table(list, title, sub) {
  const head = `<h2>${title} <span style="text-transform:none;letter-spacing:0;font-weight:600">· ${sub} · ${list.length}</span></h2>`;
  if (!list.length) return head + `<div class="empty">None right now.</div>`;
  return head + `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Symbol</th><th>Sweep (${TFN[tfSel]})</th><th>Status</th><th>Entry</th><th>Dist ${data && data.pairs && data.pairs.every(p => p.pip >= 1) ? "pts" : "pips/pts"}</th><th>R:R</th><th>Grade</th><th>CRT</th></tr></thead><tbody>` +
    list.map(({ p, s, id }) => `<tr data-sw="${esc(id)}"><td>${esc(p.sym)}${isA1(s) ? ' <span class="a1">A1</span>' : ""}</td><td>${when(s.sweep.t)} <span class="muted">${ago(s.sweep.t)}</span></td>` +
      `<td><span class="st st-${s.status}">${STATUS[s.status] || s.status}</span>${s.status === "SWEEPING" ? ` <span class="muted">closes in ${left(s)}</span>` : ""}</td><td>${s.entry != null ? fmt(p, s.entry) : "–"}</td>` +
      `<td>${s.dist != null && ACTIVE.includes(s.status) ? s.dist.toFixed(1) : "–"}</td><td>${s.rr != null ? s.rr.toFixed(1) : "–"}</td>` +
      `<td><b class="g g${s.q.grade}">${s.q.grade}</b> <span class="muted" title="TTrades checklist">${s.q.ttN != null ? s.q.ttN + "/5" : ""}</span></td><td>${crtOk(p, s) ? '<span class="crtok">✓</span>' : '<span class="muted">–</span>'}</td></tr>`).join("") +
    `</tbody></table></div>`;
}

/* overview: every symbol x 1D / 4H / 2H, the most important current setup in each cell */
function matrix() {
  const SHORT = { ENTRY_READY: "Entry", ENTERED: "In", CHOCH: "CHoCH", SWEEP: "Sweep", NO_LTF: "Sweep", SWEEPING: "Swp" };
  const pick = (p, tf) => rows(tf).filter(x => x.p === p && ACTIVE.includes(x.s.status) && passes(x.p, x.s))
    .sort((a, b) => ORDER[a.s.status] - ORDER[b.s.status] || b.s.sweep.t - a.s.sweep.t)[0];
  $("#swMx").innerHTML = `<h2>All timeframes <span style="text-transform:none;letter-spacing:0;font-weight:600">· tap a cell</span></h2><div style="overflow-x:auto"><table class="mx"><thead><tr><th>Symbol</th>${TFS.map(t => `<th>${TFN[t]} → ${LTFN[t]}</th>`).join("")}</tr></thead><tbody>` +
    ((data && data.pairs) || []).map(p => `<tr><td>${esc(p.sym)}</td>${TFS.map(t => { const x = pick(p, t); if (!x) return '<td><span class="muted">–</span></td>';
      const s = x.s, cl = s.status === "ENTRY_READY" || s.status === "ENTERED" ? "s-formed" : s.status === "CHOCH" ? "s-forming" : "s-sweeping";
      return `<td><button class="dot ${cl} ${s.dir === 1 ? "up" : "dn"}" data-mx="${esc(x.id)}" data-tf="${t}">${s.dir === 1 ? "▲" : "▼"} ${SHORT[s.status]}${isA1(s) ? " ★" : ""}<br><small>${s.q.grade} · ${s.q.ttN}/5</small></button></td>`; }).join("")}</tr>`).join("") +
    `</tbody></table></div>`;
}

/* ---------- detail ---------- */
function find(id) { return allRows().find(x => x.id === id); }
function openDetail(id) { openId = id; $("#swSheet").hidden = false; drawDetail(); }
function closeDetail() { openId = null; $("#swSheet").hidden = true; }
function drawDetail() {
  const x = find(openId); if (!x) return closeDetail();
  const { p, s, tf } = x, w = s.sweep, d = s.dir, up = d === 1, T = TFN[tf], LT = LTFN[tf];
  $("#swTitle").textContent = `${p.sym} · ${up ? "▲ Bullish" : "▼ Bearish"} ${T} sweep`;
  $("#swCap1").textContent = `${T} – swing, sweep, back into range, target`; $("#swCap2").textContent = `${LT} – CHoCH, displacement, entry zone`;
  const b = $("#swBadge"); b.textContent = STATUS[s.status] || s.status; b.className = "badge st st-" + s.status;
  const ck = (okv, txt) => `<span class="${okv ? "ok" : "no"}">${okv ? "✓" : "✗"} ${txt}</span>`, c = s.q.checks;
  $("#swChecks").innerHTML = `<b class="g g${s.q.grade}">${s.q.grade}</b>${ck(c.swing, `${T} swing ${w.swingSize.toFixed(1)}× ATR`)}${ck(c.depth, `sweep ${w.depth.toFixed(2)}× ATR`)}` +
    `${ck(c.disp, s.disp != null ? `displacement ${s.disp.toFixed(1)}×` : "displacement")}${ck(c.fvg, s.zone ? s.zone.type + " zone" : "FVG zone")}${ck(c.rr, s.rr != null ? `R:R ${s.rr.toFixed(1)}` : "R:R")}` +
    `${crtOk(p, s) ? '<span class="ok">✓ CRT confluence</span>' : ""}`;
  const t = s.q.tt || {};
  $("#swTT").innerHTML = `<i>TTrades checklist ${s.q.ttN || 0}/5</i>${ck(t.raid, "stop raid")}${ck(t.shift, "structure shift")}` +
    `${ck(t.pd, s.dir === 1 ? "entry in discount" : "entry in premium")}${ck(t.array, s.zone ? "PD array: " + s.zone.type : "PD array")}${ck(t.rr, "solid R:R (≥ 2)")}`;
  const L = [["Swept level", `${fmt(p, w.level)} <span class="muted">${T} swing ${up ? "low" : "high"}</span>`], ["Swing candle", when(w.swingT)],
    [`Sweep candle (${T})`, when(w.t)], ["Sweep extreme", fmt(p, s.ext != null ? s.ext : w.ext)], ["Back into range", w.live ? `${T} candle still open · closes in ${left(s)}` : "✓ closed back inside"],
    ["Sweep strength", w.depth.toFixed(2) + "× ATR"]];
  if (s.choch) L.push([`CHoCH (${LT})`, `${when(s.choch.t)} · ${fmt(p, s.choch.level)}`], ["Displacement", s.disp.toFixed(2) + `× ${LT} ATR`]);
  if (s.eq != null) L.push([s.dir === 1 ? "Discount below (50%)" : "Premium above (50%)", fmt(p, s.eq) + (s.pd ? " ✓" : " ✗")]);
  const o = s.order;
  if (s.zone) L.push(["Entry zone", `${s.zone.type} ${fmt(p, s.zone.lo)}–${fmt(p, s.zone.hi)} <span class="muted">formed ${when(s.zone.t)}</span>`]);
  if (o) L.push(["Order", `${o.side} limit ${fmt(p, o.price)} <span class="muted">${o.zoneType}</span>`],
    ["Order active from", `${when(o.activeT)} <span class="muted">${o.activeT === w.t + SEC[tf] ? T + " sweep candle closed" : "zone confirmed (" + LT + " candle after the CHoCH closed)"}</span>`],
    ["Order status", ORDST[o.state] + (o.why ? ` <span class="muted">${o.why}</span>` : "")], ["Stop", fmt(p, s.sl)]);
  L.push(["Target", w.target != null ? `${fmt(p, w.target)} <span class="muted">${T} ${w.targetLabel}</span>` : "–"]);
  if (s.rr != null) L.push(["R:R", s.rr.toFixed(2)]);
  if (s.dist != null && ACTIVE.includes(s.status)) L.push(["Distance to entry", s.dist.toFixed(1) + " " + unit(p)]);
  if (s.tFill) L.push([`Simulated entry (${o ? o.side : ""})`, `${when(s.tFill)} · ${fmt(p, s.fillPx)} <span class="muted">${LT} candle that touched the limit</span>`]);
  if (s.tExit && s.exitPx != null) L.push([s.status === "TARGET_HIT" ? "Exit – target" : "Exit – stop", `${when(s.tExit)} · ${fmt(p, s.exitPx)}` + (s.exitNote ? ` <span class="muted">${s.exitNote}</span>` : "")]);
  else if (s.tExit) L.push([o && o.state === "CANCELLED" ? "Order cancelled" : STATUS[s.status], when(s.tExit)]);
  if (s.tFill || s.tExit) L.push(["Note", '<span class="muted">Simulated from ' + LT + ' high/low only; the order of events inside one candle is not known.</span>']);
  $("#swLv").innerHTML = L.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join("");
  $("#swWhy").textContent = why(s, T, LT);
  draw4h(p, s, tf); draw15(p, s, tf);
}
function why(s, T, LT) {
  const w = s.sweep, side = s.dir === 1 ? "low" : "high";
  if (s.status === "SWEEPING") return `The current ${T} candle is beyond the ${T} swing ${side}. It becomes a sweep only if it closes back inside (closes in ${left(s)}).`;
  if (s.status === "SWEEP" || s.status === "NO_LTF") return `${T} swept the swing ${side} and closed back inside. Waiting for a ${LT} close through the last ${LT} swing ${s.dir === 1 ? "high" : "low"} (CHoCH).`;
  if (s.status === "CHOCH") return `${LT} CHoCH formed, but no FVG or order block was found for an entry.`;
  if (s.status === "ENTRY_READY" && s.order && s.order.state === "WAITING") return `Zone confirmed. The ${s.dir === 1 ? "buy" : "sell"} limit at ${s.entry} becomes active when the current ${LT} candle closes; stop ${s.sl}; target ${w.target}.`;
  if (s.status === "ENTRY_READY") return `Pending limit ${s.dir === 1 ? "buy" : "sell"} at ${s.entry} (near edge of the ${s.zone.type}); stop ${s.sl}; target ${w.target} (${T} ${w.targetLabel}).`;
  if (s.status === "ENTERED") return "Price came back to the entry; the trade is running.";
  return { TARGET_HIT: "Reached the opposite liquidity.", STOPPED: "Went beyond the sweep extreme after the entry.", INVALIDATED: "Went beyond the sweep extreme before the entry.",
    MISSED: "Reached the target without coming back to the entry.", EXPIRED: `No entry within 6 ${T} candles after the sweep.` }[s.status] || "";
}

/* ---------- charts ---------- */
function base(cv, cs, levels) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const C = { ink: css("--ink"), sec: css("--sec"), line: css("--line"), up: css("--green"), dn: css("--red"), blue: css("--blue"), amber: css("--amber"), tint: css("--tint") };
  const padR = 64, padB = 22, padT = 18, plotW = W - padR - 6, plotH = H - padB - padT;
  const lv = levels.filter(v => v != null && isFinite(v));
  let hi = Math.max(...cs.map(c => c[2]), ...lv), lo = Math.min(...cs.map(c => c[3]), ...lv);
  const pad = (hi - lo) * 0.06 || hi * 0.001; hi += pad; lo -= pad;
  const step = plotW / (cs.length + 3), bw = Math.max(1.2, step * 0.62);
  const X = i => 6 + step * (i + 0.5), Y = v => padT + (hi - v) / (hi - lo) * plotH;
  g.font = "11px -apple-system,Segoe UI,Roboto,sans-serif"; g.strokeStyle = C.line; g.fillStyle = C.sec; g.lineWidth = 1;
  return { g, C, W, H, padT, padB, plotW, step, bw, X, Y, lo, hi, tags: [] };
}
function candles(k, cs, fade) {
  const { g, C, X, Y, bw } = k;
  cs.forEach((c, i) => { const up = c[4] >= c[1]; g.globalAlpha = fade && fade(i) ? 0.35 : 1; g.strokeStyle = g.fillStyle = up ? C.up : C.dn;
    g.beginPath(); g.moveTo(X(i), Y(c[2])); g.lineTo(X(i), Y(c[3])); g.stroke();
    const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4])); g.fillRect(X(i) - bw / 2, y1, bw, Math.max(1, y2 - y1)); });
  g.globalAlpha = 1;
}
function grid(k, p) {
  const { g, C, Y, plotW, lo, hi } = k;
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); g.strokeStyle = C.line; g.beginPath(); g.moveTo(0, y); g.lineTo(plotW + 6, y); g.stroke();
    g.fillStyle = C.sec; g.fillText(fmt(p, v), plotW + 10, y + 4); }
}
function hline(k, v, col, txt, x0, dash, width) {
  if (v == null) return; const { g, Y, plotW } = k, y = Y(v);
  g.save(); g.strokeStyle = col; g.lineWidth = width || 1.4; g.setLineDash(dash ? [5, 4] : []); g.beginPath(); g.moveTo(x0, y); g.lineTo(plotW + 6, y); g.stroke(); g.restore();
  if (txt) k.tags.push([y, col, txt]);
}
function label(k, txt, x, y, col, align) {
  const { g } = k; g.save(); g.font = "bold 10px -apple-system,Segoe UI,Roboto,sans-serif"; g.fillStyle = col; g.textAlign = align || "center";
  const wd = g.measureText(txt).width, lo = (align === "left" ? 0 : align === "right" ? wd : wd / 2) + 2, hi = k.plotW + 4 - (align === "left" ? wd : align === "right" ? 0 : wd / 2);
  g.fillText(txt, Math.max(lo, Math.min(hi, x)), y); g.restore();     // keep labels inside the plot
}
function finish(k, cs, intraday, p, price) {
  const { g, C, X, H, plotW } = k;
  g.font = "10px -apple-system,Segoe UI,Roboto,sans-serif"; g.fillStyle = C.sec; g.textAlign = "center";
  const every = Math.max(1, Math.ceil(cs.length / 4));
  cs.forEach((c, i) => { if (i % every === 1 || every === 1) { const d = new Date(c[0] * 1000);
    g.fillText(d.toLocaleDateString([], { day: "2-digit", month: "short" }) + (intraday ? " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : ""), X(i), H - 6); } });
  g.textAlign = "left";
  if (price != null) k.tags.push([k.Y(price), C.blue, fmt(p, price)]);
  k.tags.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < k.tags.length; i++) if (k.tags[i][0] - k.tags[i - 1][0] < 17) k.tags[i][0] = k.tags[i - 1][0] + 17;
  g.font = "bold 10px -apple-system,Segoe UI,Roboto,sans-serif";
  k.tags.forEach(([y, col, txt]) => { g.fillStyle = col; g.fillRect(plotW + 6, y - 8, 64, 16); g.fillStyle = "#fff"; g.fillText(txt, plotW + 10, y + 4); });
}
function draw4h(p, s, tf) {
  const cv = $("#swCv1"), all = htfCandles(p, tf), w = s.sweep, d = s.dir, T = TFN[tf];
  if (all.length < 5) return;
  const iSwAll = all.findIndex(c => c[0] === w.swingT);
  // last 40 candles; reach further back (up to 60) so the swing candle itself is on the chart
  const N = cv.clientWidth < 500 ? 26 : 40;
  let start = Math.max(0, all.length - N);
  if (iSwAll >= 0 && iSwAll - 3 < start) start = Math.max(0, iSwAll - 3, all.length - Math.round(N * 1.5));
  const cs = all.slice(start), idx = t => cs.findIndex(c => c[0] === t);
  const iS = idx(w.t), iW = idx(w.swingT);
  const k = base(cv, cs, [w.level, w.ext, w.target, s.entry, s.sl]); const { g, C, X, Y, step, plotW, padT, H, padB } = k;
  const col = d === 1 ? C.up : C.dn;
  grid(k, p);
  if (iS >= 0) { g.save(); g.globalAlpha = .18; g.fillStyle = C.amber; g.fillRect(X(iS) - step / 2, padT - 4, step, H - padB - padT + 4); g.restore(); }
  candles(k, cs);
  // swing level: solid from the swing candle to the sweep candle, dashed afterwards
  const xs = iW >= 0 ? X(iW) : 0, xe = iS >= 0 ? X(iS) + step / 2 : plotW + 6;
  g.save(); g.strokeStyle = C.amber; g.lineWidth = 2; g.beginPath(); g.moveTo(xs, Y(w.level)); g.lineTo(xe, Y(w.level)); g.stroke();
  g.setLineDash([4, 4]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(xe, Y(w.level)); g.lineTo(plotW + 6, Y(w.level)); g.stroke(); g.restore();
  if (iW >= 0) { g.fillStyle = C.amber; g.beginPath(); g.arc(X(iW), Y(w.level), 3.5, 0, 7); g.fill(); }
  const right = xs > plotW * 0.55;          // keep the label clear of the price axis
  label(k, `${T} swing ${d === 1 ? "low" : "high"}`, right ? xs - 6 : xs + 4, d === 1 ? Y(w.level) + 13 : Y(w.level) - 6, C.amber, right ? "right" : "left");
  k.tags.push([Y(w.level), C.amber, `${T} level`]);
  if (iS >= 0) {           // the part of the sweep candle beyond the level
    g.save(); g.strokeStyle = C.dn; g.lineWidth = Math.max(3, k.bw * .35); g.lineCap = "round"; g.beginPath(); g.moveTo(X(iS), Y(w.level)); g.lineTo(X(iS), Y(w.ext)); g.stroke(); g.restore();
    g.fillStyle = C.dn; g.beginPath(); g.arc(X(iS), Y(w.ext), 4, 0, 7); g.fill();
    label(k, "Sweep", X(iS) + 7, d === 1 ? Y(w.ext) + 4 : Y(w.ext) + 4, C.dn, "left");
    const c = cs[iS];
    label(k, w.live ? "still open" : "back inside ✓", X(iS), d === 1 ? Math.max(padT + 8, Y(c[2]) - 6) : Math.min(H - padB - 4, Y(c[3]) + 14), w.live ? C.amber : col);
  }
  if (w.target != null) hline(k, w.target, C.blue, "TP", iS >= 0 ? X(iS) : 0, false);
  if (s.order) {            // from the higher-timeframe candle in which the order became active
    let iA = -1; for (let i = 0; i < cs.length; i++) if (cs[i][0] <= s.order.activeT) iA = i;
    const x0 = iA >= 0 ? X(iA) - step / 2 : 0, filled = s.order.state === "FILLED";
    hline(k, s.entry, col, filled ? "Entry" : s.order.side + " LMT", x0, !filled, filled ? 1.6 : 1.3); hline(k, s.sl, C.dn, "SL", x0, true);
  } else if (s.entry != null) { hline(k, s.entry, col, "Entry", 0, true); hline(k, s.sl, C.dn, "SL", 0, true); }
  finish(k, cs, tf !== "D", p, p.price);
}
function draw15(p, s, tf) {
  const cv = $("#swCv2"), all = ltfCandles(p, tf), w = s.sweep, d = s.dir, T = TFN[tf], LT = LTFN[tf];
  const c4 = htfCandles(p, tf);
  const k0 = c4.findIndex(c => c[0] === w.t), tPrev = k0 > 0 ? c4[k0 - 1][0] : w.t - SEC[tf];
  let start = all.findIndex(c => c[0] >= tPrev);
  if (start < 0 || all.length - start < 3) { const k = base(cv, all.length ? all.slice(-20) : [[0, 1, 1, 1, 1]], []); k.g.fillStyle = k.C.sec; k.g.fillText(`No ${LT} candles for this sweep in the current data.`, 10, k.H / 2); return; }
  if (all.length - start > 190) {          // trim old candles, but never past the start of the setup (extreme, CHoCH reference, zone)
    const anc = Math.min(...[s.extT, s.choch && s.choch.refT, s.zone && s.zone.t].filter(v => v != null)), ia = isFinite(anc) ? all.findIndex(c => c[0] >= anc) : -1;
    start = Math.max(start, Math.min(all.length - 190, ia >= 0 ? ia - 4 : all.length));
  }
  const cs = all.slice(start), idx = t => cs.findIndex(c => c[0] === t);
  const k = base(cv, cs, [w.level, s.ext, s.eq, s.choch && s.choch.level, s.watch && s.watch.level, s.zone && s.zone.lo, s.zone && s.zone.hi, s.sl, s.entry]);
  const { g, C, X, Y, step, plotW, padT, H, padB } = k, col = d === 1 ? C.up : C.dn;
  grid(k, p);
  // higher-timeframe candle boundaries; the sweep candle is shaded
  for (let i = 0; i < c4.length; i++) {
    const t = c4[i][0], a = cs.findIndex(c => c[0] >= t); if (a < 0) continue;
    const bEnd = i + 1 < c4.length ? cs.findIndex(c => c[0] >= c4[i + 1][0]) : -1, x1 = X(a) - step / 2, x2 = (bEnd < 0 ? X(cs.length - 1) : X(bEnd)) - step / 2;
    if (t === w.t) { g.save(); g.globalAlpha = .14; g.fillStyle = C.amber; g.fillRect(x1, padT - 4, Math.max(2, x2 - x1), H - padB - padT + 4); g.restore(); label(k, `${T} sweep candle`, (x1 + x2) / 2, padT + 2, C.amber); }
    g.save(); g.strokeStyle = C.sec; g.globalAlpha = .45; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x1, padT - 4); g.lineTo(x1, H - padB); g.stroke(); g.restore();
  }
  // entry zone (behind the candles)
  if (s.zone) {
    const iz = Math.max(0, idx(s.zone.t)), x1 = X(iz) - step / 2;
    g.save(); g.globalAlpha = .16; g.fillStyle = C.blue; g.fillRect(x1, Y(s.zone.hi), plotW + 6 - x1, Y(s.zone.lo) - Y(s.zone.hi)); g.restore();
    g.save(); g.strokeStyle = C.blue; g.lineWidth = 1; g.strokeRect(x1, Y(s.zone.hi), plotW + 6 - x1, Y(s.zone.lo) - Y(s.zone.hi)); g.restore();
    label(k, s.zone.type, x1 + 4, Y(s.zone.hi) - 4, C.blue, "left");
  }
  candles(k, cs);
  hline(k, w.level, C.amber, `${T} level`, 0, true, 1.2);
  const iX = s.extT ? idx(s.extT) : -1;
  if (iX >= 0) { g.fillStyle = C.dn; g.beginPath(); g.arc(X(iX), Y(s.ext), 4, 0, 7); g.fill(); label(k, "Sweep", X(iX), d === 1 ? Y(s.ext) + 15 : Y(s.ext) - 8, C.dn); }
  if (!s.choch && s.watch) {             // no CHoCH yet: the 15m level that has to break
    const iR = idx(s.watch.t), y = Y(s.watch.level);
    g.save(); g.strokeStyle = col; g.lineWidth = 1.4; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(iR >= 0 ? X(iR) : 0, y); g.lineTo(plotW + 6, y); g.stroke(); g.restore();
    label(k, "CHoCH level", iR >= 0 ? X(iR) + 4 : 4, d === 1 ? y - 6 : y + 14, col, "left"); k.tags.push([y, col, "CHoCH?"]);
  }
  if (s.choch) {
    const iR = idx(s.choch.refT), iC = idx(s.choch.t), y = Y(s.choch.level);
    g.save(); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(iR >= 0 ? X(iR) : 0, y); g.lineTo(iC >= 0 ? X(iC) + step / 2 : plotW + 6, y); g.stroke(); g.restore();
    label(k, "CHoCH", iC >= 0 ? X(iC) : plotW - 20, d === 1 ? y - 6 : y + 14, col);
    const iD = idx(s.dispT);
    if (iD >= 0) { const c = cs[iD]; g.save(); g.strokeStyle = C.amber; g.lineWidth = 2; g.strokeRect(X(iD) - step / 2, Y(c[2]) - 3, step, Y(c[3]) - Y(c[2]) + 6); g.restore();
      label(k, `Disp ${s.disp.toFixed(1)}×`, X(iD), d === 1 ? Math.min(H - padB - 2, Y(c[3]) + 15) : Math.max(padT + 10, Y(c[2]) - 7), C.amber); }
  }
  if (s.eq != null) hline(k, s.eq, C.sec, "50%", Math.max(0, X(Math.max(0, idx(s.extT))) - step / 2), true, 1);
  if (w.target != null && (s.entry != null || s.choch)) hline(k, w.target, C.blue, "TP", 0, true);
  if (s.order) drawOrder(k, cs, s, d, col);
  else if (s.entry != null) { hline(k, s.entry, col, "Entry", 0, true); hline(k, s.sl, C.dn, "SL", 0, true); }   // data from before the order marks existed
  finish(k, cs, true, p, p.price);
}

// order marks: pending limit (dashed, from the activation candle), simulated fill (solid arrow on the touching candle),
// stop exit (red cross at the stop price), target exit (blue circle at the target price); never before the order was active
function drawOrder(k, cs, s, d, col) {
  const { g, C, X, Y, step, plotW, padT, H, padB } = k, o = s.order, at = t => cs.findIndex(c => c[0] >= t), hm = t => { const z = new Date(t * 1000);
    return String(z.getHours()).padStart(2, "0") + ":" + String(z.getMinutes()).padStart(2, "0"); };
  const iA = at(o.activeT), xA = iA >= 0 ? X(iA) - step / 2 : X(cs.length - 1) + step / 2;
  const iF = s.tFill ? cs.findIndex(c => c[0] === s.tFill) : -1, iE = s.tExit ? cs.findIndex(c => c[0] === s.tExit) : -1;
  const yE = Y(o.price), xF = iF >= 0 ? X(iF) : null;
  const xEnd = o.state === "CANCELLED" && iE >= 0 ? X(iE) + step / 2 : plotW + 6;
  // stop line from activation
  g.save(); g.strokeStyle = C.dn; g.lineWidth = 1.2; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(xA, Y(s.sl)); g.lineTo(plotW + 6, Y(s.sl)); g.stroke(); g.restore();
  k.tags.push([Y(s.sl), C.dn, "SL"]);
  // pending part: dashed, thin; grey once cancelled
  const pendCol = o.state === "CANCELLED" ? C.sec : col;
  g.save(); g.strokeStyle = pendCol; g.lineWidth = 1.4; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(xA, yE); g.lineTo(xF != null ? xF : xEnd, yE); g.stroke(); g.restore();
  // activation tick: hollow diamond
  g.save(); g.strokeStyle = pendCol; g.fillStyle = css("--card") || "#fff"; g.lineWidth = 1.5; g.beginPath();
  g.moveTo(xA, yE - 5); g.lineTo(xA + 5, yE); g.lineTo(xA, yE + 5); g.lineTo(xA - 5, yE); g.closePath(); g.fill(); g.stroke(); g.restore();
  const pend = o.state === "WAITING" ? "limit – active next candle" : o.state === "CANCELLED" ? `${o.side} limit cancelled` : `pending ${o.side} limit`;
  if (xF == null || xF - xA > 70) label(k, pend, Math.min(xA + 8, plotW - 110), d === 1 ? yE + 13 : yE - 6, pendCol, "left");
  if (o.state === "CANCELLED" && iE >= 0) label(k, "✕", X(iE), yE + 4, C.sec);
  // filled part: solid, thicker
  if (xF != null) {
    const xs = iE >= 0 && s.exitPx != null ? X(iE) : plotW + 6;
    g.save(); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(xF, yE); g.lineTo(xs, yE); g.stroke(); g.restore();
    const c = cs[iF], ya = d === 1 ? Y(c[3]) + 6 : Y(c[2]) - 6, dir = d === 1 ? 1 : -1;      // arrow below a buy candle pointing up, above a sell candle pointing down
    g.save(); g.fillStyle = col; g.beginPath(); g.moveTo(X(iF), ya); g.lineTo(X(iF) - 6, ya + 9 * dir); g.lineTo(X(iF) - 2.2, ya + 9 * dir); g.lineTo(X(iF) - 2.2, ya + 17 * dir);
    g.lineTo(X(iF) + 2.2, ya + 17 * dir); g.lineTo(X(iF) + 2.2, ya + 9 * dir); g.lineTo(X(iF) + 6, ya + 9 * dir); g.closePath(); g.fill(); g.restore();
    g.save(); g.fillStyle = col; g.beginPath(); g.arc(X(iF), yE, 3, 0, 7); g.fill(); g.restore();
    const ly = d === 1 ? Math.min(H - padB - 2, ya + 29) : Math.max(padT + 10, ya - 21);
    label(k, `${o.side} ${hm(s.tFill)}`, X(iF), ly, col);
    k.tags.push([yE, col, "Entry"]);
  } else k.tags.push([yE, pendCol, o.side + " LMT"]);
  // exit marks
  if (iE >= 0 && s.exitPx != null) {
    const y = Y(s.exitPx), x = X(iE), note = s.exitNote ? "*" : "";
    if (s.status === "STOPPED") {
      g.save(); g.strokeStyle = C.dn; g.lineWidth = 2.4; g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.stroke(); g.restore();
      label(k, "SL" + note + " " + hm(s.tExit), x, d === 1 ? y + 16 : y - 9, C.dn);
    } else {
      g.save(); g.fillStyle = C.blue; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.restore(); label(k, "✓", x, y + 3.5, "#fff");
      label(k, "TP " + hm(s.tExit), x, d === 1 ? y - 10 : y + 18, C.blue);
    }
  }
}

/* ---------- export ---------- */
function csv() {
  const head = ["symbol", "timeframe", "direction", "sweep_time_utc", "status", "swing_level", "swing_size_atr", "sweep_extreme", "sweep_strength_atr", "choch_time_utc",
    "choch_level", "displacement_atr", "zone_type", "zone_low", "zone_high", "entry", "stop", "target", "target_type", "rr", "distance_pips", "grade", "crt_confluence"];
  const iso = t => t ? new Date(t * 1000).toISOString().replace(".000", "") : "";
  const r2 = (v, n) => v == null ? "" : Number(v).toFixed(n);
  const lines = allRows().filter(x => passes(x.p, x.s)).map(({ p, s, tf }) => { const w = s.sweep, dg = digits(p) + 1;
    return [p.sym, TFN[tf], s.dir === 1 ? "bullish" : "bearish", iso(w.t), STATUS[s.status] || s.status, r2(w.level, dg), r2(w.swingSize, 2), r2(s.ext != null ? s.ext : w.ext, dg), r2(w.depth, 2),
      iso(s.choch && s.choch.t), r2(s.choch && s.choch.level, dg), r2(s.disp, 2), s.zone ? s.zone.type : "", r2(s.zone && s.zone.lo, dg), r2(s.zone && s.zone.hi, dg),
      r2(s.entry, dg), r2(s.sl, dg), r2(w.target, dg), w.targetLabel || "", r2(s.rr, 2), r2(s.dist, 1), s.q.grade, crtOk(p, s) ? "yes" : "no"].join(","); });
  const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ict-sweeps-${new Date().toISOString().slice(0, 16).replace(":", "")}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- Telegram (optional, only while the app is open) ---------- */
let tg = Object.assign({ token: "", chat: "", on: false }, ls.get("sw-tg", {}));
function tgSend(text) {
  if (!tg.token || !tg.chat) return false;
  // GET with no-cors: the browser sends it even though Telegram's reply cannot be read here
  fetch(`https://api.telegram.org/bot${encodeURIComponent(tg.token).replace(/%3A/g, ":")}/sendMessage?chat_id=${encodeURIComponent(tg.chat)}&text=${encodeURIComponent(text)}`, { mode: "no-cors" }).catch(() => {});
  return true;
}
function alerts() {
  if (!tg.on || !tg.token || !tg.chat) return;
  const sent = new Set(ls.get("sw-sent", []));
  let n = 0;
  for (const { p, s, id, tf } of allRows()) {
    if (s.status !== "ENTRY_READY" || !passes(p, s) || sent.has(id)) continue;
    const w = s.sweep, up = s.dir === 1;
    tgSend(`ICT ${TFN[tf]} Sweep – ${p.sym} ${up ? "▲ Bullish" : "▼ Bearish"} (grade ${s.q.grade})\nEntry ready: ${up ? "buy" : "sell"} limit ${fmt(p, s.entry)} (${s.zone.type})\n` +
      `Stop ${fmt(p, s.sl)} · Target ${fmt(p, w.target)} · R:R ${s.rr != null ? s.rr.toFixed(1) : "–"}\nSwept ${TFN[tf]} swing ${up ? "low" : "high"} ${fmt(p, w.level)} at ${when(w.t)}${crtOk(p, s) ? " · CRT ✓" : ""}`);
    sent.add(id); n++;
  }
  if (n) { ls.set("sw-sent", [...sent].slice(-300)); $("#tgState").textContent = `Sent ${n} alert${n > 1 ? "s" : ""} at ${new Date().toLocaleTimeString()}.`; }
}

/* ---------- tabs and theme ---------- */
function setTab(t) {
  document.querySelectorAll("#appTab button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  $("#crtView").hidden = t !== "crt"; $("#swView").hidden = t !== "sweep"; ls.set("fx-tab", t);
  document.querySelector("header h1").textContent = t === "sweep" ? "ICT Sweeps" : "Forex CRT";
}
function applyTheme(m) {
  if (m === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = m;
  $("#theme").textContent = m === "dark" ? "☾" : m === "light" ? "☀" : "◐";
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = css("--navy") || "#4C1D95";
  window.dispatchEvent(new Event("resize"));      // redraw open charts in the new colours
  if (openId) drawDetail();
}

/* ---------- wiring ---------- */
function syncInputs() { $("#fSweep").value = F.sweep; $("#fDisp").value = F.disp; $("#fSwing").value = F.swing; $("#fGrade").value = F.grade; $("#fCrt").checked = F.crt; $("#fFinished").checked = F.finished; $("#fTT").checked = !!F.tt; }
function readInputs() { const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) ? v : d; };
  F = { sweep: num("#fSweep", DEF.sweep), disp: num("#fDisp", DEF.disp), swing: num("#fSwing", DEF.swing), grade: $("#fGrade").value, crt: $("#fCrt").checked, finished: $("#fFinished").checked, tt: $("#fTT").checked };
  ls.set("sw-f", F); render(); }
["#fSweep", "#fDisp", "#fSwing", "#fGrade", "#fCrt", "#fFinished", "#fTT"].forEach(id => $(id).addEventListener("change", readInputs));
$("#swReset").onclick = () => { F = Object.assign({}, DEF); ls.set("sw-f", F); syncInputs(); render(); };
$("#swChips").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; st = b.dataset.st; ls.set("sw-st", st); render(); });
$("#swDir").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; dir = +b.dataset.dir;
  document.querySelectorAll("#swDir .chip").forEach(x => x.classList.toggle("on", x === b)); render(); });
document.addEventListener("click", e => { const r = e.target.closest("tr[data-sw]"); if (r) openDetail(r.dataset.sw); });
$("#swClose").onclick = closeDetail;
$("#swSheet").addEventListener("click", e => { if (e.target.id === "swSheet") closeDetail(); });
$("#swCsv").onclick = csv;
$("#swTf").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; tfSel = b.dataset.tf; ls.set("sw-tf", tfSel); render(); });
$("#swMx").addEventListener("click", e => { const b = e.target.closest("button[data-mx]"); if (!b) return; tfSel = b.dataset.tf; ls.set("sw-tf", tfSel); render(); openDetail(b.dataset.mx); });
$("#appTab").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setTab(b.dataset.tab); });
$("#theme").onclick = () => { const cur = ls.get("fx-theme", "dark"), nx = cur === "dark" ? "light" : cur === "light" ? "auto" : "dark"; ls.set("fx-theme", nx); applyTheme(nx); };
$("#tgToken").value = tg.token; $("#tgChat").value = tg.chat; $("#tgOn").checked = tg.on;
$("#tgSave").onclick = () => { tg = { token: $("#tgToken").value.trim(), chat: $("#tgChat").value.trim(), on: $("#tgOn").checked }; ls.set("sw-tg", tg);
  $("#tgState").textContent = tg.on ? "Saved – alerts on while the app is open." : "Saved – alerts off."; alerts(); };
$("#tgTest").onclick = () => { $("#tgState").textContent = tgSend("ICT 4H Sweep: test message from your Forex CRT app ✓") ? "Test sent – check Telegram (nothing arrives = wrong token or chat id)." : "Enter the bot token and chat id first."; };
addEventListener("resize", () => { if (openId) drawDetail(); });
window.addEventListener("fxdata", e => { data = e.detail; render(); alerts(); });
syncInputs(); setTab(ls.get("fx-tab", "crt")); applyTheme(ls.get("fx-theme", "dark"));
if (window.FXApp && window.FXApp.data) { data = window.FXApp.data; render(); }
})();
