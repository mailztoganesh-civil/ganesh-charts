"""Backtest of the ICT 4H Sweep setup on the forex-data 5-minute bars, using the app's own engine (sweep4h.py):
the same swings, sweeps, 15m CHoCH, FVG/OB zone, entry, stop and target the app shows.

Execution (decided before looking at results; nothing is fitted):
  entry   limit order at the zone's near edge, placed when the CHoCH candle has closed (and the zone exists); it can
          only fill once the 4H sweep candle has closed back inside (before that the sweep is not confirmed).
          Long fills when the ask reaches it (mid low <= entry - half spread); fill price = entry.
  stop    the sweep extreme. Triggered at the bid/ask (mid +/- half spread); fill = stop minus slippage.
  target  the opposite liquidity (limit, filled at the level once the bid/ask reaches it).
  expiry  no fill within 6 4H candles after the sweep candle closed -> cancelled (the app's EXPIRED).
          Before a fill: price beyond the stop -> cancelled; target reached first -> cancelled (missed).
  hold    at most 20 days (1D) / 5 days (4H) / 3 days (2H) after the fill, then closed at the market (minus half spread and slippage).
  same 5-minute bar touches stop and target -> stop first. R = result / planned risk (entry to stop).
Costs per pair as in scripts/crt_backtest.py. Periods: train 2023-01..2024-06, validation 2024-07..2025-06, test 2025-07+.

Usage: python scripts/sweep_backtest.py <forex-data checkout> [--tf D|4H|2H] [PAIR ...]
       -> forex/backtest/sweep[<tf>]_<PAIR>.json and sweep[<tf>]_README.md (4H files have no tf in the name)
Timeframe pairs as in the app: 1D sweep -> 1H CHoCH, 4H -> 15m, 2H -> 5m.
"""
import bisect, json, math, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forex_crt as F       # noqa: E402
import sweep4h as S         # noqa: E402
import crt_backtest as B    # noqa: E402  (data loading, costs, periods, stats)

OUT_DIR = B.OUT_DIR
HOLD_D = {"D": 20 * 86400, "4H": 5 * 86400, "2H": 3 * 86400}   # max holding time after the fill
AGG = {"Open": "first", "High": "max", "Low": "min", "Close": "last"}


def lists(df):
    return [[int(t.timestamp()), float(r.Open), float(r.High), float(r.Low), float(r.Close)] for t, r in df.iterrows()]


TF = "4H"
SEC = {"D": 86400, "4H": 4 * 3600, "2H": 2 * 3600}
LTF = {"D": "1h", "4H": "15min", "2H": "5min"}
PFX = lambda: "sweep" if TF == "4H" else "sweep" + TF


def setups(c4, m15):
    """Every closed 4H sweep with its 15m setup. m15 is cut at the expiry/holding window so nothing later is used."""
    t15 = [b[0] for b in m15]; out = []
    for j in range(S.P["K"] * 2 + 2, len(c4) - 1):
        sw = S.sweep_at(c4, j, False)
        if not sw or sw["code"] != "SWEEP":
            continue
        a = bisect.bisect_left(t15, c4[j - 1][0])
        texp = c4[j + 1 + S.P["EXPIRY"]][0] if j + 1 + S.P["EXPIRY"] < len(c4) else c4[j][0] + (1 + S.P["EXPIRY"]) * SEC[TF]
        e = bisect.bisect_left(t15, texp)                         # nothing after the expiry is needed to find the zone
        x = S.ltf_setup(sw, c4, m15[a:e], open_last=False, sec=SEC[TF])
        out.append({"sw": sw, "x": x, "q": S.quality(sw, x), "texp": texp, "tconf": c4[j + 1][0]})
    return out


