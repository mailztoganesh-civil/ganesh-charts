"""Ganesh Charts - fundamentals for the CAN SLIM scanner, fully automatic.

Sources, in order (each field records where it came from):
  1. NSE official filings - quarterly results (EPS, revenue) from nseindia.com
  2. Yahoo Finance via yfinance - fallback for anything NSE didn't give, plus annual EPS,
     ROE and institutional holding

Modes (set by the GitHub Action):
  MODE=daily  - after market hours: only companies that filed results in the last few days
                (from NSE's latest-filings list) plus any stock never fetched (capped)
  MODE=full   - weekly: every stock, stalest first


Runs on GitHub Actions (free). For every NSE symbol in symbols.js it collects, from Yahoo
Finance via the yfinance library (unofficial; data can be missing or late):

  C  qEps   - latest quarter's EPS growth vs the same quarter last year (earningsQuarterlyGrowth)
     qRev   - latest quarter's revenue growth year-on-year (revenueGrowth)
     qList  - recent quarterly EPS (to see acceleration), if Yahoo has them
  A  aEps   - annual EPS for up to 4 years, aCagr = 3-year growth rate, aUp = years EPS rose
     roe    - return on equity
  I  inst   - % of shares held by institutions (heldPercentInstitutions)

Results are written to data/fundamentals.json (served by GitHub Pages next to the app).
Previous values are kept for any stock that fails this run.
"""
import json, os, re, sys, time, random, datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import yfinance as yf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "fundamentals.json")
WORKERS = int(os.environ.get("WORKERS", "3"))
LIMIT = int(os.environ.get("LIMIT", "0"))          # for testing: only the first N symbols
MAX_MINUTES = float(os.environ.get("MAX_MINUTES", "300"))
MODE = os.environ.get("MODE", "full")
DAILY_CAP = int(os.environ.get("DAILY_CAP", "400"))

# ---------------------------------------------------------------- NSE (official)
NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-financial-results",
}
_nse = {"session": None, "ok": None, "made": 0}


def nse_session():
    """A browser-like session with NSE cookies; refreshed every 10 minutes."""
    if _nse["session"] is not None and time.time() - _nse["made"] < 600:
        return _nse["session"]
    s = requests.Session()
    s.headers.update(NSE_HEADERS)
    try:
        s.get("https://www.nseindia.com", timeout=15)
        s.get("https://www.nseindia.com/companies-listing/corporate-filings-financial-results", timeout=15)
    except Exception as e:
        print("NSE session failed:", e, flush=True)
    _nse["session"], _nse["made"] = s, time.time()
    return s


def nse_get(path):
    if _nse["ok"] is False:
        return None
    for attempt in range(3):
        try:
            r = nse_session().get("https://www.nseindia.com" + path, timeout=20)
            if r.status_code == 200 and r.text.strip().startswith(("{", "[")):
                _nse["ok"] = True
                return r.json()
            if r.status_code in (401, 403):
                _nse["session"] = None          # new cookies next time
        except Exception:
            pass
        time.sleep(2 + attempt * 3)
    if _nse["ok"] is None:
        _nse["fails"] = _nse.get("fails", 0) + 1
        if _nse["fails"] >= 15:                 # NSE is blocking this server: stop trying, use Yahoo
            _nse["ok"] = False
            print("NSE is not answering this server - continuing with Yahoo only", flush=True)
    return None


DATE_FORMATS = ("%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d", "%d-%m-%Y", "%d %b %Y", "%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M")


def parse_date(v):
    if not v or not isinstance(v, str):
        return None
    v = v.strip()
    for cand in (v, v[:11], v[:10]):
        for f in DATE_FORMATS:
            try:
                return datetime.datetime.strptime(cand.strip(), f).date()
            except Exception:
                continue
    m = re.match(r"(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\d{4})", v)
    if m:
        try:
            return datetime.datetime.strptime(f"{m.group(1)}-{m.group(2)}-{m.group(3)}", "%d-%b-%Y").date()
        except Exception:
            return None
    return None


def first_list(obj):
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        for v in obj.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return []


def pick(row, *needles, exclude=()):
    """First numeric value whose key contains all needles (case-insensitive)."""
    for k, v in row.items():
        kl = k.lower()
        if all(n in kl for n in needles) and not any(x in kl for x in exclude):
            val = num(str(v).replace(",", "")) if v not in (None, "", "-") else None
            if val is not None:
                return val
    return None


