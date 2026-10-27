"""Forex CRT scanner for the Forex CRT app (ganesh-charts/forex).

Every run: download hourly candles from Yahoo for each pair, build 1H / 4H / Daily /
Weekly candles on New York forex time (day starts 17:00 NY, 4H blocks 1-5-9 NY),
classify the Candle Range Theory state of each pair/timeframe, and write
forex/data/crt.json for the app.

States (bullish shown, bearish is the mirror):
  formed      last closed candle (C2) swept the low of the one before (C1) and closed
              back inside C1 -> the current candle is C3, target = C1 high
  forming     the current candle has swept the previous low and is back inside now
  sweeping    the current candle is below the previous low, not back inside yet
  anticipated no sweep yet, price within NEAR of the previous low (share of its range)
"""
import json, math, os, sys
from datetime import datetime, timezone
import pandas as pd

PAIRS = [  # (name, yahoo symbol, pip size)
    ("EURUSD", "EURUSD=X", 0.0001), ("GBPUSD", "GBPUSD=X", 0.0001), ("USDJPY", "JPY=X", 0.01),
    ("USDCHF", "CHF=X", 0.0001), ("AUDUSD", "AUDUSD=X", 0.0001), ("NZDUSD", "NZDUSD=X", 0.0001),
    ("USDCAD", "CAD=X", 0.0001), ("EURJPY", "EURJPY=X", 0.01), ("GBPJPY", "GBPJPY=X", 0.01),
    ("EURGBP", "EURGBP=X", 0.0001), ("AUDJPY", "AUDJPY=X", 0.01), ("EURAUD", "EURAUD=X", 0.0001),
    ("XAUUSD", "GC=F", 0.1),
]
NEAR = 0.25          # "anticipated" when within 25% of the previous candle's range
KEEP = {"1H": 100, "4H": 100, "D": 60, "W": 60}   # candles per timeframe sent to the app
LTF_KEEP = {"15m": 72, "5m": 54}                    # lower-timeframe candles for the HTF+LTF view
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "forex", "data", "crt.json")
NY = "America/New_York"
TFS = {"1H": None, "4H": None, "D": None, "W": None}


def build(h):
    """h: hourly OHLC indexed by UTC time -> dict tf -> DataFrame (index = candle start, UTC)."""
    ny = h.index.tz_convert(NY)
    agg = {"Open": "first", "High": "max", "Low": "min", "Close": "last"}
    out = {"1H": h.copy()}
    def grp(keys):
        g = h.groupby(keys).agg(agg)
        start = h.index.to_series().groupby(keys).min()
        g.index = pd.DatetimeIndex(start.values, tz="UTC")
        return g.sort_index()
    # 4H blocks start 01,05,09,13,17,21 NY
    k4 = (ny - pd.Timedelta(hours=1)).floor("4h")
    out["4H"] = grp(k4.tz_localize(None).values)
    day = (ny + pd.Timedelta(hours=7)).normalize().tz_localize(None)       # trading day starts 17:00 NY
    out["D"] = grp(day.values)
    wk = day.to_period("W-SUN").astype(str)                                  # Mon..Sun trading weeks
    out["W"] = grp(wk.values)
    return out


TF_HOURS = {"1H": 1, "4H": 4, "D": 24, "W": 120}


