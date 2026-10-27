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


if __name__ == "__main__":
    unittest.main()