def simulate(s, m5, pair):
    """5-minute execution of one setup with costs. None if no order was placed (no CHoCH / zone)."""
    x = s["x"]
    if not x.get("zone") or x.get("entry") is None or s["sw"]["target"] is None:
        return None
    T, O, H, L, C = m5
    pip = B.PIP[pair]; spread, slip = B.COST[pair]; hs, sp = spread / 2 * pip, slip * pip
    d = s["sw"]["dir"]; entry, sl, tp = x["entry"], x["sl"], s["sw"]["target"]
    risk = abs(entry - sl)
    if risk <= 0 or (tp - entry) * d <= 0:
        return {"placed": False}
    t_place = max(x["choch"]["t"] + 15 * 60, x["zone"]["t"] + 3 * 15 * 60)    # after the CHoCH candle (and the FVG) closed
    a = int(np.searchsorted(T, t_place, "left")); e = int(np.searchsorted(T, s["texp"], "left"))
    fill = None
    for k in range(a, min(e, len(T))):
        lo, hi = L[k], H[k]
        touch = (lo - hs <= entry) if d == 1 else (hi + hs >= entry)        # buy limit at the ask / sell limit at the bid
        stop = (lo + hs <= sl) if d == 1 else (hi - hs >= sl)
        tgt = (hi - hs >= tp) if d == 1 else (lo + hs <= tp)
        if touch and T[k] >= s["tconf"]:                       # no fill before the 4H sweep candle closed back inside
            fill = k; break
        if stop:
            return {"placed": True, "filled": False, "why": "invalidated"}
        if tgt:
            return {"placed": True, "filled": False, "why": "missed"}
    if fill is None:
        return {"placed": True, "filled": False, "why": "expired"}
    end = int(np.searchsorted(T, T[fill] + HOLD_D[TF], "left"))
    for k in range(fill, min(end, len(T))):
        stop = (L[k] + hs <= sl) if d == 1 else (H[k] - hs >= sl)
        tgt = (H[k] - hs >= tp) if d == 1 else (L[k] + hs <= tp)
        if stop:
            return {"placed": True, "filled": True, "R": d * ((sl - d * sp) - entry) / risk, "how": "stop", "both": bool(tgt), "t": int(T[fill])}
        if tgt:
            return {"placed": True, "filled": True, "R": d * (tp - entry) / risk, "how": "target", "both": False, "t": int(T[fill])}
    k = min(end, len(T)) - 1
    return {"placed": True, "filled": True, "R": d * ((C[k] - d * (hs + sp)) - entry) / risk, "how": "time", "both": False, "t": int(T[fill])}


VARIANTS = [
    ("all setups (rules as in the app)", lambda s: True),
    ("grade A or B", lambda s: s["q"]["grade"] in ("A", "B")),
    ("grade A", lambda s: s["q"]["grade"] == "A"),
    ("4H swing >= 1.5 ATR", lambda s: s["q"]["checks"]["swing"]),
    ("sweep 0.1-1.0 ATR", lambda s: s["q"]["checks"]["depth"]),
    ("displacement >= 1.5 ATR", lambda s: s["q"]["checks"]["disp"]),
    ("FVG zone only", lambda s: s["q"]["checks"]["fvg"]),
    ("R:R >= 2", lambda s: s["q"]["checks"]["rr"]),
    ("entry in discount / premium (TTrades)", lambda s: s["x"].get("pd") is True),
    ("TTrades checklist 5/5", lambda s: s["q"]["ttN"] == 5),
    ("A1 = grade A + TTrades checklist 5/5", lambda s: s["q"]["grade"] == "A" and s["q"]["ttN"] == 5),
    ("app default filters (sweep >= 0.05, displacement >= 1.0, swing >= 1.0)",
     lambda s: s["sw"]["depth"] >= 0.05 and (s["x"].get("disp") or 0) >= 1.0 and s["sw"]["swingSize"] >= 1.0),
]


