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
  ["XAUUSD", "GC=F", 0.1], ["NAS100", "NQ=F", 1], ["US30", "YM=F", 1], ["US500", "ES=F", 1],   // indices: CME futures, pip = 1 point
];
const NEAR = 0.25;
const KEEP = { "1H": 100, "4H": 100, D: 60, W: 60, M: 24 }, LTF_KEEP = { "15m": 320, "5m": 320 };
const TF_HOURS = { "1H": 1, "4H": 4, D: 24, W: 120, M: 0 };
const LTF_FOR = { M: "D", W: "4H", D: "1H", "4H": "15m", "1H": "5m" };
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
  out["2H"] = group(L => Math.floor((L - H) / (2 * H)));            // blocks 17,19,21,23,01,03.. NY (inside the 4H blocks)
  const dayKey = L => Math.floor((L + 7 * H) / DAY);                 // trading day starts 17:00 NY
  out.D = group(dayKey);
  out.W = group(L => Math.floor((dayKey(L) - 4) / 7));               // Monday..Sunday trading weeks
  out.M = group(L => { const d = new Date(dayKey(L) * DAY * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); });
  return out;
}

function round(v, dg) { const f = Math.pow(10, dg); return Math.round(v * f) / f; }

const ENGINE = "crt-engine-2026-10-28";   // shared with scripts/forex_crt.py ENGINE
const LOOK = 10;            // how far back C1 (the range candle) can be
const TWO_SIDED = "ambiguous";   // a C2 that sweeps both C1 boundaries is AMBIGUOUS; "outer-third" = old experimental rule
const ACTIVE = 2;          // a formed CRT keeps its original C1/C2 pair through C3 and C4 (C2 up to 2 closed candles back)

/* OHLC sanity: finite, positive, high >= low and the high/low envelope the open/close. */
const okBar = c => !!c && [c[1], c[2], c[3], c[4]].every(Number.isFinite) && c[3] > 0 && c[2] >= c[3] &&
  c[2] >= Math.max(c[1], c[4]) && c[3] <= Math.min(c[1], c[4]);
/* Raw bars [{t,o,h,l,c}] -> sorted, one bar per timestamp (the later copy wins), malformed bars dropped. */
function clean(bars) {
  const m = new Map();
  for (const b of bars || []) if (b && Number.isFinite(b.t) && okBar([b.t, b.o, b.h, b.l, b.c])) m.set(b.t, b);
  return [...m.values()].sort((x, y) => x.t - y.t);
}

/* C1 = the range candle for a C2 at i + 1: the furthest-back candle (up to LOOK) whose high-low range contains every
 * candle after it up to candle i (equal highs/lows count as inside). Only candles 0..i are used, so the choice can
 * never depend on C2 or anything later. A candle that broke the range ends that range: the next range is younger. */
function mother(cs, i) {
  let best = i, hi = cs[i][2], lo = cs[i][3];
  for (let k = i - 1; k >= Math.max(0, i - LOOK); k--) {
    if (cs[k][2] >= hi && cs[k][3] <= lo) best = k;
    hi = Math.max(hi, cs[k][2]); lo = Math.min(lo, cs[k][3]);
  }
  return best;
}
/* Identification only (no screener filters): is candle j a C2 of the range candle before it?
 * Uses candles 0..j only. live = candle j is still open (its close is the current price).
 * code: FORMED | BREAKOUT | REJECTED | AMBIGUOUS | NO_SWEEP | INVALID_DATA (closed), FORMING | SWEEPING (live). */
