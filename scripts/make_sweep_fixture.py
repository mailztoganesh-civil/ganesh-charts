"""Build forex/tests/sweep_fixture.json: real EURUSD data (hourly bars for the 4H candles, 15-minute bars) and the
Python 4H-sweep results at many points in time. forex/tests/run_tests.js runs forex/sweep.js on the same data and
must get the same answers; scripts/test_forex_crt.py recomputes the Python side.

Usage: python scripts/make_sweep_fixture.py <forex-data checkout>
"""
import glob, json, os, sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forex_crt as F  # noqa: E402
import sweep4h as S    # noqa: E402

OUT = os.path.join(HERE, "..", "forex", "tests", "sweep_fixture.json")
START, END = "2025-02-03", "2025-05-17"     # covers the US daylight-saving switch (9 Mar 2025)
EVAL_DAYS, EVAL_STEP_H = 70, 7
PIP = 0.0001
AGG = {"Open": "first", "High": "max", "Low": "min", "Close": "last"}


def bars(df):
    return [[int(t.timestamp()), round(float(r.Open), 5), round(float(r.High), 5), round(float(r.Low), 5), round(float(r.Close), 5)] for t, r in df.iterrows()]


def view(h1, m15, T):
    """What the app sees at time T: hourly bars started at or before T (the last one still forming) and 15m bars."""
    hh = [b for b in h1 if b[0] <= T]; mm = [b for b in m15 if b[0] <= T]
    return hh, mm


def scan_at(h1, m15, T):
    hh, mm = view(h1, m15, T)
    df = pd.DataFrame([b[1:] for b in hh], columns=["Open", "High", "Low", "Close"], index=pd.to_datetime([b[0] for b in hh], unit="s", utc=True))
    c4 = [[int(t.timestamp()), float(r.Open), float(r.High), float(r.Low), float(r.Close)] for t, r in F.build(df)["4H"].iterrows()]
    return S.scan(c4, mm, PIP, mm[-1][4])


def main(root):
    fs = sorted(glob.glob(os.path.join(root, "data", "EURUSD", "5m", "*.csv.gz")))
    d = pd.concat(pd.read_csv(f, parse_dates=["Datetime"]) for f in fs).set_index("Datetime")
    d.index = pd.to_datetime(d.index, utc=True)
    d = F.clean_df(d); d = d[(d.index >= START) & (d.index < END)]
    h1 = bars(d.resample("1h", label="left", closed="left").agg(AGG).dropna())
    m15 = bars(d.resample("15min", label="left", closed="left").agg(AGG).dropna())
    t_end = m15[-1][0]; first = t_end - EVAL_DAYS * 86400
    times = list(range(first, t_end + 1, EVAL_STEP_H * 3600)) + [t_end]
    evals = [{"T": T, "res": scan_at(h1, m15, T)} for T in times]
    json.dump({"pair": "EURUSD", "pip": PIP, "window": [START, END], "h1": h1, "m15": m15, "evals": evals},
              open(OUT, "w"), separators=(",", ":"))
    n = sum(len(e["res"]) for e in evals)
    print("wrote", OUT, len(evals), "points in time,", n, "setups,", os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main(sys.argv[1])
