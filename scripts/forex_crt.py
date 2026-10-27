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
KEEP = {"1H": 100, "4H": 100, "D": 60, "W": 60, "M": 24}   # candles per timeframe sent to the app
LTF_KEEP = {"15m": 200, "5m": 150}                    # lower-timeframe candles for the HTF+LTF view
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
    mo = day.to_period("M").astype(str)                                      # calendar months of trading days
    out["M"] = grp(mo.values)
    return out


TF_HOURS = {"1H": 1, "4H": 4, "D": 24, "W": 120, "M": 0}
LTF_FOR = {"M": "D", "W": "4H", "D": "1H", "4H": "15m", "1H": "5m"}   # Model-1 is looked for on this timeframe


LOOK = 10   # how far back C1 (the range candle) can be


def mother(cs, i):
    """C1 = the range candle: the furthest-back candle (up to LOOK) whose high-low range contains every candle
    after it up to candle i. Candles inside that range (not only strict inside bars) keep C1 alive; C2 is then
    the first candle to trade outside it."""
    best = i; hi = cs[i][2]; lo = cs[i][3]
    for k in range(i - 1, max(-1, i - LOOK - 1), -1):
        if cs[k][2] >= hi and cs[k][3] <= lo:
            best = k
        hi = max(hi, cs[k][2]); lo = min(lo, cs[k][3])
    return best


def classify(df, tf, pip):
    cs = [[int(t.timestamp()), float(r.Open), float(r.High), float(r.Low), float(r.Close)] for t, r in df.iterrows()]
    n = len(cs)
    if n < 3:
        return None
    _, o0, h0, l0, price = cs[-1]
    res = {"status": "none", "dir": 0}
    # --- formed: C2 = the last closed candle, the first one to sweep C1's range, closed back inside ---
    formed = None
    m = mother(cs, n - 3)
    _, _, H1, L1, _ = cs[m]; _, o2, h2, l2, c2 = cs[n - 2]
    bull = l2 < L1 and L1 < c2 < H1
    bear = h2 > H1 and L1 < c2 < H1
    if bull and bear:                      # swept both sides: only counts when it closes in its outer third
        rg = h2 - l2; pos = (c2 - l2) / rg if rg > 0 else 0.5
        bull, bear = pos >= 2 / 3, pos <= 1 / 3
    if bull or bear:
        d = 1 if bull else -1
        t2 = H1 if d == 1 else L1; t1 = (H1 + L1) / 2; inv = l2 if d == 1 else h2
        hit2 = (h0 >= t2) if d == 1 else (l0 <= t2); hit1 = (h0 >= t1) if d == 1 else (l0 <= t1)
        failed = (l0 < inv) if d == 1 else (h0 > inv)
        risk = abs(price - inv)
        formed = dict(status="formed", dir=d, t1=t1, t2=t2, inv=inv, c1h=H1, c1l=L1, sweep=inv, c1Back=n - 1 - m,
                      hit1=bool(hit1), hit2=bool(hit2), failed=bool(failed),
                      toT2=round((t2 - price) * d / pip, 1), rr=round(abs(t2 - price) / risk, 2) if risk > 0 else None)
    # --- live: is the current candle the first to sweep C1's range? ---
    live = None
    m = mother(cs, n - 2)
    _, _, H1, L1, _ = cs[m]
    sl, sh = l0 < L1, h0 > H1
    if sl or sh:
        if sl and sh:
            rg0 = h0 - l0; pos0 = (price - l0) / rg0 if rg0 > 0 else 0.5
            d = 1 if pos0 >= 2 / 3 else -1 if pos0 <= 1 / 3 else 0
        else:
            d = 1 if sl else -1
        if d:
            lvl = L1 if d == 1 else H1
            live = dict(status="forming" if L1 < price < H1 else "sweeping", dir=d, level=lvl, sweep=l0 if d == 1 else h0,
                        t2=H1 if d == 1 else L1, t1=(H1 + L1) / 2, c1h=H1, c1l=L1, c1Back=n - 1 - m)
    else:
        rng = H1 - L1
        if rng > 0:
            dl, dh = (price - L1) / rng, (H1 - price) / rng
            if dl <= NEAR or dh <= NEAR:
                d = 1 if dl <= dh else -1
                lvl = L1 if d == 1 else H1
                live = dict(status="anticipated", dir=d, level=lvl, dist=round(abs(price - lvl) / pip, 1),
                            c1h=H1, c1l=L1, t2=H1 if d == 1 else L1, c1Back=n - 1 - m)
    # --- candle 3 closure (TTrades): C2 swept C1 but closed outside it; C3 closed back through C2's open ---
    c3 = None
    if n >= 4:
        m = mother(cs, n - 4)
        _, _, ha, la, _ = cs[m]; _, ob, hb, lb, cb = cs[n - 3]; _, _, hc, lc, cc = cs[n - 2]
        for d in (1, -1):
            ok = (lb < la and cb < la and cc > ob and lc >= lb) if d == 1 else (hb > ha and cb > ha and cc < ob and hc <= hb)
            if ok:
                t2 = ha if d == 1 else la; inv = lb if d == 1 else hb
                hit2 = (h0 >= t2) if d == 1 else (l0 <= t2); failed = (l0 < inv) if d == 1 else (h0 > inv)
                risk = abs(price - inv)
                if not hit2 and not failed and (t2 - price) * d > 0:
                    c3 = dict(status="c3close", dir=d, t1=(ha + la) / 2, t2=t2, inv=inv, c1h=ha, c1l=la, sweep=inv,
                              c1Back=n - 1 - m, hit1=False, hit2=False, failed=False,
                              toT2=round((t2 - price) * d / pip, 1), rr=round(abs(t2 - price) / risk, 2) if risk > 0 else None)
                break
    # priority: active formed > forming > sweeping > C3 closure > formed (finished) > anticipated
    if formed and not formed["failed"] and not formed["hit2"]:
        res = formed
        if live and live["status"] in ("forming", "sweeping"):
            res["also"] = live["status"]
    elif live and live["status"] in ("forming", "sweeping"):
        res = live
    elif c3:
        res = c3
    elif formed:
        res = formed
        res["status"] = "done" if formed["hit2"] else "failed"
    elif live:
        res = live
    res["price"] = price
    start = df.index[-1]
    res["end"] = int((start + pd.Timedelta(hours=TF_HOURS[tf])).timestamp() * 1000) if tf not in ("W", "M") else None
    dg = 3 if pip >= 0.01 else 5
    if pip >= 0.1: dg = 2
    res["candles"] = [[c[0]] + [round(v, dg) for v in c[1:]] for c in cs[-KEEP[tf]:]]
    for k, v in list(res.items()):
        if isinstance(v, float) and not math.isnan(v):
            res[k] = round(v, dg + 1)
    return res