function identify(cs, j, live) {
  const out = (code, reason, x) => Object.assign({ code, reason, dir: 0, c2: j }, x || {});
  if (j < 1 || j >= cs.length) return out("INVALID_DATA", "not enough candles");
  const C2 = cs[j];
  if (!okBar(C2)) return out("INVALID_DATA", "C2 candle has bad OHLC data");
  const m = mother(cs, j - 1), C1 = cs[m];
  const base = { c1: m, c1t: C1[0], c2t: C2[0], c1h: C1[2], c1l: C1[3] };
  if (!okBar(C1) || !(C1[2] > C1[3])) return out("INVALID_DATA", "C1 has bad data or no range", base);
  const H1 = C1[2], L1 = C1[3], h2 = C2[2], l2 = C2[3], c2 = C2[4];
  const sl = l2 < L1, sh = h2 > H1;          // strict: touching the boundary is not a sweep
  if (!sl && !sh) return out("NO_SWEEP", l2 === L1 || h2 === H1 ? "touched C1's high/low without trading through it" : "stayed inside C1", base);
  let d = sl ? 1 : -1, note = "";
  if (sl && sh) {
    const pos = (c2 - l2) / (h2 - l2);
    if (TWO_SIDED !== "outer-third" || !(pos >= 2 / 3 || pos <= 1 / 3)) return out("AMBIGUOUS", "swept both C1's high and low", base);
    d = pos >= 2 / 3 ? 1 : -1; note = " (two-sided sweep, outer-third rule)";
  }
  base.dir = d; base.sweep = d === 1 ? l2 : h2;
  const side = d === 1 ? "low" : "high", inside = L1 < c2 && c2 < H1;
  if (live) return out(inside ? "FORMING" : "SWEEPING", (inside ? `swept C1's ${side}, price back inside` : `trading beyond C1's ${side}`) + note, base);
  if (inside) return out("FORMED", `swept C1's ${side} and closed back inside` + note, base);
  if (c2 === L1 || c2 === H1) return out("REJECTED", `swept C1's ${side} but closed exactly on C1's edge (strict rule)`, base);
  return out("BREAKOUT", `swept C1's ${side} and closed outside C1`, base);
}
function classify(cs, tf, pip) {
  const n = cs.length;
  if (n < 3) return null;
  const [, , h0, l0, price] = cs[n - 1];
  const pack = (id, o) => Object.assign({ code: id.code, reason: id.reason, c1t: id.c1t, c2t: id.c2t }, o);
  // formed: C2 closed and closed back inside C1. The oldest still-active pair (C3 or C4 running) is kept, so a later
  // candle never replaces the original C1/C2. Target / failure are checked on every candle after C2, in order.
  let active = null, finished = null;
  for (let j = Math.max(1, n - 1 - ACTIVE); j <= n - 2; j++) {
    const id = identify(cs, j, false);
    if (id.code !== "FORMED") continue;
    const d = id.dir, H1 = id.c1h, L1 = id.c1l, t2 = d === 1 ? H1 : L1, t1 = (H1 + L1) / 2, inv = id.sweep;
    let hit1 = false, hit2 = false, failed = false;
    for (let k = j + 1; k < n; k++) {
      const h = cs[k][2], l = cs[k][3];
      if (d === 1 ? h >= t1 : l <= t1) hit1 = true;
      if (d === 1 ? h >= t2 : l <= t2) { hit2 = true; break; }
      if (d === 1 ? l < inv : h > inv) { failed = true; break; }
    }
    const risk = Math.abs(price - inv);
    const f = pack(id, { status: "formed", dir: d, t1, t2, inv, c1h: H1, c1l: L1, sweep: inv, c1Back: n - 1 - id.c1, c2Back: n - 1 - j,
      sigt: cs[j + 1][0], entry: cs[j + 1][1],
      hit1, hit2, failed, toT2: round((t2 - price) * d / pip, 1), rr: risk > 0 ? round(Math.abs(t2 - price) / risk, 2) : null });
    if (!hit2 && !failed) { if (!active) active = f; }
    else finished = f;                       // the most recent finished one
  }
  // live: is the current candle the first to sweep C1's range?
  const lid = identify(cs, n - 1, true);
  let live = null;
  if (lid.code === "FORMING" || lid.code === "SWEEPING") {
    const d = lid.dir, H1 = lid.c1h, L1 = lid.c1l;
    live = pack(lid, { status: lid.code.toLowerCase(), dir: d, level: d === 1 ? L1 : H1, sweep: lid.sweep,
      t2: d === 1 ? H1 : L1, t1: (H1 + L1) / 2, c1h: H1, c1l: L1, c1Back: n - 1 - lid.c1, c2Back: 0 });
  } else if (lid.code === "NO_SWEEP") {
    const H1 = lid.c1h, L1 = lid.c1l, rng = H1 - L1;
    const dl = (price - L1) / rng, dh = (H1 - price) / rng;
    if (dl <= NEAR || dh <= NEAR) {
      const d = dl <= dh ? 1 : -1, level = d === 1 ? L1 : H1;
      live = { status: "anticipated", code: "ANTICIPATED", reason: `price within ${Math.round(NEAR * 100)}% of C1's ${d === 1 ? "low" : "high"}, no sweep yet`,
        c1t: lid.c1t, c2t: null, dir: d, level, dist: round(Math.abs(price - level) / pip, 1), c1h: H1, c1l: L1, t2: d === 1 ? H1 : L1, c1Back: n - 1 - lid.c1 };
    }
  }
  // candle 3 closure (TTrades): C2 swept C1 but closed outside it (BREAKOUT); C3 closed back through C2's open
  // without a new extreme. C2 stays the breakout candle - it is not relabelled.
  let c3 = null;
  if (n >= 4) {
    const id = identify(cs, n - 3, false);
    if (id.code === "BREAKOUT") {
      const d = id.dir, [, ob, hb, lb] = cs[n - 3], [, , hc, lc, cc] = cs[n - 2];
      if (d === 1 ? (cc > ob && lc >= lb) : (cc < ob && hc <= hb)) {
        const t2 = d === 1 ? id.c1h : id.c1l, inv = d === 1 ? lb : hb;
        const hit2 = d === 1 ? h0 >= t2 : l0 <= t2, failed = d === 1 ? l0 < inv : h0 > inv, risk = Math.abs(price - inv);
        if (!hit2 && !failed && (t2 - price) * d > 0)
          c3 = pack(id, { status: "c3close", code: "C3_CLOSURE", reason: `C2 ${id.reason}; C3 closed back through C2's open`, dir: d,
            t1: (id.c1h + id.c1l) / 2, t2, inv, c1h: id.c1h, c1l: id.c1l, sweep: inv, c1Back: n - 1 - id.c1, c2Back: 2,
            sigt: cs[n - 1][0], entry: cs[n - 1][1],
            hit1: false, hit2: false, failed: false, toT2: round((t2 - price) * d / pip, 1), rr: risk > 0 ? round(Math.abs(t2 - price) / risk, 2) : null });
      }
    }
  }
  let res;
  if (active) { res = active; if (live && (live.status === "forming" || live.status === "sweeping")) res.also = live.status; }
  else if (live && (live.status === "forming" || live.status === "sweeping")) res = live;
  else if (c3) res = c3;
  else if (finished) { res = finished; res.status = finished.hit2 ? "done" : "failed"; }
  else if (live) res = live;
  else {                                       // no setup: say why (current candle if it swept both sides, else last closed)
    const id = lid.code === "AMBIGUOUS" || lid.code === "INVALID_DATA" ? lid : identify(cs, n - 2, false);
    res = { status: "none", dir: 0, code: id.code, reason: (id === lid ? "current candle: " : "last closed candle: ") + id.reason };
  }
  // one explicit state per result. CONFIRMED only for a closed C2 (or a closed C3 for C3 closure); open candles are
  // FORMING / SWEEPING and never CONFIRMED.
  res.state = { formed: "CONFIRMED", c3close: "CONFIRMED", done: "TARGET_HIT", failed: "INVALIDATED", forming: "FORMING",
    sweeping: "SWEEPING", anticipated: "WATCHING" }[res.status] || res.code;
  res.price = price;
  const start = cs[cs.length - 1][0];
  res.end = TF_HOURS[tf] ? (start + TF_HOURS[tf] * H) * 1000 : null;
  const dg = pip >= 0.1 ? 2 : pip >= 0.01 ? 3 : 5;
  res.candles = cs.slice(-KEEP[tf]).map(c => [c[0], round(c[1], dg), round(c[2], dg), round(c[3], dg), round(c[4], dg)]);
  for (const k of ["t1", "t2", "inv", "c1h", "c1l", "sweep", "level", "price", "entry"]) if (typeof res[k] === "number") res[k] = round(res[k], dg + 1);
  return res;
}

