"""Replay check for the ICT sweep engine: run the app's scan the way the phone does it, once per 15-minute candle,
seeing only the candles that existed at that moment, and check that
  1. nothing already known ever changes later (CHoCH, zone, entry, stop, target, fill time, final result), and
  2. the batch backtest (scripts/sweep_backtest.py) found the same setups with the same levels and fill times.

Usage: python scripts/sweep_replay_check.py <forex-data checkout> [PAIR] [START] [END]   (default EURUSD 2025-07-01 2025-10-01)
"""
import bisect, glob, os, sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forex_crt as F       # noqa: E402
import sweep4h as S         # noqa: E402
import sweep_backtest as B  # noqa: E402
import crt_backtest as C    # noqa: E402

AGG = {"Open": "first", "High": "max", "Low": "min", "Close": "last"}
FINAL = ("TARGET_HIT", "STOPPED", "INVALIDATED", "MISSED", "EXPIRED")


def main(root, pair="EURUSD", start="2025-07-01", end="2025-10-01"):
    m5 = C.load5(root, pair)
    m5 = m5[m5.index < end]
    h1 = m5.resample("1h", label="left", closed="left").agg(AGG).dropna()
    m15 = B.lists(m5.resample("15min", label="left", closed="left").agg(AGG).dropna())
    t15 = [b[0] for b in m15]
    h1l = B.lists(h1); th = [b[0] for b in h1l]
    pip = C.PIP[pair]
    t0 = int(pd.Timestamp(start, tz="UTC").timestamp())
    seen, changes, steps = {}, [], 0
    for i in range(bisect.bisect_left(t15, t0), len(m15)):
        T = m15[i][0]
        hh = h1l[max(0, bisect.bisect_right(th, T) - 1500):bisect.bisect_right(th, T)]   # ~ 2 months of hourly bars
        df = pd.DataFrame([b[1:] for b in hh], columns=["Open", "High", "Low", "Close"], index=pd.to_datetime([b[0] for b in hh], unit="s", utc=True))
        c4 = B.lists(F.build(df)["4H"])
        mm = m15[max(0, i - 480):i + 1]                 # 5 days of 15m candles, like the app; the last one is open
        for r in S.scan(c4, mm, pip, mm[-1][4], 4 * 3600):
            k = (r["sweep"]["t"], r["dir"]); s = seen.setdefault(k, {"first": T})
            if r["choch"] and "ct" in s and s["ct"] != r["choch"]["t"]: changes.append((k, "choch", s["ct"], r["choch"]["t"]))
            if r["choch"]: s["ct"] = r["choch"]["t"]
            if r["zone"]:                               # the zone is known from the close of the candle after the CHoCH
                f = (r["choch"]["t"], (r["zone"]["type"], r["zone"]["lo"], r["zone"]["hi"]), r.get("entry"), r.get("sl"), r.get("tp"))
                if "f" in s and s["f"] != f: changes.append((k, "levels", s["f"], f))
                s["f"] = f
            if r.get("tFill") is not None:
                if "fill" in s and s["fill"] != r["tFill"]: changes.append((k, "fill", s["fill"], r["tFill"]))
                s["fill"] = r["tFill"]
            if r["status"] in FINAL:
                if "end" in s and s["end"] != r["status"]: changes.append((k, "end", s["end"], r["status"]))
                s["end"] = r["status"]
        steps += 1
    print(f"replay: {steps} scans of {pair} 4H, {len(seen)} sweeps seen, {len(changes)} later changes of known facts")
    for c in changes[:5]:
        print("  changed:", c)
    # the batch backtest on the same data
    B.TF = "4H"
    full_c4 = B.lists(F.build(h1)["4H"])
    batch = {(s["sw"]["t"], s["sw"]["dir"]): s for s in B.setups(full_c4, m15) if s["sw"]["t"] >= t0}
    common = [k for k in seen if k in batch and "f" in seen[k]]
    diff = []
    for k in common:
        x = batch[k]["x"]
        f = (x["choch"]["t"], (x["zone"]["type"], x["zone"]["lo"], x["zone"]["hi"]), x.get("entry"), x.get("sl"), x.get("tp")) if x.get("zone") else None
        if f != seen[k]["f"]:
            diff.append((k, seen[k]["f"], f))
        elif x.get("tFill") != seen[k].get("fill") and "fill" in seen[k]:
            diff.append((k, "fill", seen[k].get("fill"), x.get("tFill")))
    only_replay = [k for k in seen if k not in batch and k[0] >= t0 and seen[k]["first"] > k[0] + 4 * 3600]
    print(f"batch backtest: {len(batch)} closed sweeps in the period; {len(common)} with a CHoCH compared with the replay; "
          f"{len(diff)} differ; {len(only_replay)} closed sweeps seen live but missing from the batch")
    for d in diff[:5]:
        print("  differs:", d)
    return len(changes) == 0 and len(diff) == 0 and len(only_replay) == 0


if __name__ == "__main__":
    ok = main(*sys.argv[1:])
    print("REPLAY CHECK", "PASSED" if ok else "FAILED")
    sys.exit(0 if ok else 1)
