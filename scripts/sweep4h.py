"""ICT 4H Sweep engine (Python side): the same logic as forex/sweep.js, line for line, used by the GitHub scan and
by scripts/sweep_backtest.py. forex/tests/run_tests.js and scripts/test_forex_crt.py check both give the same answers.
The rules are written out at the top of forex/sweep.js.

Candles are lists [t, open, high, low, close] (t = UTC seconds, candle start), oldest first.
dir: +1 = bullish setup (a 4H swing low was swept), -1 = bearish (a 4H swing high was swept).
"""
import math

P = {"K": 2, "LEFT": 10, "MIN_AGE": 5, "LOOK": 60, "ATR_N": 14, "RECENT": 12, "EXPIRY": 6, "FVG_MIN": 0.1, "TARGET_BACK": 20}
H4 = 4 * 3600


def atr(cs, i, n):
    """Average true range of the n candles ending at i (true range uses the previous close)."""
    s = 0.0; c = 0
    for k in range(max(1, i - n + 1), i + 1):
        h, l, pc = cs[k][2], cs[k][3], cs[k - 1][4]
        s += max(h - l, abs(h - pc), abs(l - pc)); c += 1
    return s / c if c else (cs[i][2] - cs[i][3] if i >= 0 else 0.0)


def swings(cs, upto, frm=0):
    """Confirmed 4H swings using candles 0..upto only (a swing at i needs candles i+1..i+K)."""
    out = []; K = P["K"]
    for i in range(max(K, frm or 0), upto - K + 1):
        lft = range(max(0, i - P["LEFT"]), i)        # external swing: beyond the LEFT candles before it
        hiL = max(cs[k][2] for k in lft); loL = min(cs[k][3] for k in lft)
        hiR = max(cs[k][2] for k in range(i + 1, i + K + 1)); loR = min(cs[k][3] for k in range(i + 1, i + K + 1))
        wLo = min(cs[k][3] for k in range(i - K, i + K + 1)); wHi = max(cs[k][2] for k in range(i - K, i + K + 1))
        a = atr(cs, i, P["ATR_N"]) or 1e-12
        if cs[i][2] > hiL and cs[i][2] >= hiR:
            out.append({"i": i, "t": cs[i][0], "side": 1, "price": cs[i][2], "conf": i + K, "size": (cs[i][2] - wLo) / a})
        if cs[i][3] < loL and cs[i][3] <= loR:
            out.append({"i": i, "t": cs[i][0], "side": -1, "price": cs[i][3], "conf": i + K, "size": (wHi - cs[i][3]) / a})
    return out


def sweep_at(cs, j, live=False):
    """Steps 2-4 for 4H candle j (live = still open). Uses candles 0..j only."""
    if j < P["K"] * 2 + 2:
        return None
    sw = [s for s in swings(cs, j - 1, j - P["LOOK"]) if s["conf"] <= j - 1 and s["i"] >= j - P["LOOK"]]

    def untouched(s):
        for k in range(s["i"] + 1, j):
            if (cs[k][2] > s["price"]) if s["side"] == 1 else (cs[k][3] < s["price"]):
                return False
        return True
    _, o, h, l, c = cs[j]
    hi = lo = None
    for s in sw:
        if not untouched(s) or s["i"] > j - P["MIN_AGE"]:      # swing at least MIN_AGE candles old
            continue
        if s["side"] == 1 and h > s["price"] and o < s["price"] and (hi is None or s["price"] > hi["price"]):
            hi = s
        if s["side"] == -1 and l < s["price"] and o > s["price"] and (lo is None or s["price"] < lo["price"]):
            lo = s
    if hi is None and lo is None:
        return None
    if hi is not None and lo is not None:
        return {"code": "AMBIGUOUS", "j": j, "t": cs[j][0]}
    s = hi or lo; d = -1 if hi else 1; a4 = atr(cs, j - 1, P["ATR_N"]) or 1e-12
    ext = h if d == -1 else l; back = (c < s["price"]) if d == -1 else (c > s["price"])
    target = None; tlabel = None
    for o in sw:
        if o["side"] != -s["side"]:
            continue
        ok = True
        for k in range(o["i"] + 1, j + 1):
            if (cs[k][2] > o["price"]) if o["side"] == 1 else (cs[k][3] < o["price"]):
                ok = False; break
        if not ok or ((o["price"] >= c) if d == -1 else (o["price"] <= c)):
            continue
        if target is None or ((o["price"] > target) if d == -1 else (o["price"] < target)):
            target = o["price"]; tlabel = "swing low" if d == -1 else "swing high"
    if target is None:
        back20 = cs[max(0, j - P["TARGET_BACK"]):j]
        if back20:
            x = min(q[3] for q in back20) if d == -1 else max(q[2] for q in back20)
            if (x < c) if d == -1 else (x > c):
                target = x; tlabel = "20-candle low" if d == -1 else "20-candle high"
    return {"code": "SWEEPING" if live else ("SWEEP" if back else "BREAK"), "dir": d, "j": j, "t": cs[j][0], "live": bool(live),
            "back": back, "level": s["price"], "swingT": s["t"], "swingI": s["i"], "swingSize": s["size"], "ext": ext, "close": c,
            "depth": ((ext - s["price"]) if d == -1 else (s["price"] - ext)) / a4, "atr4": a4, "target": target, "targetLabel": tlabel}


