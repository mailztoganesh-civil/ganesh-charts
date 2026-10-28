"""Build forex/tests/parity_fixture.json: real EURUSD hourly bars plus the Python scanner's results at many points in
time. forex/tests/run_tests.js feeds the same bars to the phone engine (forex/live.js) and must get the same answers;
scripts/test_forex_crt.py recomputes the Python side, so a change to either engine that breaks parity fails a test.

The window (Feb-Nov 2025) covers both US daylight-saving switches, so the New York candle anchoring is checked too.

Usage: python scripts/make_parity_fixture.py <forex-data>/data/EURUSD/1h.csv
"""
import json, os, sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forex_crt as F  # noqa: E402

OUT = os.path.join(HERE, "..", "forex", "tests", "parity_fixture.json")
START, END = "2025-02-01", "2025-11-20"
EVAL_DAYS, EVAL_STEP = 200, 29          # evaluate every 29 hours over the last 200 days of the window
PIP = 0.0001
FIELDS = ["status", "state", "code", "dir", "c1t", "c2t", "c1Back", "c2Back", "sigt", "entry", "t1", "t2", "inv", "sweep",
          "level", "hit1", "hit2", "failed", "toT2", "rr", "also"]


def load(path):
    d = pd.read_csv(path, parse_dates=["Datetime"]).set_index("Datetime")
    d.index = pd.to_datetime(d.index, utc=True)
    d = F.clean_df(d)
    return d[(d.index >= START) & (d.index < END)].round(5)


def scan(h):
    """Python results for hourly bars h (the last bar = the bar in progress)."""
    tfs = F.build(h)
    row = {"sym": "EURUSD", "pip": PIP, "tf": {}}
    for tf, df in tfs.items():
        r = F.classify(df, tf, PIP)
        if r:
            row["tf"][tf] = r
    F.add_model1(row, tfs, {})
    out = {}
    for tf, r in row["tf"].items():
        o = {k: r[k] for k in FIELDS if k in r}
        for k in ("q", "q2", "m1"):
            if r.get(k):
                o[k] = r[k]
        o["last"] = r["candles"][-1]; o["n"] = len(tfs[tf])
        out[tf] = o
    return out


def results(h, ends):
    return [{"end": e, "tf": scan(h.iloc[:e + 1])} for e in ends]


def main(path):
    h = load(path)
    first = h.index[-1] - pd.Timedelta(days=EVAL_DAYS)
    ends = [i for i in range(len(h)) if h.index[i] >= first][::EVAL_STEP] + [len(h) - 1]
    bars = [[int(t.timestamp()), r.Open, r.High, r.Low, r.Close] for t, r in h.iterrows()]
    json.dump({"pair": "EURUSD", "pip": PIP, "window": [START, END], "bars": bars, "evals": results(h, ends)},
              open(OUT, "w"), separators=(",", ":"))
    print("wrote", OUT, len(bars), "bars,", len(ends), "evaluation points,", os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main(sys.argv[1])