def run(root, pair):
    m5df = B.load5(root, pair)
    m5 = (np.array([int(t.timestamp()) for t in m5df.index]), m5df.Open.values, m5df.High.values, m5df.Low.values, m5df.Close.values)
    h = m5df.resample("1h", label="left", closed="left").agg(AGG).dropna()
    c4 = lists(F.build(h)[TF]); m15 = lists(m5df.resample(LTF[TF], label="left", closed="left").agg(AGG).dropna())
    su = setups(c4, m15)
    for s in su:
        s["r"] = simulate(s, m5, pair)
    funnel = {"sweeps (closed back inside)": len(su), "with 15m CHoCH": sum(1 for s in su if s["x"].get("choch")),
              "orders placed": sum(1 for s in su if s["r"] and s["r"].get("placed")),
              "filled": sum(1 for s in su if s["r"] and s["r"].get("filled"))}
    for why in ("invalidated", "missed", "expired"):
        funnel["cancelled: " + why] = sum(1 for s in su if s["r"] and s["r"].get("why") == why)
    trades = sorted([s for s in su if s["r"] and s["r"].get("filled")], key=lambda s: s["r"]["t"])
    for s in trades:
        t = s["r"]["t"]
        s["split"] = next(n for n, a, b in B.SPLITS if pd.Timestamp(a).timestamp() <= t < pd.Timestamp(b).timestamp())
        s["session"] = B.session(t)
    res = {"pair": pair, "data": [str(m5df.index[0]), str(m5df.index[-1])], "cost_pips": B.COST[pair], "funnel": funnel, "variants": {}, "sessions": {},
           "exits": {k: sum(1 for s in trades if s["r"]["how"] == k) for k in ("target", "stop", "time")},
           "same_bar_stop_and_target": sum(1 for s in trades if s["r"]["both"])}
    for name, f in VARIANTS:
        sel = [s for s in trades if f(s)]
        res["variants"][name] = {sp: B.stats([s["r"]["R"] for s in sel if s["split"] == sp]) for sp, _, _ in B.SPLITS}
        res["variants"][name]["all"] = B.stats([s["r"]["R"] for s in sel])
    for ss in sorted({s["session"] for s in trades}):
        res["sessions"][ss] = B.stats([s["r"]["R"] for s in trades if s["session"] == ss])
    print(pair, funnel, res["variants"]["all setups (rules as in the app)"]["all"])
    return res


def summary(pairs):
    D = {p: json.load(open(os.path.join(OUT_DIR, f"{PFX()}_{p}.json"))) for p in pairs}
    L = [f"# ICT {'1D' if TF == 'D' else TF} Sweep backtest – summary (CHoCH on {dict(D='1H', **{'4H': '15m', '2H': '5m'})[TF]})", "",
         f"Pairs: {', '.join(pairs)}. forex-data 5-minute bars from {B.SPLITS[0][1]}; costs per pair as in the CRT backtest. "
         "Made by `python scripts/sweep_backtest.py <forex-data> --tf " + TF + " " + " ".join(pairs) + "`; execution rules in that script's header. "
         "Average R per filled trade, all pairs pooled; trades in brackets. No threshold was tuned.", "",
         "## Funnel (all pairs)", "", "| Step | Count |", "|---|---|"]
    for k in D[pairs[0]]["funnel"]:
        L.append(f"| {k} | {sum(D[p]['funnel'][k] for p in pairs)} |")
    L += ["", "## Results", "", "| Variant | Train | Validation | Test | Win % (all) |", "|---|---|---|---|---|"]
    for v in D[pairs[0]]["variants"]:
        cells = []
        for sp in [x[0] for x in B.SPLITS] + ["all"]:
            n = sum(D[p]["variants"][v][sp].get("n", 0) for p in pairs); sr = sum(D[p]["variants"][v][sp].get("sumR", 0) for p in pairs)
            cells.append((n, sr))
        wins = sum(D[p]["variants"][v]["all"].get("win", 0) * D[p]["variants"][v]["all"].get("n", 0) / 100 for p in pairs)
        n_all = cells[-1][0]
        L.append(f"| {v} | " + " | ".join(f"{sr / n:+.3f} ({n})" if n else "–" for n, sr in cells[:3]) +
                 (f" | {wins / n_all * 100:.0f}% |" if n_all else " | – |"))
    L += ["", "## Per pair (all setups, whole period)", "", "| Pair | Trades | Win | Avg R | PF | Sum R | Max DD |", "|---|---|---|---|---|---|---|"]
    for p in pairs:
        L.append(f"| {p} | {B.fmt(D[p]['variants']['all setups (rules as in the app)']['all'])} |")
    L += ["", "Not tested here: the CRT-confluence filter (it needs the CRT state at each moment), news, swaps.", ""]
    open(os.path.join(OUT_DIR, f"{PFX()}_README.md"), "w").write("\n".join(L))


def main():
    global TF
    args = sys.argv[1:]; root = args.pop(0)
    if args[:1] == ["--tf"]:
        TF = args[1]; args = args[2:]
    pairs = args or ["EURUSD"]
    os.makedirs(OUT_DIR, exist_ok=True)
    for p in pairs:
        json.dump(run(root, p), open(os.path.join(OUT_DIR, f"{PFX()}_{p}.json"), "w"), indent=1)
    summary(pairs)


if __name__ == "__main__":
    main()
