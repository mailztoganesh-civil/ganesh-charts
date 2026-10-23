/* Evening scans on GitHub Actions.
 * Loads the app's own app.js in a sandbox (a fake page built from index.html, so every scanner
 * uses exactly the same rules and default settings as the app), downloads 2 years of daily prices
 * for every NSE stock once, runs every scanner on it and writes data/scans.json.
 * The app shows these results instantly ("Tonight's results"). */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.env.GITHUB_WORKSPACE || process.cwd();
const OUT = path.join(ROOT, "data", "scans.json");
const LIMIT = parseInt(process.env.LIMIT || "0", 10);
const CONC = parseInt(process.env.CONCURRENCY || "6", 10);
const MODES = (process.env.MODES || "start,startlive,smc,tight,undercut,flag,manas,india,rvol,vcp,base,canslim").split(",");

/* ── a fake page: element values come from index.html, everything else is a harmless no-op ── */
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const defaults = {};
// <input ...> elements (one tag each)
for (const m of html.matchAll(/<input\b([^>]*)>/g)) {
  const attrs = m[1], id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
  if (!id) continue;
  defaults[id] = { value: (attrs.match(/\bvalue="([^"]*)"/) || [, ""])[1], checked: /\bchecked\b/.test(attrs) };
}
// <select ...> ... </select> with its options (the selected one, else the first)
for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
  const id = (m[1].match(/\bid="([^"]+)"/) || [])[1];
  if (!id) continue;
  const opts = [...m[2].matchAll(/<option\b([^>]*)>([^<]*)/g)].map(o => ({ value: (o[1].match(/value="([^"]*)"/) || [, o[2]])[1], text: o[2], sel: /\bselected\b/.test(o[1]) }));
  const sel = opts.find(o => o.sel) || opts[0] || { value: "", text: "" };
  defaults[id] = { value: sel.value, options: opts };
}
const hiddenIds = new Set();
for (const m of html.matchAll(/<[a-z0-9]+\b([^>]*)>/gi)) {
  const id = (m[1].match(/\bid="([^"]+)"/) || [])[1];
  if (id && /(^|\s)hidden(\s|=|$)/.test(m[1])) hiddenIds.add(id);
}
const noop = () => {};
const anyProxy = () => new Proxy(function () {}, {
  get: (t, k) => k === Symbol.toPrimitive ? () => "" : k === "length" ? 0 : k === Symbol.iterator ? function* () {} : k === "then" ? undefined : anyProxy(),
  apply: () => anyProxy(), set: () => true, construct: () => anyProxy(),
});
const els = {};
function fakeEl(id) {
  if (els[id]) return els[id];
  const d = defaults[id] || {};
  const opts = (d.options || []).map(o => ({ value: o.value, textContent: o.text, text: o.text }));
  const base = {
    id, value: d.value ?? "", checked: !!d.checked, hidden: hiddenIds.has(id), disabled: false, textContent: "", innerHTML: "", innerText: "",
    style: {}, dataset: {}, options: opts, selectedOptions: opts.filter(o => o.value === d.value), children: [], className: "",
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, append: noop, prepend: noop, removeChild: noop, remove: noop, insertRow: () => fakeEl("_row"), insertCell: () => fakeEl("_cell"),
    querySelector: () => fakeEl("_q"), querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop, focus: noop, blur: noop, click: noop, scrollIntoView: noop,
    setPointerCapture: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200 }),
    getContext: () => anyProxy(), toDataURL: () => "", closest: () => null, contains: () => false,
    clientWidth: 600, clientHeight: 200, width: 600, height: 200,
  };
  return (els[id] = base);
}
const store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }, clear: () => {} };
const document = {
  getElementById: fakeEl, querySelector: () => fakeEl("_q"), querySelectorAll: () => [], createElement: t => fakeEl("_new_" + t + Math.random()),
  addEventListener: noop, removeEventListener: noop, body: fakeEl("_body"), documentElement: fakeEl("_html"), hidden: false, visibilityState: "visible",
  head: fakeEl("_head"), title: "",
};
// relative URLs (data/*.json) are read from the repo; everything else is a real network request
const realFetch = globalThis.fetch;
async function sandboxFetch(url, opts) {
  const u = String(url);
  if (!/^https?:/.test(u)) {
    const f = path.join(ROOT, u.split("?")[0]);
    if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => ({}) };
    const txt = fs.readFileSync(f, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
  }
  if (process.env.MOCK && /workers\.dev/.test(u)) {                 // local testing without network
    const sym = decodeURIComponent((u.match(/symbol=([^&]+)/) || [, "X"])[1]); let seed = [...sym].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const candles = []; let v = 100 + rnd() * 400; const t0 = Math.floor(Date.now() / 1000) - 500 * 86400;
    for (let k = 0; k < 500; k++) { v *= 1 + (rnd() - 0.48) * 0.04; candles.push({ time: t0 + k * 86400, open: v * (1 + (rnd() - 0.5) * 0.01), high: v * 1.015, low: v * 0.985, close: v, volume: Math.round(2e5 + rnd() * 2e6) }); }
    return { ok: true, status: 200, json: async () => ({ candles }) };
  }
  return realFetch(u, opts);
}
const ctx = vm.createContext({
  console, document, localStorage, sessionStorage: localStorage, fetch: sandboxFetch, setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: { onLine: true, storage: { persist: async () => false, persisted: async () => false }, serviceWorker: undefined, share: undefined, wakeLock: undefined, userAgent: "node" },
  location: { href: "https://localhost/", search: "", hash: "", reload: noop }, history: { pushState: noop, replaceState: noop, back: noop, state: null },
  matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }), requestAnimationFrame: f => setTimeout(f, 0),
  indexedDB: undefined, URL, Blob: class {}, File: class {}, FileReader: class {}, Image: class {}, AbortController, alert: noop, confirm: () => true, prompt: () => null,
  devicePixelRatio: 1, innerWidth: 1200, innerHeight: 900, addEventListener: noop, removeEventListener: noop, getComputedStyle: () => ({}),
  jspdf: anyProxy(), pdfjsLib: anyProxy(), Intl, Date, Math, JSON, Promise,
});
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
for (const f of ["symbols.js", "app.js"]) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f }); }
  catch (e) { console.error(`Loading ${f} failed:`, e.stack); process.exit(1); }
}
const app = name => vm.runInContext(`typeof ${name} === "undefined" ? undefined : ${name}`, ctx);
const call = (expr) => vm.runInContext(expr, ctx);

