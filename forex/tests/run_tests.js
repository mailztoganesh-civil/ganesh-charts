/* Synthetic tests for the C1/C2 identification in forex/live.js.  Run: node forex/tests/run_tests.js
 * Expected values in crt_cases.json were worked out by hand from the rules, not copied from the code's output.
 * scripts/test_forex_crt.py runs the same cases against scripts/forex_crt.py. */
"use strict";
const fs = require("fs"), path = require("path");
global.window = {};
eval(fs.readFileSync(path.join(__dirname, "..", "sweep.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "..", "live.js"), "utf8"));
const F = window.FXLive, T = JSON.parse(fs.readFileSync(path.join(__dirname, "crt_cases.json"), "utf8"));
let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) pass++; else { fail++; console.log("FAIL:", name, info === undefined ? "" : JSON.stringify(info)); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1-10, 12: identification of single cases
for (const c of T.identify) {
  const id = F.identify(c.candles, c.j, c.live);
  const got = { code: id.code, dir: id.dir };
  if ("c1" in c.expect) got.c1 = id.c1;
  check(`[${c.test}] ${c.name}`, eq(got, c.expect), { got, expect: c.expect, reason: id.reason });
  if (id.c1 != null) check(`[${c.test}] ${c.name}: timestamps match indices`, id.c1t === c.candles[id.c1][0] && id.c2t === c.candles[c.j][0]);
}
// 10, 12: cleaning (malformed rows dropped, duplicate timestamps -> later copy, sorted)
{
  const cl = F.clean(T.clean.input.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4] }))).map(b => [b.t, b.o, b.h, b.l, b.c]);
  check("[10/12] clean drops bad rows, de-duplicates and sorts", eq(cl, T.clean.expect), cl);
}
const S = T.sequence, t = i => S[i][0];
// 11: live C2 becomes the confirmed C2 after it closes - same C1 and C2
{
  const a = F.classify(S.slice(0, 3), "1H", 0.01), b = F.classify(S.slice(0, 4), "1H", 0.01);
  check("[11] live candle is C2 forming", a.status === "forming" && a.code === "FORMING" && a.c2Back === 0 && a.c1t === t(1) && a.c2t === t(2), a);
  check("[11] after it closes the same pair is FORMED", b.status === "formed" && b.code === "FORMED" && b.c2Back === 1 && b.c1t === t(1) && b.c2t === t(2), b);
}
// 15: a later candle never replaces the confirmed pair; no look-ahead
{
  const c = F.classify(S.slice(0, 5), "1H", 0.01);
  check("[15] C3 forms a new opposite pair but the original C1/C2 is kept through C4",
    c.status === "formed" && c.dir === 1 && c.c2Back === 2 && c.c1t === t(1) && c.c2t === t(2), c);
  const later = F.identify(S, 3, false);
  check("[15] (the newer pair exists: C1 = old C2, bearish)", later.code === "FORMED" && later.dir === -1 && later.c1 === 2, later);
  let same = true;
  for (let j = 1; j < S.length; j++) same = same && eq(F.identify(S.slice(0, j + 1), j, false), F.identify(S, j, false));
  check("[15] identify(j) is the same with or without later candles", same);
}
// 13: C1 quality filter changes the grade, never the C1/C2 identity
{
  const mk = (pre) => pre.concat([[110, 120, 100, 105], [104, 108, 98, 106], [106, 107, 103, 105]])
    .map((r, i) => [(i + 1) * 3600 * 24 * 31, ...r]);
  const small = Array.from({ length: 20 }, () => [301, 302, 300, 301]);          // tiny earlier candles -> C1 is big
  const big = Array.from({ length: 20 }, () => [350, 400, 300, 350]);            // huge earlier candles -> C1 is small
  const A = mk(small), B = mk(big);
  const ra = F.classify(A, "M", 0.0001), rb = F.classify(B, "M", 0.0001);
  const qa = F.c1Quality({ M: A }, "M", ra), qb = F.c1Quality({ M: B }, "M", rb);
  check("[13] size filter passes with small earlier candles", qa && qa.size === true, qa);
  check("[13] size filter fails with big earlier candles", qb && qb.size === false, qb);
  check("[13] identity unchanged by the filter", ra.code === rb.code && ra.code === "FORMED" && ra.c1Back === rb.c1Back && ra.c2Back === rb.c2Back,
    { a: [ra.code, ra.c1Back, ra.c2Back], b: [rb.code, rb.c1Back, rb.c2Back] });
}
// 14: repeated scans of the same data give identical results and do not change the input
{
  const before = JSON.stringify(S);
  const r1 = JSON.stringify(F.classify(S, "4H", 0.01)), r2 = JSON.stringify(F.classify(S, "4H", 0.01));
  check("[14] same input -> identical output (no duplicate / shifting signals)", r1 === r2);
  check("[14] input candles are not modified", JSON.stringify(S) === before);
}
// 9: a live candle changes classification before it closes; only the closed candle is CONFIRMED
{
  const L = T.live_snapshots;
  for (const sn of L.snaps) {
    const r = F.classify(L.before.concat([[3 * 3600, ...sn.c2]]), "1H", 0.01);
    check(`[9] live snapshot ${JSON.stringify(sn.c2)} -> ${sn.status}`, r.status === sn.status && r.state === sn.state && r.state !== "CONFIRMED", r);
  }
  const r = F.classify(L.before.concat([[3 * 3600, ...L.closed.c2], [4 * 3600, ...L.closed.c3]]), "1H", 0.01);
  const got = {}; for (const k of Object.keys(L.closed.expect)) got[k] = r[k];
  check("[10] after the close: CONFIRMED with signal time, entry, stop and target levels", eq(got, L.closed.expect), got);
}
// 7: a sweep deeper than C1's range is still C2; the clean-sweep check (a filter) flags it
{
  const X = T.large_sweep_c2check, r = F.classify(X.candles, "1H", 0.01), q2 = F.c2Checks({ "1H": X.candles }, "1H", r, 0.01);
  check("[7] deep sweep: identified, sweep filter fails", r.code === X.expect.code && q2.sweep === X.expect.sweepOk && q2.depth === X.expect.depthPips, { r: r.code, q2 });
}
// regression: the phone loaded 6 months of hourly data while the GitHub scan loads 1 year, so Monthly C1 grades differed
check("[regression] phone engine loads 1 year of hourly data like the GitHub scan",
  /get\(base, ysym, "1h", fresh \? "1y"/.test(fs.readFileSync(path.join(__dirname, "..", "live.js"), "utf8")));
// Parity with the Python scanner on real EURUSD data (parity_fixture.json, made by scripts/make_parity_fixture.py):
// candle building, identification, levels, signal time, C1/C2 checks and Model-1 must match.
{
  const P = JSON.parse(fs.readFileSync(path.join(__dirname, "parity_fixture.json"), "utf8"));
  const bars = P.bars.map(b => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4] }));
  // numbers: prices to 2e-6 (rounding to 6 decimals in either language); pips / R:R are rounded to 0.1 / 0.01
  const TOL = { toT2: 0.051, depth: 0.051, need: 0.051, dist: 0.051, rr: 0.0051 };
  const same = (a, b, k) => {
    if (a == null || b == null) return a == null && b == null;
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= (TOL[k] ?? 2e-6);
    if (typeof a !== "object") return a === b;
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i], k));
    const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...ks].every(kk => same(a[kk], b[kk], kk));
  };
  let checked = 0, bad = 0;
  for (const e of P.evals) {
    const tfs = F.build(bars.slice(0, e.end + 1));
    const row = { sym: P.pair, pip: P.pip, tf: {} };
    for (const tf of ["1H", "4H", "D", "W", "M"]) { const r = F.classify(tfs[tf], tf, P.pip); if (r) row.tf[tf] = r; }
    F.addModel1(row, tfs, {});
    for (const [tf, py] of Object.entries(e.tf)) {
      const r = row.tf[tf]; checked++;
      const js = {};
      for (const k of Object.keys(py)) if (!["last", "n"].includes(k)) js[k] = r[k];
      for (const k of ["q", "q2", "m1"]) if (r[k] && !(k in py)) js[k] = r[k];
      const ok = same(js, Object.fromEntries(Object.entries(py).filter(([k]) => !["last", "n"].includes(k)))) &&
        tfs[tf].length === py.n && same(r.candles[r.candles.length - 1], py.last);
      if (!ok) { bad++; if (bad <= 3) console.log("parity mismatch", e.end, tf, JSON.stringify({ py, js }).slice(0, 600)); }
    }
  }
  check(`[parity] JS = Python on ${checked} real-data results (${P.evals.length} points in time x 5 timeframes)`, bad === 0, { bad });
}
// 4H sweep rules on hand-worked candles (sweep_cases.json; expected values worked out by hand)
{
  const SW = window.FXSweep, Z = JSON.parse(fs.readFileSync(path.join(__dirname, "sweep_cases.json"), "utf8"));
  const sub = (got, exp) => exp === null ? got === null : Object.entries(exp).every(([k, v]) =>
    v !== null && typeof v === "object" ? sub(got[k], v) : typeof v === "number" ? Math.abs(got[k] - v) < 1e-9 : got[k] === v);
  for (const c of Z.sweeps) { const g = SW.sweepAt(c.c4, c.j, c.live); check(`[sweep] ${c.name}`, sub(g, c.expect), g); }
  for (const c of Z.ltf) { const sw = SW.sweepAt(c.c4, c.j, false), g = SW.ltfSetup(sw, c.c4, c.m15, true); check(`[sweep 15m] ${c.name}`, sub(g, c.expect), g); }
}
// 4H sweep engine: JS (forex/sweep.js) = Python (scripts/sweep4h.py) on real EURUSD data (sweep_fixture.json)
{
  const SW = window.FXSweep, X = JSON.parse(fs.readFileSync(path.join(__dirname, "sweep_fixture.json"), "utf8"));
  const near = (a, b) => {
    if (a == null || b == null) return a == null && b == null;
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
    if (typeof a !== "object") return a === b;
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => near(x, b[i]));
    const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...ks].every(k => near(a[k], b[k]));
  };
  let bad = 0, n = 0;
  for (const e of X.evals) {
    const hh = X.h1.filter(b => b[0] <= e.T).map(b => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4] }));
    const mm = X.m15.filter(b => b[0] <= e.T);
    const B = F.build(hh), px = mm[mm.length - 1][4];
    const got = { res: SW.scan(B["4H"], mm, X.pip, px, 4 * 3600), resD: SW.scan(B.D, B["1H"], X.pip, px, 86400) };
    if (X.m5.length && X.m5[0][0] + 86400 <= e.T) got.res2H = SW.scan(B["2H"], X.m5.filter(b => b[0] <= e.T), X.pip, px, 2 * 3600);
    n += got.res.length + got.resD.length + (got.res2H ? got.res2H.length : 0);
    const exp = Object.fromEntries(Object.entries(e).filter(([k]) => k !== "T"));
    if (!near(JSON.parse(JSON.stringify(got)), exp)) { bad++; if (bad <= 2) console.log("sweep mismatch at", e.T, JSON.stringify({ js: got, py: exp }).slice(0, 900)); }
  }
  check(`[sweep parity] JS = Python at ${X.evals.length} points in time (${n} setups on 1D, 4H, 2H)`, bad === 0, { bad });
  // regression (look-ahead): an entry can only fill after the CHoCH candle and after the zone exists
  const early = X.evals.flatMap(e => e.res).filter(r => r.tFill != null && (r.tFill <= r.choch.t || r.tFill <= r.zone.t || r.tFill < r.sweep.t + 4 * 3600));
  check("[sweep] no fill before the CHoCH, the entry zone or the 4H close", early.length === 0, early.slice(0, 2));
}
console.log(`JS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
