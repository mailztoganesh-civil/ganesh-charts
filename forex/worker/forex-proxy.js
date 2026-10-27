// Cloudflare Worker for the Forex CRT app: returns Yahoo Finance candles for forex
// symbols (EURUSD=X, JPY=X, GC=F ...) with CORS, full price precision and a 30 s edge cache.
// Deploy: Cloudflare dashboard -> Workers & Pages -> Create -> name it "forex-proxy" -> paste this -> Deploy.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "1d", "1wk"];
const RANGES = ["1d", "2d", "5d", "1mo", "3mo", "6mo", "1y", "2y"];
const json = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS, ...extra } });

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
    const interval = url.searchParams.get("interval") || "1h";
    const range = url.searchParams.get("range") || "5d";
    if (!/^[A-Z0-9=^.\-]{1,20}$/.test(symbol)) return json({ error: "bad symbol" }, 400);
    if (!INTERVALS.includes(interval) || !RANGES.includes(range)) return json({ error: "bad interval or range" }, 400);

    const cache = caches.default;
    const key = new Request(`https://forex-proxy.cache/${symbol}/${interval}/${range}`);
    const hit = await cache.match(key);
    if (hit) return hit;

    const y = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
    try {
      const r = await fetch(y, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Accept: "application/json" } });
      if (!r.ok) return json({ error: "Yahoo HTTP " + r.status }, 502);
      const d = await r.json();
      const res = d && d.chart && d.chart.result && d.chart.result[0];
      if (!res) return json({ error: "no data" }, 502);
      const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
      const ts = res.timestamp || [];
      const out = { s: symbol, t: [], o: [], h: [], l: [], c: [], price: res.meta && res.meta.regularMarketPrice };
      for (let i = 0; i < ts.length; i++) {
        const o = q.open && q.open[i]; if (o == null) continue;
        let c = q.close[i], h = q.high[i], l = q.low[i];
        if (c == null) c = out.price != null ? out.price : o;
        if (h == null) h = Math.max(o, c); if (l == null) l = Math.min(o, c);
        out.t.push(ts[i]); out.o.push(o); out.h.push(h); out.l.push(l); out.c.push(c);
      }
      const resp = json(out, 200, { "Cache-Control": "public, max-age=30" });
      ctx.waitUntil(cache.put(key, resp.clone()));
      return resp;
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502);
    }
  },
};