/* Model-1 on the lower timeframe: after the sweep of lvl (d = 1: a low was swept, look for longs), the opening
 * price of the last opposite-close candle (or series) before the sweep extreme; a close back through it confirms. */
function model1(lt, d, t0, lvl, t2, pip) {
  const a = lt.findIndex(c => c[0] >= t0);
  if (a < 0 || lt.length - a < 2) return null;
  let J = a;
  for (let i = a; i < lt.length; i++) if (d === -1 ? lt[i][2] > lt[J][2] : lt[i][3] < lt[J][3]) J = i;
  const ext = d === -1 ? lt[J][2] : lt[J][3];
  if (!(d === -1 ? ext > lvl : ext < lvl)) return null;
  const opp = c => d === -1 ? c[4] > c[1] : c[4] < c[1];
  let q = J; while (q >= 0 && !opp(lt[q])) q--;
  if (q < 0) return null;
  let r0 = q; while (r0 - 1 >= 0 && opp(lt[r0 - 1])) r0--;
  const c = lt[q], rng = c[2] - c[3];
  const wick = r0 === q && rng > 0 && Math.abs(c[4] - c[1]) / rng < 0.3;
  const run = lt.slice(r0, q + 1);
  const level = wick ? (d === -1 ? c[3] : c[2]) : (d === -1 ? Math.min(...run.map(x => x[1])) : Math.max(...run.map(x => x[1])));
  let k = -1; for (let i = J + 1; i < lt.length; i++) if (d === -1 ? lt[i][4] < level : lt[i][4] > level) { k = i; break; }
  const res = { dir: d, ext, tExt: lt[J][0], level, tRun: lt[r0][0], tRunEnd: lt[q][0], wick, confirmed: k >= 0, target: t2 };
  if (k >= 0) {
    const e = lt[k][4], risk = Math.abs(ext - e);
    Object.assign(res, { tConf: lt[k][0], entry: e, rr: risk > 0 ? round(Math.abs(t2 - e) / risk, 2) : null,
      hit: (t2 - e) * d <= 0 || lt.slice(k + 1).some(x => d === -1 ? x[3] <= t2 : x[2] >= t2) });
  } else res.need = round(Math.abs(lt[lt.length - 1][4] - level) / pip, 1);
  return res;
}
/* Is C1 a proper C1? size (>= 0.7 x average range of the 20 candles before it), not an inside bar, swept at a
 * key level (previous day/week/month high-low or an unfilled higher-timeframe FVG), and the HTF bias. */