C2_BACK = {"formed": 1, "done": 1, "failed": 1, "c3close": 2}   # how many candles back C2 is (0 = current candle)


def model1(lt, d, t0, lvl, t2, pip):
    """Model-1 on the lower timeframe: after the sweep of `lvl` (direction d: 1 = swept a low, look for longs),
    the opening price of the last opposite-close candle (or candle series) before the sweep extreme.
    A close back through it confirms. lt = [[t,o,h,l,c], ...] oldest first."""
    idx = [i for i, c in enumerate(lt) if c[0] >= t0]
    if len(idx) < 2:
        return None
    a = idx[0]
    if d == -1:
        J = max(range(a, len(lt)), key=lambda i: lt[i][2]); ext = lt[J][2]; swept = ext > lvl
    else:
        J = min(range(a, len(lt)), key=lambda i: lt[i][3]); ext = lt[J][3]; swept = ext < lvl
    if not swept:
        return None
    opp = (lambda c: c[4] > c[1]) if d == -1 else (lambda c: c[4] < c[1])
    q = J
    while q >= 0 and not opp(lt[q]):
        q -= 1
    if q < 0:
        return None
    r0 = q
    while r0 - 1 >= 0 and opp(lt[r0 - 1]):
        r0 -= 1
    c = lt[q]; rng = c[2] - c[3]
    wick = r0 == q and rng > 0 and abs(c[4] - c[1]) / rng < 0.3
    if wick:
        level = c[3] if d == -1 else c[2]
    else:
        level = min(x[1] for x in lt[r0:q + 1]) if d == -1 else max(x[1] for x in lt[r0:q + 1])
    k = next((i for i in range(J + 1, len(lt)) if (lt[i][4] < level if d == -1 else lt[i][4] > level)), None)
    res = dict(dir=d, ext=ext, tExt=lt[J][0], level=level, tRun=lt[r0][0], tRunEnd=lt[q][0], wick=bool(wick),
               confirmed=k is not None, target=t2)
    if k is not None:
        e = lt[k][4]; risk = abs(ext - e)
        res.update(tConf=lt[k][0], entry=e, rr=round(abs(t2 - e) / risk, 2) if risk > 0 else None,
                   hit=bool((t2 - e) * d <= 0 or any((x[3] <= t2 if d == -1 else x[2] >= t2) for x in lt[k + 1:])))
    else:
        res["need"] = round(abs(lt[-1][4] - level) / pip, 1)
    return res


PARENT = {"1H": "D", "4H": "D", "D": "W", "W": "M", "M": None}
GRAND = {"1H": "W", "4H": "W", "D": "M", "W": None, "M": None}
LVL_NAME = {"D": ("PDH", "PDL"), "W": ("PWH", "PWL"), "M": ("PMH", "PML")}


