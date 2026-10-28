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
M5_DAYS = 21
PIP = 0.0001
AGG = {"Open": "first", "High": "max", "Low": "min", "Close": "last"}


def bars(df):
    return [[int(t.timestamp()), round(float(r.Open), 5), round(float(r.High), 5), round(float(r.Low), 5), round(float(r.Close), 5)] for t, r in df.iterrows()]


def view(h1, m15, T):
    """What the app sees at time T: hourly bars started at or before T (the last one still forming) and 15m bars."""
    hh = [b for b in h1 if b[0] <= T]; mm = [b for b in m15 if b[0] <= T]
    return hh, mm


def scan_at(h1, m15, T, m5=None):
    """Sweep results at time T: 4H (15m CHoCH), Daily (1H CHoCH) and, when 5m bars cover T, 2H (5m CHoCH)."""
    hh, mm = view(h1, m15, T)
    df = pd.DataFrame([b[1:] for b in hh], columns=["Open", "High", "Low", "Close"], index=pd.to_datetime([b[0] for b in hh], unit="s", utc=True))
    tfs = F.build(df)
    L = lambda x: [[int(t.timestamp()), float(r.Open), float(r.High), float(r.Low), float(r.Close)] for t, r in x.iterrows()]
    out = {"res": S.scan(L(tfs["4H"]), mm, PIP, mm[-1][4], 4 * 3600), "resD": S.scan(L(tfs["D"]), L(tfs["1H"]), PIP, mm[-1][4], 86400)}
    if m5 and m5[0][0] + 86400 <= T:
        m = [b for b in m5 if b[0] <= T]
        out["res2H"] = S.scan(L(tfs["2H"]), m, PIP, mm[-1][4], 2 * 3600)
    return out


def main(root):
    fs = sorted(glob.glob(os.path.join(root, "data", "EURUSD", "5m", "*.csv.gz")))
    d = pd.concat(pd.read_csv(f, parse_dates=["Datetime"]) for f in fs).set_index("Datetime")
    d.index = pd.to_datetime(d.index, utc=True)
    d = F.clean_df(d); d = d[(d.index >= START) & (d.index < END)]
    h1 = bars(d.resample("1h", label="left", closed="left").agg(AGG).dropna())
    m15 = bars(d.resample("15min", label="left", closed="left").agg(AGG).dropna())
    m5 = bars(d[d.index >= d.index[-1] - pd.Timedelta(days=M5_DAYS)])          # 5m only for the last weeks (file size)
    t_end = m15[-1][0]; first = t_end - EVAL_DAYS * 86400
    times = list(range(first, t_end + 1, EVAL_STEP_H * 3600)) + [t_end]
    evals = [dict({"T": T}, **scan_at(h1, m15, T, m5)) for T in times]
    json.dump({"pair": "EURUSD", "pip": PIP, "window": [START, END], "h1": h1, "m15": m15, "m5": m5, "evals": evals},
              open(OUT, "w"), separators=(",", ":"))
    n = {k: sum(len(e.get(k, [])) for e in evals) for k in ("res", "resD", "res2H")}
    print("wrote", OUT, len(evals), "points in time, setups", n, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main(sys.argv[1])