const C2_BACK = { formed: 1, done: 1, failed: 1, c3close: 2 };   // how many candles back C2 is (0 = current)
const PARENT = { "1H": "D", "4H": "D", D: "W", W: "M", M: null }, GRAND = { "1H": "W", "4H": "W", D: "M", W: null, M: null };
const LVL_NAME = { D: ["PDH", "PDL"], W: ["PWH", "PWL"], M: ["PMH", "PML"] };
function ttBias(S, k) {
  if (k < 2) return 0;
  const [, , h1, l1, c1] = S[k - 1], [, , h2, l2] = S[k - 2];
  if (c1 > h2) return 1; if (c1 < l2) return -1;
  if (h1 > h2 && c1 < h2 && !(l1 < l2)) return -1;
  if (l1 < l2 && c1 > l2 && !(h1 > h2)) return 1;
  return 0;
}
const lastAtOrBefore = (S, t) => { let k = -1; for (let i = 0; i < S.length; i++) if (S[i][0] <= t) k = i; return k < 0 ? null : k; };
function c1Quality(lists, tf, r) {
  const cs = lists[tf], n = cs.length, st = r.status;
  if (r.c1Back == null || !r.dir) return null;
  const c1i = n - 1 - r.c1Back, c2i = n - 1 - (r.c2Back ?? C2_BACK[st] ?? 0);
  if (c1i < 1) return null;
  const d = r.dir, [t, , h, l] = cs[c1i], rng = h - l;
  const prev = cs.slice(Math.max(0, c1i - 20), c1i);
  const avg = prev.length ? prev.reduce((a, x) => a + x[2] - x[3], 0) / prev.length : rng;
  const size = rng >= 0.7 * avg, inside = h <= cs[c1i - 1][2] && l >= cs[c1i - 1][3];
  const c2 = cs[c2i];
  const ext = d === 1 ? c2[3] : c2[2], tol = 0.25 * rng, t2s = c2[0];
  const levels = [];
  for (const X of [PARENT[tf], GRAND[tf]]) {
    if (!X) continue;
    const S = lists[X], k = lastAtOrBefore(S, t2s);
    if (k !== null && k >= 1) levels.push([LVL_NAME[X][0], S[k - 1][2]], [LVL_NAME[X][1], S[k - 1][3]]);
  }
  if (tf === "M") { const past = cs.slice(Math.max(0, c1i - 12), c1i); if (past.length) levels.push(["12M high", Math.max(...past.map(x => x[2]))], ["12M low", Math.min(...past.map(x => x[3]))]); }
  let key = null;
  for (const [name, L] of levels) {
    if (d === 1 && (name.endsWith("L") || name.endsWith("low")) && ext - tol <= L && L <= l + tol) { key = [name, L]; break; }
    if (d === -1 && (name.endsWith("H") || name.endsWith("high")) && h - tol <= L && L <= ext + tol) { key = [name, L]; break; }
  }
  const P = PARENT[tf]; let bias = null, keyT = null;
  if (P) {
    const S = lists[P], k = lastAtOrBefore(S, t2s);
    if (!key && k !== null) {          // an untouched swing high/low (3-candle fractal) on the parent timeframe that C2 swept
      for (let j = k - 2; j >= Math.max(1, k - 30); j--) {
        const [tj, , hj, lj] = S[j], later = S.slice(j + 1, k);
        if (d === 1 && lj < S[j - 1][3] && lj < S[j + 1][3] && later.every(x => x[3] > lj) && ext < lj && lj <= l + tol) { key = ["Swing " + P, lj]; keyT = tj; break; }
        if (d === -1 && hj > S[j - 1][2] && hj > S[j + 1][2] && later.every(x => x[2] < hj) && ext > hj && hj >= h - tol) { key = ["Swing " + P, hj]; keyT = tj; break; }
      }
    }
    if (!key && k !== null) {
      for (let j = k - 1; j > Math.max(1, k - 30); j--) {
        const a2 = S[j - 2], cj = S[j];
        if (d === 1 && cj[3] > a2[2]) { const bot = a2[2], top = cj[3];
          if (S.slice(j + 1, k).every(x => x[3] > bot) && bot - tol <= ext && ext <= top + tol) { key = [P + " FVG", top]; break; } }
        if (d === -1 && cj[2] < a2[3]) { const bot = cj[2], top = a2[3];
          if (S.slice(j + 1, k).every(x => x[2] < top) && bot - tol <= ext && ext <= top + tol) { key = [P + " FVG", bot]; break; } }
      }
    }
    if (k !== null) { const b = ttBias(S, k); bias = b === 0 ? null : b === d; }
  }
  const req = size && !inside;
  const grade = req && key && bias !== false ? "A" : req && (key || bias) ? "B" : "C";
  return { size, inside, key: key ? key[0] : null, keyLvl: key ? key[1] : null, keyT, bias, grade, c1t: t };
}
/* C2 quality: clean sweep (>= max(2 pips, 5% of C1) beyond C1, <= C1's range), rejection close (bullish: upper half
 * of C2), outside bar, T-spot (50% of C2's wick), and kill-zone timing of the sweep on 1H / 4H. */
