"""CRT backtest on the 5-minute data in the forex-data repository, using the screener's own identification code
(forex_crt.identify, c1_quality, c2_checks), so the backtest tests exactly what the app shows.

Rules tested (no parameters are fitted; every threshold is the app's existing default):
  signal   C2 is FORMED (swept one C1 boundary, closed strictly inside C1). The signal exists only once C2 has
           closed: time = start of the next candle (C3). identify() only reads candles up to C2.
  entry    first 5-minute bar at/after the signal: its open, plus half the spread and slippage (market order).
  stop     beyond C2's sweep extreme (the "invalid" level the app shows). Stop fill = level minus slippage.
  target   the far side of C1 (TP2, the app's target). A variant uses 50% of C1 (TP1). Limit fill at the level.
  time     if neither is hit, exit at the close of C4 (end of the candle 2 after C2) - the app keeps a formed setup
           active through C3 and C4 only. Exit fill = close minus half the spread and slippage.
  costs    prices are treated as mid quotes; buys pay +half spread, sells -half spread; market fills also pay slippage.
  same bar if one 5-minute bar touches both stop and target, the stop is assumed first (conservative); counted.
  overlap  every signal is traded on its own (1R risk each), also when trades overlap in time.

Variants compared: the original rules (before 27 Oct 2026: a C2 sweeping both sides counted when it closed in its
outer third), the current strict rules (two-sided = ambiguous, not traded), and the current rules plus each optional
screener filter on its own, plus the app's default filter set.

Periods (chronological): train 2023-01 to 2024-06, validation 2024-07 to 2025-06, test 2025-07 to the end of data.

Usage: python scripts/crt_backtest.py <forex-data checkout> [PAIR ...]      (default EURUSD)
Writes forex/backtest/<PAIR>.json and forex/backtest/<PAIR>.md
"""
import glob, json, math, os, sys
from collections import defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forex_crt as F  # noqa: E402

OUT_DIR = os.path.join(HERE, "..", "forex", "backtest")
PIP = {"EURUSD": 1e-4, "GBPUSD": 1e-4, "AUDUSD": 1e-4, "NZDUSD": 1e-4, "USDCAD": 1e-4, "USDCHF": 1e-4,
       "USDJPY": 0.01, "XAUUSD": 0.1}
# (spread, slippage) in pips per pair - typical retail ECN-style costs incl. commission, not best case
COST = {"EURUSD": (0.8, 0.2), "GBPUSD": (1.2, 0.3), "AUDUSD": (1.0, 0.3), "NZDUSD": (1.6, 0.3), "USDCAD": (1.5, 0.3),
        "USDCHF": (1.5, 0.3), "USDJPY": (1.0, 0.3), "XAUUSD": (3.0, 1.0)}
SPLITS = [("train", "2023-01-01", "2024-07-01"), ("validation", "2024-07-01", "2025-07-01"), ("test", "2025-07-01", "2100-01-01")]
TFS = ["1H", "4H", "D"]
SESS = [(19, 24, "Asia"), (0, 2, "Asia"), (2, 8, "London"), (8, 12, "NY AM"), (12, 17, "NY PM"), (17, 19, "NY close")]


def session(t):
    h = F.ny_hour(t)
    return next(name for a, b, name in SESS if a <= h < b)


def load5(root, pair):
    fs = sorted(glob.glob(os.path.join(root, "data", pair, "5m", "*.csv.gz")))
    if not fs:
        raise SystemExit(f"no 5-minute files for {pair} under {root}/data/{pair}/5m")
    d = pd.concat(pd.read_csv(f, parse_dates=["Datetime"]) for f in fs).set_index("Datetime")
    d.index = pd.to_datetime(d.index, utc=True)
    d = d[d.index >= pd.Timestamp(SPLITS[0][1], tz="UTC")]        # same periods for every pair (older data not used)
    return F.clean_df(d)


def to_list(df):
    return [[int(t.timestamp()), float(r.Open), float(r.High), float(r.Low), float(r.Close)] for t, r in df.iterrows()]