def ttrades_bias(S, k):
    """TTrades daily-bias rule applied to the parent candle k, from candles k-1 and k-2"""
    if k < 2:
        return 0
    _, _, h1, l1, c1 = S[k - 1]; _, _, h2, l2, _ = S[k - 2]
    if c1 > h2: return 1
    if c1 < l2: return -1
    if h1 > h2 and c1 < h2 and not l1 < l2: return -1
    if l1 < l2 and c1 > l2 and not h1 > h2: return 1
    return 0


def c1_quality(lists, tf, r):
    """Is C1 a proper C1?  size (>= 0.7 x average range of the 20 candles before it), not an inside bar,
    swept at a key level (previous day/week/month high-low or an unfilled higher-timeframe FVG), and HTF bias."""
    cs = lists[tf]; n = len(cs); st = r["status"]
    if "c1Back" not in r or not r.get("dir"):
        return None
    c1i = n - 1 - r["c1Back"]; c2i = n - 1 - C2_BACK.get(st, 0)
    if c1i < 1:
        return None
    d = r["dir"]; t, o, h, l, c = cs[c1i]; rng = h - l
    prev = cs[max(0, c1i - 20):c1i]
    avg = sum(x[2] - x[3] for x in prev) / len(prev) if prev else rng
    size = rng >= 0.7 * avg
    inside = h <= cs[c1i - 1][2] and l >= cs[c1i - 1][3]
    c2 = cs[c2i]
    ext = c2[3] if d == 1 else c2[2]
    tol = 0.25 * rng
    t2s = c2[0]
    levels = []
    for X in (PARENT[tf], GRAND[tf]):
        if not X:
            continue
        S = lists[X]; k = max((i for i in range(len(S)) if S[i][0] <= t2s), default=None)
        if k is not None and k >= 1:
            levels.append((LVL_NAME[X][0], S[k - 1][2])); levels.append((LVL_NAME[X][1], S[k - 1][3]))
    if tf == "M":
        past = cs[max(0, c1i - 12):c1i]
        if past:
            levels += [("12M high", max(x[2] for x in past)), ("12M low", min(x[3] for x in past))]
    key = None
    for name, L in levels:
        if d == 1 and name.endswith(("L", "low")) and ext - tol <= L <= l + tol:
            key = (name, L); break
        if d == -1 and name.endswith(("H", "high")) and h - tol <= L <= ext + tol:
            key = (name, L); break
    P = PARENT[tf]; bias = None; keyT = None
    if P:
        S = lists[P]; k = max((i for i in range(len(S)) if S[i][0] <= t2s), default=None)
        if key is None and k is not None:      # untouched swing high/low (3-candle fractal) on the parent TF swept by C2
            for j in range(k - 2, max(1, k - 30) - 1, -1):
                tj, hj, lj = S[j][0], S[j][2], S[j][3]; later = S[j + 1:k]
                if d == 1 and lj < S[j - 1][3] and lj < S[j + 1][3] and all(x[3] > lj for x in later) and ext < lj <= l + tol:
                    key = ("Swing " + P, lj); keyT = tj; break
                if d == -1 and hj > S[j - 1][2] and hj > S[j + 1][2] and all(x[2] < hj for x in later) and ext > hj >= h - tol:
                    key = ("Swing " + P, hj); keyT = tj; break
        if key is None and k is not None:      # unfilled FVG on the parent timeframe
            for j in range(k - 1, max(1, k - 30), -1):
                a2, cj = S[j - 2], S[j]
                if d == 1 and cj[3] > a2[2]:
                    bot, top = a2[2], cj[3]
                    if all(x[3] > bot for x in S[j + 1:k]) and bot - tol <= ext <= top + tol:
                        key = (P + " FVG", top); break
                if d == -1 and cj[2] < a2[3]:
                    bot, top = cj[2], a2[3]
                    if all(x[2] < top for x in S[j + 1:k]) and bot - tol <= ext <= top + tol:
                        key = (P + " FVG", bot); break
        if k is not None:
            b = ttrades_bias(S, k)
            bias = None if b == 0 else (b == d)
    req = size and not inside
    grade = "A" if req and key and bias is not False else "B" if req and (key or bias) else "C"
    return dict(size=bool(size), inside=bool(inside), key=key[0] if key else None, keyLvl=key[1] if key else None,
                keyT=keyT, bias=bias, grade=grade, c1t=t)


def ny_hour(t):
    return pd.Timestamp(t, unit="s", tz="UTC").tz_convert(NY).hour


