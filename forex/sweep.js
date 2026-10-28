/* ICT 4H Sweep engine (phone side). scripts/sweep4h.py is the same logic in Python (GitHub scan + backtest);
 * forex/tests/run_tests.js checks that both give the same answers.
 *
 * Candles are arrays [t, open, high, low, close] (t = UTC seconds, candle start), oldest first.
 * dir: +1 = bullish setup (a 4H swing LOW was swept, look for longs), -1 = bearish (a swing HIGH was swept).
 *
 * The rules, step by step (every number below is in P and can be changed in one place):
 *  1. 4H swing: candle i is a swing high when its high is above the highs of the K=2 candles before it and not
 *     below the highs of the K=2 candles after it (lows mirrored). It is only known once those 2 candles have
 *     closed. Swing size = (swing high - lowest low of the 5-candle window) / ATR(14) of the 4H candles.
 *  2. 4H sweep: candle j trades beyond an untouched swing (no candle since the swing went past it; equal is a
 *     touch, not a sweep) from the last LOOK=60 4H candles (about 10 trading days). If it takes several swings,
 *     the furthest one counts. If one candle takes a swing high AND a swing low it is ambiguous and skipped.
 *  3. Return into range: the 4H sweep candle must CLOSE back on the inside of the swing level. Closing beyond it
 *     is a break, not a sweep. While the 4H candle is still open the setup is only "Sweeping".
 *     Sweep strength = how far it went beyond the level / ATR(14) of the 4H candles before it.
 *  4. Target = opposite liquidity: the nearest untouched 4H swing on the other side of the sweep candle's close;
 *     if there is none, the extreme of the 20 4H candles before the sweep.
 *  5. 15m CHoCH: from the start of the sweep candle, follow the 15m extreme of the sweep (it must go beyond the 4H level). The CHoCH level is the
 *     most recent 15m swing (1 candle each side) before that extreme - the last higher low that pushed price into
 *     a swing high, for a bearish setup. CHoCH = the first 15m candle that CLOSES through that level. A new extreme
 *     moves the level to the newest swing before it. Only candles up to "now" are used.
 *  6. Displacement = the biggest 15m candle body from the extreme to the CHoCH candle, / ATR(14) of the 15m candles.
 *  7. Entry zone: the 15m FVG (3-candle gap, at least 0.1 x ATR15) in the move from the extreme to the candle after
 *     the CHoCH, choosing the one made by the biggest-body candle. No FVG -> the order block: the last opposite
 *     candle at or before the extreme (bearish: last up-close candle, zone open..high).
 *     Entry = the near edge of the zone (limit order), stop = the sweep extreme, target = step 4.
 *  8. Status after that (from the candle after the CHoCH, never earlier), candle by candle: ENTRY_READY until price returns to the entry -> ENTERED -> TARGET_HIT or
 *     STOPPED. Before the entry: INVALIDATED if price goes beyond the stop, MISSED if the target is reached first,
 *     EXPIRED if nothing happens within 6 4H candles after the sweep candle closed.
 */
