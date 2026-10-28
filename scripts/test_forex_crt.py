"""Synthetic tests for the C1/C2 identification in forex_crt.py.  Run: python3 -m unittest scripts/test_forex_crt.py
The cases live in forex/tests/crt_cases.json and are shared with forex/tests/run_tests.js (the phone engine), so
both engines are held to the same hand-worked expectations."""
import json, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forex_crt as F  # noqa: E402

T = json.load(open(os.path.join(HERE, "..", "forex", "tests", "crt_cases.json")))
S = T["sequence"]


def t(i):
    return S[i][0]


class Identify(unittest.TestCase):
    def test_cases(self):                       # tests 1-10, 12
        for c in T["identify"]:
            with self.subTest(c["name"]):
                i = F.identify(c["candles"], c["j"], c["live"])
                got = {"code": i["code"], "dir": i["dir"]}
                if "c1" in c["expect"]:
                    got["c1"] = i.get("c1")
                self.assertEqual(got, c["expect"], i["reason"])
                if i.get("c1") is not None:
                    self.assertEqual(i["c1t"], c["candles"][i["c1"]][0])
                    self.assertEqual(i["c2t"], c["candles"][c["j"]][0])

    def test_clean(self):                       # tests 10, 12
        self.assertEqual(F.clean_list(T["clean"]["input"]), T["clean"]["expect"])


class Sequence(unittest.TestCase):
    def test_live_then_confirmed(self):         # test 11
        a = F.classify_cs(S[:3], "1H", 0.01); b = F.classify_cs(S[:4], "1H", 0.01)
        self.assertEqual((a["status"], a["code"], a["c2Back"], a["c1t"], a["c2t"]), ("forming", "FORMING", 0, t(1), t(2)))
        self.assertEqual((b["status"], b["code"], b["c2Back"], b["c1t"], b["c2t"]), ("formed", "FORMED", 1, t(1), t(2)))

    def test_original_pair_kept(self):          # test 15
        c = F.classify_cs(S[:5], "1H", 0.01)
        self.assertEqual((c["status"], c["dir"], c["c2Back"], c["c1t"], c["c2t"]), ("formed", 1, 2, t(1), t(2)))
        later = F.identify(S, 3)
        self.assertEqual((later["code"], later["dir"], later["c1"]), ("FORMED", -1, 2))
        for j in range(1, len(S)):
            self.assertEqual(F.identify(S[:j + 1], j), F.identify(S, j))

    def test_filter_does_not_change_identity(self):   # test 13
        def mk(pre):
            rows = pre + [[110, 120, 100, 105], [104, 108, 98, 106], [106, 107, 103, 105]]
            return [[(i + 1) * 3600 * 24 * 31] + r for i, r in enumerate(rows)]
        A = mk([[301, 302, 300, 301]] * 20); B = mk([[350, 400, 300, 350]] * 20)
        ra = F.classify_cs(A, "M", 0.0001); rb = F.classify_cs(B, "M", 0.0001)
        qa = F.c1_quality({"M": A}, "M", ra); qb = F.c1_quality({"M": B}, "M", rb)
        self.assertTrue(qa["size"]); self.assertFalse(qb["size"])
        self.assertEqual((ra["code"], ra["c1Back"], ra["c2Back"]), ("FORMED", rb["c1Back"], rb["c2Back"]))
        self.assertEqual(rb["code"], "FORMED")

    def test_repeat_scans(self):                # test 14
        before = json.dumps(S)
        self.assertEqual(json.dumps(F.classify_cs(S, "4H", 0.01)), json.dumps(F.classify_cs(S, "4H", 0.01)))
        self.assertEqual(json.dumps(S), before)


