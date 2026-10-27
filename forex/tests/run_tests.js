/* Synthetic tests for the C1/C2 identification in forex/live.js.  Run: node forex/tests/run_tests.js
 * Expected values in crt_cases.json were worked out by hand from the rules, not copied from the code's output.
 * scripts/test_forex_crt.py runs the same cases against scripts/forex_crt.py. */
"use strict";
const fs = require("fs"), path = require("path");
global.window = {};
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
console.log(`JS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