/* ── settings: the app's own *Settings() functions, i.e. the defaults in index.html ── */
const cfgs = {};
const safe = (k, f) => { try { cfgs[k] = f(); } catch (e) { console.error(`settings ${k}:`, e.message); } };
safe("start", () => ({ ...call("startSettings()"), when: "ready" }));
safe("startlive", () => ({ ...call("startSettings()"), when: "3" }));
safe("smc", () => ({ ...call("smcSettings()"), show: "all" }));
safe("tight", () => ({ ...call("tightSettings()"), minScore: 70 }));
safe("undercut", () => ({ ...call("ucSettings()"), show: "all" }));
safe("flag", () => call("flagSettings()"));
safe("manas", () => call("manasSettings()"));
safe("india", () => call("indiaSettings()"));
safe("rvol", () => call("rvolSettings()"));
safe("vcp", () => call("vcpSettings()"));
safe("base", () => call("baseSettings()"));
safe("canslim", () => ({ ...call("canslimSettings()"), mOnly: false }));
for (const [k, v] of Object.entries(cfgs)) console.log(`settings ${k}: ${JSON.stringify(v).slice(0, 300)}`);

const run = async () => {
  const t0 = Date.now();
  const SYMS = app("NSE_SYMBOLS").map(x => x[0]);
  const syms = LIMIT ? SYMS.slice(0, LIMIT) : SYMS;
  console.log(`${syms.length} symbols, modes: ${MODES.join(", ")}`);
  const nifty = await call("fetchNiftyMap()");
  console.log(`Nifty: ${nifty ? "ok" : "unavailable"}`);
  await call("loadFundamentals(true)");
  console.log(`Fundamentals: ${app("FUND") ? "ok" : "not available"}`);
  const fn = {
    start: c => call("analyseStart")(c, cfgs.start), startlive: c => call("analyseStart")(c, cfgs.startlive),
    smc: c => call("analyseSmc")(c, cfgs.smc), tight: c => call("analyseTight")(c, cfgs.tight), undercut: c => call("analyseUndercut")(c, cfgs.undercut),
    flag: c => call("analyseFlag")(c, cfgs.flag), manas: c => call("analyseManas")(c, nifty, cfgs.manas),
    india: c => call("analyseIndia")(c, nifty, cfgs.india), rvol: c => call("analyseRvol")(c, cfgs.rvol),
    vcp: c => call("analyseVcp")(c, cfgs.vcp, nifty), base: c => call("analyseBase")(c, cfgs.base, nifty),
    canslim: (c, sym) => { cfgs.canslim._sym = sym; return call("analyseCanslim")(c, cfgs.canslim, nifty); },
  };
  const tallied = new Set(["vcp", "flag", "undercut", "tight", "smc"]);
  const res = {}, tally = {}, errs = {};
  for (const m of MODES) { res[m] = []; tally[m] = {}; }
  const allRs = [];
  let done = 0, noData = 0, i = 0, lastDate = "";
  const fetchDaily = call("fetchDaily2y");
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < syms.length) {
      const sym = syms[i++];
      let c = await fetchDaily(sym);
      if (!c.length) { await new Promise(r => setTimeout(r, 3000)); c = await fetchDaily(sym); }
      done++;
      if (!c.length) { noData++; continue; }
      const d = call("ymd")(c[c.length - 1].date); if (d > lastDate) lastDate = d;
      allRs.push(call("rsScoreOf")(c.map(x => x.close)));
      for (const m of MODES) {
        if (!fn[m] || !cfgs[m.replace("live", "")] && !cfgs[m]) continue;
        let r;
        try { r = fn[m](c, sym); } catch (e) { errs[m] = (errs[m] || 0) + 1; if (errs[m] < 3) console.error(m, sym, e.message); continue; }
        if (tallied.has(m) && r) {
          (r.fails && r.fails.length ? r.fails : ["ok"]).forEach(f => (tally[m][f] = (tally[m][f] || 0) + 1));
          if (!r.mode || r.fails.length > (cfgs[m].nearMiss ? 1 : 0)) r = null;
        }
        if (r) res[m].push(JSON.parse(JSON.stringify({ symbol: sym, ...r })));
      }
      if (done % 200 === 0) console.log(`${done}/${syms.length} (${Math.round((Date.now() - t0) / 60000)} min)`);
    }
  }));
  const sortVcp = app("sortVcp");
  const out = { updated: new Date().toISOString(), dataDate: lastDate, scanned: done, noData, universe: syms.length, modes: {} };
  for (const m of MODES) {
    let list = res[m];
    if (m === "vcp") list = call("finalizeVcp")(list, allRs, cfgs.vcp);
    else if (m === "base") list = call("finalizeBase")(list, allRs, cfgs.base);
    else if (m === "canslim") list = call("finalizeBase")(list, allRs, { rsOn: true, rsMin: cfgs.canslim.rsMin });
    list = JSON.parse(JSON.stringify(sortVcp(list)));
    out.modes[m] = { results: list, tally: tallied.has(m) ? tally[m] : null, settings: JSON.parse(JSON.stringify(cfgs[m] || {})) };
    console.log(`${m}: ${list.length} found${errs[m] ? ` (${errs[m]} errors)` : ""}`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) in ${Math.round((Date.now() - t0) / 60000)} min; ${noData} without data`);
};
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