function c2Checks(lists, tf, r, pip) {
  const cs = lists[tf], n = cs.length, st = r.status, d = r.dir;
  if (!d) return null;
  if (r.c1Back == null) return null;
  const c1i = n - 1 - r.c1Back, c2i = n - 1 - (r.c2Back ?? C2_BACK[st] ?? 0);
  if (c1i < 0 || c2i <= c1i) return null;
  const [, , h1, l1] = cs[c1i], [t2c, o2, h2, l2, c2] = cs[c2i], rng = h1 - l1;
  const depth = d === 1 ? l1 - l2 : h2 - h1;
  const sweep = depth >= Math.max(2 * pip, 0.05 * rng) && depth <= rng;
  const r2 = h2 - l2, pos = r2 > 0 ? (c2 - l2) / r2 : 0.5, reject = d === 1 ? pos >= 0.5 : pos <= 0.5;
  const tspot = d === 1 ? (l2 + Math.min(o2, c2)) / 2 : (h2 + Math.max(o2, c2)) / 2;
  let kz = null, kzName = null;
  if (tf === "1H" || tf === "4H") {
    let tExt = t2c;
    if (tf === "4H" && lists["1H"]) {
      const bars = lists["1H"].filter(b => b[0] >= t2c && b[0] < t2c + 4 * H);
      if (bars.length) tExt = bars.reduce((a, b) => (d === 1 ? b[3] < a[3] : b[2] > a[2]) ? b : a)[0];
    }
    const hr = Math.floor(((nyLocal(tExt) % DAY) + DAY) % DAY / H);
    kzName = hr >= 2 && hr < 5 ? "London" : hr >= 8 && hr < 11 ? "New York" : null; kz = kzName !== null;
  }
  return { depth: round(depth / pip, 1), sweep, reject, outside: h2 > h1 && l2 < l1, tspot, kz, kzName };
}
function addModel1(row, tfs, ltfFull) {
  const lists = { M: tfs.M, W: tfs.W, D: tfs.D, "4H": tfs["4H"], "1H": tfs["1H"], ...ltfFull };
  const dg = row.pip >= 0.1 ? 2 : row.pip >= 0.01 ? 3 : 5;
  for (const [tf, r] of Object.entries(row.tf)) {
    if (!r.status || r.status === "none") continue;
    const q = c1Quality(lists, tf, r);
    if (q) { if (typeof q.keyLvl === "number") q.keyLvl = round(q.keyLvl, dg + 1); r.q = q; }
    const q2 = c2Checks(lists, tf, r, row.pip);
    if (q2) { q2.tspot = round(q2.tspot, dg + 1); r.q2 = q2; }
  }
  for (const [tf, r] of Object.entries(row.tf)) {
    if (!["formed", "forming", "sweeping", "done", "c3close"].includes(r.status) || !lists[LTF_FOR[tf]]) continue;
    // Model-1 starts at the scanner's C2 candle (c2t), never at a position re-derived from the status
    const [t0, lvl] = r.status === "forming" || r.status === "sweeping" ? [r.c2t, r.level] : [r.c2t, r.dir === 1 ? r.c1l : r.c1h];
    const m = model1(lists[LTF_FOR[tf]], r.dir, t0, lvl, r.t2, row.pip);
    if (m) { for (const k of ["ext", "level", "entry", "target"]) if (typeof m[k] === "number") m[k] = round(m[k], dg + 1); r.m1 = m; }
  }
}