def nse_quarterly(sym):
    """Quarterly results comparison from NSE: list of {d, eps, rev}, oldest first."""
    data = nse_get("/api/results-comparision?symbol=" + requests.utils.quote(sym))
    rows = first_list(data)
    out = []
    for r in rows:
        d = None
        for key in ("re_to_dt", "toDate", "to_date", "re_to_date"):
            if key in r:
                d = parse_date(str(r[key])); break
        if d is None:
            for k, v in r.items():
                if "to" in k.lower() and "dt" in k.lower() or "todate" in k.lower():
                    d = parse_date(str(v))
                    if d: break
        eps = pick(r, "basic", "eps") or pick(r, "eps", exclude=("dil",)) or pick(r, "eps")
        rev = (pick(r, "net", "sale") or pick(r, "revenue") or pick(r, "total", "inc") or pick(r, "income", exclude=("other", "exp")))
        if d and eps is not None:
            out.append({"d": d.isoformat(), "eps": round(eps, 4), "rev": rev})
    out.sort(key=lambda x: x["d"])
    dedup = {}
    for x in out:
        dedup[x["d"]] = x
    return list(dedup.values())


def yoy(rows, field):
    """Latest quarter vs the same quarter a year earlier (and the quarter before, for acceleration)."""
    def match(i):
        d = datetime.date.fromisoformat(rows[i]["d"])
        for j in range(i - 1, -1, -1):
            dj = datetime.date.fromisoformat(rows[j]["d"])
            if 340 <= (d - dj).days <= 390:
                return growth(rows[i].get(field), rows[j].get(field))
        return None
    if not rows:
        return None, None
    return match(len(rows) - 1), (match(len(rows) - 2) if len(rows) >= 2 else None)


def nse_recent_filers(days=4):
    """Symbols that filed quarterly results recently (one call to NSE's latest-filings list)."""
    data = nse_get("/api/corporates-financial-results?index=equities&period=Quarterly")
    rows = first_list(data)
    cutoff = datetime.date.today() - datetime.timedelta(days=days)
    out = set()
    for r in rows:
        sym = r.get("symbol") or r.get("sm_symbol")
        dt = None
        for k, v in r.items():
            kl = k.lower()
            if "broadcast" in kl or "filing" in kl or kl in ("date", "creation_date"):
                dt = parse_date(str(v))
                if dt: break
        if sym and (dt is None or dt >= cutoff):
            out.add(str(sym).upper())
    return out


def load_symbols():
    src = open(os.path.join(ROOT, "symbols.js"), encoding="utf-8").read()
    syms = re.findall(r'\["([A-Z0-9&\-]+)",', src)
    seen, out = set(), []
    for s in syms:
        if s not in seen:
            seen.add(s); out.append(s)
    return out


def num(x):
    try:
        v = float(x)
        return None if v != v else v          # NaN -> None
    except Exception:
        return None


def eps_row(df):
    if df is None or getattr(df, "empty", True):
        return None
    for name in ("DilutedEPS", "BasicEPS", "Diluted EPS", "Basic EPS"):
        if name in df.index:
            return df.loc[name]
    return None


def series(df, *names):
    if df is None or getattr(df, "empty", True):
        return {}
    for n in names:
        if n in df.index:
            return {str(k)[:10]: num(v) for k, v in df.loc[n].items() if num(v) is not None}
    return {}


def quarter_table(df):
    pat = series(df, "NetIncome", "NetIncomeCommonStockholders", "NetIncomeContinuousOperations")
    sales = series(df, "TotalRevenue", "OperatingRevenue")
    op = series(df, "OperatingIncome", "EBIT")
    dates = sorted(set(pat) | set(sales))
    rows = []
    for i, d in enumerate(dates):
        def pct(cur, prev):
            return round((cur - prev) / abs(prev) * 100, 1) if cur is not None and prev else None
        def back(series_, k):
            return series_.get(dates[i - k]) if i - k >= 0 else None
        p, sl = pat.get(d), sales.get(d)
        rows.append({
            "d": d,
            "pat": round(p / 1e7, 2) if p is not None else None,
            "sales": round(sl / 1e7, 2) if sl is not None else None,
            "patYoY": pct(p, back(pat, 4)), "patQoQ": pct(p, back(pat, 1)),
            "salesYoY": pct(sl, back(sales, 4)), "salesQoQ": pct(sl, back(sales, 1)),
            "opm": round(op[d] / sl * 100, 1) if d in op and sl else None,
        })
    return rows[-6:]