class EdgeCases(unittest.TestCase):
    def test_live_snapshots_then_close(self):  # tests 9, 10
        L = T["live_snapshots"]
        for sn in L["snaps"]:
            r = F.classify_cs(L["before"] + [[3 * 3600] + sn["c2"]], "1H", 0.01)
            self.assertEqual((r["status"], r["state"]), (sn["status"], sn["state"]))
        r = F.classify_cs(L["before"] + [[3 * 3600] + L["closed"]["c2"], [4 * 3600] + L["closed"]["c3"]], "1H", 0.01)
        self.assertEqual({k: r.get(k) for k in L["closed"]["expect"]}, L["closed"]["expect"])

    def test_deep_sweep_is_c2_but_fails_filter(self):   # test 7
        X = T["large_sweep_c2check"]
        r = F.classify_cs(X["candles"], "1H", 0.01); q2 = F.c2_checks({"1H": X["candles"]}, "1H", r, 0.01)
        self.assertEqual((r["code"], q2["sweep"], q2["depth"]), (X["expect"]["code"], X["expect"]["sweepOk"], X["expect"]["depthPips"]))

    def test_clean_df_sorts_dedupes_drops(self):        # test 8
        import pandas as pd
        rows = T["clean"]["input"]
        df = pd.DataFrame([r[1:] for r in rows], columns=["Open", "High", "Low", "Close"],
                          index=pd.to_datetime([r[0] for r in rows], unit="s", utc=True))
        got = [[int(t.timestamp()), r.Open, r.High, r.Low, r.Close] for t, r in F.clean_df(df).iterrows()]
        self.assertEqual(got, T["clean"]["expect"])


class Parity(unittest.TestCase):
    def test_python_matches_committed_fixture(self):
        """The Python side of forex/tests/parity_fixture.json (the JS side is checked by run_tests.js)."""
        import pandas as pd
        import make_parity_fixture as M
        P = json.load(open(os.path.join(HERE, "..", "forex", "tests", "parity_fixture.json")))
        b = P["bars"]
        h = pd.DataFrame([x[1:] for x in b], columns=["Open", "High", "Low", "Close"],
                         index=pd.to_datetime([x[0] for x in b], unit="s", utc=True))
        for e in P["evals"][::4] + P["evals"][-1:]:        # every 4th point keeps the test quick; JS checks all
            got = json.loads(json.dumps(M.scan(h.iloc[:e["end"] + 1])))
            self.assertEqual(got, e["tf"], f"evaluation ending at bar {e['end']}")


class Sweep4H(unittest.TestCase):
    """ICT 4H sweep engine (scripts/sweep4h.py): hand-worked cases and parity with forex/sweep.js."""
    def sub(self, got, exp, where):
        if exp is None:
            self.assertIsNone(got, where); return
        for k, v in exp.items():
            if isinstance(v, dict):
                self.sub(got[k], v, where + "." + k)
            elif isinstance(v, (int, float)) and not isinstance(v, bool):
                self.assertAlmostEqual(got[k], v, places=9, msg=where + "." + k)
            else:
                self.assertEqual(got[k], v, where + "." + k)

    def test_hand_cases(self):
        import sweep4h as S
        Z = json.load(open(os.path.join(HERE, "..", "forex", "tests", "sweep_cases.json")))
        for c in Z["sweeps"]:
            self.sub(S.sweep_at(c["c4"], c["j"], c["live"]), c["expect"], c["name"])
        for c in Z["ltf"]:
            sw = S.sweep_at(c["c4"], c["j"], False)
            self.sub(S.ltf_setup(sw, c["c4"], c["m15"], True), c["expect"], c["name"])

    def test_parity_fixture(self):
        import make_sweep_fixture as M
        X = json.load(open(os.path.join(HERE, "..", "forex", "tests", "sweep_fixture.json")))
        for e in X["evals"]:                       # every point in time (JS checks all of them too)
            got = json.loads(json.dumps(M.scan_at(X["h1"], X["m15"], e["T"], X["m5"])))
            self.assertEqual(got, {k: v for k, v in e.items() if k != "T"}, f"T={e['T']}")
        for e in X["evals"]:                       # regression: no fill before the CHoCH / zone (look-ahead)
            for r in e["res"]:            # 4H: no fill before the 4H close
                if r.get("tFill") is not None:
                    self.assertGreater(r["tFill"], r["choch"]["t"]); self.assertGreater(r["tFill"], r["zone"]["t"])
                    self.assertGreaterEqual(r["tFill"], r["sweep"]["t"] + 4 * 3600)