/* ---- fetching with an hourly cache: full history once, then only the last day ---- */
const store = {};   // ysym -> Map(t -> bar)
async function get(base, sym, interval, range) {
  const r = await fetch(`${base}?symbol=${encodeURIComponent(sym)}&interval=${interval}&range=${range}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${sym} ${interval}: HTTP ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(`${sym} ${interval}: ${d.error}`);
  return clean(d.t.map((t, i) => ({ t, o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i] })));
}
async function pair(base, [name, ysym, pip]) {
  const fresh = !store[ysym];
  const hourly = await get(base, ysym, "1h", fresh ? "1y" : "2d");   // 1 year, same as the GitHub scan
  if (fresh) store[ysym] = new Map();
  const m = store[ysym];
  hourly.forEach(b => m.set(b.t, b));
  const bars = [...m.values()].sort((a, b) => a.t - b.t);
  if (bars.length < 50) throw new Error(name + ": not enough data");
  const tfs = build(bars), row = { sym: name, pip, src: ysym, tf: {}, price: bars[bars.length - 1].c, ltf: {} };
  for (const tf of ["1H", "4H", "D", "W", "M"]) { const r = classify(tfs[tf], tf, pip); if (r) row.tf[tf] = r; }
  const dg = pip >= 0.1 ? 2 : pip >= 0.01 ? 3 : 5;
  const [m15, m5] = await Promise.all([get(base, ysym, "15m", "5d").catch(() => []), get(base, ysym, "5m", "2d").catch(() => [])]);
  const toL = a => a.map(b => [b.t, b.o, b.h, b.l, b.c]);
  const ltfFull = { "15m": toL(m15), "5m": toL(m5) };
  addModel1(row, tfs, ltfFull);
  // ICT liquidity-sweep setups (forex/sweep.js): Daily -> 1H CHoCH, 4H -> 15m, 2H -> 5m
  if (window.FXSweep) {
    const SW = window.FXSweep;
    row.sweeps = { D: SW.scan(tfs.D, tfs["1H"], pip, row.price, 86400), "4H": SW.scan(tfs["4H"], ltfFull["15m"], pip, row.price, 4 * H),
      "2H": SW.scan(tfs["2H"], ltfFull["5m"], pip, row.price, 2 * H) };
    row.sweep = row.sweeps["4H"];                                  // older app versions read this
    const rd = a => a.map(c => [c[0], round(c[1], dg), round(c[2], dg), round(c[3], dg), round(c[4], dg)]);
    row.c2h = rd(tfs["2H"].slice(-80)); row.h1 = rd(tfs["1H"].slice(-320));   // candles for the 2H and Daily sweep charts
  }
  row.ltf["15m"] = ltfFull["15m"].slice(-LTF_KEEP["15m"]).map(c => [c[0], round(c[1], dg), round(c[2], dg), round(c[3], dg), round(c[4], dg)]);
  row.ltf["5m"] = ltfFull["5m"].slice(-LTF_KEEP["5m"]).map(c => [c[0], round(c[1], dg), round(c[2], dg), round(c[3], dg), round(c[4], dg)]);
  return row;
}
async function load(base) {
  const rows = await Promise.all(PAIRS.map(p => pair(base, p).catch(e => { console.warn(e.message); return null; })));
  const pairs = rows.filter(Boolean);
  if (!pairs.length) throw new Error("live data unavailable");
  return { updated: new Date().toISOString(), engine: ENGINE, near: NEAR, pairs, live: true, missing: rows.length - pairs.length };
}
window.FXLive = { ENGINE, load, build, classify, identify, mother, clean, okBar, model1, addModel1, c1Quality, c2Checks, PAIRS, LOOK, ACTIVE };
})();