def growth(new, old):
    if new is None or old is None or old <= 0:
        return None                              # growth from a loss isn't meaningful
    return new / old - 1


def fetch_one(sym):
    t = yf.Ticker(sym + ".NS")
    rec = {"t": datetime.date.today().isoformat(), "src": {}}
    # 1) official NSE quarterly results
    try:
        q = nse_quarterly(sym)
    except Exception:
        q = []
    # NSE's comparison feed can be months behind: ignore it if its latest quarter is over ~6 months old
    if q and (datetime.date.today() - datetime.date.fromisoformat(q[-1]["d"])).days > 200:
        rec["nseStale"] = q[-1]["d"]
        q = []
    if q:
        g, gp = yoy(q, "eps")
        r_, _ = yoy(q, "rev")
        if g is not None:
            rec["qEps"] = g; rec["src"]["C"] = "NSE"
        if gp is not None:
            rec["qEpsPrev"] = gp
        if r_ is not None:
            rec["qRev"] = r_; rec["src"]["sales"] = "NSE"
        rec["qList"] = [{"d": x["d"], "eps": x["eps"]} for x in q][-6:]
    info = {}
    try:
        info = t.get_info() or {}
    except Exception as e:
        if "Rate" in type(e).__name__ or "429" in str(e):
            raise
    if rec.get("qEps") is None and num(info.get("earningsQuarterlyGrowth")) is not None:
        rec["qEps"] = num(info.get("earningsQuarterlyGrowth")); rec["src"]["C"] = "Yahoo"
    if rec.get("qRev") is None and num(info.get("revenueGrowth")) is not None:
        rec["qRev"] = num(info.get("revenueGrowth")); rec["src"]["sales"] = "Yahoo"
    rec["inst"] = num(info.get("heldPercentInstitutions"))
    if rec["inst"] is not None:
        rec["src"]["I"] = "Yahoo"
    rec["roe"] = num(info.get("returnOnEquity"))
    rec["name"] = info.get("longName") or info.get("shortName")
    # chart header (MarketSmith-style): market cap, free-float cap, sector, listing year
    mc = num(info.get("marketCap"))
    rec["mcap"] = round(mc / 1e7) if mc else None
    fl, px = num(info.get("floatShares")), num(info.get("currentPrice") or info.get("regularMarketPrice"))
    rec["ff"] = round(fl * px / 1e7) if fl and px else None
    rec["sector"] = info.get("sector"); rec["industry"] = info.get("industry")
    ft = info.get("firstTradeDateMilliseconds") or (info.get("firstTradeDateEpochUtc") and info.get("firstTradeDateEpochUtc") * 1000)
    try:
        rec["listed"] = datetime.datetime.utcfromtimestamp(ft / 1000).year if ft else None
    except Exception:
        rec["listed"] = None

    # annual EPS (oldest -> newest)
    try:
        row = eps_row(t.get_income_stmt(pretty=False, freq="yearly"))
        if row is not None:
            pts = sorted([(str(k)[:10], num(v)) for k, v in row.items() if num(v) is not None])
            rec["aEps"] = [{"d": d, "eps": round(v, 4)} for d, v in pts][-4:]
            e = [p["eps"] for p in rec["aEps"]]
            if len(e) >= 2:
                rec["aUp"] = sum(1 for i in range(1, len(e)) if e[i] > e[i - 1])
                rec["aYears"] = len(e) - 1
                if e[0] > 0 and e[-1] > 0:
                    rec["aCagr"] = (e[-1] / e[0]) ** (1 / (len(e) - 1)) - 1
                    rec["src"]["A"] = "Yahoo"
    except Exception as e:
        if "Rate" in type(e).__name__ or "429" in str(e):
            raise

    # quarterly results table for the chart: PAT, sales, YoY / QoQ, operating margin (Rs crore)
    qdf = None
    try:
        qdf = t.get_income_stmt(pretty=False, freq="quarterly")
        rec["qTable"] = quarter_table(qdf)
    except Exception as e:
        if "Rate" in type(e).__name__ or "429" in str(e):
            raise

    # quarterly EPS from Yahoo: used when NSE gave nothing, or when Yahoo has a newer quarter
    try:
        row = eps_row(qdf)
        if row is not None:
            pts = sorted([(str(k)[:10], num(v)) for k, v in row.items() if num(v) is not None])
            nse_last = rec["qList"][-1]["d"] if rec["src"].get("C") == "NSE" and rec.get("qList") else ""
            newer = bool(pts) and pts[-1][0] > nse_last
            if not newer:
                pts = []                         # NSE is as recent (or newer): keep the official figures
            else:
                rec["qList"] = [{"d": d, "eps": round(v, 4)} for d, v in pts][-6:]
                if rec["src"].get("C") == "NSE":
                    rec["src"].pop("C", None); rec.pop("qEps", None); rec.pop("qEpsPrev", None)
                    # fall back to Yahoo's own quarterly figures for C and sales
                    if num(info.get("earningsQuarterlyGrowth")) is not None:
                        rec["qEps"] = num(info.get("earningsQuarterlyGrowth")); rec["src"]["C"] = "Yahoo"
                    if num(info.get("revenueGrowth")) is not None:
                        rec["qRev"] = num(info.get("revenueGrowth")); rec["src"]["sales"] = "Yahoo"
            if len(pts) >= 5:
                g = growth(pts[-1][1], pts[-5][1])
                if g is not None:
                    rec["qEps"] = g; rec["src"]["C"] = "Yahoo"
                g_prev = growth(pts[-2][1], pts[-6][1]) if len(pts) >= 6 else None
                if g_prev is not None:
                    rec["qEpsPrev"] = g_prev
    except Exception as e:
        if "Rate" in type(e).__name__ or "429" in str(e):
            raise

    for k in list(rec):
        if isinstance(rec[k], float):
            rec[k] = round(rec[k], 4)
    return rec


