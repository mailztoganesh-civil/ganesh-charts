"""forex/backtest/ICT_VALIDATION.md from the sweep backtest files (run scripts/sweep_backtest.py first for D, 4H, 2H).
Trades of all pairs are merged in time order, so the pooled maximum drawdown is a real equity-curve drawdown.

Usage: python scripts/ict_report.py
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "forex", "backtest")
PAIRS = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY", "XAUUSD"]
TFS = [("D", "sweepD", "1D → 1H"), ("4H", "sweep", "4H → 15m"), ("2H", "sweep2H", "2H → 5m")]
GROUPS = [("all setups", lambda t: True), ("grade A", lambda t: t[2] == "A"), ("grade B", lambda t: t[2] == "B"),
          ("grade C", lambda t: t[2] == "C"), ("checklist 5/5", lambda t: t[3] == 5), ("A1 (A + 5/5)", lambda t: t[2] == "A" and t[3] == 5)]
SPLITS = ["train", "validation", "test"]


def stats(rs):
    if not rs:
        return None
    n = len(rs); m = sum(rs) / n
    sd = math.sqrt(sum((r - m) ** 2 for r in rs) / (n - 1)) if n > 1 else 0
    win = sum(1 for r in rs if r > 0) / n * 100
    gw = sum(r for r in rs if r > 0); gl = -sum(r for r in rs if r < 0)
    eq = peak = dd = 0.0
    for r in rs:
        eq += r; peak = max(peak, eq); dd = max(dd, peak - eq)
    return {"n": n, "exp": m, "se": sd / math.sqrt(n) if n > 1 else None, "pf": gw / gl if gl else None, "win": win, "dd": dd, "sum": sum(rs)}


def cell(s):
    if not s:
        return "– | – | – | – | –"
    pf = f"{s['pf']:.2f}" if s["pf"] is not None else "–"
    se = f"{s['se']:.3f}" if s['se'] is not None else "–"
    return f"{s['n']} | {s['exp']:+.3f} ± {se} | {pf} | {s['win']:.0f}% | {s['dd']:.1f}"


def load(prefix, pairs):
    tr = []
    for p in pairs:
        f = os.path.join(OUT, f"{prefix}_{p}.json")
        if os.path.exists(f):
            tr += [t + [p] for t in json.load(open(f)).get("trades", [])]
    return sorted(tr, key=lambda t: t[0])


def section(title, pairs):
    L = [f"## {title}", ""]
    for tf, prefix, name in TFS:
        tr = load(prefix, pairs)
        L += [f"### {name}", "", "| Setups | Period | Trades | Expectancy R ± s.e. | Profit factor | Win rate | Max drawdown R |", "|---|---|---|---|---|---|---|"]
        for g, f in GROUPS:
            for sp in SPLITS + ["all"]:
                rs = [t[1] for t in tr if f(t) and (sp == "all" or t[4] == sp)]
                L.append(f"| {g} | {sp} | {cell(stats(rs))} |")
        L.append("")
    return L


def main():
    L = ["# ICT sweep – validation backtest", "",
         "Data: forex-data 5-minute bars (HistData, bid), 2023-01 to 2026-10. Periods in time order: train 2023-01..2024-06, "
         "validation 2024-07..2025-06, test 2025-07..end. Costs per pair (spread + slippage, e.g. EURUSD 0.8 + 0.2 pips; "
         "XAUUSD 30 + 10 cents). Entry: limit at the zone edge, placed when the lower-timeframe candle after the CHoCH has closed, "
         "fillable only after the higher-timeframe sweep candle closed; stop = sweep extreme; target = opposite liquidity; "
         "a 5-minute bar touching stop and target counts as a stop; entry and target in one bar = no trade. No parameter was fitted. "
         "Expectancy = average R per trade. Max drawdown from the equity curve of the trades in time order (all pairs merged in the pooled table).", ""]
    L += section("EURUSD only", ["EURUSD"])
    L += section("All 7 majors + gold, pooled", PAIRS)
    L += ["## Execution-delay sensitivity (all setups, pooled, train / validation / test)", "",
          "Measured with `ICT_DELAY_BARS=n python scripts/sweep_backtest.py ...` (order placed n lower-timeframe candles later):", "",
          "| Delay | 2H → 5m | 4H → 15m |", "|---|---|---|",
          "| 0 (zone known) | +0.192 / +0.052 / +0.139 | +0.124 / +0.337 / −0.045 |",
          "| 1 candle | +0.113 / +0.041 / +0.094 | +0.139 / +0.283 / −0.086 |",
          "| 2 candles | +0.086 / +0.012 / +0.070 | +0.087 / +0.227 / −0.106 |",
          "| 4 candles | +0.034 / −0.046 / +0.025 | +0.143 / +0.224 / −0.079 |", "",
          "The 2H result shrinks steadily when the order goes in later (5-minute candles: 5-20 minutes), so it depends on "
          "near-instant execution; the 4H test period is negative at every delay.", "",
          "A1 and the TTrades 5/5 checklist are labels for the setup's shape, not evidence of an edge: compare their rows "
          "across the three periods and with the standard errors.", ""]
    open(os.path.join(OUT, "ICT_VALIDATION.md"), "w").write("\n".join(L))
    print("wrote", os.path.join(OUT, "ICT_VALIDATION.md"))


if __name__ == "__main__":
    main()