def signals(lists, tf, pip):
    """All closed-C2 CRT signals on one timeframe. Only candles up to C2 are read for identity and checks."""
    cs = lists[tf]; out = []
    for j in range(25, len(cs) - 1):
        i = F.identify(cs, j); original_only = False
        if i["code"] == "AMBIGUOUS":                      # old rule: outer-third close made it a setup
            F.TWO_SIDED = "outer-third"
            try:
                i = F.identify(cs, j)
            finally:
                F.TWO_SIDED = "ambiguous"
            original_only = True
        if i["code"] != "FORMED":
            continue
        lo = max(0, j - 60)
        win = dict(lists); win[tf] = cs[lo:j + 1]            # the scanner's view at C2's close: nothing later
        r = {"status": "formed", "dir": i["dir"], "c1Back": j - i["c1"], "c2Back": 0}
        q = F.c1_quality(win, tf, r) or {}; q2 = F.c2_checks(win, tf, r, pip) or {}
        out.append(dict(tf=tf, j=j, dir=i["dir"], c1h=i["c1h"], c1l=i["c1l"], sweep=i["sweep"], original_only=original_only,
                        t_sig=cs[j + 1][0], t_end=cs[j + 3][0] if j + 3 < len(cs) else None,
                        size=bool(q.get("size")) and not q.get("inside"), key=bool(q.get("key")), bias=q.get("bias") is True,
                        clean=bool(q2.get("sweep")), reject=bool(q2.get("reject")), kz=q2.get("kz") is True))
    return out


def trade(s, m5, pair, target="t2", costs=True):
    T, O, H, L, C = m5
    pip = PIP[pair]; spread, slip = COST[pair] if costs else (0.0, 0.0); hs, sp = spread / 2 * pip, slip * pip
    d = s["dir"]; sl = s["sweep"]
    tp = (s["c1h"] if d == 1 else s["c1l"]) if target == "t2" else (s["c1h"] + s["c1l"]) / 2
    a = int(np.searchsorted(T, s["t_sig"], "left"))
    b = int(np.searchsorted(T, s["t_end"], "left")) if s["t_end"] else len(T)
    if a >= b:
        return None
    entry = O[a] + d * (hs + sp)
    risk = d * (entry - sl)
    if risk <= 0 or d * (tp - entry) <= 0:
        return {"skip": True}
    h, l = H[a:b], L[a:b]
    if d == 1:
        stop_hit, tp_hit = l - hs <= sl, h - hs >= tp            # sells happen at the bid
    else:
        stop_hit, tp_hit = h + hs >= sl, l + hs <= tp            # buys happen at the ask
    ks = int(np.argmax(stop_hit)) if stop_hit.any() else None
    kt = int(np.argmax(tp_hit)) if tp_hit.any() else None
    both = ks is not None and kt is not None and ks == kt
    if ks is not None and (kt is None or ks <= kt):
        exit_px, how = sl - d * sp, "stop"
    elif kt is not None:
        exit_px, how = tp, "target"
    else:
        exit_px, how = C[b - 1] - d * (hs + sp), "time"
    return {"R": d * (exit_px - entry) / risk, "how": how, "both": both, "rr_plan": d * (tp - entry) / risk}


def stats(rs):
    if not rs:
        return {"n": 0}
    a = np.array(rs); eq = np.cumsum(a); dd = float(np.max(np.maximum.accumulate(np.concatenate([[0], eq]))[1:] - eq)) if len(a) else 0
    wins, losses = a[a > 0].sum(), -a[a < 0].sum()
    return {"n": len(a), "win": round(float((a > 0).mean()) * 100, 1), "avgR": round(float(a.mean()), 3),
            "se": round(float(a.std(ddof=1) / math.sqrt(len(a))), 3) if len(a) > 1 else None,
            "pf": round(float(wins / losses), 2) if losses > 0 else None, "sumR": round(float(a.sum()), 1), "maxDD": round(dd, 1)}


