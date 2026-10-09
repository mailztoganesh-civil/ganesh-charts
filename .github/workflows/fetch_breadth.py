"""
Market breadth for NSE (like Manas Arora's daily breadth table).

Runs on GitHub Actions after the market closes. Downloads 2 years of daily prices from Yahoo
for every symbol in symbols.js and counts, for each of the last ~250 trading days:

  up45 / dn45     stocks up / down 4.5%+ that day
  up20 / dn20     stocks up / down 20%+ over 5 days
  a20 / b20       stocks closing above / below their 20-day average (also 50 and 200)
  hi52 / lo52     stocks closing at a 52-week high / low
  n               stocks that traded that day

Writes data/breadth.json (newest day first). For the last 10 days it also keeps the stock
lists behind the main counts, so the app can open their charts.
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

ROOT = os.environ.get("GITHUB_WORKSPACE") or os.getcwd()
OUT = os.path.join(ROOT, "data", "breadth.json")
BATCH = int(os.environ.get("BATCH", "150"))
KEEP_DAYS = 250
LIST_DAYS = 10


def load_symbols():
    src = open(os.path.join(ROOT, "symbols.js"), encoding="utf-8").read()
    return sorted(set(re.findall(r'\[\s*"([^"]+)"\s*,', src)))


def download(symbols):
    closes, vols = {}, {}
    for i in range(0, len(symbols), BATCH):
        chunk = symbols[i:i + BATCH]
        tick = [s + ".NS" for s in chunk]
        for attempt in range(3):
            try:
                df = yf.download(tick, period="2y", interval="1d", group_by="ticker",
                                 auto_adjust=True, threads=True, progress=False)
                break
            except Exception as e:  # network / throttling
                print("retry", i, e, file=sys.stderr)
                time.sleep(10 * (attempt + 1))
        else:
            continue
        for s, t in zip(chunk, tick):
            try:
                sub = df[t] if isinstance(df.columns, pd.MultiIndex) else df
                c = sub["Close"].dropna()
                if len(c) < 30:
                    continue
                closes[s] = sub["Close"]
                vols[s] = sub["Volume"]
            except Exception:
                pass
        print(f"{min(i + BATCH, len(symbols))}/{len(symbols)} downloaded, {len(closes)} with data", flush=True)
        time.sleep(1)
    C = pd.DataFrame(closes).sort_index()
    V = pd.DataFrame(vols).reindex(C.index)
    C.index = pd.to_datetime(C.index).tz_localize(None).normalize()
    V.index = C.index
    C = C[~C.index.duplicated(keep="last")]
    V = V[~V.index.duplicated(keep="last")]
    return C, V


def compute(C, V):
    traded = C.notna() & (V.fillna(0) > 0)
    # drop half-empty rows (holidays / bad Yahoo rows)
    good = traded.sum(axis=1) >= 0.5 * traded.sum(axis=1).max()
    C, V, traded = C[good], V[good], traded[good]
    Cf = C.ffill()
    r1 = (C / Cf.shift(1) - 1) * 100
    r5 = (C / Cf.shift(5) - 1) * 100
    s20 = Cf.rolling(20, min_periods=20).mean()
    s50 = Cf.rolling(50, min_periods=50).mean()
    s200 = Cf.rolling(200, min_periods=200).mean()
    mx = Cf.rolling(252, min_periods=120).max()
    mn = Cf.rolling(252, min_periods=120).min()

    rows, lists = [], {}
    dates = C.index[-KEEP_DAYS:]
    for d in dates:
        t = traded.loc[d]
        c = C.loc[d]
        def cnt(mask):
            return int((mask & t).sum())
        up45 = (r1.loc[d] >= 4.5) & t
        dn45 = (r1.loc[d] <= -4.5) & t
        up20 = (r5.loc[d] >= 20) & t
        dn20 = (r5.loc[d] <= -20) & t
        hi = (c >= mx.loc[d]) & t
        lo = (c <= mn.loc[d]) & t
        row = {
            "d": d.strftime("%Y-%m-%d"),
            "n": int(t.sum()),
            "up45": int(up45.sum()), "dn45": int(dn45.sum()),
            "up20": int(up20.sum()), "dn20": int(dn20.sum()),
            "a20": cnt(c > s20.loc[d]), "b20": cnt(c <= s20.loc[d]),
            "a50": cnt(c > s50.loc[d]), "b50": cnt(c <= s50.loc[d]),
            "a200": cnt(c > s200.loc[d]), "b200": cnt(c <= s200.loc[d]),
            "hi52": int(hi.sum()), "lo52": int(lo.sum()),
        }
        rows.append(row)
        if d in dates[-LIST_DAYS:]:
            def top(mask, key, desc=True):
                v = key[mask].sort_values(ascending=not desc)
                return [[s, round(float(x), 1)] for s, x in v.items()]
            lists[row["d"]] = {
                "up45": top(up45, r1.loc[d]), "dn45": top(dn45, r1.loc[d], False),
                "up20": top(up20, r5.loc[d]), "dn20": top(dn20, r5.loc[d], False),
                "hi52": top(hi, r1.loc[d]),
            }
    rows.reverse()
    return rows, lists


def main():
    syms = load_symbols()
    limit = int(os.environ.get("LIMIT", "0"))
    if limit:
        syms = syms[:limit]
    print(f"{len(syms)} symbols")
    C, V = download(syms)
    if C.empty:
        print("No data downloaded", file=sys.stderr)
        sys.exit(1)
    rows, lists = compute(C, V)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "universe": int(C.shape[1]),
        "rows": rows,
        "lists": lists,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(rows)} days, latest {rows[0]['d'] if rows else '-'}")


if __name__ == "__main__":
    main()
