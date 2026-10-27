/* Forex CRT live engine: fetches candles through the forex-proxy Cloudflare Worker and builds
 * the same result as scripts/forex_crt.py (the GitHub scan), on the phone, every minute.
 * window.FXLive.load(url) -> Promise<data> (same shape as data/crt.json).
 */
(() => {
"use strict";
const PAIRS = [
  ["EURUSD", "EURUSD=X", 0.0001], ["GBPUSD", "GBPUSD=X", 0.0001], ["USDJPY", "JPY=X", 0.01],
  ["USDCHF", "CHF=X", 0.0001], ["AUDUSD", "AUDUSD=X", 0.0001], ["NZDUSD", "NZDUSD=X", 0.0001],
  ["USDCAD", "CAD=X", 0.0001], ["EURJPY", "EURJPY=X", 0.01], ["GBPJPY", "GBPJPY=X", 0.01],
  ["EURGBP", "EURGBP=X", 0.0001], ["AUDJPY", "AUDJPY=X", 0.01], ["EURAUD", "EURAUD=X", 0.0001],
  ["XAUUSD", "GC=F", 0.1],
];
const NEAR = 0.25;
const KEEP = { "1H": 100, "4H": 100, D: 60, W: 60 }, LTF_KEEP = { "15m": 72, "5m": 54 };
const TF_HOURS = { "1H": 1, "4H": 4, D: 24, W: 120 };
const H = 3600, DAY = 86400;

/* New York local time (seconds) for a UTC timestamp, DST-aware */
const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const offCache = new Map();
function nyLocal(ts) {
  const hourKey = Math.floor(ts / H);
  let off = offCache.get(hourKey);
  if (off === undefined) {
    const p = {}; nyFmt.formatToParts(new Date(ts * 1000)).forEach(x => p[x.type] = x.value);
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) / 1000;
    off = asUtc - Math.floor(ts / 60) * 60;
    offCache.set(hourKey, off);
  }
  return ts + off;
}

/* hourly bars [{t,o,h,l,c}] -> {1H,4H,D,W} arrays of [t,o,h,l,c] (t = first bar's UTC time) */
function build(bars) {
  const out = { "1H": bars.map(b => [b.t, b.o, b.h, b.l, b.c]) };
  const group = keyFn => {
    const res = []; let cur = null, ck = null;
    for (const b of bars) {
      const k = keyFn(nyLocal(b.t));
      if (k !== ck) { if (cur) res.push(cur); cur = [b.t, b.o, b.h, b.l, b.c]; ck = k; }
      else { cur[2] = Math.max(cur[2], b.h); cur[3] = Math.min(cur[3], b.l); cur[4] = b.c; }
    }
    if (cur) res.push(cur);
    return res;
  };
  out["4H"] = group(L => Math.floor((L - H) / (4 * H)));            // blocks 01,05,09,13,17,21 NY
  const dayKey = L => Math.floor((L + 7 * H) / DAY);                 // trading day starts 17:00 NY
  out.D = group(dayKey);
  out.W = group(L => Math.floor((dayKey(L) - 4) / 7));               // Monday..Sunday trading weeks
  return out;
}

function round(v, dg) { const f = Math.pow(10, dg); return Math.round(v * f) / f; }

function classify(cs, tf, pip) {
  if (cs.length < 3) return null;
  const [, o0, h0, l0, c0] = cs[cs.length - 1], [, o1, h1, l1, c1] = cs[cs.length - 2], [, , h2, l2] = cs[cs.length - 3];
  const price = c0;
  let res = { status: "none", dir: 0 };
  let bull = l1 < l2 && l2 < c1 && c1 < h2, bear = h1 > h2 && l2 < c1 && c1 < h2;
  if (bull && bear) { bull = c1 >= o1; bear = !bull; }
  let formed = null;
  if (bull || bear) {
    const d = bull ? 1 : -1, t2 = d === 1 ? h2 : l2, t1 = (h2 + l2) / 2, inv = d === 1 ? l1 : h1;
    const hit2 = d === 1 ? h0 >= t2 : l0 <= t2, hit1 = d === 1 ? h0 >= t1 : l0 <= t1, failed = d === 1 ? l0 < inv : h0 > inv;
    const risk = Math.abs(price - inv);
    formed = { status: "formed", dir: d, t1, t2, inv, c1h: h2, c1l: l2, sweep: d === 1 ? l1 : h1, hit1, hit2, failed,
      toT2: round((t2 - price) * d / pip, 1), rr: risk > 0 ? round(Math.abs(t2 - price) / risk, 2) : null };
  }
  let live = null;
  const sl = l0 < l1, sh = h0 > h1;
  if (sl || sh) {
    const d = sl && sh ? (price >= o0 ? 1 : -1) : sl ? 1 : -1;
    const level = d === 1 ? l1 : h1, inside = l1 < price && price < h1;
    live = { status: inside ? "forming" : "sweeping", dir: d, level, sweep: d === 1 ? l0 : h0, t2: d === 1 ? h1 : l1, t1: (h1 + l1) / 2, c1h: h1, c1l: l1 };
  } else {
    const rng = h1 - l1;
    if (rng > 0) {
      const dl = (price - l1) / rng, dh = (h1 - price) / rng;
      if (dl <= NEAR || dh <= NEAR) {
        const d = dl <= dh ? 1 : -1, level = d === 1 ? l1 : h1;
        live = { status: "anticipated", dir: d, level, dist: round(Math.abs(price - level) / pip, 1), c1h: h1, c1l: l1, t2: d === 1 ? h1 : l1 };
      }
    }
  }
  if (formed && !formed.failed && !formed.hit2) { res = formed; if (live && (live.status === "forming" || live.status === "sweeping")) res.also = live.status; }
  else if (live && (live.status === "forming" || live.status === "sweeping")) res = live;
  else if (formed) { res = formed; res.status = formed.hit2 ? "done" : "failed"; }
  else if (live) res = live;
  res.price = price;
  const start = cs[cs.length - 1][0];
  res.end = tf !== "W" ? (start + TF_HOURS[tf] * H) * 1000 : null;
  const dg = pip >= 0.1 ? 2 : pip >= 0.01 ? 3 : 5;
  res.candles = cs.slice(-KEEP[tf]).map(c => [c[0], round(c[1], dg), round(c[2], dg), round(c[3], dg), round(c[4], dg)]);
  for (const k of ["t1", "t2", "inv", "c1h", "c1l", "sweep", "level", "price"]) if (typeof res[k] === "number") res[k] = round(res[k], dg + 1);
  return res;
}

/* ---- fetching with an hourly cache: full history once, then only the last day ---- */
const store = {};   // ysym -> Map(t -> bar)
async function get(base, sym, interval, range) {
  const r = await fetch(`${base}?symbol=${encodeURIComponent(sym)}&interval=${interval}&range=${range}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${sym} ${interval}: HTTP ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(`${sym} ${interval}: ${d.error}`);
  return d.t.map((t, i) => ({ t, o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i] }));
}
async function pair(base, [name, ysym, pip]) {
  const fresh = !store[ysym];
  const hourly = await get(base, ysym, "1h", fresh ? "6mo" : "2d");
  if (fresh) store[ysym] = new Map();
  const m = store[ysym];
  hourly.forEach(b => m.set(b.t, b));
  const bars = [...m.values()].sort((a, b) => a.t - b.t);
  if (bars.length < 50) throw new Error(name + ": not enough data");
  const tfs = build(bars), row = { sym: name, pip, src: ysym, tf: {}, price: bars[bars.length - 1].c, ltf: {} };
  for (const tf of ["1H", "4H", "D", "W"]) { const r = classify(tfs[tf], tf, pip); if (r) row.tf[tf] = r; }
  const dg = pip >= 0.1 ? 2 : pip >= 0.01 ? 3 : 5;
  const [m15, m5] = await Promise.all([get(base, ysym, "15m", "5d").catch(() => []), get(base, ysym, "5m", "1d").catch(() => [])]);
  row.ltf["15m"] = m15.slice(-LTF_KEEP["15m"]).map(b => [b.t, round(b.o, dg), round(b.h, dg), round(b.l, dg), round(b.c, dg)]);
  row.ltf["5m"] = m5.slice(-LTF_KEEP["5m"]).map(b => [b.t, round(b.o, dg), round(b.h, dg), round(b.l, dg), round(b.c, dg)]);
  return row;
}
async function load(base) {
  const rows = await Promise.all(PAIRS.map(p => pair(base, p).catch(e => { console.warn(e.message); return null; })));
  const pairs = rows.filter(Boolean);
  if (!pairs.length) throw new Error("live data unavailable");
  return { updated: new Date().toISOString(), near: NEAR, pairs, live: true, missing: rows.length - pairs.length };
}
window.FXLive = { load, build, classify, PAIRS };
})();