def ltf_setup(sw, c4, m15, open_last=True, sec=H4):
    """Steps 5-8 on the 15m candles (oldest first). open_last = the last 15m candle is still forming."""
    d = sw["dir"]; j = sw["j"]
    t4 = c4[j][0]; tprev = c4[j - 1][0]
    texp = c4[j + 1 + P["EXPIRY"]][0] if j + 1 + P["EXPIRY"] < len(c4) else t4 + (1 + P["EXPIRY"]) * sec
    n = len(m15); last_closed = n - 1 - (1 if open_last else 0)
    a = next((i for i, b in enumerate(m15) if b[0] >= tprev), -1)
    s = next((i for i, b in enumerate(m15) if b[0] >= t4), -1)
    out = {"status": "SWEEP", "choch": None, "zone": None}
    if a < 0 or s < 0:
        out["status"] = "NO_LTF"; return out
    H = lambda k: m15[k][2]; L = lambda k: m15[k][3]; O = lambda k: m15[k][1]; C = lambda k: m15[k][4]

    def is_ref(i):
        if not (i - 1 >= a and i + 1 < n):
            return False
        return (L(i) < L(i - 1) and L(i) <= L(i + 1)) if d == -1 else (H(i) > H(i - 1) and H(i) >= H(i + 1))

    def ref_before(X):
        for i in range(X - 1, a, -1):
            if i + 1 <= X and is_ref(i):
                return i
        return -1
    X = s; ref = ref_before(s); b = -1
    for k in range(s + 1, last_closed + 1):
        if m15[k][0] >= texp:
            break
        if (H(k) > H(X)) if d == -1 else (L(k) < L(X)):
            X = k; ref = ref_before(X); continue
        swept = (H(X) > sw["level"]) if d == -1 else (L(X) < sw["level"])
        if swept and ref >= 0 and ((C(k) < L(ref)) if d == -1 else (C(k) > H(ref))):
            b = k; break
    out["ext"] = H(X) if d == -1 else L(X); out["extT"] = m15[X][0]
    if b < 0 and ref >= 0:
        out["watch"] = {"level": L(ref) if d == -1 else H(ref), "t": m15[ref][0]}   # the CHoCH level to watch
    if b < 0:
        if last_closed >= 0 and m15[min(last_closed + 1, n - 1)][0] >= texp:
            out["status"] = "EXPIRED"
        return out
    a15 = atr(m15, b - 1, P["ATR_N"]) or 1e-12
    body = 0.0; disp_k = X
    for k in range(X, b + 1):
        bd = abs(C(k) - O(k))
        if bd > body:
            body = bd; disp_k = k
    out["choch"] = {"t": m15[b][0], "level": L(ref) if d == -1 else H(ref), "refT": m15[ref][0], "k": b}
    out["disp"] = body / a15; out["dispT"] = m15[disp_k][0]; out["atr15"] = a15
    best = None
    for m in range(X + 1, min(b + 1, last_closed)):        # m + 1 <= min(b + 1, last_closed)
        lo = H(m + 1) if d == -1 else H(m - 1); hi = L(m - 1) if d == -1 else L(m + 1)
        if hi - lo >= P["FVG_MIN"] * a15:
            bd = abs(C(m) - O(m))
            if best is None or bd >= best["bd"]:
                best = {"type": "FVG", "lo": lo, "hi": hi, "t": m15[m - 1][0], "from": m + 1, "bd": bd}
    if best is None:
        for k in range(X, a - 1, -1):
            if (C(k) > O(k)) if d == -1 else (C(k) < O(k)):
                best = ({"type": "OB", "lo": O(k), "hi": H(k), "t": m15[k][0], "from": b} if d == -1
                        else {"type": "OB", "lo": L(k), "hi": O(k), "t": m15[k][0], "from": b})
                break
    if best is None:
        out["status"] = "CHOCH"; return out
    best.pop("bd", None); out["zone"] = best
    entry = best["lo"] if d == -1 else best["hi"]; sl = out["ext"]; tp = sw["target"]
    out["entry"] = entry; out["sl"] = sl; out["tp"] = tp
    # TTrades discount / premium: dealing range = sweep extreme .. far end of the move up to max(zone, CHoCH)
    far = math.inf if d == -1 else -math.inf
    for k in range(X, max(best["from"], b) + 1):
        far = min(far, L(k)) if d == -1 else max(far, H(k))
    out["eq"] = (far + sl) / 2; out["pd"] = (entry >= out["eq"]) if d == -1 else (entry <= out["eq"])
    out["rr"] = (abs(tp - entry) / abs(sl - entry)
                 if tp is not None and (tp - entry) * d > 0 and abs(sl - entry) > 0 else None)
    out["status"] = "ENTRY_READY"
    tconf = c4[j + 1][0] if j + 1 < len(c4) else t4 + sec      # no fill before the 4H sweep candle has closed
    filled = False
    for k in range(max(best["from"], b) + 1, n):       # zone usable only after the CHoCH closed
        t = m15[k][0]; hk = H(k); lk = L(k)
        if not filled:
            if t >= texp:
                out["status"] = "EXPIRED"; break
            touch = (hk >= entry) if d == -1 else (lk <= entry)
            stop = (hk > sl) if d == -1 else (lk < sl)
            fillable = touch and t >= tconf
            if tp is not None and ((lk <= tp) if d == -1 else (hk >= tp)) and not fillable:
                out["status"] = "MISSED"; out["tExit"] = t; break
            if stop and not fillable:
                out["status"] = "INVALIDATED"; out["tExit"] = t; break
            if fillable:
                filled = True; out["status"] = "ENTERED"; out["tFill"] = t
        if filled:
            stop = (hk >= sl) if d == -1 else (lk <= sl)
            hit = tp is not None and ((lk <= tp) if d == -1 else (hk >= tp))
            if stop:
                out["status"] = "STOPPED"; out["tExit"] = t; break
            if hit:
                out["status"] = "TARGET_HIT"; out["tExit"] = t; break
    return out