def classify(df, tf, pip):
    if len(df) < 3:
        return None
    c0, c1, c2 = df.iloc[-1], df.iloc[-2], df.iloc[-3]     # current, previous (C2 if formed), the one before (C1)
    price = float(c0.Close)
    res = {"status": "none", "dir": 0}
    # --- formed: previous closed candle is a CRT C2 relative to the one before ---
    bull = c1.Low < c2.Low and c2.Low < c1.Close < c2.High
    bear = c1.High > c2.High and c2.Low < c1.Close < c2.High
    if bull and bear:
        bull, bear = c1.Close >= c1.Open, c1.Close < c1.Open
    formed = None
    if bull or bear:
        d = 1 if bull else -1
        t2 = float(c2.High if d == 1 else c2.Low)
        t1 = float((c2.High + c2.Low) / 2)
        inv = float(c1.Low if d == 1 else c1.High)
        hit2 = (c0.High >= t2) if d == 1 else (c0.Low <= t2)
        hit1 = (c0.High >= t1) if d == 1 else (c0.Low <= t1)
        failed = (c0.Low < inv) if d == 1 else (c0.High > inv)
        risk = abs(price - inv)
        formed = dict(status="formed", dir=d, t1=t1, t2=t2, inv=inv, c1h=float(c2.High), c1l=float(c2.Low),
                      sweep=float(c1.Low if d == 1 else c1.High), hit1=bool(hit1), hit2=bool(hit2), failed=bool(failed),
                      toT2=round((t2 - price) * d / pip, 1), rr=round(abs(t2 - price) / risk, 2) if risk > 0 else None)
    # --- live: current candle vs previous ---
    live = None
    sl, sh = c0.Low < c1.Low, c0.High > c1.High
    if sl or sh:
        if sl and sh:
            d = 1 if price >= c0.Open else -1
        else:
            d = 1 if sl else -1
        lvl = float(c1.Low if d == 1 else c1.High)
        inside = (c1.Low < price < c1.High)
        live = dict(status="forming" if inside else "sweeping", dir=d, level=lvl,
                    sweep=float(c0.Low if d == 1 else c0.High), t2=float(c1.High if d == 1 else c1.Low),
                    t1=float((c1.High + c1.Low) / 2), c1h=float(c1.High), c1l=float(c1.Low))
    else:
        rng = float(c1.High - c1.Low)
        if rng > 0:
            dl, dh = (price - c1.Low) / rng, (c1.High - price) / rng
            if dl <= NEAR or dh <= NEAR:
                d = 1 if dl <= dh else -1
                lvl = float(c1.Low if d == 1 else c1.High)
                live = dict(status="anticipated", dir=d, level=lvl, dist=round(abs(price - lvl) / pip, 1),
                            c1h=float(c1.High), c1l=float(c1.Low), t2=float(c1.High if d == 1 else c1.Low))
    # priority: active formed > forming > sweeping > formed (finished) > anticipated
    if formed and not formed["failed"] and not formed["hit2"]:
        res = formed
        if live and live["status"] in ("forming", "sweeping"):
            res["also"] = live["status"]
    elif live and live["status"] in ("forming", "sweeping"):
        res = live
    elif formed:
        res = formed
        res["status"] = "done" if formed["hit2"] else "failed"
    elif live:
        res = live
    res["price"] = price
    start = df.index[-1]
    res["end"] = int((start + pd.Timedelta(hours=TF_HOURS[tf])).timestamp() * 1000) if tf != "W" else None
    dg = 3 if pip >= 0.01 else 5
    if pip >= 0.1: dg = 2
    res["candles"] = [[int(t.timestamp()), round(float(r.Open), dg), round(float(r.High), dg), round(float(r.Low), dg), round(float(r.Close), dg)]
                      for t, r in df.tail(KEEP[tf]).iterrows()]
    for k, v in list(res.items()):
        if isinstance(v, float) and not math.isnan(v):
            res[k] = round(v, dg + 1)
    return res


def fetch_yahoo(symbol, interval="1h", period="1y"):
    import yfinance as yf
    d = yf.download(symbol, period=period, interval=interval, progress=False, auto_adjust=False)
    if isinstance(d.columns, pd.MultiIndex):
        d.columns = d.columns.get_level_values(0)
    d = d[["Open", "High", "Low", "Close"]].dropna()
    d.index = pd.to_datetime(d.index, utc=True)
    return d


def main(loader=fetch_yahoo):
    out = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "near": NEAR, "pairs": []}
    for name, ysym, pip in PAIRS:
        try:
            h = loader(ysym if loader is fetch_yahoo else name)
            if h is None or len(h) < 50:
                print(name, "no data"); continue
            tfs = build(h)
            row = {"sym": name, "pip": pip, "src": ysym, "tf": {}}
            for tf, df in tfs.items():
                r = classify(df, tf, pip)
                if r: row["tf"][tf] = r
            row["price"] = float(h.Close.iloc[-1])
            if loader is fetch_yahoo:          # lower timeframes for the HTF + LTF view
                dg = 2 if pip >= 0.1 else 3 if pip >= 0.01 else 5
                row["ltf"] = {}
                for iv in ("15m", "5m"):
                    try:
                        x = fetch_yahoo(ysym, iv, "5d").tail(LTF_KEEP[iv])
                        row["ltf"][iv] = [[int(t.timestamp()), round(float(r.Open), dg), round(float(r.High), dg),
                                           round(float(r.Low), dg), round(float(r.Close), dg)] for t, r in x.iterrows()]
                    except Exception as e:
                        print(name, iv, "failed:", e)
            out["pairs"].append(row)
            print(name, {k: (v["status"], v["dir"]) for k, v in row["tf"].items()})
        except Exception as e:  # keep going if one pair fails
            print(name, "failed:", e)
    if not out["pairs"]:
        print("nothing downloaded; keeping the old file"); sys.exit(0)
    # skip the commit when the market is closed (nothing new since last run)
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT))
            key = lambda o: [(p["sym"], p["tf"].get("1H", {}).get("candles", [[0]])[-1]) for p in o["pairs"]]
            if key(old) == key(out):
                print("no new candles; file unchanged"); return
        except Exception:
            pass
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