def c2_checks(lists, tf, r, pip):
    """C2 quality: a clean sweep (at least max(2 pips, 5% of C1) beyond C1, no more than C1's range),
    a rejection close (bullish: in the upper half of C2), outside bar flag, T-spot (50% of C2's wick),
    and kill-zone timing of the sweep for 1H / 4H (London 02-05, New York 08-11 NY time)."""
    cs = lists[tf]; n = len(cs); st = r["status"]; d = r.get("dir")
    if not d:
        return None
    if "c1Back" not in r:
        return None
    c1i = n - 1 - r["c1Back"]; c2i = n - 1 - C2_BACK.get(st, 0)
    if c1i < 0 or c2i <= c1i:
        return None
    _, _, h1, l1, _ = cs[c1i]; t2c, o2, h2, l2, c2 = cs[c2i]
    rng = h1 - l1
    depth = (l1 - l2) if d == 1 else (h2 - h1)
    sweep_ok = depth >= max(2 * pip, 0.05 * rng) and depth <= rng
    r2 = h2 - l2; pos = (c2 - l2) / r2 if r2 > 0 else 0.5
    reject = pos >= 0.5 if d == 1 else pos <= 0.5
    tspot = (l2 + min(o2, c2)) / 2 if d == 1 else (h2 + max(o2, c2)) / 2
    kz = None; kz_name = None
    if tf in ("1H", "4H"):
        t_ext = t2c
        if tf == "4H" and "1H" in lists:
            bars = [b for b in lists["1H"] if t2c <= b[0] < t2c + 4 * 3600]
            if bars:
                t_ext = (min(bars, key=lambda b: b[3]) if d == 1 else max(bars, key=lambda b: b[2]))[0]
        hr = ny_hour(t_ext)
        kz_name = "London" if 2 <= hr < 5 else "New York" if 8 <= hr < 11 else None
        kz = kz_name is not None
    return dict(depth=round(depth / pip, 1), sweep=bool(sweep_ok), reject=bool(reject), outside=bool(h2 > h1 and l2 < l1),
                tspot=tspot, kz=kz, kzName=kz_name)


def add_model1(row, tfs, ltf_lists):
    """attach Model-1 (on the paired lower timeframe) to every CRT that has a sweep"""
    lists = {k: [[int(t.timestamp()), float(r.Open), float(r.High), float(r.Low), float(r.Close)] for t, r in df.iterrows()]
             for k, df in tfs.items() if k in ("D", "4H", "1H")}
    lists.update({k: [[int(t.timestamp()), float(r.Open), float(r.High), float(r.Low), float(r.Close)] for t, r in df.iterrows()]
                  for k, df in tfs.items() if k in ("W", "M")})
    lists.update(ltf_lists)
    dg = 2 if row["pip"] >= 0.1 else 3 if row["pip"] >= 0.01 else 5
    for tf, r in row["tf"].items():           # is C1 a proper C1?
        if r.get("status") not in (None, "none"):
            q = c1_quality(lists, tf, r)
            if q:
                if isinstance(q.get("keyLvl"), float):
                    q["keyLvl"] = round(q["keyLvl"], dg + 1)
                r["q"] = q
            q2 = c2_checks(lists, tf, r, row["pip"])
            if q2:
                q2["tspot"] = round(q2["tspot"], dg + 1)
                r["q2"] = q2
    for tf, r in row["tf"].items():
        st = r.get("status")
        if st not in ("formed", "forming", "sweeping", "done", "c3close") or LTF_FOR.get(tf) not in lists:
            continue
        cs = r["candles"]
        if st == "c3close":
            t0, lvl = cs[-3][0], (r["c1l"] if r["dir"] == 1 else r["c1h"])
        elif st in ("formed", "done"):
            t0, lvl = cs[-2][0], (r["c1l"] if r["dir"] == 1 else r["c1h"])
        else:
            t0, lvl = cs[-1][0], r["level"]
        m = model1(lists[LTF_FOR[tf]], r["dir"], t0, lvl, r["t2"], row["pip"])
        if m:
            for k in ("ext", "level", "entry", "target"):
                if isinstance(m.get(k), float):
                    m[k] = round(m[k], dg + 1)
            r["m1"] = m


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
            dg = 2 if pip >= 0.1 else 3 if pip >= 0.01 else 5
            ltf_full = {}
            if loader is fetch_yahoo:          # lower timeframes for Model-1 and the HTF + LTF view
                row["ltf"] = {}
                for iv in ("15m", "5m"):
                    try:
                        x = fetch_yahoo(ysym, iv, "5d")
                        ltf_full[iv] = [[int(t.timestamp()), float(r.Open), float(r.High), float(r.Low), float(r.Close)] for t, r in x.iterrows()]
                        row["ltf"][iv] = [[c[0]] + [round(v, dg) for v in c[1:]] for c in ltf_full[iv][-LTF_KEEP[iv]:]]
                    except Exception as e:
                        print(name, iv, "failed:", e)
            elif hasattr(loader, "ltf"):
                ltf_full = loader.ltf(name)
            add_model1(row, tfs, ltf_full)
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