VARIANTS = [
    ("original rules (two-sided outer-third counts)", lambda s: True, True),
    ("current strict rules (baseline)", lambda s: True, False),
    ("+ C1 size and not inside bar", lambda s: s["size"], False),
    ("+ key level", lambda s: s["key"], False),
    ("+ HTF bias agrees", lambda s: s["bias"], False),
    ("+ clean sweep depth", lambda s: s["clean"], False),
    ("+ rejection close", lambda s: s["reject"], False),
    ("+ kill zone (1H/4H only)", lambda s: s["kz"], False),
    ("+ planned R:R >= 2", lambda s: s["rr_plan"] >= 2, False),
    ("app default filters (size, key, sweep, rejection)", lambda s: s["size"] and s["key"] and s["clean"] and s["reject"], False),
]


def run(root, pair):
    m5df = load5(root, pair)
    m5 = (np.array([int(t.timestamp()) for t in m5df.index]), m5df.Open.values, m5df.High.values, m5df.Low.values, m5df.Close.values)
    h = m5df.resample("1h", label="left", closed="left").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna()
    tfs = F.build(h); lists = {k: to_list(v) for k, v in tfs.items()}
    pip = PIP[pair]
    res = {"pair": pair, "data": [str(m5df.index[0]), str(m5df.index[-1])], "bars5m": len(m5df), "cost_pips": COST[pair], "tf": {}}
    for tf in TFS:
        sig = signals(lists, tf, pip); trades = []; skipped = 0
        for s in sig:
            for tgt in ("t2", "t1", "t2-nocost"):
                x = trade(s, m5, pair, tgt[:2], costs=not tgt.endswith("nocost"))
                if x is None:
                    continue
                if x.get("skip"):
                    skipped += tgt == "t2"; continue
                trades.append({**s, **x, "target": tgt, "split": next(n for n, a, b in SPLITS if pd.Timestamp(a).timestamp() <= s["t_sig"] < pd.Timestamp(b).timestamp()),
                               "session": session(s["t_sig"])})
        trades.sort(key=lambda t: t["t_sig"])
        out = {"signals": len(sig), "skipped_at_entry": skipped, "variants": {}, "sessions": {}}
        for name, f, allow_orig in VARIANTS:
            for tgt in ("t2",) if name != "current strict rules (baseline)" else ("t2", "t1", "t2-nocost"):
                sel = [t for t in trades if t["target"] == tgt and (allow_orig or not t["original_only"]) and f(t)]
                key = name + {"t2": "", "t1": " - target 50% of C1", "t2-nocost": " - WITHOUT costs (reference only)"}[tgt]
                out["variants"][key] = {sp: stats([t["R"] for t in sel if t["split"] == sp]) for sp, _, _ in SPLITS}
                out["variants"][key]["all"] = stats([t["R"] for t in sel])
                out["variants"][key]["same_bar_stop_and_target"] = sum(t["both"] for t in sel)
        base = [t for t in trades if t["target"] == "t2" and not t["original_only"]]
        for ss in sorted({t["session"] for t in base}):
            out["sessions"][ss] = {"all": stats([t["R"] for t in base if t["session"] == ss]),
                                   "test": stats([t["R"] for t in base if t["session"] == ss and t["split"] == "test"])}
        out["exits"] = {k: sum(t["how"] == k for t in base) for k in ("target", "stop", "time")}
        res["tf"][tf] = out
        print(pair, tf, "signals", len(sig), "baseline", out["variants"]["current strict rules (baseline)"]["all"])
    return res


def fmt(s):
    if not s or not s.get("n"):
        return "0 | – | – | – | – | –"
    return f"{s['n']} | {s['win']}% | {s['avgR']:+.3f} ± {s['se']} | {s['pf']} | {s['sumR']:+.1f} | {s['maxDD']}"