class NoRepaint(unittest.TestCase):
    """Look-ahead / repaint check: once a fact about a setup is known at time T1 (its CHoCH, zone, entry, stop,
    target, fill time, final result), every later scan T2 > T1 must report exactly the same fact."""
    def test_facts_never_change(self):
        X = json.load(open(os.path.join(HERE, "..", "forex", "tests", "sweep_fixture.json")))
        checked = 0
        for key, sec in (("res", 4 * 3600), ("resD", 86400), ("res2H", 2 * 3600)):
            seen = {}
            for e in X["evals"]:
                for r in e.get(key, []):
                    k = (r["sweep"]["t"], r["dir"])
                    if r["zone"]:            # zone (and levels) are known from the close of the candle after the CHoCH
                        facts = {f: r.get(f) for f in ("choch", "zone", "entry", "sl", "tp", "disp")}
                        if k in seen and "facts" in seen[k]:
                            self.assertEqual(facts, seen[k]["facts"], f"{key} {k} CHoCH/zone changed after it was known"); checked += 1
                        seen.setdefault(k, {})["facts"] = facts
                    if r.get("tFill") is not None:
                        if k in seen and "fill" in seen[k]:
                            self.assertEqual(r["tFill"], seen[k]["fill"], f"{key} {k} fill time changed"); checked += 1
                        seen.setdefault(k, {})["fill"] = r["tFill"]
                        self.assertGreaterEqual(r["tFill"], r["sweep"]["t"] + sec, f"{key} {k} filled before the sweep candle closed")
                    if r["status"] in ("TARGET_HIT", "STOPPED", "INVALIDATED", "MISSED", "EXPIRED"):
                        if k in seen and "end" in seen[k]:
                            self.assertEqual(r["status"], seen[k]["end"], f"{key} {k} final result changed"); checked += 1
                        seen.setdefault(k, {})["end"] = r["status"]
        self.assertGreater(checked, 50)


class Candles(unittest.TestCase):
    """New York anchoring through both daylight-saving switches (Feb-Nov 2025): the 4H / 2H / daily candles from
    build() must equal candles made independently, bar by bar, with zoneinfo (4H blocks 01/05/09/13/17/21 NY,
    2H blocks on odd NY hours, days from 17:00 NY). A candle is labelled with its first hourly bar (Yahoo's week
    starts at 00:00 UTC, so Sunday candles read 19:00 or 20:00 NY)."""
    def test_dst(self):
        import pandas as pd
        from datetime import datetime, timedelta, timezone
        from zoneinfo import ZoneInfo
        P = json.load(open(os.path.join(HERE, "..", "forex", "tests", "parity_fixture.json")))
        b = P["bars"]
        h = pd.DataFrame([x[1:] for x in b], columns=["Open", "High", "Low", "Close"], index=pd.to_datetime([x[0] for x in b], unit="s", utc=True))
        tfs = F.build(h); ny = ZoneInfo("America/New_York")
        def local(t):
            return datetime.fromtimestamp(t, timezone.utc).astimezone(ny).replace(tzinfo=None)
        keys = {"4H": lambda L: (L - timedelta(hours=1)).replace(minute=0, hour=(L - timedelta(hours=1)).hour // 4 * 4),
                "2H": lambda L: (L - timedelta(hours=1)).replace(minute=0, hour=(L - timedelta(hours=1)).hour // 2 * 2),
                "D": lambda L: (L + timedelta(hours=7)).date()}
        for tf, key in keys.items():
            groups = {}
            for t, o, hi, lo, c in b:
                k = key(local(t)); g = groups.get(k)
                groups[k] = [t, o, hi, lo, c] if g is None else [g[0], g[1], max(g[2], hi), min(g[3], lo), c]
            mine = sorted(groups.values())
            got = [[int(t.timestamp()), r.Open, r.High, r.Low, r.Close] for t, r in tfs[tf].iterrows()]
            self.assertEqual(got, mine, tf)
            if tf != "D":       # every candle starts inside its block, also across the DST switches
                ok = {1, 5, 9, 13, 17, 21} if tf == "4H" else set(range(1, 24, 2))
                starts = {(local(g[0]) - timedelta(hours=1)).hour // (4 if tf == "4H" else 2) * (4 if tf == "4H" else 2) + 1 for g in mine}
                self.assertLessEqual(starts, ok, tf)


if __name__ == "__main__":
    unittest.main()