def fetch_with_retry(sym):
    for attempt in range(4):
        try:
            return sym, fetch_one(sym), None
        except Exception as e:
            wait = (20 if ("Rate" in type(e).__name__ or "429" in str(e)) else 3) * (attempt + 1)
            time.sleep(wait + random.random() * 2)
            err = f"{type(e).__name__}: {e}"
    return sym, None, err


def main():
    syms = load_symbols()
    old = {}
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding="utf-8")).get("data", {})
        except Exception:
            old = {}
    # oldest data first, so a run that stops early still refreshes the stalest stocks
    syms.sort(key=lambda s: (old.get(s, {}).get("t", "0000"), s))
    if MODE == "daily":
        recent = nse_recent_filers()
        never = [s for s in syms if s not in old]
        pick_ = [s for s in syms if s in recent] + never
        syms = list(dict.fromkeys(pick_))[:DAILY_CAP]
        print(f"Daily mode: {len(recent)} recent filers, {len(never)} never fetched -> {len(syms)} to update", flush=True)
    if LIMIT:
        syms = syms[:LIMIT]
    start = time.time()
    data, ok, fail = dict(old), 0, 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {}
        for s in syms:
            futures[pool.submit(fetch_with_retry, s)] = s
            time.sleep(0.15)
        for i, f in enumerate(as_completed(futures), 1):
            sym, rec, err = f.result()
            if rec:
                data[sym] = rec; ok += 1
            else:
                fail += 1
            if i % 100 == 0:
                print(f"{i}/{len(syms)} done, {ok} ok, {fail} failed, {int(time.time() - start)}s", flush=True)
                save(data)
            if (time.time() - start) / 60 > MAX_MINUTES:
                print("Time limit reached, saving what we have", flush=True)
                for g in futures: g.cancel()
                break
    save(data)
    nse_used = sum(1 for v in data.values() if isinstance(v, dict) and v.get("src", {}).get("C") == "NSE")
    print(f"Finished: {ok} updated, {fail} failed, {len(data)} stocks in file, {nse_used} with official NSE quarterly data"
          + ("" if _nse["ok"] is not False else " (NSE blocked this server; Yahoo used)"))


def save(data):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    payload = {"updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
               "source": "NSE filings (official) + Yahoo Finance fallback", "data": data}
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    os.replace(tmp, OUT)


if __name__ == "__main__":
    main()