def report(res):
    L = [f"# CRT backtest – {res['pair']}", "",
         f"Data: forex-data 5-minute bars {res['data'][0][:10]} → {res['data'][1][:10]} ({res['bars5m']:,} bars, UTC). "
         f"Costs: {res['cost_pips'][0]} pip spread + {res['cost_pips'][1]} pip slippage per market fill.",
         "Generated by `scripts/crt_backtest.py` (rules and assumptions in its header). R = profit in units of the initial risk. "
         "avgR ± one standard error. Max DD in R, trades in signal order.", ""]
    for tf, o in res["tf"].items():
        L += [f"## {tf}", "", f"{o['signals']} closed-C2 signals; {o['skipped_at_entry']} skipped because price at entry was already past the target or stop. "
              f"Baseline exits: {o['exits']['target']} target, {o['exits']['stop']} stop, {o['exits']['time']} time (end of C4).", ""]
        for sp in ["train", "validation", "test", "all"]:
            L += [f"**{sp}**", "", "| Variant | Trades | Win | Avg R | PF | Sum R | Max DD |", "|---|---|---|---|---|---|---|"]
            for k, v in o["variants"].items():
                L.append(f"| {k} | {fmt(v[sp])} |")
            L.append("")
        L += ["**Baseline by session (signal time, New York)**", "", "| Session | Trades (all) | Win | Avg R | PF | Sum R | Max DD | Test-period avg R |", "|---|---|---|---|---|---|---|---|"]
        for ss, v in o["sessions"].items():
            t = v["test"]
            L.append(f"| {ss} | {fmt(v['all'])} | {('%+.3f' % t['avgR']) if t.get('n') else '–'} ({t.get('n', 0)}) |")
        L.append("")
    return "\n".join(L)


def summary(pairs):
    """forex/backtest/README.md: every pair pooled (sum of R / number of trades) per timeframe, variant and period."""
    D = {p: json.load(open(os.path.join(OUT_DIR, f"{p}.json"))) for p in pairs}
    L = ["# CRT backtest – summary", "",
         f"Pairs: {', '.join(pairs)}. 5-minute data from the forex-data repository, {SPLITS[0][1]} onward; costs per pair in each "
         "pair's report. Made by `python scripts/crt_backtest.py <forex-data> " + " ".join(pairs) + "`. Rules, costs, fills and "
         "the same-bar rule are in that script's header. Average R per trade, all pairs pooled; trades in brackets.", "",
         "No thresholds were tuned: every filter uses the app's existing default. Train and validation are where a refinement "
         "would have to show an edge first; the test period is the final check.", ""]
    for tf in TFS:
        L += [f"## {tf}", "", "| Variant | Train | Validation | Test |", "|---|---|---|---|"]
        for v in D[pairs[0]]["tf"][tf]["variants"]:
            cells = []
            for sp, _, _ in SPLITS:
                n = sum(D[p]["tf"][tf]["variants"][v][sp].get("n", 0) for p in pairs)
                sr = sum(D[p]["tf"][tf]["variants"][v][sp].get("sumR", 0) for p in pairs)
                cells.append(f"{sr / n:+.3f} ({n})" if n else "–")
            L.append(f"| {v} | " + " | ".join(cells) + " |")
        L.append("")
    L += ["## Limits of this test", "",
          "- Quotes: forex-data 5-minute bars come from HistData (bid side); they are treated as mid prices with half the "
          "spread added on each side, which is an approximation of real bid/ask fills.",
          "- Entry is at the open of the candle after C2 (the CRT signal itself). Model-1 entries on the lower timeframe are "
          "not part of this test.",
          "- Overlapping trades are all counted at 1R; no position limit, no news filter, no swap/rollover cost.",
          "- 2023-01 to 2026-10 only (the 5-minute history available); about 3.8 years per pair.", ""]
    open(os.path.join(OUT_DIR, "README.md"), "w").write("\n".join(L))


def main():
    root = sys.argv[1]; pairs = sys.argv[2:] or ["EURUSD"]
    os.makedirs(OUT_DIR, exist_ok=True)
    for pair in pairs:
        res = run(root, pair)
        json.dump(res, open(os.path.join(OUT_DIR, f"{pair}.json"), "w"), indent=1)
        open(os.path.join(OUT_DIR, f"{pair}.md"), "w").write(report(res))
    if len(pairs) > 1:
        summary(pairs)


if __name__ == "__main__":
    main()