(() => {
"use strict";
const P = { K: 2, LOOK: 60, ATR_N: 14, RECENT: 12, EXPIRY: 6, FVG_MIN: 0.1, TARGET_BACK: 20 };
const H4 = 4 * 3600;

/* Average true range of the n candles ending at i (true range uses the previous close). */
function atr(cs, i, n) {
  let s = 0, c = 0;
  for (let k = Math.max(1, i - n + 1); k <= i; k++) {
    const [, , h, l] = cs[k], pc = cs[k - 1][4];
    s += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); c++;
  }
  return c ? s / c : (i >= 0 ? cs[i][2] - cs[i][3] : 0);
}

/* Confirmed 4H swings (step 1) using candles 0..upto only: a swing at i needs candles i+1..i+K, so i <= upto-K. */
function swings(cs, upto, from) {
  const out = [], K = P.K;
  for (let i = Math.max(K, from || 0); i <= upto - K; i++) {
    let hiL = -Infinity, hiR = -Infinity, loL = Infinity, loR = Infinity, wLo = Infinity, wHi = -Infinity;
    for (let k = i - K; k < i; k++) { hiL = Math.max(hiL, cs[k][2]); loL = Math.min(loL, cs[k][3]); }
    for (let k = i + 1; k <= i + K; k++) { hiR = Math.max(hiR, cs[k][2]); loR = Math.min(loR, cs[k][3]); }
    for (let k = i - K; k <= i + K; k++) { wLo = Math.min(wLo, cs[k][3]); wHi = Math.max(wHi, cs[k][2]); }
    const a = atr(cs, i, P.ATR_N) || 1e-12;
    if (cs[i][2] > hiL && cs[i][2] >= hiR) out.push({ i, t: cs[i][0], side: 1, price: cs[i][2], conf: i + K, size: (cs[i][2] - wLo) / a });
    if (cs[i][3] < loL && cs[i][3] <= loR) out.push({ i, t: cs[i][0], side: -1, price: cs[i][3], conf: i + K, size: (wHi - cs[i][3]) / a });
  }
  return out;
}

/* Step 2-4 for 4H candle j. live = candle j is still open. Uses candles 0..j only. */
function sweepAt(cs, j, live) {
  if (j < P.K * 2 + 2) return null;
  const sw = swings(cs, j - 1, j - P.LOOK).filter(s => s.conf <= j - 1 && s.i >= j - P.LOOK);
  const untouched = s => { for (let k = s.i + 1; k < j; k++) if (s.side === 1 ? cs[k][2] > s.price : cs[k][3] < s.price) return false; return true; };
  const [, , h, l, c] = cs[j];
  let hi = null, lo = null;
  for (const s of sw) {
    if (!untouched(s)) continue;
    if (s.side === 1 && h > s.price && (!hi || s.price > hi.price)) hi = s;
    if (s.side === -1 && l < s.price && (!lo || s.price < lo.price)) lo = s;
  }
  if (!hi && !lo) return null;
  if (hi && lo) return { code: "AMBIGUOUS", j, t: cs[j][0] };
  const s = hi || lo, d = hi ? -1 : 1, a4 = atr(cs, j - 1, P.ATR_N) || 1e-12;
  const ext = d === -1 ? h : l, back = d === -1 ? c < s.price : c > s.price;
  // step 4: opposite liquidity, untouched through candle j and on the far side of j's close
  let target = null, tLabel = null;
  for (const o of sw) {
    if (o.side !== -s.side) continue;
    let ok = true; for (let k = o.i + 1; k <= j; k++) if (o.side === 1 ? cs[k][2] > o.price : cs[k][3] < o.price) { ok = false; break; }
    if (!ok || (d === -1 ? o.price >= c : o.price <= c)) continue;
    if (target === null || (d === -1 ? o.price > target : o.price < target)) { target = o.price; tLabel = d === -1 ? "swing low" : "swing high"; }
  }
  if (target === null) {
    const back20 = cs.slice(Math.max(0, j - P.TARGET_BACK), j), x = d === -1 ? Math.min(...back20.map(q => q[3])) : Math.max(...back20.map(q => q[2]));
    if (back20.length && (d === -1 ? x < c : x > c)) { target = x; tLabel = d === -1 ? "20-candle low" : "20-candle high"; }
  }
  return { code: live ? "SWEEPING" : back ? "SWEEP" : "BREAK", dir: d, j, t: cs[j][0], live: !!live, back,
    level: s.price, swingT: s.t, swingI: s.i, swingSize: s.size, ext, close: c, depth: (d === -1 ? ext - s.price : s.price - ext) / a4,
    atr4: a4, target, targetLabel: tLabel };
}

/* Steps 5-8 on the 15m candles m15 (oldest first). openLast = the last 15m candle is still forming. */
function ltfSetup(sw, c4, m15, openLast, sec) {
  sec = sec || H4;                 // length of one higher-timeframe candle (4H default; 1D and 2H use the same rules)
  const d = sw.dir, j = sw.j;
  const t4 = c4[j][0], tPrev = c4[j - 1][0];
  const tExp = j + 1 + P.EXPIRY < c4.length ? c4[j + 1 + P.EXPIRY][0] : t4 + (1 + P.EXPIRY) * sec;
  const n = m15.length, lastClosed = n - 1 - (openLast ? 1 : 0);
  const a = m15.findIndex(b => b[0] >= tPrev), s = m15.findIndex(b => b[0] >= t4);
  const out = { status: "SWEEP", choch: null, zone: null };
  if (a < 0 || s < 0) { out.status = "NO_LTF"; return out; }
  const H = k => m15[k][2], L = k => m15[k][3], O = k => m15[k][1], C = k => m15[k][4];
  // 15m swings against the sweep: bearish setup -> swing lows (k = 1 each side), bullish -> swing highs
  const isRef = i => i - 1 >= a && i + 1 < n && (d === -1 ? L(i) < L(i - 1) && L(i) <= L(i + 1) : H(i) > H(i - 1) && H(i) >= H(i + 1));
  const refBefore = X => { for (let i = X - 1; i > a; i--) if (i + 1 <= X && isRef(i)) return i; return -1; };
  // X = running 15m extreme since the sweep candle opened. The CHoCH must come after a candle that is the extreme
  // and after price has actually gone beyond the 4H level (the sweep), never on the extreme candle itself.
  let X = s, ref = refBefore(s), b = -1;
  for (let k = s + 1; k <= lastClosed; k++) {
    if (m15[k][0] >= tExp) break;
    if (d === -1 ? H(k) > H(X) : L(k) < L(X)) { X = k; ref = refBefore(X); continue; }
    const swept = d === -1 ? H(X) > sw.level : L(X) < sw.level;
    if (swept && ref >= 0 && (d === -1 ? C(k) < L(ref) : C(k) > H(ref))) { b = k; break; }
  }
  // the extreme can keep growing in the candle that is still open (shown, not used for the CHoCH)
  out.ext = d === -1 ? H(X) : L(X); out.extT = m15[X][0];
  if (b < 0 && ref >= 0) out.watch = { level: d === -1 ? L(ref) : H(ref), t: m15[ref][0] };   // the CHoCH level to watch
  if (b < 0) { if (lastClosed >= 0 && m15[Math.min(lastClosed + 1, n - 1)][0] >= tExp) out.status = "EXPIRED"; return out; }
  const a15 = atr(m15, b - 1, P.ATR_N) || 1e-12;
  let body = 0, dispK = X;
  for (let k = X; k <= b; k++) { const bd = Math.abs(C(k) - O(k)); if (bd > body) { body = bd; dispK = k; } }
  out.choch = { t: m15[b][0], level: d === -1 ? L(ref) : H(ref), refT: m15[ref][0], k: b };
  out.disp = body / a15; out.dispT = m15[dispK][0]; out.atr15 = a15;
  // step 7: FVG in the move X .. b+1 (needs candle b+1 closed), else order block
  let best = null;
  for (let m = X + 1; m + 1 <= Math.min(b + 1, lastClosed); m++) {
    const lo = d === -1 ? H(m + 1) : H(m - 1), hi = d === -1 ? L(m - 1) : L(m + 1);
    if (hi - lo >= P.FVG_MIN * a15) { const bd = Math.abs(C(m) - O(m)); if (!best || bd >= best.bd) best = { type: "FVG", lo, hi, t: m15[m - 1][0], from: m + 1, bd }; }
  }
  if (!best) {
    for (let k = X; k >= a; k--) if (d === -1 ? C(k) > O(k) : C(k) < O(k)) {
      best = d === -1 ? { type: "OB", lo: O(k), hi: H(k), t: m15[k][0], from: b } : { type: "OB", lo: L(k), hi: O(k), t: m15[k][0], from: b }; break; }
  }
  if (!best) { out.status = "CHOCH"; return out; }
  delete best.bd; out.zone = best;
  const entry = d === -1 ? best.lo : best.hi, sl = out.ext, tp = sw.target;
  out.entry = entry; out.sl = sl; out.tp = tp;
  // TTrades discount / premium: dealing range = sweep extreme .. the far end of the move up to when the zone is
  // known (candles X .. max(zone, CHoCH)). Longs want the entry at or below its 50% (discount), shorts at or above.
  { let far = d === -1 ? Infinity : -Infinity;
    for (let k = X; k <= Math.max(best.from, b); k++) far = d === -1 ? Math.min(far, L(k)) : Math.max(far, H(k));
    out.eq = (far + sl) / 2; out.pd = d === -1 ? entry >= out.eq : entry <= out.eq; }
  out.rr = tp != null && (tp - entry) * d > 0 && Math.abs(sl - entry) > 0 ? Math.abs(tp - entry) / Math.abs(sl - entry) : null;
  // step 8: walk forward from the candle after the zone exists (the open candle counts: a touch is a touch)
  out.status = "ENTRY_READY";
  // the sweep is only confirmed when the 4H candle has closed back inside: no fill before that
  const tConf = j + 1 < c4.length ? c4[j + 1][0] : t4 + sec;
  let filled = false;
  // the zone is only usable once the CHoCH has closed (an FVG can be older than the CHoCH): start after both
  for (let k = Math.max(best.from, b) + 1; k < n; k++) {
    const t = m15[k][0], hk = H(k), lk = L(k);
    if (!filled) {
      if (t >= tExp) { out.status = "EXPIRED"; break; }
      const touch = d === -1 ? hk >= entry : lk <= entry, stop = d === -1 ? hk > sl : lk < sl;
      const fillable = touch && t >= tConf;
      if (tp != null && (d === -1 ? lk <= tp : hk >= tp) && !fillable) { out.status = "MISSED"; out.tExit = t; break; }
      if (stop && !fillable) { out.status = "INVALIDATED"; out.tExit = t; break; }
      if (touch && t >= tConf) { filled = true; out.status = "ENTERED"; out.tFill = t; }
    }
    if (filled) {
      const stop = d === -1 ? hk >= sl : lk <= sl, hit = tp != null && (d === -1 ? lk <= tp : hk >= tp);
      if (stop) { out.status = "STOPPED"; out.tExit = t; break; }          // same candle as the target: stop first
      if (hit) { out.status = "TARGET_HIT"; out.tExit = t; break; }
    }
  }
  return out;
}

/* Quality checks (shown and filterable; they never change what was detected). */
function quality(sw, x) {
  const c = { swing: sw.swingSize >= 1.5, depth: sw.depth >= 0.1 && sw.depth <= 1.0, disp: x.disp != null && x.disp >= 1.5,
    fvg: !!(x.zone && x.zone.type === "FVG"), rr: x.rr != null && x.rr >= 2 };
  const n = Object.values(c).filter(Boolean).length;
  // TTrades entry checklist (video "A ICT Entry Checklist"): stop raid, structure shift, discount/premium, PD array, solid R:R
  const tt = { raid: true, shift: !!x.choch, pd: x.pd === true, array: !!x.zone, rr: x.rr != null && x.rr >= 2 };
  return { checks: c, score: n, grade: n >= 4 ? "A" : n === 3 ? "B" : "C", tt, ttN: Object.values(tt).filter(Boolean).length };
}

/* Everything for one symbol: 4H sweeps of the last RECENT 4H candles (newest first), each with its 15m setup.
 * c4 last candle and m15 last candle are the ones still forming. */
function scan(c4, m15, pip, price, sec) {
  const n = c4.length, res = [];
  for (let j = n - 1; j >= Math.max(1, n - P.RECENT); j--) {
    const sw = sweepAt(c4, j, j === n - 1);
    if (!sw || sw.code === "AMBIGUOUS" || sw.code === "BREAK") continue;
    const x = m15 && m15.length ? ltfSetup(sw, c4, m15, true, sec) : { status: "NO_LTF" };
    const status = sw.live ? "SWEEPING" : x.status;
    const q = quality(sw, x);
    const dist = x.entry != null && price != null ? Math.abs(price - x.entry) / pip : null;
    res.push(Object.assign({ dir: sw.dir, sweep: sw, dist: dist == null ? null : Math.round(dist * 10) / 10 }, x, { status, ltfStatus: x.status, q }));
  }
  // two 4H sweeps can lead to the same 15m CHoCH (the later candle took the move further): keep the newest one
  const seen = new Set();
  return res.filter(r => { if (!r.choch) return true; const key = r.dir + "|" + r.choch.t; if (seen.has(key)) return false; seen.add(key); return true; });
}

window.FXSweep = { P, atr, swings, sweepAt, ltfSetup, quality, scan };
})();