def quality(sw, x):
    c = {"swing": sw["swingSize"] >= 1.5, "depth": 0.1 <= sw["depth"] <= 1.0, "disp": x.get("disp") is not None and x["disp"] >= 1.5,
         "fvg": bool(x.get("zone") and x["zone"]["type"] == "FVG"), "rr": x.get("rr") is not None and x["rr"] >= 2}
    n = sum(1 for v in c.values() if v)
    # TTrades entry checklist: stop raid, structure shift, discount/premium, PD array, solid R:R
    tt = {"raid": True, "shift": bool(x.get("choch")), "pd": x.get("pd") is True, "array": bool(x.get("zone")),
          "rr": x.get("rr") is not None and x["rr"] >= 2}
    return {"checks": c, "score": n, "grade": "A" if n >= 4 else "B" if n == 3 else "C", "tt": tt, "ttN": sum(1 for v in tt.values() if v)}


def scan(c4, m15, pip, price, sec=H4):
    """4H sweeps of the last RECENT 4H candles (newest first) with their 15m setups. Last candles are still forming."""
    c4 = [[int(b[0])] + [float(v) for v in b[1:5]] for b in c4]       # plain floats (numpy bools are not JSON)
    m15 = [[int(b[0])] + [float(v) for v in b[1:5]] for b in (m15 or [])]
    n = len(c4); res = []
    for j in range(n - 1, max(1, n - P["RECENT"]) - 1, -1):
        sw = sweep_at(c4, j, j == n - 1)
        if not sw or sw["code"] in ("AMBIGUOUS", "BREAK"):
            continue
        x = ltf_setup(sw, c4, m15, True, sec) if m15 else {"status": "NO_LTF"}
        status = "SWEEPING" if sw["live"] else x["status"]
        q = quality(sw, x)
        dist = abs(price - x["entry"]) / pip if x.get("entry") is not None and price is not None else None
        r = {"status": status, "dir": sw["dir"], "sweep": sw, "dist": None if dist is None else math.floor(dist * 10 + 0.5) / 10}
        r.update(x); r["status"] = status; r["ltfStatus"] = x["status"]; r["q"] = q
        res.append(r)
    seen = set(); out = []                              # same 15m CHoCH from two 4H sweeps: keep the newest
    for r in res:
        if r.get("choch"):
            key = (r["dir"], r["choch"]["t"])
            if key in seen:
                continue
            seen.add(key)
        out.append(r)
    return out
