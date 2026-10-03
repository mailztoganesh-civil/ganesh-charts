/* Ganesh Charts — web version of the SwiftUI app
 * Screener CSV → date filter → daily + weekly charts per stock → PDF (842 × 1190 pt pages).
 * Data via your Cloudflare Worker (nse-charts-proxy) instead of calling Yahoo directly.
 */
const OHLC_API_BASE = "https://nse-charts-proxy.mailztoganesh.workers.dev";
const BATCH_SIZE = 5;          // same as the Swift app
const CW = 800, CH = 460, SCALE = 2;

const $ = id => document.getElementById(id);
const state = { stocks: [], byDate: {}, dates: [], busy: false, urls: [], mode: "csv", letters: new Set() };

/* ───────── CSV (port of parseCSV) ───────── */
const pad2 = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function parseDate(raw) {
  const s = raw.trim();
  let m;
  // dd-MM-yyyy hh:mm a  /  dd-MM-yyyy HH:mm  /  dd-MM-yyyy
  if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(\s+\d{1,2}:\d{2}(\s*[AaPp][Mm])?)?$/))) return ymd(new Date(+m[3], +m[2] - 1, +m[1]));
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return ymd(new Date(+m[1], +m[2] - 1, +m[3]));
  // MM/dd/yyyy is tried before dd/MM/yyyy in the Swift app
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    const a = +m[1], b = +m[2];
    return a <= 12 ? ymd(new Date(+m[3], a - 1, b)) : ymd(new Date(+m[3], b - 1, a));
  }
  return null;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n|\r/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { stocks: [], byDate: {} };
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, "").toLowerCase());
  let nameIdx = headers.findIndex(h => h === "symbol" || h.includes("symbol") || h.includes("name") || h.includes("stock"));
  if (nameIdx < 0) nameIdx = 1;
  let dateIdx = headers.findIndex(h => h === "date" || h.includes("date"));
  if (dateIdx < 0) dateIdx = 0;
  const stocks = [], byDate = {};
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
    if (cols.length <= nameIdx) continue;
    const stock = cols[nameIdx].toUpperCase().trim();
    if (!stock || stock === "SYMBOL" || stock === "NAME") continue;
    if (!stocks.includes(stock)) stocks.push(stock);
    if (cols.length > dateIdx) {
      const d = parseDate(cols[dateIdx]);
      if (d) {
        (byDate[d] = byDate[d] || []);
        if (!byDate[d].includes(stock)) byDate[d].push(stock);
      }
    }
  }
  return { stocks, byDate };
}

function letterKey(sym) { return /^[A-Z]/.test(sym) ? sym[0] : "#"; }
function letterStocks() {
  return NSE_SYMBOLS.map(([s]) => s).filter(s => state.letters.has(letterKey(s)));
}

function filteredStocks() {
  if (state.mode === "letters") return letterStocks();
  if (!$("useFilter").checked || !state.dates.length) return state.stocks;
  const from = $("fromDate").value, to = $("toDate").value;
  const seen = new Set();
  for (const [d, list] of Object.entries(state.byDate)) if (d >= from && d <= to) list.forEach(s => seen.add(s));
  return state.stocks.filter(s => seen.has(s));
}

function refresh() {
  const csvMode = state.mode === "csv";
  $("paneCsv").hidden = !csvMode;
  $("paneLetters").hidden = csvMode;
  $("tabCsv").setAttribute("aria-selected", csvMode);
  $("tabLetters").setAttribute("aria-selected", !csvMode);
  $("step2").hidden = !csvMode || !state.stocks.length;
  const n = filteredStocks().length;
  $("step3").hidden = !n && !(csvMode && state.stocks.length);
  if (!csvMode) {
    const L = [...state.letters].sort((a, b) => (a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b)));
    $("letterCount").textContent = L.length ? `${n} stocks · ${L.join(", ")}` : "No letters selected";
  }
  $("filterCount").textContent = `${n} stocks in selected range`;
  $("filterCount").className = n ? "count ok" : "count none";
  $("go").textContent = `Generate PDF (${n} stocks)`;
  $("go").disabled = !n || state.busy;
}

function loadCSV(name, text) {
  const p = parseCSV(text);
  state.stocks = p.stocks; state.byDate = p.byDate;
  state.dates = Object.keys(p.byDate).sort();
  $("fileName").textContent = name;
  $("found").textContent = p.stocks.length ? `${p.stocks.length} total stocks found` : "No stocks found in this CSV";
  $("found").className = p.stocks.length ? "ok" : "err";
  $("csvDates").textContent = state.dates.length ? `CSV dates: ${state.dates[0]} to ${state.dates.at(-1)}` : "";
  if (state.dates.length) { $("fromDate").value = state.dates[0]; $("toDate").value = state.dates.at(-1); }
  refresh();
}

/* ───────── Chart length ───────── */
function approx(n, perYear) {
  const y = n / perYear;
  if (y < 1) { const m = Math.round(y * 12); return `\u2248 ${m} month${m === 1 ? "" : "s"}`; }
  return `\u2248 ${Math.round(y * 10) / 10} year${y === 1 ? "" : "s"}`;
}
function barHints() {
  $("dHint").textContent = approx(dailyBars(), 250);
  $("wHint").textContent = approx(weeklyBars(), 52);
  document.querySelectorAll(".chips button").forEach(b => {
    const inp = $(b.parentElement.dataset.for);
    b.setAttribute("aria-pressed", String(parseInt(inp.value, 10) === +b.dataset.v));
  });
}
document.querySelectorAll(".chips button").forEach(b => {
  b.onclick = () => { $(b.parentElement.dataset.for).value = b.dataset.v; barHints(); saveSettings(); };
});
$("dBars").oninput = $("wBars").oninput = barHints;
$("dBars").onchange = $("wBars").onchange = () => { barHints(); saveSettings(); };
barHints();

/* ───────── Manas Arora setups (rules distilled from his 41 posted entries) ─────────
 * What the posts show: he buys strong recent movers (many fresh IPOs), intraday, as price
 * breaks out, with a tight stop (low of day or 2%, sometimes 1%), and repeatedly re-enters
 * the same leaders. Charts show two setups:
 *  A. Base breakout: a sharp run-up, then a tight sideways base for 2–6 weeks, bought as it
 *     breaks the top of the base.
 *  B. 21 EMA pullback: a pullback in an uptrend into a rising 21 EMA (higher low), bought as
 *     it turns back up.
 * Works for young listings too (no 200-day average needed). */
function manasSettings() {
  return {
    minTurnover: Math.max(0, parseFloat($("mTurn").value) || 0),
    minPrice: Math.max(0, parseFloat($("mMinPrice").value) || 0),
    mom: clampInt($("mMom").value, 0, 300, 30),
    near: clampInt($("mNear").value, 1, 60, 15),
    adrMin: Math.max(0, parseFloat($("mAdr").value) || 0),
    baseMax: clampInt($("mBase").value, 3, 40, 12),
    maxRisk: Math.max(1, parseFloat($("mRisk").value) || 3),
    setups: $("mSetup").value,          // both | A | B
    cOn: $("mC").checked,
    rsLine: $("mRsLine").checked,
  };
}

function analyseManas(c, niftyMap, cfg) {
  const n = c.length;
  if (n < 45) return null;                                   // ~2 months of trading is enough (IPOs)
  const C = c.map(x => x.close), H = c.map(x => x.high), L = c.map(x => x.low), V = c.map(x => x.volume);
  const k = n - 1, close = C[k];
  if (close < cfg.minPrice) return null;
  let turn = 0; for (let j = k - 19; j <= k; j++) turn += C[j] * V[j]; turn = turn / 20 / 1e7;
  if (turn < cfg.minTurnover) return null;
  let adr = 0; for (let j = k - 19; j <= k; j++) adr += (H[j] / L[j] - 1) * 100; adr /= 20;
  if (adr < cfg.adrMin) return null;

  // Strong recent mover, still near its highs (setups A / B)
  let mom = 0, minL = Infinity;
  for (let j = Math.max(0, k - 62); j <= k; j++) { minL = Math.min(minL, L[j]); mom = Math.max(mom, (H[j] / minL - 1) * 100); }
  let hiAll = -Infinity; for (let j = Math.max(0, k - 251); j <= k; j++) hiAll = Math.max(hiAll, H[j]);
  const off = (1 - close / hiAll) * 100;
  const e21 = emaSeries(C, 21), e50 = emaSeries(C, Math.min(50, Math.max(10, n - 5)));
  const up21 = e21[k] > e21[k - 5];
  const leader = mom >= cfg.mom && off <= cfg.near && e21[k] > e50[k] && up21;
  if (!leader && !(cfg.cOn && cfg.setups === "both")) return null;

  // RS line (stock ÷ Nifty), like the lower panel on his entry charts: near its 3-month high = leading
  let rsLineHigh = null;
  if (niftyMap && niftyMap.size) {
    const ratio = [];
    let lastN = null;
    for (let j = Math.max(0, k - 62); j <= k; j++) {
      const nv = niftyMap.get(ymd(c[j].date)) || lastN;
      if (nv) { lastN = nv; ratio.push(C[j] / nv); }
    }
    if (ratio.length > 20) rsLineHigh = ratio[ratio.length - 1] >= Math.max(...ratio) * 0.98;
  }
  if (cfg.rsLine && rsLineHigh === false && leader) {
    // leaders must have a leading RS line; setup C (reversals) is exempt
    if (!(cfg.cOn && cfg.setups === "both")) return null;
  }
  const v50 = smaAt(V, k, Math.min(50, n - 1)), v5 = smaAt(V, k, 5);
  const rng = m => { let h = -Infinity, l = Infinity; for (let j = k - m + 1; j <= k; j++) { h = Math.max(h, H[j]); l = Math.min(l, L[j]); } return { h, l, pct: (h - l) / close * 100 }; };
  const r10 = rng(10), r20 = rng(20), r5 = rng(5);

  let setup = null;
  // A. Base breakout: tight 10-day base just under the 20-day high, quiet volume, above the 21 EMA
  const leadOk = leader && !(cfg.rsLine && rsLineHigh === false);
  if (leadOk && cfg.setups !== "B" && r10.pct <= cfg.baseMax && close >= r20.h * 0.95 && close > e21[k] && v5 < v50) setup = "A";
  // B. Pullback to a rising 21 EMA: dipped 6%+ from the 10-day high, low touched the EMA zone
  //    in the last 3 days, close back above the EMA, volume drying up
  if (leadOk && !setup && cfg.setups !== "A") {
    // pullback low in the last 5 days, within 3% of the 21 EMA, now turning up off it
    const low5 = Math.min(L[k], L[k - 1], L[k - 2], L[k - 3], L[k - 4]);
    const pull = (1 - low5 / r10.h) * 100;
    const touched = low5 <= e21[k] * 1.03;
    const turning = close > Math.min(C[k - 1], C[k - 2]);
    if (pull >= 6 && pull <= 20 && touched && turning && close > e21[k] && close <= e21[k] * 1.06 && v5 < v50 * 1.05) setup = "B";
  }
  if (!setup && cfg.setups === "both" && cfg.cOn) {
    // C. Confirmation reversal: fell 20%+ from a recent high within ~3 weeks, then a big up day
    //    (8%+) on heavy volume closing near the high. Breaks the momentum rules above on purpose.
    let h15 = -Infinity; for (let j = k - 15; j < k; j++) h15 = Math.max(h15, H[j]);
    let l5 = Infinity; for (let j = k - 5; j < k; j++) l5 = Math.min(l5, L[j]);
    const fell = (1 - l5 / h15) * 100;
    const dayUp = (C[k] / C[k - 1] - 1) * 100;
    const pos = H[k] > L[k] ? (C[k] - L[k]) / (H[k] - L[k]) : 1;
    if (fell >= 20 && dayUp >= 8 && V[k] >= 2 * v50 && pos >= 0.6) setup = "C";
  }
  if (!setup) return null;

  // Plan like his posts: buy above today's high, stop at the low of the day or 2%
  const trigger = H[k] * 1.001;
  const lodRisk = (trigger - L[k]) / trigger * 100;
  const sl = lodRisk <= cfg.maxRisk ? L[k] : trigger * 0.98;
  const stopType = lodRisk <= cfg.maxRisk ? "LOD" : "2%";
  const risk = (trigger - sl) / trigger * 100;
  const ib = H[k] < H[k - 1] && L[k] > L[k - 1];
  let rs = null;
  if (niftyMap && niftyMap.size && k >= 63) {
    const n0 = niftyMap.get(ymd(c[k - 63].date)), n1 = niftyMap.get(ymd(c[k].date));
    if (n0 && n1) rs = ((C[k] / C[k - 63]) - (n1 / n0)) * 100;
  }
  const young = n < 200;
  const tags = [setup === "A" ? "A: Base breakout" : setup === "B" ? "B: 21 EMA pullback" : "C: Reversal confirmation", `Mom ${mom.toFixed(0)}%`, `${off.toFixed(1)}% off high`];
  if (setup === "A") tags.push(`10d base ${r10.pct.toFixed(1)}%`);
  if (rs !== null) tags.push(`RS ${rs >= 0 ? "+" : ""}${rs.toFixed(0)}`);
  if (rsLineHigh) tags.push("RS line \u2191");
  if (ib) tags.push("IB");
  if (young) tags.push("New listing");
  return {
    mode: "manas", setup, close, date: ymd(c[k].date), trigger, sl, stopType, risk: Math.round(risk * 10) / 10,
    dist: Math.round((trigger - close) / trigger * 1000) / 10, mom: Math.round(mom), off: Math.round(off * 10) / 10,
    base: Math.round(r10.pct * 10) / 10, adr: Math.round(adr * 10) / 10, turn: Math.round(turn * 10) / 10,
    rs: rs === null ? null : Math.round(rs * 10) / 10, rsLineHigh, ib, young, volDry: Math.round(v5 / v50 * 100) / 100,
    ema21: e21[k], tags,
  };
}

/* ───────── Learned scan: measure real example trades, then find stocks that look the same ─────────
 * For each example (symbol, entry date, entry price) the app loads the chart and measures the
 * setup on the day BEFORE the entry: run-up, RS vs Nifty, distance from highs and the 21 EMA,
 * tightness, ADR, volume dry-up, liquidity. The middle 80% of each measurement (10th–90th
 * percentile) becomes a rule. Today's stocks are scored by how many rules they match, and the
 * example they most resemble is shown. */
const MANAS_EXAMPLES = `ICIL,2026-09-30,453.45
JGCHEM,2026-09-29,639.49
CONFIPET,2026-09-23,90.8
ICIL,2026-09-23,460.99
BLUESTONE,2026-09-22,878.41
EMMVEE,2026-09-10,336.23
MIDHANI,2026-09-08,429.30
GAJA,2026-08-31,152.5
TATATECH,2026-08-31,826.89
ICIL,2026-08-28,430
INOXINDIA,2026-08-27,1989.09
GENUSPOWER,2026-08-26,343.11
BLUEJET,2026-08-24,609.41
RATEGAIN,2026-08-21,955
MEESHO,2026-08-20,198.13
SUVEN,2026-08-20,343.24
DATAPATTNS,2026-08-18,4652.87
GENUSPOWER,2026-07-27,320.45
EIEL,2026-07-20,224.41
SKIPPER,2026-07-16,549.97
GENUSPOWER,2026-07-16,323.93
RAIN,2026-07-06,192.66
EXICOM,2026-07-03,176.48
STALLION,2026-07-03,191.15
AGIIL,2026-07-01,371.94
SKYGOLD,2026-06-30,510.59
CONFIPET,2026-06-30,72.42
ATHERENERG,2026-06-29,1023.84
DIACABS,2026-06-25,208.82
CONFIPET,2026-06-24,71.83
GENUSPOWER,2026-06-23,331.58
SERVOTECH,2026-05-29,95.58
ATHERENERG,2026-05-29,983.78
PREMIERENE,2026-05-27,1039.08
PAISALO,2026-05-27,50.53
GREAVESCOT,2026-05-26,177.25
WALCHANNAG,2026-05-26,255.74
OLAELEC,2026-05-25,37.54
JINDALSAW,2026-05-19,222.46
RAYMONDREL,2026-05-18,554.8
ADANIENSOL,2026-05-11,1325.58
JTLIND,2026-06-09,71.31
GOLDIAM,2026-06-09,429.95
EXICOM,2026-06-08,134.35
HINDOILEXP,2026-06-05,170.05
MIDHANI,2026-06-04,435
HSCL,2026-06-01,599.40
AEQUS,2026-06-15,188.72
# adds on strength (also entries)
OLAELEC,2026-05-26,38.35
OLAELEC,2026-05-27,38.46
OLAELEC,2026-06-23,42.90
SCI,2026-06-24,327.49
MEESHO,2026-09-04,213.31
SHIPROCKET,2026-08-31,137.87
RATEGAIN,2026-08-24,999.81
SKIPPER,2026-08-24,565
DATAPATTNS,2026-08-20,4810
SKYGOLD,2026-06-30,519.9
CONFIPET,2026-06-30,72.90`;

const LFEAT = {
  mom:      { label: "3-month run-up", unit: "%" },
  rs:       { label: "RS vs Nifty (3M)", unit: " pts" },
  off52:    { label: "Below 52-week high", unit: "%" },
  aboveE21: { label: "Above 21 EMA", unit: "%" },
  e21slope: { label: "21 EMA slope (5 days)", unit: "%" },
  tight5:   { label: "Last 5 days range", unit: "%" },
  tight10:  { label: "Last 10 days range", unit: "%" },
  adr:      { label: "ADR (20 days)", unit: "%" },
  volDay:   { label: "Volume vs 50-day avg (day before)", unit: "\u00D7" },
  vol10:    { label: "10-day / 50-day volume", unit: "\u00D7" },
  turn:     { label: "20-day turnover", unit: " Cr", minOnly: true },
};
const ENTRY_FEAT = {
  vsPrevHigh: { label: "Entry vs previous day high", unit: "%" },
  vsHigh10:   { label: "Entry vs 10-day high", unit: "%" },
  gap:        { label: "Opening gap on entry day", unit: "%" },
  rvol:       { label: "Entry-day volume vs 50-day avg", unit: "\u00D7" },
};

// Setup measurements at bar k (the day before an entry, or today when scanning)
function setupFeatures(c, k, niftyMap) {
  if (k < 70) return null;
  const C = c.map(x => x.close), H = c.map(x => x.high), L = c.map(x => x.low), V = c.map(x => x.volume);
  const e21 = emaSeries(C.slice(0, k + 1), 21);
  let turn = 0; for (let j = k - 19; j <= k; j++) turn += C[j] * V[j]; turn = turn / 20 / 1e7;
  let adr = 0; for (let j = k - 19; j <= k; j++) adr += (H[j] / L[j] - 1) * 100; adr /= 20;
  const rangeOf = m => { let h = -Infinity, l = Infinity; for (let j = k - m + 1; j <= k; j++) { h = Math.max(h, H[j]); l = Math.min(l, L[j]); } return (h - l) / C[k] * 100; };
  let mom = 0, minL = Infinity;
  for (let j = Math.max(0, k - 62); j <= k; j++) { minL = Math.min(minL, L[j]); mom = Math.max(mom, (H[j] / minL - 1) * 100); }
  let hi52 = -Infinity; for (let j = Math.max(0, k - 251); j <= k; j++) hi52 = Math.max(hi52, H[j]);
  const v50 = smaAt(V, k, 50), v10 = smaAt(V, k, 10);
  let rs = null;
  if (niftyMap && niftyMap.size && k >= 63) {
    const n0 = niftyMap.get(ymd(c[k - 63].date)), n1 = niftyMap.get(ymd(c[k].date));
    if (n0 && n1) rs = ((C[k] / C[k - 63]) - (n1 / n0)) * 100;
  }
  return {
    mom, rs, off52: (1 - C[k] / hi52) * 100, aboveE21: (C[k] / e21[k] - 1) * 100,
    e21slope: (e21[k] / e21[k - 5] - 1) * 100, tight5: rangeOf(5), tight10: rangeOf(10), adr,
    volDay: v50 > 0 ? V[k] / v50 : 1, vol10: v50 > 0 ? v10 / v50 : 1, turn,
    ib: H[k] < H[k - 1] && L[k] > L[k - 1],
  };
}

function pctile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p, a = Math.floor(i), b = Math.ceil(i);
  return sorted[a] + (sorted[b] - sorted[a]) * (i - a);
}

let learned = null;
try { learned = JSON.parse(localStorage.getItem("gc:learned") || "null"); } catch {}

function parseExamples(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => {
    const [sym, date, entry] = l.split(/[,\s]+/);
    return { symbol: normSym(sym), date: (date || "").trim(), entry: parseFloat(entry) || null };
  }).filter(e => e.symbol && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
}
function normSym(s) { return String(s || "").trim().toUpperCase().replace(/^#/, "").replace(/^NSE:/, "").replace(/\.NS$/, ""); }

async function learnFromExamples() {
  const ex = parseExamples($("lExamples").value);
  if (ex.length < 5) { alert("Add at least 5 examples (one per line: SYMBOL,YYYY-MM-DD,entry price)."); return; }
  try { localStorage.setItem("gc:learnText", $("lExamples").value); } catch {}
  $("lLearn").disabled = true;
  $("lStatus").textContent = "Loading Nifty\u2026";
  const nifty = await fetchNiftyMap();
  const measured = [], skipped = [], mismatched = [];
  const cache = {};
  let done = 0;
  for (const e of ex) {
    $("lStatus").textContent = `Measuring ${++done} / ${ex.length}: ${e.symbol} on ${fmtD(e.date)}\u2026`;
    if (!cache[e.symbol]) cache[e.symbol] = await fetchDaily2y(e.symbol);
    const c = cache[e.symbol];
    const d = c.findIndex(x => ymd(x.date) >= e.date);
    if (!c.length) { skipped.push(`${e.symbol} (no data)`); continue; }
    if (d < 71) { skipped.push(`${e.symbol} ${e.date} (date not in data)`); continue; }
    const f = setupFeatures(c, d - 1, nifty);
    if (!f) { skipped.push(`${e.symbol} (too little history)`); continue; }
    const k = d - 1, H = c.map(x => x.high), V = c.map(x => x.volume);
    // the posted entry price must sit inside that day's range, otherwise the date / symbol is off
    const priceOk = e.entry && e.entry >= c[d].low * 0.97 && e.entry <= c[d].high * 1.03;
    if (e.entry && !priceOk) mismatched.push(`${e.symbol} ${fmtD(e.date)}`);
    let h10 = -Infinity; for (let j = k - 9; j <= k; j++) h10 = Math.max(h10, H[j]);
    const v50 = smaAt(V, k, 50);
    const ent = {
      vsPrevHigh: priceOk ? (e.entry / H[k] - 1) * 100 : NaN, vsHigh10: priceOk ? (e.entry / h10 - 1) * 100 : NaN,
      gap: (c[d].open / c[k].close - 1) * 100, rvol: v50 > 0 ? V[d] / v50 : 1,
    };
    measured.push({ ...e, f, ent });
  }
  if (measured.length < 5) {
    $("lStatus").textContent = `Only ${measured.length} examples could be measured. ${skipped.join(", ")}`;
    $("lLearn").disabled = false;
    return;
  }
  const rules = {}, entryProf = {};
  for (const key of Object.keys(LFEAT)) {
    const vals = measured.map(m => m.f[key]).filter(v => v !== null && isFinite(v)).sort((a, b) => a - b);
    if (vals.length < 5) continue;
    rules[key] = { lo: pctile(vals, 0.1), hi: pctile(vals, 0.9), med: pctile(vals, 0.5), n: vals.length };
  }
  for (const key of Object.keys(ENTRY_FEAT)) {
    const vals = measured.map(m => m.ent[key]).filter(v => isFinite(v)).sort((a, b) => a - b);
    if (vals.length >= 5) entryProf[key] = { lo: pctile(vals, 0.1), hi: pctile(vals, 0.9), med: pctile(vals, 0.5), n: vals.length };
  }
  const ibShare = measured.filter(m => m.f.ib).length / measured.length;
  learned = { at: Date.now(), n: measured.length, total: ex.length, skipped, mismatched, rules, entryProf, ibShare,
    examples: measured.map(m => ({ symbol: m.symbol, date: m.date, f: m.f })) };
  try { localStorage.setItem("gc:learned", JSON.stringify(learned)); } catch {}
  $("lLearn").disabled = false;
  renderLearned();
  vcpUniverseLabels();
}

function fmtF(v, unit) { return `${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}${unit}`; }
function renderLearned() {
  const box = $("lProfile");
  box.innerHTML = "";
  if (!learned) { $("lStatus").textContent = "Not learned yet. Tap \u201CLearn from these trades\u201D."; return; }
  $("lStatus").textContent = `Learned from ${learned.n} of ${learned.total} trades (${new Date(learned.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })})${learned.skipped.length ? `. Skipped: ${learned.skipped.join(", ")}` : ""}${learned.mismatched && learned.mismatched.length ? `. Entry price didn\u2019t match the chart (entry-day stats ignored): ${learned.mismatched.join(", ")}` : ""}.`;
  const tbl = document.createElement("table");
  tbl.className = "ltable";
  tbl.innerHTML = "<thead><tr><th>Day before entry</th><th>Typical</th><th>Range (middle 80%)</th></tr></thead><tbody></tbody>";
  const tb = tbl.querySelector("tbody");
  const addRow = (lab, med, lo, hi, unit, minOnly) => {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td></td><td></td><td></td>";
    tr.children[0].textContent = lab;
    tr.children[1].textContent = fmtF(med, unit);
    tr.children[2].textContent = minOnly ? `\u2265 ${fmtF(lo, unit)}` : `${fmtF(lo, unit)} to ${fmtF(hi, unit)}`;
    tb.appendChild(tr);
  };
  for (const [k, r] of Object.entries(learned.rules)) addRow(LFEAT[k].label, r.med, r.lo, r.hi, LFEAT[k].unit, LFEAT[k].minOnly);
  const tr = document.createElement("tr"); tr.className = "lsep"; tr.innerHTML = "<td colspan=3>On the entry day</td>"; tb.appendChild(tr);
  for (const [k, r] of Object.entries(learned.entryProf)) addRow(ENTRY_FEAT[k].label, r.med, r.lo, r.hi, ENTRY_FEAT[k].unit);
  const tr2 = document.createElement("tr"); tr2.innerHTML = `<td>Inside bar the day before</td><td>${Math.round(learned.ibShare * 100)}% of trades</td><td></td>`; tb.appendChild(tr2);
  box.appendChild(tbl);
}

function analyseLearned(c, niftyMap, cfg) {
  if (!learned) return null;
  const k = c.length - 1;
  const f = setupFeatures(c, k, niftyMap);
  if (!f) return null;
  const C = c.map(x => x.close), H = c.map(x => x.high), L = c.map(x => x.low);
  if (C[k] < cfg.minPrice) return null;
  const keys = Object.keys(learned.rules);
  let pass = 0, total = 0;
  const misses = [];
  for (const key of keys) {
    const r = learned.rules[key], v = f[key];
    if (v === null || !isFinite(v)) continue;
    const w = (r.hi - r.lo) * cfg.widen / 100;
    total++;
    const ok = LFEAT[key].minOnly ? v >= r.lo - w : v >= r.lo - w && v <= r.hi + w;
    if (ok) pass++; else misses.push(LFEAT[key].label);
  }
  if (!total) return null;
  const sim = Math.round(pass / total * 100);
  if (sim < cfg.minSim) return null;
  // nearest example (scaled distance over the learned ranges)
  let best = null, bestD = Infinity;
  for (const ex of learned.examples) {
    let d = 0, m = 0;
    for (const key of keys) {
      const r = learned.rules[key], a = f[key], b = ex.f[key];
      if (a === null || b === null || !isFinite(a) || !isFinite(b)) continue;
      const span = Math.max(1e-6, r.hi - r.lo);
      d += ((a - b) / span) ** 2; m++;
    }
    if (m && d / m < bestD) { bestD = d / m; best = ex; }
  }
  // trigger like his entries: the typical distance above the previous day's high
  const lift = Math.min(3, Math.max(0, learned.entryProf.vsPrevHigh ? learned.entryProf.vsPrevHigh.med : 0.2));
  const trigger = H[k] * (1 + lift / 100);
  const slLod = trigger * 0.98;
  return {
    mode: "learned", close: C[k], date: ymd(c[k].date), sim, misses, like: best ? `${best.symbol} ${fmtD(best.date)}` : null,
    trigger, sl: slLod, risk: 2, todayLow: L[k], f, ib: f.ib,
    dist: Math.round((trigger - C[k]) / trigger * 1000) / 10,
  };
}

/* ───────── Purple dot settings ───────── */
["pdOn", "pdDay", "pdWeek", "pdRvol", "pdMinVol"].forEach(id => {
  $(id).addEventListener("change", () => { saveSettings(); $("pdOpts").hidden = !$("pdOn").checked; });
});
$("pdOpts").hidden = !$("pdOn").checked;

/* ───────── By first letter ───────── */
(function buildLetterGrid() {
  const counts = {};
  NSE_SYMBOLS.forEach(([s]) => { const k = letterKey(s); counts[k] = (counts[k] || 0) + 1; });
  const keys = ["#"].concat("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")).filter(k => counts[k]);
  for (const k of keys) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.k = k; b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", `${k === "#" ? "Numbers" : k}, ${counts[k]} stocks`);
    b.innerHTML = `${k === "#" ? "0–9" : k}<small>${counts[k]}</small>`;
    b.onclick = () => {
      state.letters.has(k) ? state.letters.delete(k) : state.letters.add(k);
      b.setAttribute("aria-pressed", state.letters.has(k));
      refresh(); saveSettings();
    };
    $("letterGrid").appendChild(b);
  }
})();
function syncLetterButtons() {
  $("letterGrid").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", state.letters.has(b.dataset.k)));
}
$("lAll").onclick = () => { $("letterGrid").querySelectorAll("button").forEach(b => state.letters.add(b.dataset.k)); syncLetterButtons(); refresh(); saveSettings(); };
$("lNone").onclick = () => { state.letters.clear(); syncLetterButtons(); refresh(); saveSettings(); };
$("tabCsv").onclick = () => { state.mode = "csv"; refresh(); saveSettings(); };
$("tabLetters").onclick = () => { state.mode = "letters"; refresh(); saveSettings(); };

$("csvFile").onchange = async () => {
  const f = $("csvFile").files[0];
  if (!f) return;
  const text = await f.text();
  $("csvFile").value = "";
  try { localStorage.setItem("gc:csv", JSON.stringify({ name: f.name, text })); } catch {}
  state.mode = "csv";
  loadCSV(f.name, text);
  saveSettings();
};

/* Remember filter + split settings so a reload restores everything */
function saveSettings() {
  try {
    localStorage.setItem("gc:settings", JSON.stringify({
      useFilter: $("useFilter").checked, from: $("fromDate").value, to: $("toDate").value,
      split: document.querySelector('input[name="split"]:checked').value, splitN: $("splitN").value,
      mode: state.mode, letters: [...state.letters], dBars: $("dBars").value, wBars: $("wBars").value,
      pd: { on: $("pdOn").checked, d: $("pdDay").value, w: $("pdWeek").value, r: $("pdRvol").value, v: $("pdMinVol").value },
    }));
  } catch {}
}
function restore() {
  try {
    const c = JSON.parse(localStorage.getItem("gc:csv") || "null");
    if (c) loadCSV(c.name, c.text);
    const st = JSON.parse(localStorage.getItem("gc:settings") || "null");
    if (st) {
      state.mode = st.mode === "letters" ? "letters" : "csv";
      state.letters = new Set(st.letters || []);
      syncLetterButtons();
      document.querySelector(`input[name="split"][value="${st.split === "split" ? "split" : "single"}"]`).checked = true;
      if (st.splitN) $("splitN").value = st.splitN;
      if (st.dBars) $("dBars").value = st.dBars;
      if (st.wBars) $("wBars").value = st.wBars;
      if (st.pd) { $("pdOn").checked = !!st.pd.on; if (st.pd.d) $("pdDay").value = st.pd.d; if (st.pd.w) $("pdWeek").value = st.pd.w; if (st.pd.r) $("pdRvol").value = st.pd.r; if (st.pd.v) $("pdMinVol").value = st.pd.v; }
      barHints();
    }
    if (c && st) {
      $("useFilter").checked = !!st.useFilter;
      $("dateRow").hidden = !st.useFilter;
      if (st.from) $("fromDate").value = st.from;
      if (st.to) $("toDate").value = st.to;
      document.querySelector(`input[name="split"][value="${st.split === "split" ? "split" : "single"}"]`).checked = true;
      if (st.splitN) $("splitN").value = st.splitN;
      refresh();
    }
  } catch {}
}
document.querySelectorAll('input[name="split"]').forEach(r => (r.onchange = saveSettings));
$("splitN").onchange = saveSettings;
$("useFilter").onchange = () => { $("dateRow").hidden = !$("useFilter").checked; refresh(); saveSettings(); };
$("fromDate").onchange = $("toDate").onchange = () => { refresh(); saveSettings(); };

/* ───────── Data (port of fetchCandles) ───────── */
/* Chart length chosen in Step 3 (candles shown) */
function clampInt(v, lo, hi, def) { const n = parseInt(v, 10); return isNaN(n) ? def : Math.min(hi, Math.max(lo, n)); }
function dailyBars() { return clampInt($("dBars").value, 20, 750, 120); }
function weeklyBars() { return clampInt($("wBars").value, 20, 520, 120); }

/* Yahoo range big enough for the candles shown + 20 extra so SMA 20 starts at the left edge */
function rangeFor(interval, bars) {
  const need = bars + 20;
  if (interval === "W") {
    const years = need / 52;
    return years <= 1 ? "1y" : years <= 2 ? "2y" : years <= 5 ? "5y" : years <= 10 ? "10y" : "max";
  }
  const cal = need * 1.5;                       // trading days → calendar days
  return cal <= 90 ? "3mo" : cal <= 180 ? "6mo" : cal <= 365 ? "1y" : cal <= 730 ? "2y" : "5y";
}

/* One fetcher for all data: retries with back-off, because Yahoo briefly limits the
 * Worker after many requests (e.g. right after a big scan). Remembers the last error. */
const lastFetchError = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchOHLC(symbol, range, interval, tries = 3) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`${OHLC_API_BASE}?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`, { cache: "no-store", signal: ctrl.signal });
      clearTimeout(t);
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.candles) && j.candles.length) {
        delete lastFetchError[symbol];
        return j.candles
          .filter(c => c && c.close > 0 && c.high > 0 && c.low > 0)
          .map(c => {
            const d = new Date((c.time + 19800) * 1000);
            return { date: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), open: c.open || c.close, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
          });
      }
      lastFetchError[symbol] = (j && j.error) || `HTTP ${res.status}`;
      // "no data" for a real symbol isn't worth retrying; throttling / server errors are
      if (res.status === 404 || /not found|no data/i.test(lastFetchError[symbol]) && res.status < 500) break;
    } catch (e) {
      lastFetchError[symbol] = e.name === "AbortError" ? "timeout" : "network error";
    }
    if (attempt < tries - 1) await sleep(1200 * (attempt + 1) + Math.random() * 600);
  }
  return [];
}

async function fetchCandles(symbol, interval) {
  const range = rangeFor(interval, interval === "W" ? weeklyBars() : dailyBars());
  return fetchOHLC(symbol, range, interval === "W" ? "1wk" : "1d");
}

function sma(candles, period) {
  const out = {};
  for (let i = period - 1; i < candles.length; i++) {
    let s = 0;
    for (let k = i - period + 1; k <= i; k++) s += candles[k].close;
    out[i] = s / period;
  }
  return out;
}

/* ───────── Chart (port of drawCandlestickChart) ───────── */
const FONT = "-apple-system, Helvetica, Arial, sans-serif";
const GREEN = "rgb(18,166,71)", RED = "rgb(230,46,46)";
const BLUE_SMA = "rgba(26,102,230,0.9)", ORANGE_SMA = "rgba(242,128,13,0.9)";
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function watermark(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(-Math.PI / 6);
  ctx.font = `bold ${size}px ${FONT}`; ctx.fillStyle = color;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("GANESH CHARTS", 0, 0);
  ctx.restore();
}

/* Purple dots on every chart: bullish candle with a big % move on unusually heavy volume */
function pdSettings() {
  const on = !!($("pdOn") && $("pdOn").checked);
  return {
    on,
    dMove: Math.max(0, parseFloat($("pdDay") && $("pdDay").value) || 5),
    wMove: Math.max(0, parseFloat($("pdWeek") && $("pdWeek").value) || 10),
    rvol: Math.max(1, parseFloat($("pdRvol") && $("pdRvol").value) || 2),
    minVol: Math.max(0, parseFloat($("pdMinVol") && $("pdMinVol").value) || 0) * 1e5,
  };
}
function purpleDotIdx(candles, from, interval, cfg) {
  const out = [];
  const move = interval === "W" ? cfg.wMove : cfg.dMove;
  const minVol = interval === "W" ? cfg.minVol * 5 : cfg.minVol;      // a week ≈ 5 sessions
  const look = interval === "W" ? 20 : 50;                              // average volume window
  let sum = 0, cnt = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i >= from && i > 0 && cnt >= Math.min(look, 10)) {
      const avg = sum / cnt;
      const prev = candles[i - 1].close;
      if (c.close > (c.open || prev) && prev > 0 && (c.close / prev - 1) * 100 >= move && avg > 0 && c.volume >= avg * cfg.rvol && c.volume >= minVol) out.push(i);
    }
    sum += c.volume; cnt++;
    if (cnt > look) { sum -= candles[i - look].volume; cnt--; }
  }
  return out;
}

function drawChart(canvas, symbol, interval, candles, bars, mark) {
  const ctx = canvas.getContext("2d");
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const topPad = 44, bottomPad = 24, leftPad = 12, rightPad = 72, volH = 70, gap = 8, dateH = 18;
  const chartH = CH - topPad - bottomPad - volH - gap - dateH;
  const chartW = CW - leftPad - rightPad;
  const start = Math.max(0, candles.length - bars);
  const dc = candles.slice(start);
  const s10All = sma(candles, 10), s20All = sma(candles, 20);

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, CW, CH);
  watermark(ctx, CW / 2, CH / 2, 38, "rgba(191,217,255,0.35)");

  if (!dc.length) {
    ctx.font = `bold 18px ${FONT}`; ctx.fillStyle = "gray";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`No data for ${symbol}`, CW / 2, CH / 2);
    return false;
  }

  // SMAs use the extra history, then are shifted to the visible candles
  const s10 = {}, s20 = {};
  dc.forEach((_, i) => { if (s10All[start + i] !== undefined) s10[i] = s10All[start + i]; if (s20All[start + i] !== undefined) s20[i] = s20All[start + i]; });
  const all = dc.flatMap(c => [c.high, c.low]).concat(Object.values(s10), Object.values(s20));
  const maxP = Math.max(...all), minP = Math.min(...all);
  const range = maxP - minP === 0 ? 1 : maxP - minP;
  const maxVol = Math.max(...dc.map(c => c.volume)) || 1;
  const volTop = topPad + chartH + gap;
  const sp = chartW / dc.length, cw = Math.max(1.5, sp * 0.65);
  const X = i => leftPad + i * sp + sp / 2;
  const Y = p => topPad + ((maxP - p) / range) * chartH;

  // Grid + price labels
  ctx.strokeStyle = "rgb(224,224,224)"; ctx.lineWidth = 0.5; ctx.setLineDash([4, 3]);
  ctx.font = `9px ${FONT}`; ctx.fillStyle = "rgb(102,102,102)"; ctx.textAlign = "left"; ctx.textBaseline = "top";
  for (let i = 0; i <= 4; i++) {
    const y = topPad + chartH * i / 4;
    ctx.beginPath(); ctx.moveTo(leftPad, y); ctx.lineTo(CW - rightPad, y); ctx.stroke();
    const p = maxP - range * i / 4;
    ctx.fillText(p >= 100 ? p.toFixed(1) : p.toFixed(2), CW - rightPad + 4, y - 6);
  }
  ctx.setLineDash([]);

  // Volume panel background
  ctx.fillStyle = "rgb(247,247,247)"; ctx.fillRect(leftPad, volTop, chartW, volH);

  // Candles + volume
  dc.forEach((c, i) => {
    const up = c.close >= c.open, col = up ? GREEN : RED, x = X(i);
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, Y(c.high)); ctx.lineTo(x, Y(c.low)); ctx.stroke();
    const top = Y(Math.max(c.open, c.close)), bot = Y(Math.min(c.open, c.close));
    ctx.fillStyle = col; ctx.fillRect(x - cw / 2, top, cw, Math.max(1.5, bot - top));
    const vh = (c.volume / maxVol) * (volH - 4);
    ctx.fillStyle = up ? "rgba(18,166,71,0.55)" : "rgba(230,46,46,0.55)";
    ctx.fillRect(x - cw / 2, volTop + volH - vh, cw, vh);
  });

  // SMA lines
  for (const [s, col] of [[s10, BLUE_SMA], [s20, ORANGE_SMA]]) {
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath();
    let started = false;
    dc.forEach((_, i) => {
      if (s[i] === undefined) return;
      started ? ctx.lineTo(X(i), Y(s[i])) : ctx.moveTo(X(i), Y(s[i]));
      started = true;
    });
    ctx.stroke();
  }

  // Purple dots (all qualifying candles)
  const pd = pdSettings();
  let pdCount = 0;
  if (pd.on) {
    ctx.fillStyle = "rgb(147,51,234)";
    for (const gi of purpleDotIdx(candles, start, interval, pd)) {
      const i = gi - start;
      if (i < 0 || i >= dc.length) continue;
      ctx.beginPath();
      ctx.arc(X(i), Math.min(Y(dc[i].low) + Math.max(5, cw), topPad + chartH - 3), Math.max(2.2, Math.min(4, cw * 0.6)), 0, Math.PI * 2);
      ctx.fill();
      pdCount++;
    }
  }

  // Extra level lines (e.g. Entry / SL from the scanner)
  if (mark && Array.isArray(mark.lines)) {
    for (const ln of mark.lines) {
      if (!(ln.price >= minP && ln.price <= maxP)) continue;
      const y = Y(ln.price);
      ctx.save();
      ctx.strokeStyle = ln.color; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(leftPad, y); ctx.lineTo(CW - rightPad, y); ctx.stroke();
      ctx.restore();
      ctx.font = `bold 9px ${FONT}`; ctx.fillStyle = ln.color; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`${ln.label} ${ln.price.toFixed(2)}`, CW - rightPad + 4, y);
    }
  }
  // Purple dot under the breakout candle (relative-volume scan)
  if (mark && mark.dotDate && interval !== "W" && !pd.on) {
    const di = dc.findIndex(x => ymd(x.date) === mark.dotDate);
    if (di >= 0) {
      ctx.fillStyle = "rgb(147,51,234)";
      ctx.beginPath(); ctx.arc(X(di), Math.min(Y(dc[di].low) + 9, topPad + chartH - 4), 4, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Watchlist entry: dashed line at the added price + star on the added candle
  if (mark && mark.price) {
    if (mark.price >= minP && mark.price <= maxP) {
      const y = Y(mark.price);
      ctx.save();
      ctx.strokeStyle = "rgba(124,58,237,0.9)"; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(leftPad, y); ctx.lineTo(CW - rightPad, y); ctx.stroke();
      ctx.restore();
      ctx.font = `bold 9px ${FONT}`; ctx.fillStyle = "rgb(124,58,237)"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`${mark.label || "Added"} ${mark.price.toFixed(2)}`, CW - rightPad + 4, y);
    }
    if (mark.date) {
      // first visible candle on/after the added date (weekly candles cover the whole week)
      let idx = -1;
      for (let i = 0; i < dc.length; i++) {
        const next = dc[i + 1];
        const dk = ymd(dc[i].date), nk = next ? ymd(next.date) : "9999";
        if (interval === "W" ? (mark.date >= dk && mark.date < nk) : dk >= mark.date) { idx = i; break; }
      }
      if (idx >= 0) {
        ctx.font = `bold 14px ${FONT}`; ctx.fillStyle = "rgb(124,58,237)"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText("\u2605", X(idx), Y(dc[idx].high) - 3);
      }
    }
  }

  // Legend (top right, above the plot)
  const lx = CW - rightPad - 120, ly = 6;
  ctx.font = `bold 9px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = "left";
  [["SMA 10", BLUE_SMA, "rgb(26,102,230)", 0], ["SMA 20", ORANGE_SMA, "rgb(242,128,13)", 60]].forEach(([t, line, txt, off]) => {
    ctx.strokeStyle = line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lx + off, ly + 7); ctx.lineTo(lx + off + 16, ly + 7); ctx.stroke();
    ctx.fillStyle = txt; ctx.fillText(t, lx + off + 20, ly + 2);
  });
  if (pd.on) {
    ctx.fillStyle = "rgb(147,51,234)";
    ctx.beginPath(); ctx.arc(lx - 78, ly + 7, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(`Purple dot${pdCount ? ` (${pdCount})` : ""}`, lx - 71, ly + 2);
  }

  // Title + last close
  ctx.font = `bold 13px ${FONT}`; ctx.fillStyle = "rgb(26,77,179)";
  ctx.fillText(`NSE:${symbol}  \u2014  ${interval === "W" ? "Weekly" : "Daily"}`, leftPad + 2, 9);
  const last = dc.at(-1);
  ctx.font = `bold 11px ${FONT}`;
  ctx.fillStyle = last.close >= last.open ? "rgb(18,140,51)" : "rgb(217,26,26)";
  ctx.fillText(`\u20B9${last.close.toFixed(2)}`, leftPad + 2, 27);

  // VOL label + date labels
  ctx.font = `8px ${FONT}`; ctx.fillStyle = "rgb(115,115,115)";
  ctx.fillText("VOL", CW - rightPad + 4, volTop + 3);
  const dateY = volTop + volH + 5;
  const shortSpan = (dc.at(-1).date - dc[0].date) / 864e5 < 200;
  for (let step = 0; step < 5; step++) {
    const idx = Math.floor(step * (dc.length - 1) / 4);
    const d = dc[idx].date;
    // Short charts show day + month so labels don't repeat; long charts show month + year
    ctx.fillText(shortSpan ? `${d.getDate()} ${MON[d.getMonth()]}` : `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, X(idx) - 14, dateY);
  }

  // Border
  ctx.strokeStyle = "rgb(191,191,191)"; ctx.lineWidth = 0.5;
  ctx.strokeRect(leftPad, topPad, chartW, chartH);
  return true;
}

/* ───────── PDF (port of buildPDF) ───────── */
const PW = 842, PH = 1190, M = 24, HDR = 52, FTR = 28;
const CHART_PDF_H = (PH - M * 2 - HDR - FTR - 8) / 2;

function pdfPage(doc, stock, dailyImg, weeklyImg, dN, wN) {
  doc.setFillColor(20, 51, 140); doc.rect(0, 0, PW, HDR, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(26); doc.setTextColor(255, 255, 255);
  doc.text(`NSE: ${stock}`, M, 12, { baseline: "top" });

  // Section labels + charts
  const label = (txt, y) => {
    doc.setFillColor(26, 77, 179); doc.rect(M, y + 1, 3, 11, "F");
    doc.setFontSize(11); doc.setTextColor(26, 77, 179);
    doc.text(txt, M + 7, y + 1, { baseline: "top" });
  };
  const dY = M + HDR;
  label(`DAILY CHART  \u00B7  ${dN} days`, dY);
  doc.addImage(dailyImg, "JPEG", M, dY + 16, PW - M * 2, CHART_PDF_H);
  const wY = dY + 16 + CHART_PDF_H + 8;
  label(`WEEKLY CHART  \u00B7  ${wN} weeks`, wY);
  doc.addImage(weeklyImg, "JPEG", M, wY + 16, PW - M * 2, CHART_PDF_H);

  // Page watermark (over the charts, very faint — same order as the Swift app's visual result)
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.18 }));
  doc.setFontSize(54); doc.setTextColor(179, 209, 255);
  const w = doc.getTextWidth("GANESH CHARTS"), a = Math.PI / 6;
  doc.text("GANESH CHARTS", PW / 2 - (w / 2) * Math.cos(a), PH / 2 + (w / 2) * Math.sin(a), { angle: 30, baseline: "middle" });
  doc.restoreGraphicsState();

  // Footer + border
  doc.setFillColor(242, 242, 242); doc.rect(0, PH - FTR, PW, FTR, "F");
  doc.setFontSize(10); doc.setTextColor(26, 77, 179);
  doc.text("GANESH CHARTS  \u2022  Data: Yahoo Finance  \u2022  SMA 10 | SMA 20", M, PH - FTR + 9, { baseline: "top" });
  doc.setDrawColor(204, 204, 204); doc.setLineWidth(0.5); doc.rect(1, 1, PW - 2, PH - 2);
}

/* ───────── Watchlists (several named lists; stocks picked while studying the PDF) ───────── */
const WLKEY = "gc:watchlists";
const livePrice = {};   // symbol -> { close, date } fetched this session
const priceHist = {};   // symbol -> daily candles (1 year) for position management
let WL = null;          // { lists: [{ id, name, items: [...] }], active }

(function loadWatchlists() {
  try { WL = JSON.parse(localStorage.getItem(WLKEY) || "null"); } catch { WL = null; }
  if (!WL || !Array.isArray(WL.lists) || !WL.lists.length) {
    let old = [];
    try { old = JSON.parse(localStorage.getItem("gc:watch") || "[]"); } catch {}
    WL = { lists: [{ id: "w1", name: "Watchlist 1", items: old }], active: "w1" };
    try { localStorage.setItem(WLKEY, JSON.stringify(WL)); } catch {}
  }
  if (!WL.lists.some(l => l.id === WL.active)) WL.active = WL.lists[0].id;
})();

const newId = () => "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const activeList = () => WL.lists.find(l => l.id === WL.active) || WL.lists[0];
const listById = id => WL.lists.find(l => l.id === id);
const listsWith = sym => WL.lists.filter(l => l.items.some(i => i.symbol === sym));
const allSymbols = () => [...new Set(WL.lists.flatMap(l => l.items.map(i => i.symbol)))];

function wlSave() { try { localStorage.setItem(WLKEY, JSON.stringify(WL)); } catch {} renderWatch(); }
function watchHas(sym) { return listsWith(sym).length > 0; }
function addToList(list, item) {
  if (list.items.some(i => i.symbol === item.symbol)) return false;
  list.items.unshift({ ...item });
  return true;
}
function removeFromList(list, sym) { list.items = list.items.filter(i => i.symbol !== sym); }
function createList(name) {
  const n = (name || "").trim() || `Watchlist ${WL.lists.length + 1}`;
  const l = { id: newId(), name: n, items: [] };
  WL.lists.push(l);
  return l;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2000);
}

function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);
}
function fmtD(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${+d} ${MON[+m - 1]} ${y.slice(2)}`;
}

/* ── Position management, modelled on Manas Arora's follow-up posts ──
 *  • Stop hit: low went below the stop (LOD / 2% from entry).
 *  • Out at cost: it ran 5%+ but came back to the entry ("Touched 684, stopped out at cost").
 *  • Sell some: 10%+ up or a new 52-week high ("Sold some #INOXINDIA at 2251.90, holding the rest").
 *  • Stop to cost: 5%+ up, so the stop moves to the entry price.
 *  • Add on strength: closing at a new high since entry, 3%+ up ("2nd entry … Added more").
 *  These are guides from his public posts, not his exact private rules. */
function manageInfo(w) {
  const c = priceHist[w.symbol];
  const entry = w.entry || w.price;
  if (!c || !c.length || !entry) return null;
  const stop = w.sl && w.sl < entry ? w.sl : entry * 0.98;
  const risk = entry - stop;                                  // 1R
  const from = w.priceDate || w.addedOn;
  const since = c.filter(x => ymd(x.date) > from);
  if (!since.length) return { code: "new", label: "New position", cls: "mnew", entry, stop, r: 0, rMax: 0 };
  const last = since[since.length - 1];
  const r = (last.close - entry) / risk;
  const rMax = (Math.max(...since.map(x => x.high)) - entry) / risk;
  let hi52 = -Infinity; for (const x of c.slice(-252)) hi52 = Math.max(hi52, x.high);
  const newHigh = last.high >= hi52 * 0.999;
  const atHighSince = last.close >= Math.max(...since.map(x => x.close)) - 1e-9;
  const base = { entry, stop, r, rMax };
  // Modelled on AEQUS: "Closed some at 202 (~3R), now holding the rest with breakeven stop",
  // "Sold some" at a new high, then "holding approx. 50% size … 20R".
  const hitStopIdx = since.findIndex(x => x.low <= stop);
  const firstIdx = since.findIndex(x => (x.high - entry) / risk >= 3);        // first partial + stop to cost
  const ranIdx = since.findIndex(x => (x.high - entry) / risk >= 2);
  if (hitStopIdx >= 0 && (ranIdx < 0 || hitStopIdx <= ranIdx)) return { ...base, code: "stop", label: "Stop hit \u00B7 \u22121R", cls: "mstop" };
  if (firstIdx >= 0 && since.slice(firstIdx + 1).some(x => x.low <= entry)) return { ...base, code: "cost", label: "Partial booked \u00B7 rest out at cost", cls: "mtrail" };
  if (ranIdx >= 0 && firstIdx < 0 && since.slice(ranIdx + 1).some(x => x.low <= entry)) return { ...base, code: "cost", label: "Out at cost", cls: "mstop" };
  if (rMax >= 8 || (firstIdx >= 0 && newHigh && r >= 5)) return { ...base, code: "partial", label: `${r.toFixed(1)}R \u00B7 sell more, hold ~50% runner`, cls: "mpart" };
  if (rMax >= 3) return { ...base, code: "trail", label: `${r.toFixed(1)}R \u00B7 sell some, stop to cost`, cls: "mpart" };
  if (atHighSince && r >= 1) return { ...base, code: "add", label: `${r.toFixed(1)}R \u00B7 add on strength`, cls: "madd" };
  return { ...base, code: "hold", label: `${r >= 0 ? "+" : ""}${r.toFixed(1)}R \u00B7 holding`, cls: "mhold" };
}

/* ── List picker sheet: used by ☆ in the PDF viewer and by Move / Copy ── */
let pickCfg = null;
function openPicker(cfg) {
  pickCfg = cfg;
  $("pickTitle").textContent = cfg.title;
  $("pickNew").value = "";
  renderPicker();
  $("pick").hidden = false;
}
function closePicker() { $("pick").hidden = true; pickCfg = null; updateStar(); renderWatch(); }
function renderPicker() {
  const box = $("pickList");
  box.innerHTML = "";
  const lists = pickCfg.mode === "target" ? WL.lists.filter(l => l.id !== pickCfg.exclude) : WL.lists;
  if (!lists.length) {
    const p = document.createElement("p"); p.className = "small"; p.textContent = "No other lists yet. Create one below.";
    box.appendChild(p);
  }
  for (const l of lists) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pickrow";
    const on = pickCfg.mode === "toggle" && l.items.some(i => i.symbol === pickCfg.item.symbol);
    b.setAttribute("aria-pressed", String(on));
    b.innerHTML = `<span class="tick"></span><span class="pname"></span><span class="pcount"></span>`;
    b.querySelector(".tick").textContent = pickCfg.mode === "toggle" ? (on ? "\u2605" : "\u2606") : "\u2192";
    b.querySelector(".pname").textContent = l.name;
    b.querySelector(".pcount").textContent = l.items.length;
    b.onclick = () => pickChoose(l);
    box.appendChild(b);
  }
}
function pickChoose(l) {
  if (pickCfg.mode === "toggle") {
    const sym = pickCfg.item.symbol;
    if (l.items.some(i => i.symbol === sym)) { removeFromList(l, sym); toast(`Removed ${sym} from ${l.name}`); }
    else { addToList(l, pickCfg.item); toast(`\u2605 ${sym} added to ${l.name}`); refreshPrices([sym]); }
    wlSave(); renderPicker(); updateStar();
  } else {
    pickCfg.onTarget(l);
    closePicker();
  }
}
$("pickCreate").onclick = () => {
  const l = createList($("pickNew").value);
  $("pickNew").value = "";
  wlSave();
  pickChoose(l);
  if (pickCfg) renderPicker();
};
$("pickNew").onkeydown = e => { if (e.key === "Enter") $("pickCreate").click(); };
$("pickDone").onclick = closePicker;
$("pick").onclick = e => { if (e.target === $("pick")) closePicker(); };

/* ── Watchlist card ── */
let watchOrder = [];
const selected = new Set();
let selectMode = false;

function renderTabs() {
  const box = $("wTabs");
  box.innerHTML = "";
  for (const l of WL.lists) {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(l.id === WL.active));
    b.innerHTML = `<span></span><small></small>`;
    b.querySelector("span").textContent = l.name;
    b.querySelector("small").textContent = l.items.length;
    b.onclick = () => { WL.active = l.id; selected.clear(); wlSave(); };
    box.appendChild(b);
  }
  const add = document.createElement("button");
  add.type = "button"; add.className = "addlist"; add.textContent = "+ New list";
  add.onclick = () => {
    const name = prompt("Name for the new watchlist", `Watchlist ${WL.lists.length + 1}`);
    if (name === null) return;
    const l = createList(name); WL.active = l.id; wlSave();
  };
  box.appendChild(add);
}

function renderWatch() {
  const total = WL.lists.reduce((n, l) => n + l.items.length, 0);
  $("watchCard").hidden = false;
  renderTabs();
  const L = activeList();
  for (const s of [...selected]) if (!L.items.some(i => i.symbol === s)) selected.delete(s);
  $("wSelect").textContent = selectMode ? "Done" : "Select";
  $("wSelect").hidden = !L.items.length;
  $("wSelBar").hidden = !selectMode;
  $("wSelCount").textContent = `${selected.size} selected`;
  ["wMove", "wCopy", "wDelSel"].forEach(id => ($(id).disabled = !selected.size));
  $("wEmpty").hidden = L.items.length > 0;

  const sort = $("wSort").value;
  const chg = w => (w.price && livePrice[w.symbol] ? (livePrice[w.symbol].close - w.price) / w.price * 100 : null);
  const list = [...L.items];
  if (sort === "best") list.sort((a, b) => (chg(b) ?? -1e9) - (chg(a) ?? -1e9));
  else if (sort === "worst") list.sort((a, b) => (chg(a) ?? 1e9) - (chg(b) ?? 1e9));
  else if (sort === "az") list.sort((a, b) => a.symbol.localeCompare(b.symbol));
  watchOrder = list.map(w => w.symbol);
  const box = $("watchList");
  box.innerHTML = "";
  for (const w of list) {
    const lp = livePrice[w.symbol], c = chg(w);
    const row = document.createElement("div");
    row.className = "wrow" + (selectMode ? " selecting" : "") + (selected.has(w.symbol) ? " picked" : "");
    row.innerHTML = `
      <span class="wchk" aria-hidden="true"></span>
      <div class="wsym"><b></b><span class="wnote"></span></div>
      <div class="wcol"><small>Added</small><span class="wadd"></span></div>
      <div class="wcol"><small>Now</small><span class="wnow"></span></div>
      <div class="wchg"></div>
      <div class="wact"><button type="button" class="wbtn note" aria-label="Note">Note</button><button type="button" class="wbtn del" aria-label="Remove">\u2715</button></div>`;
    row.querySelector("b").textContent = w.symbol;
    row.querySelector(".wnote").textContent = w.note || "";
    row.querySelector(".wadd").textContent = `${fmtD(w.priceDate || w.addedOn)}${w.price ? ` \u00B7 \u20B9${w.price.toFixed(2)}` : ""}`;
    row.querySelector(".wnow").textContent = lp ? `\u20B9${lp.close.toFixed(2)}` : "\u2026";
    const mi = manageInfo(w);
    if (mi) {
      const bd = document.createElement("span");
      bd.className = `mbadge ${mi.cls}`; bd.textContent = mi.label;
      row.querySelector(".wsym").appendChild(bd);
    }
    const ce = row.querySelector(".wchg");
    if (c !== null) {
      ce.textContent = `${c >= 0 ? "+" : ""}${c.toFixed(2)}%`;
      ce.className = "wchg " + (c >= 0 ? "up" : "down");
      const days = daysBetween(w.priceDate || w.addedOn, lp.date);
      const sub = document.createElement("small");
      sub.textContent = `${days}d`;
      ce.appendChild(sub);
    }
    row.querySelector(".note").onclick = e => {
      e.stopPropagation();
      const v = prompt(`Note for ${w.symbol}`, w.note || "");
      if (v === null) return;
      w.note = v.trim(); wlSave();
    };
    row.querySelector(".del").onclick = e => {
      e.stopPropagation();
      if (!confirm(`Remove ${w.symbol} from ${L.name}?`)) return;
      removeFromList(L, w.symbol); wlSave();
    };
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", selectMode ? `Select ${w.symbol}` : `Open ${w.symbol} chart`);
    if (selectMode) row.setAttribute("aria-pressed", String(selected.has(w.symbol)));
    const act = () => {
      if (selectMode) { selected.has(w.symbol) ? selected.delete(w.symbol) : selected.add(w.symbol); renderWatch(); }
      else openChartWin(w.symbol);
    };
    row.onclick = act;
    row.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } };
    box.appendChild(row);
  }
}

$("wSelect").onclick = () => { selectMode = !selectMode; selected.clear(); renderWatch(); };
$("wSelAll").onclick = () => {
  const L = activeList();
  if (selected.size === L.items.length) selected.clear(); else L.items.forEach(i => selected.add(i.symbol));
  renderWatch();
};
function moveOrCopy(move) {
  const src = activeList();
  const syms = [...selected];
  openPicker({
    title: `${move ? "Move" : "Copy"} ${syms.length} stock${syms.length > 1 ? "s" : ""} to\u2026`,
    mode: "target", exclude: src.id,
    onTarget: dest => {
      let n = 0;
      for (const sym of syms) {
        const item = src.items.find(i => i.symbol === sym);
        if (item && addToList(dest, item)) n++;
        if (move) removeFromList(src, sym);
      }
      selected.clear(); selectMode = false;
      wlSave();
      const skipped = syms.length - n;
      toast(`${move ? "Moved" : "Copied"} ${n} to ${dest.name}${skipped ? ` (${skipped} already there)` : ""}`);
    },
  });
}
$("wMove").onclick = () => moveOrCopy(true);
$("wCopy").onclick = () => moveOrCopy(false);
$("wDelSel").onclick = () => {
  const L = activeList();
  if (!confirm(`Remove ${selected.size} stock${selected.size > 1 ? "s" : ""} from ${L.name}?`)) return;
  selected.forEach(sym => removeFromList(L, sym));
  selected.clear(); selectMode = false; wlSave();
};
$("wRename").onclick = () => {
  const L = activeList();
  const v = prompt("Rename watchlist", L.name);
  if (v === null || !v.trim()) return;
  L.name = v.trim(); wlSave();
};
$("wDelList").onclick = () => {
  const L = activeList();
  if (!confirm(`Delete "${L.name}" and its ${L.items.length} stock${L.items.length === 1 ? "" : "s"}?`)) return;
  WL.lists = WL.lists.filter(l => l.id !== L.id);
  if (!WL.lists.length) WL.lists.push({ id: newId(), name: "Watchlist 1", items: [] });
  WL.active = WL.lists[0].id;
  selectMode = false; selected.clear(); wlSave();
};

/* ── Sync between devices: export / import a backup file ── */
$("wExport").onclick = async () => {
  const data = { app: "ganesh-charts", type: "watchlists", version: 1, exportedAt: new Date().toISOString(), lists: WL.lists };
  const name = `GaneshCharts_watchlists_${ymd(new Date())}.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Ganesh Charts watchlists" }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
$("wImportBtn").onclick = () => $("wImport").click();
$("wImport").onchange = async () => {
  const f = $("wImport").files[0];
  $("wImport").value = "";
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch { alert("That file isn't a Ganesh Charts backup."); return; }
  if (!data || data.app !== "ganesh-charts" || !Array.isArray(data.lists)) { alert("That file isn't a Ganesh Charts watchlist backup."); return; }
  const incoming = data.lists.filter(l => l && l.name && Array.isArray(l.items));
  const nStocks = incoming.reduce((n, l) => n + l.items.length, 0);
  const replace = confirm(
    `Backup from ${data.exportedAt ? new Date(data.exportedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "another device"}: ` +
    `${incoming.length} list${incoming.length === 1 ? "" : "s"}, ${nStocks} stocks.\n\n` +
    `OK = Replace this device's watchlists with the backup\nCancel = Merge (keep both, add what's missing)`);
  if (replace) {
    WL.lists = incoming.map(l => ({ id: newId(), name: String(l.name), items: l.items.filter(i => i && i.symbol) }));
    if (!WL.lists.length) WL.lists = [{ id: newId(), name: "Watchlist 1", items: [] }];
    WL.active = WL.lists[0].id;
    toast(`Replaced with ${incoming.length} lists from backup`);
  } else {
    let added = 0, newLists = 0;
    for (const l of incoming) {
      let mine = WL.lists.find(x => x.name.trim().toLowerCase() === String(l.name).trim().toLowerCase());
      if (!mine) { mine = { id: newId(), name: String(l.name), items: [] }; WL.lists.push(mine); newLists++; }
      for (const it of l.items) {
        if (!it || !it.symbol) continue;
        const have = mine.items.find(i => i.symbol === it.symbol);
        if (!have) { mine.items.push({ ...it }); added++; }
        else if (!have.note && it.note) have.note = it.note;   // fill in missing notes
      }
    }
    toast(`Merged: ${added} stocks added${newLists ? `, ${newLists} new list${newLists === 1 ? "" : "s"}` : ""}`);
  }
  selected.clear(); selectMode = false;
  wlSave();
  refreshPrices();
};

async function refreshPrices(symbols) {
  const list = symbols || allSymbols();
  if (!list.length) return;
  $("wRefresh").disabled = true;
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(3, list.length) }, async () => {
    while (i < list.length) {
      const sym = list[i++];
      const c = await fetchOHLC(sym, "1y", "1d", 2);
      const last = c[c.length - 1];
      if (last) livePrice[sym] = { close: last.close, date: ymd(last.date) };
      if (c.length) priceHist[sym] = c;
    }
  }));
  $("wRefresh").disabled = false;
  $("wUpdated").textContent = `Prices as of ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  renderWatch();
}
$("wSort").onchange = renderWatch;
$("wRefresh").onclick = () => { for (const k in chartCache) delete chartCache[k]; refreshPrices(); };

/* ───────── Saved PDFs (IndexedDB — survive reloads / back button) ───────── */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("ganesh-charts", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("pdfs", { keyPath: "name" });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction("pdfs", mode), st = t.objectStore("pdfs");
      const out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    put: rec => tx("readwrite", st => st.put(rec)),
    all: () => tx("readonly", st => st.getAll()),
    clear: () => tx("readwrite", st => st.clear()),
  };
})();

async function renderSaved() {
  let recs = [];
  try { recs = await DB.all(); } catch {}
  recs = recs.concat((state.memOnly || []).map((m, i) => ({ ...m, order: 1000 + i, label: "Not stored, keep this page open" })));
  recs.sort((a, b) => a.order - b.order);
  state.urls.forEach(u => URL.revokeObjectURL(u)); state.urls = [];
  const box = $("downloads");
  box.innerHTML = "";
  $("saved").hidden = !recs.length;
  for (const r of recs) {
    const url = URL.createObjectURL(r.blob);
    state.urls.push(url);
    const row = document.createElement("div");
    row.className = "pdfrow";
    row.innerHTML = `<div class="meta"><b></b><span></span></div>
      <button type="button" class="view">View</button><button type="button" class="dl">Save</button>`;
    row.querySelector("b").textContent = r.name;
    row.querySelector("span").textContent = `${r.label} \u00B7 ${(r.blob.size / 1048576).toFixed(1)} MB`;
    // View opens the built-in viewer on top of this page, so nothing is lost
    row.querySelector(".view").onclick = () => openViewer(r, url);
    // Save uses the iPad share sheet (Save to Files) when available
    row.querySelector(".dl").onclick = () => sharePdf(r, url);
    box.appendChild(row);
  }
}
async function sharePdf(r, url) {
  const file = new File([r.blob], r.name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove();
}

/* ───────── Built-in PDF viewer (pdf.js), like the Swift PDFViewer ─────────
 * Pages render only when near the screen and are released after, so long PDFs stay light.
 */
let viewerDoc = null, viewerObs = null, viewerRec = null, viewerPageN = 1;

function setViewerPage(n, total) {
  viewerPageN = n;
  const sym = viewerRec && viewerRec.stocks ? viewerRec.stocks[n - 1] : null;
  $("vTitle").textContent = sym || (viewerRec ? viewerRec.name : "");
  $("vPage").textContent = `${n} / ${total}`;
  updateStar();
}
function updateStar() {
  const sym = viewerRec && viewerRec.stocks ? viewerRec.stocks[viewerPageN - 1] : null;
  const n = sym ? listsWith(sym).length : 0;
  $("vStar").textContent = n ? `\u2605 In ${n === 1 ? listsWith(sym)[0].name : n + " lists"}` : "\u2606 Add";
  $("vStar").setAttribute("aria-pressed", String(n > 0));
  $("vStar").disabled = !sym;
}
$("vStar").onclick = () => {
  const n = viewerPageN;
  const sym = viewerRec && viewerRec.stocks ? viewerRec.stocks[n - 1] : null;
  if (!sym) return;
  const c = viewerRec.closes && viewerRec.closes[n - 1];
  openPicker({
    title: `Add ${sym}${c ? ` (\u20B9${c.close.toFixed(2)})` : ""} to\u2026`,
    mode: "toggle",
    item: { symbol: sym, addedOn: ymd(new Date()), price: c ? c.close : null, priceDate: c ? c.date : null, note: "", source: viewerRec.name },
  });
};
async function openViewer(r, url) {
  if (!window.pdfjsLib) { sharePdf(r, url); return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  viewerRec = r;
  $("vTitle").textContent = r.name;
  $("vStar").hidden = !r.stocks;
  $("vPage").textContent = "Loading\u2026";
  $("vSave").onclick = () => sharePdf(r, url);
  const pages = $("pages");
  pages.innerHTML = ""; pages.scrollTop = 0;
  $("viewer").hidden = false;
  document.body.style.overflow = "hidden";
  history.pushState({ viewer: true }, "");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await r.blob.arrayBuffer()) }).promise;
  viewerDoc = doc;
  const total = doc.numPages;
  $("vPage").textContent = `${total} pages`;
  setViewerPage(1, total);
  const rendering = new Map();
  const render = async el => {
    const n = +el.dataset.n;
    if (el.querySelector("canvas") || rendering.has(n)) return;
    rendering.set(n, true);
    try {
      const page = await doc.getPage(n);
      if (viewerDoc !== doc) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (el.clientWidth * dpr) / page.getViewport({ scale: 1 }).width });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      if (el.isConnected && !el.querySelector("canvas")) el.appendChild(c);
    } finally { rendering.delete(n); }
  };
  viewerObs = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) render(e.target);
      else { const c = e.target.querySelector("canvas"); if (c) { c.width = 0; c.height = 0; c.remove(); } }
    }
  }, { root: pages, rootMargin: "1500px 0px" });
  const pageObs = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) setViewerPage(+e.target.dataset.n, total);
  }, { root: pages, threshold: 0.5 });
  const frag = document.createDocumentFragment();
  for (let n = 1; n <= total; n++) {
    const d = document.createElement("div");
    d.className = "pg"; d.dataset.n = n;
    frag.appendChild(d);
  }
  pages.appendChild(frag);
  pages.querySelectorAll(".pg").forEach(d => { viewerObs.observe(d); pageObs.observe(d); });
  viewerObs.pageObs = pageObs;
}
function closeViewer() {
  if ($("viewer").hidden) return;
  if (viewerObs) { viewerObs.disconnect(); viewerObs.pageObs.disconnect(); viewerObs = null; }
  if (viewerDoc) { viewerDoc.destroy(); viewerDoc = null; }
  $("pages").innerHTML = "";
  $("viewer").hidden = true;
  document.body.style.overflow = "";
}
$("vClose").onclick = () => { if (history.state && history.state.viewer) history.back(); else closeViewer(); };
// The iPad back gesture / back button closes the viewer instead of leaving the app
window.addEventListener("popstate", () => { closeViewer(); closeChartWin(); });

/* ───────── Watchlist chart window: tap a stock, Prev / Next through the list ───────── */
const chartCache = {};          // symbol -> { d, w, bars: "dN|wN" }
let cwIndex = 0, cwToken = 0;

const CHART_MAX_AGE = 5 * 60 * 1000;   // reuse a fetched chart for 5 minutes, then refetch
async function getCharts(sym, force) {
  const key = `${dailyBars()}|${weeklyBars()}`;
  const hit = chartCache[sym];
  if (!force && hit && hit.key === key && Date.now() - hit.at < CHART_MAX_AGE) return hit;
  const [d, w] = await Promise.all([fetchCandles(sym, "D"), fetchCandles(sym, "W")]);
  const last = d.length ? d[d.length - 1] : null;
  if (last) livePrice[sym] = { close: last.close, date: ymd(last.date) };
  const out = { d, w, key, at: Date.now() };
  if (d.length || w.length) chartCache[sym] = out;     // never keep an empty result
  else delete chartCache[sym];
  return out;
}
function noDataMsg(sym) {
  const e = lastFetchError[sym] || "";
  if (/not found|no data|404/i.test(e)) return `Yahoo has no data for ${sym}. The symbol may have changed or the stock may be suspended.`;
  return `Couldn't load ${sym} (${e || "no response"}). Yahoo limits requests for a few minutes after a big scan. Wait a minute, then tap \u21BB Refresh.`;
}
const hhmm = t => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/* The window can browse any list: the active watchlist (default) or VCP scan results */
let cwSrc = null;
const watchSource = () => ({ kind: "watch", name: activeList().name, symbols: watchOrder, item: sym => activeList().items.find(x => x.symbol === sym) || { symbol: sym } });

function openChartWin(sym, source) {
  cwSrc = source || watchSource();
  if (!cwSrc.symbols.length) return;
  cwIndex = Math.max(0, cwSrc.symbols.indexOf(sym));
  $("chartWin").hidden = false;
  document.body.style.overflow = "hidden";
  if (!(history.state && history.state.chartWin)) history.pushState({ chartWin: true }, "");
  showChartAt(cwIndex);
}
function closeChartWin() {
  if ($("chartWin").hidden) return;
  $("chartWin").hidden = true;
  document.body.style.overflow = "";
  renderWatch();
  if (typeof renderVcp === "function") renderVcp();
}

async function showChartAt(i, force) {
  const order = cwSrc ? cwSrc.symbols : watchOrder;
  const n = order.length;
  if (!n) { closeChartWin(); return; }
  cwIndex = (i + n) % n;
  const sym = order[cwIndex];
  if (cwSrc && cwSrc.kind === "vcp") return showVcpAt(sym, n, force);
  const w = cwSrc ? cwSrc.item(sym) : (activeList().items.find(x => x.symbol === sym) || { symbol: sym });
  const token = ++cwToken;
  $("cwTitle").textContent = sym;
  $("cwList").textContent = cwSrc ? cwSrc.name : activeList().name;
  $("cwPos").textContent = `${cwIndex + 1} / ${n}`;
  $("cwPrev").disabled = $("cwNext").disabled = n < 2;
  const lp = livePrice[sym];
  const chg = w.price && lp ? (lp.close - w.price) / w.price * 100 : null;
  $("cwInfo").innerHTML = "";
  const add = (label, val, cls) => {
    const d = document.createElement("div");
    d.innerHTML = "<small></small><b></b>";
    d.querySelector("small").textContent = label;
    d.querySelector("b").textContent = val;
    if (cls) d.querySelector("b").className = cls;
    $("cwInfo").appendChild(d);
  };
  add("Added", `${fmtD(w.priceDate || w.addedOn)}${w.price ? ` \u00B7 \u20B9${w.price.toFixed(2)}` : ""}`);
  add("Now", lp ? `\u20B9${lp.close.toFixed(2)}` : "\u2026");
  const miw = manageInfo(w);
  if (miw) add("Manage", `${miw.label} \u00B7 stop \u20B9${miw.stop.toFixed(2)}`, miw.code === "stop" || miw.code === "cost" ? "down" : miw.code === "hold" || miw.code === "new" ? "" : "up");
  if (chg !== null) add("Change", `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% \u00B7 ${daysBetween(w.priceDate || w.addedOn, lp.date)}d`, chg >= 0 ? "up" : "down");
  $("cwNote").textContent = w.note ? `Note: ${w.note}` : "";
  $("cwStatus").textContent = "Loading chart\u2026";
  $("cwStatus").hidden = false;

  $("cwFresh").textContent = "Fetching latest data\u2026";
  const data = await getCharts(sym, force);
  if (token !== cwToken) return;                 // user already moved on
  const lastD = data.d.length ? data.d[data.d.length - 1] : null;
  $("cwFresh").textContent = `Data as of ${hhmm(data.at)}${lastD ? ` \u00B7 last candle ${fmtD(ymd(lastD.date))}` : ""}`;
  // keep the info panel in step with the freshly fetched price
  const lp2 = livePrice[sym];
  if (lp2 && w.price) {
    const c2 = (lp2.close - w.price) / w.price * 100;
    const items = $("cwInfo").children;
    if (items[1]) items[1].querySelector("b").textContent = `\u20B9${lp2.close.toFixed(2)}`;
    if (items[2]) { const b = items[2].querySelector("b"); b.textContent = `${c2 >= 0 ? "+" : ""}${c2.toFixed(2)}% \u00B7 ${daysBetween(w.priceDate || w.addedOn, lp2.date)}d`; b.className = c2 >= 0 ? "up" : "down"; }
    else add("Change", `${c2 >= 0 ? "+" : ""}${c2.toFixed(2)}% \u00B7 ${daysBetween(w.priceDate || w.addedOn, lp2.date)}d`, c2 >= 0 ? "up" : "down");
  }
  const mark = { price: w.price, date: w.priceDate || w.addedOn };
  for (const [id, iv, c, bars] of [["cwDaily", "D", data.d, dailyBars()], ["cwWeekly", "W", data.w, weeklyBars()]]) {
    const cv = $(id);
    cv.width = CW * SCALE; cv.height = CH * SCALE;
    drawChart(cv, sym, iv, c, bars, mark);
  }
  $("cwStatus").hidden = !(data.d.length === 0 && data.w.length === 0);
  $("cwStatus").textContent = noDataMsg(sym);
  // warm up the neighbours so Next / Prev feel instant
  [1, -1].forEach(k => { const s2 = order[(cwIndex + k + n) % n]; if (s2 && s2 !== sym) getCharts(s2).catch(() => {}); });
}

/* VCP result in the chart window: pivot line + contraction details */
async function showVcpAt(sym, n, force) {
  const r = cwSrc.item(sym);
  const token = ++cwToken;
  $("cwTitle").textContent = sym;
  $("cwList").textContent = cwSrc.name;
  $("cwPos").textContent = `${cwIndex + 1} / ${n}`;
  $("cwPrev").disabled = $("cwNext").disabled = n < 2;
  const box = $("cwInfo");
  box.innerHTML = "";
  const add = (label, val, cls) => {
    const d = document.createElement("div");
    d.innerHTML = "<small></small><b></b>";
    d.querySelector("small").textContent = label;
    d.querySelector("b").textContent = val;
    if (cls) d.querySelector("b").className = cls;
    box.appendChild(d);
  };
  let mark;
  if (r.mode === "manas") {
    add("Setup", r.setup === "A" ? "A \u00B7 Base breakout" : r.setup === "B" ? "B \u00B7 21 EMA pullback" : "C \u00B7 Reversal confirmation", "up");
    add("Buy above", `\u20B9${r.trigger.toFixed(2)}`);
    add(`Stop (${r.stopType})`, `\u20B9${r.sl.toFixed(2)}`);
    add("Risk", `${r.risk.toFixed(1)}%`, r.risk > 3 ? "down" : "");
    add("Close", `\u20B9${r.close.toFixed(2)}`);
    add("3-month run-up", `${r.mom}%`);
    add("Off high", `${r.off}%`);
    if (r.rs !== null) add("RS vs Nifty 3M", `${r.rs >= 0 ? "+" : ""}${r.rs.toFixed(1)}`, r.rs >= 0 ? "up" : "down");
    add("ADR", `${r.adr}%`);
    add("Turnover 20d", `\u20B9${r.turn} Cr`);
    $("cwNote").textContent = r.setup === "C"
      ? "Sharp fall, then a big up day on heavy volume (the \u201Cfalling knife\u201D he bought on confirmation). Riskier: smaller size, and only above the trigger."
      : r.setup === "A"
      ? `Tight ${r.base}% 10-day base near the high, volume ${r.volDry.toFixed(2)}\u00D7 average. Plan: buy only if it trades above the trigger; skip if it opens far above.`
      : `Pulled back into a rising 21 EMA (\u20B9${r.ema21.toFixed(2)}) on lighter volume. Plan: buy only if it turns up through the trigger.`;
    mark = { lines: [{ price: r.trigger, label: "Buy above", color: "rgb(18,140,51)" }, { price: r.sl, label: `Stop ${r.stopType}`, color: "rgb(217,26,26)" }] };
  } else if (r.mode === "learned") {
    add("Similarity", `${r.sim}% of learned rules`, r.sim >= 95 ? "up" : "");
    if (r.like) add("Looks most like", r.like);
    add("Trigger", `\u20B9${r.trigger.toFixed(2)}`);
    add("Stop 2%", `\u20B9${r.sl.toFixed(2)}`);
    add("Or stop LOD", `\u20B9${r.todayLow.toFixed(2)} (today's low)`);
    add("Close", `\u20B9${r.close.toFixed(2)}`);
    add("Run-up 3M", `${r.f.mom.toFixed(0)}%`);
    if (r.f.rs !== null) add("RS vs Nifty", `${r.f.rs >= 0 ? "+" : ""}${r.f.rs.toFixed(1)}`, r.f.rs >= 0 ? "up" : "down");
    add("5-day range", `${r.f.tight5.toFixed(1)}%`);
    add("Volume (today)", `${r.f.volDay.toFixed(2)}\u00D7 avg`);
    $("cwNote").textContent = r.misses.length ? `Outside the learned range: ${r.misses.join(", ")}` : "Inside the learned range on every rule.";
    mark = { lines: [{ price: r.trigger, label: "Trigger", color: "rgb(18,140,51)" }, { price: r.sl, label: "SL 2%", color: "rgb(217,26,26)" }] };
  } else if (r.mode === "vcp2") {
    add("Grade", r.near ? `Near miss (${r.near})` : `${r.grade} \u00B7 ${r.score}/100`, r.grade === "A" ? "up" : "");
    add("Status", r.status, r.breakout ? "up" : "");
    add("Pivot", `\u20B9${r.pivot.toFixed(2)}`);
    add("Stop-loss", `\u20B9${r.sl.toFixed(2)}`);
    add("Risk from pivot", `${r.risk.toFixed(1)}%`);
    add("Close", `\u20B9${r.close.toFixed(2)} (${r.dist <= 0 ? Math.abs(r.dist).toFixed(1) + "% above" : r.dist.toFixed(1) + "% below"})`);
    add("Contractions", r.depths.map(d => d.toFixed(0) + "%").join(" \u2192 "));
    if (r.rsRank !== null) add("RS rank", String(r.rsRank), r.rsRank >= 80 ? "up" : "");
    else if (r.rsNifty !== null) add("vs Nifty 6M", `${r.rsNifty >= 0 ? "+" : ""}${r.rsNifty.toFixed(1)}`, r.rsNifty >= 0 ? "up" : "down");
    add("Volume 10d/50d", `${r.volRatio.toFixed(2)}\u00D7`);
    $("cwNote").textContent = `${r.baseWeeks}-week base after a ${r.priorUp}% run-up \u00B7 last 5 days ${r.tight5}% range \u00B7 final contraction volume ${r.contrVol.toFixed(2)}\u00D7 base average \u00B7 ${r.off52}% off 52-week high${r.tt ? " \u00B7 Trend Template \u2713" : ""}`;
    mark = { lines: [{ price: r.pivot, label: "Pivot", color: "rgb(124,58,237)" }, { price: r.sl, label: "SL", color: "rgb(217,26,26)" }] };
  } else if (r.mode === "rvol") {
    add("Breakout day", `${fmtD(r.bDate)}${r.days ? ` (${r.days}d ago)` : " (today)"}`);
    add("Day move", `+${r.move.toFixed(1)}%`, "up");
    add("Rel. volume", `${r.rvol.toFixed(1)}\u00D7 50-day avg`);
    add("Breakout level", `\u20B9${r.level.toFixed(2)}`);
    add("Stop-loss", `\u20B9${r.sl.toFixed(2)} (day low)`);
    add("Risk", `${r.risk.toFixed(1)}%`);
    add("Close", `\u20B9${r.close.toFixed(2)}`, r.held ? "up" : "down");
    add("Turnover 20d", `\u20B9${r.turn.toFixed(1)} Cr`);
    $("cwNote").textContent = `Base: ${r.depth.toFixed(0)}% deep before the breakout \u00B7 closed in the top ${100 - r.pos}% of the day's range${r.held ? "" : " \u00B7 now back inside the base"}`;
    mark = { dotDate: r.bDate, lines: [{ price: r.level, label: "Breakout", color: "rgb(147,51,234)" }, { price: r.sl, label: "SL", color: "rgb(217,26,26)" }] };
  } else if (r.mode === "india") {
    add("Entry", `\u20B9${r.entry.toFixed(2)}`);
    add("Stop-loss", `\u20B9${r.sl.toFixed(2)}`);
    add("Risk", `${r.risk.toFixed(1)}%`);
    add("Close", `\u20B9${r.close.toFixed(2)}`, r.dist <= 0 ? "up" : "");
    add("Momentum 3M", `${r.mom}%`);
    if (r.rs !== null) add("RS vs Nifty 3M", `${r.rs >= 0 ? "+" : ""}${r.rs.toFixed(1)}`, r.rs >= 0 ? "up" : "down");
    add("ADR", `${r.adr.toFixed(1)}%`);
    add("Turnover 20d", `\u20B9${r.turn.toFixed(1)} Cr`);
    $("cwNote").textContent = `${r.tags.join(" \u00B7 ")} \u00B7 ${r.off52.toFixed(1)}% off 52-week high`;
    mark = { lines: [{ price: r.entry, label: "Entry", color: "rgb(18,140,51)" }, { price: r.sl, label: "SL", color: "rgb(217,26,26)" }] };
  } else {
    add("Pivot", `\u20B9${r.pivot.toFixed(2)}`);
    add("Close", `\u20B9${r.close.toFixed(2)}`);
    add("From pivot", r.dist <= 0 ? `${Math.abs(r.dist).toFixed(1)}% above` : `${r.dist.toFixed(1)}% below`, r.dist <= 0 ? "up" : "");
    add("Contractions", r.depths.map(d => d.toFixed(0) + "%").join(" \u2192 "));
    add("Volume 10d/50d", `${r.volRatio.toFixed(2)}\u00D7`);
    $("cwNote").textContent = r.trend ? "Stage 2 trend template: passed" : "Trend template: not checked";
    mark = { price: r.pivot, label: "Pivot" };
  }
  $("cwStatus").textContent = "Loading chart\u2026"; $("cwStatus").hidden = false;
  $("cwFresh").textContent = "Fetching latest data\u2026";
  const data = await getCharts(sym, force);
  if (token !== cwToken) return;
  const lastD = data.d.length ? data.d[data.d.length - 1] : null;
  $("cwFresh").textContent = `Data as of ${hhmm(data.at)}${lastD ? ` \u00B7 last candle ${fmtD(ymd(lastD.date))}` : ""}`;
  for (const [id, iv, c, bars] of [["cwDaily", "D", data.d, dailyBars()], ["cwWeekly", "W", data.w, weeklyBars()]]) {
    const cv = $(id);
    cv.width = CW * SCALE; cv.height = CH * SCALE;
    drawChart(cv, sym, iv, c, bars, mark);
  }
  $("cwStatus").hidden = !(data.d.length === 0 && data.w.length === 0);
  $("cwStatus").textContent = noDataMsg(sym);
  [1, -1].forEach(k => { const s2 = cwSrc.symbols[(cwIndex + k + n) % n]; if (s2 && s2 !== sym) getCharts(s2).catch(() => {}); });
}

$("cwPrev").onclick = () => showChartAt(cwIndex - 1);
$("cwRefresh").onclick = () => showChartAt(cwIndex, true);
$("cwNext").onclick = () => showChartAt(cwIndex + 1);
$("cwClose").onclick = () => { if (history.state && history.state.chartWin) history.back(); else closeChartWin(); };
document.addEventListener("keydown", e => {
  if ($("chartWin").hidden) return;
  if (e.key === "ArrowRight") showChartAt(cwIndex + 1);
  else if (e.key === "ArrowLeft") showChartAt(cwIndex - 1);
  else if (e.key === "Escape") $("cwClose").click();
});
// Swipe left / right on the charts
(() => {
  let x0 = null, y0 = null;
  const body = $("cwBody");
  body.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  body.addEventListener("touchend", e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) showChartAt(cwIndex + (dx < 0 ? 1 : -1));
    x0 = null;
  }, { passive: true });
})();

$("clearSaved").onclick = async () => {
  if (!confirm("Delete all saved PDFs from this browser?")) return;
  await DB.clear(); renderSaved();
};

/* ───────── Generate (port of startGeneration) ─────────
 * Works part by part: fetch → draw → build that PDF → save it → free memory → next part.
 */
$("go").onclick = () => generate();
async function generate(override) {
  const stocks = override || filteredStocks();
  if (!stocks.length || state.busy) return;
  state.busy = true; refresh();
  $("errors").hidden = true;
  $("progress").hidden = false;
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  try { await DB.clear(); } catch {}
  state.memOnly = [];
  await renderSaved();

  const dBarsN = dailyBars(), wBarsN = weeklyBars();
  $("dBars").value = dBarsN; $("wBars").value = wBarsN;
  const splitOn = document.querySelector('input[name="split"]:checked').value === "split";
  const PART_SIZE = splitOn ? Math.max(1, parseInt($("splitN").value, 10) || 150) : stocks.length;
  const parts = Math.ceil(stocks.length / PART_SIZE);
  const canvas = document.createElement("canvas");
  canvas.width = CW * SCALE; canvas.height = CH * SCALE;
  const noData = [];
  let done = 0;
  const setP = t => { $("bar").style.width = `${(done / stocks.length) * 100}%`; $("ptext").textContent = t; };
  setP("Fetching data...");

  for (let p = 0; p < parts; p++) {
    const chunk = stocks.slice(p * PART_SIZE, (p + 1) * PART_SIZE);
    const doc = new jspdf.jsPDF({ unit: "pt", format: [PW, PH], orientation: "portrait", compress: true });
    let first = true;
    const pageStocks = [], pageCloses = [];
    for (let b = 0; b < chunk.length; b += BATCH_SIZE) {
      const batch = chunk.slice(b, b + BATCH_SIZE);
      const data = await Promise.all(batch.map(async s => [s, await fetchCandles(s, "D"), await fetchCandles(s, "W")]));
      for (const [s, d, w] of data) {
        const lastD = d.length ? d[d.length - 1] : null;
        pageStocks.push(s);
        pageCloses.push(lastD ? { close: lastD.close, date: ymd(lastD.date) } : null);
        const okD = drawChart(canvas, s, "D", d, dBarsN);
        const di = canvas.toDataURL("image/jpeg", 0.85);
        const okW = drawChart(canvas, s, "W", w, wBarsN);
        const wi = canvas.toDataURL("image/jpeg", 0.85);
        if (!okD && !okW) noData.push(s);
        if (!first) doc.addPage([PW, PH], "portrait");
        first = false;
        pdfPage(doc, s, di, wi, dBarsN, wBarsN);   // page goes straight into the PDF; images aren't kept
      }
      done += batch.length;
      setP(`Processed ${done}/${stocks.length} stocks${parts > 1 ? ` (PDF ${p + 1} of ${parts})` : ""}...`);
    }
    setP(`Saving PDF${parts > 1 ? ` ${p + 1} of ${parts}` : ""}...`);
    await new Promise(r => setTimeout(r, 30));
    const name = parts > 1 ? `GaneshCharts_part${p + 1}_of_${parts}.pdf` : "GaneshCharts.pdf";
    const from = p * PART_SIZE + 1, to = p * PART_SIZE + chunk.length;
    const blob = doc.output("blob");
    try {
      await DB.put({ name, order: p, stocks: pageStocks, closes: pageCloses, label: parts > 1 ? (from === to ? `Stock ${from}` : `Stocks ${from}\u2013${to}`) : `${chunk.length} stocks`, blob });
    } catch {
      // Storage full/blocked: keep it in this page only
      state.memOnly = (state.memOnly || []).concat({ name, blob });
    }
    await renderSaved();
  }

  setP(`Done. ${stocks.length} stocks in ${parts} PDF${parts > 1 ? "s" : ""}. Tap View or Save below.`);
  if (noData.length) { $("errors").hidden = false; $("errors").textContent = `No data for: ${noData.join(", ")}`; }
  try { wakeLock?.release(); } catch {}
  state.busy = false; refresh();
}

/* ───────── VCP scanner (Minervini volatility contraction pattern) ─────────
 * Rules (adjustable in the card):
 *  1. Trend template: close > SMA50 > SMA150 > SMA200, SMA200 rising over 1 month,
 *     close within 25% of the 52-week high and 30%+ above the 52-week low.
 *  2. Base: from the highest swing high in the lookback, 2+ pullbacks, each shallower than the last.
 *  3. Final contraction tight; volume dry-up (10-day avg vs 50-day avg).
 *  4. Close near the pivot (top of the last contraction).
 */
const VCP_KEY = "gc:vcp";
let vcp = { results: [], scanned: 0, universe: "", at: null };
try { vcp = JSON.parse(localStorage.getItem(VCP_KEY) || "null") || vcp; } catch {}
let vcpStop = false, vcpBusy = false;

function smaAt(arr, end, w) {
  if (end - w + 1 < 0) return NaN;
  let s = 0;
  for (let k = end - w + 1; k <= end; k++) s += arr[k];
  return s / w;
}

// Swing points: a new swing needs a reversal of at least `pct` from the running extreme
function zigzag(H, L, start, end, pct) {
  // A bar that makes a new extreme can't also be the reversal bar (wide bars would fake swings)
  const piv = [];
  let dir = 0, hi = start, lo = start;
  for (let i = start + 1; i <= end; i++) {
    if (dir === 0) {
      if (H[i] > H[hi]) hi = i;
      if (L[i] < L[lo]) lo = i;
      if (hi > lo && i > lo && H[hi] >= L[lo] * (1 + pct)) { piv.push({ t: "L", i: lo }); dir = 1; }
      else if (lo > hi && i > hi && L[lo] <= H[hi] * (1 - pct)) { piv.push({ t: "H", i: hi }); dir = -1; }
    } else if (dir === 1) {
      if (H[i] > H[hi]) { hi = i; continue; }
      if (L[i] <= H[hi] * (1 - pct)) {
        piv.push({ t: "H", i: hi }); dir = -1;
        lo = hi + 1; for (let k = hi + 1; k <= i; k++) if (L[k] < L[lo]) lo = k;
      }
    } else {
      if (L[i] < L[lo]) { lo = i; continue; }
      if (H[i] >= L[lo] * (1 + pct)) {
        piv.push({ t: "L", i: lo }); dir = 1;
        hi = lo + 1; for (let k = lo + 1; k <= i; k++) if (H[k] > H[hi]) hi = k;
      }
    }
  }
  if (dir === 1) piv.push({ t: "H", i: hi, tent: true });
  else if (dir === -1) piv.push({ t: "L", i: lo, tent: true });
  return piv;
}

/* ── Solid VCP (Minervini volatility contraction pattern) ──
 * 1. Trend Template (all 8 points) + RS rank vs the scanned universe (IBD-style weighted 12-month).
 * 2. Prior uptrend of 30%+ into the base high.
 * 3. Base 3+ weeks; 2–6 contractions, each shallower than the last, with higher lows;
 *    swing size adapts to each stock's volatility (ADR).
 * 4. Final contraction tight (≤10%), tight last 5 days, volume drying up.
 * 5. Close near the pivot (top of the final contraction), or just broken out on volume.
 * Every match gets a 0–100 quality score and an A / B / C grade. */
function vcpSettings() {
  return {
    trend: $("vTrend").checked,
    priorUp: clampInt($("vPrior").value, 0, 300, 30),
    rsOn: $("vRsOn").checked,
    rsMin: clampInt($("vRs").value, 1, 99, 70),
    lookback: +$("vLook").value,
    minC: clampInt($("vMinC").value, 2, 6, 2),
    maxFirst: clampInt($("vMaxFirst").value, 5, 60, 35),
    maxLast: clampInt($("vMaxLast").value, 2, 30, 10),
    higherLows: $("vHL").checked,
    tight5: clampInt($("vTight5").value, 2, 30, 8),
    maxDist: clampInt($("vDist").value, 1, 25, 8),
    volOn: $("vVol").checked,
    volMax: Math.max(0.2, Math.min(1.5, parseFloat($("vVolMax").value) || 0.8)),
    minTurnover: Math.max(0, parseFloat($("vTurn").value) || 0),
    minPrice: Math.max(0, parseFloat($("vMinPrice").value) || 0),
    nearMiss: $("vNear").checked,
  };
}

// IBD-style relative strength score: weighted 3/6/9/12-month performance
function rsScoreOf(C) {
  const n = C.length, last = n - 1;
  if (n < 253) return null;
  const r = k => C[last] / C[last - k] - 1;
  return 0.4 * r(63) + 0.2 * r(126) + 0.2 * r(189) + 0.2 * r(252);
}

/* Every rule is checked and failures are collected (instead of stopping at the first one),
 * so the scan can report why stocks were filtered out and optionally show near misses.
 * The base is read at three swing sizes (fine → coarse) and the cleanest reading is used,
 * so small wiggles inside a pullback don't break an otherwise good VCP. */
const VCP_RULES = {
  liq: "Price / turnover too low", data: "Not enough history", trend: "Trend Template",
  base: "No clear base (needs 2+ pullbacks)", prior: "Prior run-up too small", shrink: "Pullbacks not getting smaller",
  first: "First pullback too deep", last: "Final pullback too deep", lows: "Lows not rising",
  tight: "Last 5 days not tight", far: "Too far below pivot", ext: "Extended above pivot",
  vol: "Volume not drying up", rs: "RS too weak",
};

function readBase(H, L, start, last, pct) {
  const piv = zigzag(H, L, start, last, pct);
  let baseK = -1;
  piv.forEach((p, k) => { if (p.t === "H" && !p.tent && (baseK < 0 || H[p.i] > H[piv[baseK].i])) baseK = k; });
  if (baseK < 0) return null;
  const depths = [], troughs = [];
  let pivot = null, pivotIdx = -1;
  for (let k = baseK; k < piv.length - 1; k++) {
    if (piv[k].t !== "H" || piv[k + 1].t !== "L") continue;
    const ph = H[piv[k].i], tl = L[piv[k + 1].i];
    depths.push((ph - tl) / ph * 100);
    troughs.push(tl);
    pivot = ph; pivotIdx = piv[k].i;
  }
  if (depths.length < 2) return null;
  return { baseIdx: piv[baseK].i, depths, troughs, pivot, pivotIdx, pct };
}

function analyseVcp(c, cfg, niftyMap) {
  const n = c.length;
  if (n < 260) return { fails: ["data"] };
  const C = c.map(x => x.close), H = c.map(x => x.high), L = c.map(x => x.low), V = c.map(x => x.volume);
  const last = n - 1, close = C[last];
  let turn = 0;
  for (let k = n - 20; k < n; k++) turn += C[k] * V[k];
  turn = turn / 20 / 1e7;
  if (close < cfg.minPrice || turn < cfg.minTurnover) return { fails: ["liq"] };

  const fails = [];
  // Trend Template
  const s50 = smaAt(C, last, 50), s150 = smaAt(C, last, 150), s200 = smaAt(C, last, 200), s200b = smaAt(C, last - 22, 200);
  let hi52 = -Infinity, lo52 = Infinity;
  for (let k = n - 252; k < n; k++) { hi52 = Math.max(hi52, H[k]); lo52 = Math.min(lo52, L[k]); }
  const tt = close > s150 && close > s200 && s150 > s200 && s200 > s200b && s50 > s150 && s50 > s200 && close > s50 && close >= lo52 * 1.3 && close >= hi52 * 0.75;
  if (cfg.trend && !tt) fails.push("trend");

  let adr = 0;
  for (let k = n - 20; k < n; k++) adr += (H[k] / L[k] - 1) * 100;
  adr /= 20;
  const basePct = Math.min(0.08, Math.max(0.03, adr * 1.2 / 100));
  const start = Math.max(1, n - cfg.lookback);

  // Read the base at three swing sizes; keep the reading with the fewest structural failures
  const structFails = b => {
    const f = [];
    if (last - b.baseIdx < 15) f.push("base");
    for (let k = 1; k < b.depths.length; k++) if (b.depths[k] >= b.depths[k - 1]) { f.push("shrink"); break; }
    if (b.depths[0] > cfg.maxFirst) f.push("first");
    if (b.depths[b.depths.length - 1] > cfg.maxLast) f.push("last");
    if (cfg.higherLows) for (let k = 1; k < b.troughs.length; k++) if (b.troughs[k] < b.troughs[k - 1] * 0.99) { f.push("lows"); break; }
    if (b.depths.length > 6) f.push("base");
    return f;
  };
  let best = null, bestF = null;
  for (const p of [...new Set([basePct, Math.max(basePct, 0.05), 0.08].map(x => Math.round(x * 1000) / 1000))]) {
    const b = readBase(H, L, start, last, p);
    if (!b || b.depths.length < cfg.minC) continue;
    const f = structFails(b);
    if (!best || f.length < bestF.length) { best = b; bestF = f; }
    if (!f.length) break;
  }
  if (!best) return { fails: [...fails, "base"], tt };
  fails.push(...bestF);

  const { baseIdx, depths, pivot, pivotIdx } = best;
  let preLow = Infinity;
  for (let k = Math.max(0, baseIdx - 126); k <= baseIdx; k++) preLow = Math.min(preLow, L[k]);
  const priorUp = (H[baseIdx] / preLow - 1) * 100;
  if (priorUp < cfg.priorUp) fails.push("prior");

  let h5 = -Infinity, l5 = Infinity;
  for (let k = n - 5; k < n; k++) { h5 = Math.max(h5, H[k]); l5 = Math.min(l5, L[k]); }
  const tight5 = (h5 - l5) / close * 100;
  const v10 = smaAt(V, last, 10), v50 = smaAt(V, last, 50);
  const volRatio = v50 > 0 ? v10 / v50 : 1;
  let baseVol = 0, lastVol = 0;
  for (let k = baseIdx; k <= last; k++) baseVol += V[k];
  baseVol /= (last - baseIdx + 1);
  for (let k = pivotIdx; k <= last; k++) lastVol += V[k];
  lastVol /= (last - pivotIdx + 1);
  const contrVol = baseVol > 0 ? lastVol / baseVol : 1;

  const dist = (pivot - close) / pivot * 100;
  const breakout = close > pivot;
  const volBreak = breakout && V[last] >= 1.4 * v50;
  if (dist > cfg.maxDist) fails.push("far");
  if (dist < -5) fails.push("ext");
  if (!breakout && tight5 > cfg.tight5) fails.push("tight");
  // dry-up: either recent volume or the final contraction's volume is light
  if (cfg.volOn && !volBreak && volRatio > cfg.volMax && contrVol > cfg.volMax) fails.push("vol");

  let sl = Infinity;
  for (let k = pivotIdx; k <= last; k++) sl = Math.min(sl, L[k]);
  const risk = (pivot - sl) / pivot * 100;
  let rsNifty = null;
  if (niftyMap && niftyMap.size) {
    const k0 = n - 127;
    const n0 = niftyMap.get(ymd(c[k0].date)), n1 = niftyMap.get(ymd(c[last].date));
    if (n0 && n1) rsNifty = ((C[last] / C[k0]) - (n1 / n0)) * 100;
  }
  return {
    fails, mode: "vcp2", close, date: ymd(c[last].date),
    depths: depths.map(d => Math.round(d * 10) / 10), pivot, sl, risk: Math.round(risk * 10) / 10,
    dist: Math.round(dist * 10) / 10, breakout, volBreak, tight5: Math.round(tight5 * 10) / 10,
    volRatio: Math.round(volRatio * 100) / 100, contrVol: Math.round(contrVol * 100) / 100,
    baseWeeks: Math.round((last - baseIdx) / 5), priorUp: Math.round(priorUp), tt, adr: Math.round(adr * 10) / 10,
    off52: Math.round((1 - close / hi52) * 1000) / 10, turn: Math.round(turn * 10) / 10,
    rsScore: rsScoreOf(C), rsNifty: rsNifty === null ? null : Math.round(rsNifty * 10) / 10,
    lastVolX: v50 > 0 ? Math.round(V[last] / v50 * 10) / 10 : 1, swing: Math.round(best.pct * 100),
  };
}

// RS rank (1–99) from the scanned universe, then the quality score and grade
function finalizeVcp(found, allRs, cfg) {
  const sorted = allRs.filter(x => x !== null).sort((a, b) => a - b);
  const useRank = sorted.length >= 60;
  const out = [];
  for (const r0 of found) {
    if (r0.mode !== "vcp2") { out.push(r0); continue; }
    const r = { ...r0, fails: [...(r0.fails || [])] };
    let rsRank = null;
    if (useRank && r.rsScore !== null) {
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= r.rsScore) lo = m + 1; else hi = m; }
      rsRank = Math.max(1, Math.min(99, Math.round(lo / sorted.length * 99)));
    }
    if (cfg.rsOn) {
      if ((rsRank !== null && rsRank < cfg.rsMin) || (rsRank === null && r.rsNifty !== null && r.rsNifty < 0)) r.fails.push("rs");
    }
    if (r.fails.length > (cfg.nearMiss ? 1 : 0)) continue;
    const nC = r.depths.length, ld = r.depths[nC - 1];
    let score = Math.min(3, nC - 1) * 8;
    score += ld <= 3 ? 20 : ld <= 6 ? 15 : ld <= 10 ? 8 : 3;
    score += r.volRatio <= 0.5 ? 15 : r.volRatio <= 0.7 ? 10 : r.volRatio <= 0.85 ? 5 : 0;
    score += r.contrVol <= 0.7 ? 5 : 0;
    score += rsRank !== null ? Math.max(0, Math.min(20, (rsRank - 50) / 50 * 20)) : (r.rsNifty !== null && r.rsNifty > 0 ? 10 : 0);
    score += r.volBreak ? 12 : r.dist <= 2 && r.dist >= 0 ? 10 : r.dist <= 5 ? 6 : 2;
    score += r.off52 <= 10 ? 6 : 0;
    let regular = true;
    for (let k = 1; k < nC; k++) if (r.depths[k] > r.depths[k - 1] * 0.75) regular = false;
    if (regular) score += 5;
    score = Math.round(Math.min(100, score));
    const grade = score >= 70 ? "A" : score >= 50 ? "B" : "C";
    const status = r.volBreak ? "Breakout on volume" : r.breakout ? "Above pivot, light volume" : "Setting up";
    const near = r.fails.length ? VCP_RULES[r.fails[0]] : null;
    out.push({ ...r, rsRank, score: near ? Math.min(score, 49) : score, grade: near ? "\u2248" : grade, status, near });
  }
  return out;
}

/* India momentum + tightness scan, in the spirit of Manas Arora (momentum burst after
 * contraction, RS vs Nifty, volume dry-up, around the 21 EMA) and Ankur Patel
 * (2-day inside bar). These are public descriptions of their styles, not their exact rules. */
function emaSeries(arr, p) {
  const k = 2 / (p + 1), out = new Array(arr.length);
  let e = arr[0];
  for (let i = 0; i < arr.length; i++) { e = i ? arr[i] * k + e * (1 - k) : arr[0]; out[i] = e; }
  return out;
}

function indiaSettings() {
  return {
    minTurnover: Math.max(0, parseFloat($("iTurn").value) || 0),     // ₹ crore, 20-day average
    minPrice: Math.max(0, parseFloat($("iMinPrice").value) || 0),
    mom: clampInt($("iMom").value, 0, 300, 30),                       // % run-up in last 3 months
    rsOn: $("iRsOn").checked,
    rsMin: parseFloat($("iRs").value) || 0,                           // % points vs Nifty, 3 months
    near52: clampInt($("iNear52").value, 1, 60, 20),
    trendOn: $("iTrend").checked,
    maxAbove: clampInt($("iAbove").value, 1, 40, 8),                  // % above 21 EMA
    tight: clampInt($("iTight").value, 2, 30, 8),                     // 5-day range %
    adrMin: Math.max(0, parseFloat($("iAdr").value) || 0),
    volOn: $("iVol").checked,
    ib: $("iIb").value,                                               // any | 1 | 2
  };
}

function analyseIndia(c, niftyMap, cfg) {
  const n = c.length;
  if (n < 80) return null;
  const C = c.map(x => x.close), H = c.map(x => x.high), L = c.map(x => x.low), V = c.map(x => x.volume);
  const last = n - 1, close = C[last];
  if (close < cfg.minPrice) return null;

  // Liquidity: 20-day average turnover in ₹ crore
  let turn = 0;
  for (let k = n - 20; k < n; k++) turn += C[k] * V[k];
  turn = turn / 20 / 1e7;
  if (turn < cfg.minTurnover) return null;

  // ADR% (20) and 5-day tightness
  let adr = 0;
  for (let k = n - 20; k < n; k++) adr += (H[k] / L[k] - 1) * 100;
  adr /= 20;
  if (adr < cfg.adrMin) return null;
  let h5 = -Infinity, l5 = Infinity;
  for (let k = n - 5; k < n; k++) { h5 = Math.max(h5, H[k]); l5 = Math.min(l5, L[k]); }
  const tight = (h5 - l5) / close * 100;
  if (tight > cfg.tight) return null;

  // Momentum: best run-up inside the last ~3 months (low → later high)
  let mom = 0, minL = Infinity;
  for (let k = Math.max(0, n - 63); k < n; k++) { minL = Math.min(minL, L[k]); mom = Math.max(mom, (H[k] / minL - 1) * 100); }
  if (mom < cfg.mom) return null;

  // Near the 52-week high
  let hi52 = -Infinity;
  for (let k = Math.max(0, n - 252); k < n; k++) hi52 = Math.max(hi52, H[k]);
  const off52 = (1 - close / hi52) * 100;
  if (off52 > cfg.near52) return null;

  // Trend: close > 21 EMA > 50 EMA, 21 EMA rising, not extended
  const e21 = emaSeries(C, 21), e50 = emaSeries(C, 50);
  const above = (close / e21[last] - 1) * 100;
  if (cfg.trendOn && !(close > e21[last] && e21[last] > e50[last] && e21[last] > e21[last - 5])) return null;
  if (above > cfg.maxAbove) return null;

  // Relative strength vs Nifty over 3 months (percentage points)
  let rs = null;
  if (niftyMap && niftyMap.size) {
    const k0 = n - 64;
    const n0 = niftyMap.get(ymd(c[k0].date)), n1 = niftyMap.get(ymd(c[last].date));
    if (n0 && n1) rs = ((C[last] / C[k0]) - (n1 / n0)) * 100;
  }
  if (cfg.rsOn && rs !== null && rs < cfg.rsMin) return null;

  // Volume dry-up: today's volume below its 10-day average
  const v10 = smaAt(V, last, 10), v50 = smaAt(V, last, 50);
  const volDry = V[last] < v10;
  if (cfg.volOn && !volDry) return null;

  // Inside bars (Ankur Patel's 2-day pattern = two consecutive inside bars)
  const inside = k => H[k] < H[k - 1] && L[k] > L[k - 1];
  const ib = inside(last) && inside(last - 1) ? 2 : inside(last) ? 1 : 0;
  if (cfg.ib === "1" && ib < 1) return null;
  if (cfg.ib === "2" && ib < 2) return null;

  // Trigger levels: inside bar → prior bar's high / low; otherwise the 5-day range
  const entry = ib ? H[last - 1] : h5;
  const sl = ib ? L[last - 1] : l5;
  const risk = (entry - sl) / entry * 100;
  const tags = [];
  if (ib === 2) tags.push("IB2"); else if (ib === 1) tags.push("IB");
  tags.push(`Tight ${tight.toFixed(1)}%`);
  if (rs !== null) tags.push(`RS ${rs >= 0 ? "+" : ""}${rs.toFixed(0)}`);
  tags.push(`Mom ${mom.toFixed(0)}%`);
  if (volDry) tags.push("Vol dry");
  return {
    mode: "india", close, date: ymd(c[last].date), entry, sl, risk: Math.round(risk * 10) / 10,
    dist: Math.round((entry - close) / entry * 1000) / 10, mom: Math.round(mom), rs: rs === null ? null : Math.round(rs * 10) / 10,
    adr: Math.round(adr * 10) / 10, tight: Math.round(tight * 10) / 10, turn: Math.round(turn * 10) / 10,
    off52: Math.round(off52 * 10) / 10, ib, volRatio: v50 > 0 ? Math.round(V[last] / v50 * 100) / 100 : 1, tags,
  };
}

/* Relative-volume breakout ("purple dot" style): a strong up day on unusually high volume
 * that closes above a recent base. Community versions of the purple dot flag bullish bars
 * with a big % move on heavy volume; here we add relative volume and a base breakout. */
function rvolSettings() {
  return {
    within: clampInt($("rWithin").value, 1, 10, 1),       // breakout day within the last N sessions
    move: Math.max(0, parseFloat($("rMove").value) || 0),  // % up on the day
    rvol: Math.max(1, parseFloat($("rRvol").value) || 2),  // volume ÷ 50-day average
    minVol: Math.max(0, parseFloat($("rMinVol").value) || 0) * 1e5,   // lakh shares
    base: clampInt($("rBase").value, 5, 120, 20),          // base length (sessions)
    baseMax: clampInt($("rBaseMax").value, 3, 60, 25),     // base depth %
    closePos: clampInt($("rClose").value, 0, 100, 50),     // close in top X% of the day's range
    trendOn: $("rTrend").checked,
    minTurnover: Math.max(0, parseFloat($("rTurn").value) || 0),
    minPrice: Math.max(0, parseFloat($("rMinPrice").value) || 0),
  };
}

function analyseRvol(c, cfg) {
  const n = c.length;
  if (n < 80) return null;
  const C = c.map(x => x.close), H = c.map(x => x.high), L = c.map(x => x.low), V = c.map(x => x.volume);
  const last = n - 1, close = C[last];
  if (close < cfg.minPrice) return null;
  let turn = 0;
  for (let k = n - 20; k < n; k++) turn += C[k] * V[k];
  turn = turn / 20 / 1e7;
  if (turn < cfg.minTurnover) return null;
  const e21 = emaSeries(C, 21), e50 = emaSeries(C, 50);

  // newest qualifying breakout day within the window
  for (let b = last; b > last - cfg.within && b > cfg.base + 50; b--) {
    const move = (C[b] / C[b - 1] - 1) * 100;
    if (move < cfg.move || C[b] <= (c[b].open || C[b - 1])) continue;           // bullish, big move
    const avg50 = smaAt(V, b - 1, 50);
    const rvol = avg50 > 0 ? V[b] / avg50 : 0;
    if (rvol < cfg.rvol || V[b] < cfg.minVol) continue;                          // heavy volume
    const rng = H[b] - L[b];
    const pos = rng > 0 ? (C[b] - L[b]) / rng * 100 : 100;
    if (pos < 100 - cfg.closePos) continue;                                      // strong close
    let bh = -Infinity, bl = Infinity;
    for (let k = b - cfg.base; k < b; k++) { bh = Math.max(bh, H[k]); bl = Math.min(bl, L[k]); }
    const depth = (bh - bl) / bh * 100;
    if (depth > cfg.baseMax) continue;                                           // it was a base
    if (C[b] <= bh) continue;                                                    // closed above it
    if (cfg.trendOn && !(C[b] > e21[b] && e21[b] > e50[b])) continue;
    const held = close > bh;                                                     // still above breakout level?
    const sl = L[b];
    const risk = (close - sl) / close * 100;
    const days = last - b;
    const tags = ["Purple dot", `RVOL ${rvol.toFixed(1)}\u00D7`, `+${move.toFixed(1)}%`, `Base ${cfg.base}d ${depth.toFixed(0)}%`];
    if (days) tags.push(held ? `${days}d ago, holding` : `${days}d ago, back in base`);
    return {
      mode: "rvol", close, date: ymd(c[last].date), bDate: ymd(c[b].date), days, move: Math.round(move * 10) / 10,
      rvol: Math.round(rvol * 10) / 10, vol: V[b], level: bh, sl, risk: Math.round(risk * 10) / 10,
      depth: Math.round(depth * 10) / 10, pos: Math.round(pos), held, turn: Math.round(turn * 10) / 10,
      ext: Math.round((close / bh - 1) * 1000) / 10, tags,
    };
  }
  return null;
}

async function fetchNiftyMap() {
  for (const sym of ["^NSEI", "NIFTYBEES"]) {
    const c = await fetchDaily2y(sym);
    if (c.length > 100) return new Map(c.map(x => [ymd(x.date), x.close]));
  }
  return null;
}

async function fetchDaily2y(sym) { return fetchOHLC(sym, "2y", "1d"); }

function vcpUniverse() {
  const v = $("vUniverse").value;
  if (v === "watch") return { name: `Watchlist: ${activeList().name}`, symbols: activeList().items.map(i => i.symbol) };
  if (v === "all") return { name: "All NSE stocks", symbols: NSE_SYMBOLS.map(([s]) => s) };
  return { name: state.mode === "letters" ? "Letters selection" : "Screener CSV", symbols: filteredStocks() };
}
function vcpUniverseLabels() {
  const sel = $("vUniverse"), cur = sel.value;
  const step1 = filteredStocks().length;
  sel.options[0].textContent = `Step 1 selection (${step1})`;
  sel.options[1].textContent = `Current watchlist: ${activeList().name} (${activeList().items.length})`;
  sel.options[2].textContent = `All NSE stocks (${NSE_SYMBOLS.length}, slow)`;
  sel.value = cur;
  if (!vcpBusy) $("vScan").textContent = `Scan ${vcpUniverse().symbols.length} stocks`;
}

async function runVcp() {
  if (vcpBusy) { vcpStop = true; return; }
  const u = vcpUniverse();
  if (!u.symbols.length) { toast("Choose stocks in Step 1 first"); return; }
  if (u.symbols.length > 600 && !confirm(`Scanning ${u.symbols.length} stocks downloads 2 years of data for each and may take a long time. Keep the app open. Continue?`)) return;
  const mode = $("vMode").value;
  if (mode === "learned" && !learned) { toast("Tap \u201CLearn from these trades\u201D first"); return; }
  const cfg = mode === "manas" ? manasSettings() : mode === "india" ? indiaSettings() : mode === "rvol" ? rvolSettings() : mode === "learned"
    ? { minSim: clampInt($("lSim").value, 50, 100, 85), widen: clampInt($("lWiden").value, 0, 100, 0), minPrice: 20 }
    : vcpSettings();
  vcpBusy = true; vcpStop = false;
  $("vScan").textContent = "Stop scan";
  $("vProg").hidden = false;
  const found = [];
  let done = 0, i = 0, noData = 0;
  const t0 = Date.now();
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  const upd = () => {
    $("vBar").style.width = `${(done / u.symbols.length) * 100}%`;
    const rate = done ? (Date.now() - t0) / done : 0;
    const left = rate ? Math.round((u.symbols.length - done) * rate / 60000) : null;
    $("vProgText").textContent = `${done} / ${u.symbols.length} scanned \u00B7 ${found.length} found${left !== null && left > 0 ? ` \u00B7 ~${left} min left` : ""}`;
  };
  upd();
  let nifty = null;
  if (mode === "india" || mode === "vcp" || mode === "learned" || mode === "manas") { $("vProgText").textContent = "Loading Nifty for relative strength\u2026"; nifty = await fetchNiftyMap(); upd(); }
  const allRs = [], tally = {};
  await Promise.all(Array.from({ length: Math.min(3, u.symbols.length) }, async () => {
    while (i < u.symbols.length && !vcpStop) {
      const sym = u.symbols[i++];
      const c = await fetchDaily2y(sym);
      if (!c.length) noData++;
      if (mode === "vcp" && c.length) allRs.push(rsScoreOf(c.map(x => x.close)));
      let r = c.length ? (mode === "manas" ? analyseManas(c, nifty, cfg) : mode === "india" ? analyseIndia(c, nifty, cfg) : mode === "rvol" ? analyseRvol(c, cfg) : mode === "learned" ? analyseLearned(c, nifty, cfg) : analyseVcp(c, cfg, nifty)) : null;
      if (mode === "vcp" && r) {
        (r.fails.length ? r.fails : ["ok"]).forEach(f => (tally[f] = (tally[f] || 0) + 1));
        if (!r.mode || r.fails.length > (cfg.nearMiss ? 1 : 0)) r = null;   // keep matches (+ near misses)
      }
      if (r) { found.push({ symbol: sym, ...r }); if (c.length) livePrice[sym] = { close: r.close, date: r.date }; }
      done++; upd();
      if (found.length && done % 10 === 0) { vcp = { results: sortVcp(mode === "vcp" ? finalizeVcp(found, allRs, cfg) : found), scanned: done, universe: u.name, at: Date.now(), mode }; renderVcp(); }
    }
  }));
  const finalList = mode === "vcp" ? finalizeVcp(found, allRs, cfg) : found;
  vcp = { results: sortVcp(finalList), scanned: done, universe: u.name, at: Date.now(), stopped: vcpStop, noData, mode, niftyOk: mode !== "india" || !!nifty, rsRanked: allRs.filter(x => x !== null).length >= 60 };
  try { localStorage.setItem(VCP_KEY, JSON.stringify(vcp)); } catch {}
  try { wakeLock?.release(); } catch {}
  vcpBusy = false;
  $("vProgText").textContent = `${vcpStop ? "Stopped" : "Done"}: ${done} scanned, ${finalList.length} found${noData ? ` (${noData} without data)` : ""}${(mode === "india" || mode === "vcp") && !nifty ? ". Nifty data unavailable" : ""}${mode === "vcp" && allRs.filter(x => x !== null).length < 60 ? ". Fewer than 60 stocks, so RS is measured against Nifty instead of an RS rank" : ""}.`;
  if (mode === "vcp") {
    const items = Object.entries(tally).filter(([k]) => k !== "ok").sort((a, b) => b[1] - a[1]);
    $("vWhy").hidden = !items.length;
    $("vWhyList").innerHTML = "";
    for (const [k, v] of items) {
      const li = document.createElement("li");
      li.innerHTML = "<span></span><b></b>";
      li.querySelector("span").textContent = VCP_RULES[k] || k;
      li.querySelector("b").textContent = v;
      $("vWhyList").appendChild(li);
    }
  } else $("vWhy").hidden = true;
  vcpUniverseLabels();
  renderVcp();
}
// Classic: closest to pivot first. India: inside bars first, then the tightest risk
const sortVcp = arr => [...arr].sort((a, b) => a.mode === "india"
  ? (b.ib - a.ib) || (a.risk - b.risk)
  : a.mode === "rvol" ? (a.days - b.days) || (b.rvol - a.rvol)
  : a.mode === "manas" ? ((a.risk > 3) - (b.risk > 3)) || ((b.rsLineHigh ? 1 : 0) - (a.rsLineHigh ? 1 : 0)) || (b.mom - a.mom)
  : a.mode === "learned" ? (b.sim - a.sim) || (b.ib - a.ib) || (a.dist - b.dist)
  : a.mode === "vcp2" ? (!!a.near - !!b.near) || (b.score - a.score) || (a.dist - b.dist)
  : Math.abs(a.dist) - Math.abs(b.dist));

function vcpSource() {
  const order = vcp.results.map(r => r.symbol);
  return { kind: "vcp", name: vcp.mode === "manas" ? "Manas setups" : vcp.mode === "learned" ? "Learned scan" : vcp.mode === "india" ? "Momentum scan" : vcp.mode === "rvol" ? "RVOL breakouts" : "VCP scan", symbols: order, item: sym => vcp.results.find(r => r.symbol === sym) };
}

function renderVcp() {
  const box = $("vResults");
  box.innerHTML = "";
  const res = vcp.results || [];
  $("vActions").hidden = !res.length;
  $("vSummary").textContent = vcp.at
    ? `${res.length} found in ${vcp.universe} (${vcp.scanned} scanned, ${new Date(vcp.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })})`
    : "";
  for (const r of res) {
    const row = document.createElement("div");
    row.className = "vrow"; row.tabIndex = 0; row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Open ${r.symbol} chart`);
    if (r.mode === "manas") {
      row.classList.add("irow");
      row.innerHTML = `<b></b><span class="itags"></span><span class="ilev"></span><span class="vdist"></span>`;
      row.querySelector("b").textContent = r.symbol;
      const tg = row.querySelector(".itags");
      r.tags.forEach((t, i) => { const sp = document.createElement("span"); sp.className = "tag" + (i === 0 ? " pd" : t === "IB" ? " ib" : ""); sp.textContent = t; tg.appendChild(sp); });
      row.querySelector(".ilev").textContent = `Buy above \u20B9${r.trigger.toFixed(2)} \u00B7 stop ${r.stopType} \u20B9${r.sl.toFixed(2)} \u00B7 risk ${r.risk.toFixed(1)}%`;
      row.querySelector(".vdist").textContent = `${r.dist.toFixed(1)}% to trigger`;
      row.onclick = () => openChartWin(r.symbol, vcpSource());
      row.onkeydown = e => { if (e.key === "Enter") openChartWin(r.symbol, vcpSource()); };
      box.appendChild(row);
      continue;
    }
    if (r.mode === "learned") {
      row.classList.add("irow");
      row.innerHTML = `<b></b><span class="itags"></span><span class="ilev"></span><span class="vdist"></span>`;
      const bEl = row.querySelector("b");
      const gr = document.createElement("span"); gr.className = `grade ${r.sim >= 95 ? "gA" : r.sim >= 85 ? "gB" : "gC"}`; gr.textContent = `${r.sim}%`;
      bEl.textContent = r.symbol + " "; bEl.appendChild(gr);
      const tg = row.querySelector(".itags");
      [r.like ? `Like ${r.like}` : null, r.ib ? "IB" : null, `Tight ${r.f.tight5.toFixed(1)}%`, r.f.rs !== null ? `RS ${r.f.rs >= 0 ? "+" : ""}${r.f.rs.toFixed(0)}` : null, `Mom ${r.f.mom.toFixed(0)}%`, ...r.misses.map(m => `\u2717 ${m}`)]
        .filter(Boolean).forEach(t => { const sp = document.createElement("span"); sp.className = "tag" + (t === "IB" ? " ib" : t.startsWith("Like") ? " pd" : t.startsWith("\u2717") ? " miss" : ""); sp.textContent = t; tg.appendChild(sp); });
      row.querySelector(".ilev").textContent = `Trigger \u20B9${r.trigger.toFixed(2)} \u00B7 SL \u20B9${r.sl.toFixed(2)} (2%) or today's low \u20B9${r.todayLow.toFixed(2)}`;
      const dd = row.querySelector(".vdist");
      dd.textContent = `${r.dist.toFixed(1)}% to trigger`;
      row.onclick = () => openChartWin(r.symbol, vcpSource());
      row.onkeydown = e => { if (e.key === "Enter") openChartWin(r.symbol, vcpSource()); };
      box.appendChild(row);
      continue;
    }
    if (r.mode === "vcp2") {
      row.classList.add("irow");
      row.innerHTML = `<b></b><span class="itags"></span><span class="ilev"></span><span class="vdist"></span>`;
      const bEl = row.querySelector("b");
      const gr = document.createElement("span"); gr.className = `grade g${r.grade}`; gr.textContent = `${r.grade} ${r.score}`;
      bEl.textContent = r.symbol + " "; bEl.appendChild(gr);
      const tg = row.querySelector(".itags");
      const tagList = [r.near ? `Near miss: ${r.near}` : r.status, r.depths.map(d => d.toFixed(0) + "%").join("\u2192"), r.rsRank !== null ? `RS ${r.rsRank}` : (r.rsNifty !== null ? `vs Nifty ${r.rsNifty >= 0 ? "+" : ""}${r.rsNifty.toFixed(0)}` : null), `Vol ${r.volRatio.toFixed(2)}\u00D7`, `${r.baseWeeks}w base`].filter(Boolean);
      tagList.forEach((t, k) => { const sp = document.createElement("span"); sp.className = "tag" + (k === 0 ? (r.volBreak ? " pd" : r.breakout ? " ib" : "") : ""); sp.textContent = t; tg.appendChild(sp); });
      row.querySelector(".ilev").textContent = `Pivot \u20B9${r.pivot.toFixed(2)} \u00B7 SL \u20B9${r.sl.toFixed(2)} \u00B7 risk ${r.risk.toFixed(1)}%`;
      const dd = row.querySelector(".vdist");
      dd.textContent = r.dist <= 0 ? `${Math.abs(r.dist).toFixed(1)}% above` : `${r.dist.toFixed(1)}% below`;
      if (r.dist <= 0) dd.classList.add("up");
      row.onclick = () => openChartWin(r.symbol, vcpSource());
      row.onkeydown = e => { if (e.key === "Enter") openChartWin(r.symbol, vcpSource()); };
      box.appendChild(row);
      continue;
    }
    if (r.mode === "rvol") {
      row.classList.add("irow");
      row.innerHTML = `<b></b><span class="itags"></span><span class="ilev"></span><span class="vdist"></span>`;
      row.querySelector("b").textContent = r.symbol;
      const tg = row.querySelector(".itags");
      r.tags.forEach(t => { const sp = document.createElement("span"); sp.className = "tag" + (t === "Purple dot" ? " pd" : ""); sp.textContent = t; tg.appendChild(sp); });
      row.querySelector(".ilev").textContent = `Breakout \u20B9${r.level.toFixed(2)} \u00B7 SL \u20B9${r.sl.toFixed(2)} \u00B7 risk ${r.risk.toFixed(1)}%`;
      const de3 = row.querySelector(".vdist");
      de3.textContent = r.ext >= 0 ? `${r.ext.toFixed(1)}% above` : `${Math.abs(r.ext).toFixed(1)}% below`;
      de3.classList.add(r.ext >= 0 ? "up" : "down");
      row.onclick = () => openChartWin(r.symbol, vcpSource());
      row.onkeydown = e => { if (e.key === "Enter") openChartWin(r.symbol, vcpSource()); };
      box.appendChild(row);
      continue;
    }
    if (r.mode === "india") {
      row.classList.add("irow");
      row.innerHTML = `<b></b><span class="itags"></span><span class="ilev"></span><span class="vdist"></span>`;
      row.querySelector("b").textContent = r.symbol;
      const tg = row.querySelector(".itags");
      r.tags.forEach(t => { const sp = document.createElement("span"); sp.className = "tag" + (t.startsWith("IB") ? " ib" : ""); sp.textContent = t; tg.appendChild(sp); });
      row.querySelector(".ilev").textContent = `Entry \u20B9${r.entry.toFixed(2)} \u00B7 SL \u20B9${r.sl.toFixed(2)} \u00B7 risk ${r.risk.toFixed(1)}%`;
      const de2 = row.querySelector(".vdist");
      de2.textContent = r.dist <= 0 ? "Triggered" : `${r.dist.toFixed(1)}% to entry`;
      if (r.dist <= 0) de2.classList.add("up");
      row.onclick = () => openChartWin(r.symbol, vcpSource());
      row.onkeydown = e => { if (e.key === "Enter") openChartWin(r.symbol, vcpSource()); };
      box.appendChild(row);
      continue;
    }
    row.innerHTML = `<b></b><span class="vdep"></span><span class="vpiv"></span><span class="vdist"></span><span class="vvol"></span>`;
    row.querySelector("b").textContent = r.symbol;
    row.querySelector(".vdep").textContent = r.depths.map(d => d.toFixed(0) + "%").join(" \u2192 ");
    row.querySelector(".vpiv").textContent = `Pivot \u20B9${r.pivot.toFixed(2)}`;
    const de = row.querySelector(".vdist");
    de.textContent = r.dist <= 0 ? `${Math.abs(r.dist).toFixed(1)}% above` : `${r.dist.toFixed(1)}% below`;
    if (r.dist <= 0) de.classList.add("up");
    row.querySelector(".vvol").textContent = `Vol ${r.volRatio.toFixed(2)}\u00D7`;
    row.onclick = () => openChartWin(r.symbol, vcpSource());
    row.onkeydown = e => { if (e.key === "Enter") openChartWin(r.symbol, vcpSource()); };
    box.appendChild(row);
  }
}

$("vScan").onclick = runVcp;
function vcpModeUI() {
  const m = $("vMode").value, india = m === "india";
  $("setIndia").hidden = m !== "india"; $("setVcp").hidden = m !== "vcp"; $("setRvol").hidden = m !== "rvol";
  $("learnBox").hidden = m !== "learned"; $("setLearned").hidden = m !== "learned"; $("setManas").hidden = m !== "manas";
  if (m === "manas") {
    $("vDesc").textContent = "Two setups seen in Manas Arora\u2019s posted entries: A) a tight 2-week base right under the high after a 30%+ run-up, B) a pullback into a rising 21 EMA. Liquid, volatile leaders incl. new listings. Each result gives a buy-above trigger and a low-of-day or 2% stop, like his #NewPosition posts.";
    try { localStorage.setItem("gc:vcpmode", m); } catch {}
    return;
  }
  if (m === "learned") {
    $("vDesc").textContent = "Learns from real trades: measures each example on the day before its entry, turns the middle 80% of those measurements into rules, then finds stocks that look the same today. Shows a trigger (like his entries, just above the day\u2019s high), a 2% / LOD stop, and which trade each match looks most like.";
    try { localStorage.setItem("gc:vcpmode", m); } catch {}
    return;
  }
  if (m === "rvol") {
    $("vDesc").textContent = "Purple-dot style breakouts: a strong up day (5%+) on 2\u00D7+ normal volume, closing near the day\u2019s high and above a recent base. Shows the breakout level, stop-loss (breakout-day low) and whether it\u2019s still holding.";
    try { localStorage.setItem("gc:vcpmode", m); } catch {}
    return;
  }
  $("vDesc").textContent = india
    ? "Momentum stocks resting quietly: big 3-month run-up, beating Nifty, liquid, tight 5-day range just above a rising 21 EMA, volume drying up. Inside bars (incl. Ankur Patel\u2019s 2-day pattern) are tagged and listed first, with entry and stop-loss."
    : "Minervini VCP: full Trend Template, RS rank 70+, a 30%+ run-up, then 2\u20136 pullbacks each shallower with higher lows, a tight final contraction on drying volume, price at the pivot. Each match is graded A / B / C.";
  try { localStorage.setItem("gc:vcpmode", $("vMode").value); } catch {}
}
$("vMode").onchange = vcpModeUI;
try { $("lExamples").value = localStorage.getItem("gc:learnText") || MANAS_EXAMPLES; } catch { $("lExamples").value = MANAS_EXAMPLES; }
$("lLearn").onclick = learnFromExamples;
$("lReset").onclick = () => { $("lExamples").value = MANAS_EXAMPLES; try { localStorage.removeItem("gc:learnText"); } catch {} };
renderLearned();
try { const m = localStorage.getItem("gc:vcpmode"); if (m) $("vMode").value = m; } catch {}
vcpModeUI();
$("vUniverse").onchange = vcpUniverseLabels;
$("vPdf").onclick = () => {
  const syms = vcp.results.map(r => r.symbol);
  if (!syms.length || state.busy) return;
  $("step3").hidden = false;
  $("step3").scrollIntoView({ behavior: "smooth", block: "start" });
  generate(syms);
};
$("vWatch").onclick = () => {
  const res = vcp.results;
  openPicker({
    title: `Add ${res.length} VCP stock${res.length > 1 ? "s" : ""} to\u2026`, mode: "target", exclude: null,
    onTarget: dest => {
      let n = 0;
      for (const r of res) {
        const note = r.mode === "manas"
          ? `Setup ${r.setup}: buy above \u20B9${r.trigger.toFixed(2)}, stop ${r.stopType} \u20B9${r.sl.toFixed(2)} (${r.risk}%)`
          : r.mode === "learned"
          ? `Learned ${r.sim}%${r.like ? `, like ${r.like}` : ""}: trigger \u20B9${r.trigger.toFixed(2)} SL \u20B9${r.sl.toFixed(2)}`
          : r.mode === "vcp2"
          ? `VCP ${r.grade}${r.score}: pivot \u20B9${r.pivot.toFixed(2)} SL \u20B9${r.sl.toFixed(2)} (${r.depths.map(d => d.toFixed(0)).join("\u2192")}%${r.rsRank !== null ? `, RS ${r.rsRank}` : ""})`
          : r.mode === "rvol"
          ? `RVOL breakout ${fmtD(r.bDate)}: level \u20B9${r.level.toFixed(2)} SL \u20B9${r.sl.toFixed(2)} (RVOL ${r.rvol}\u00D7, +${r.move}%)`
          : r.mode === "india"
          ? `Entry \u20B9${r.entry.toFixed(2)} SL \u20B9${r.sl.toFixed(2)} (${r.tags.join(", ")})`
          : `VCP pivot \u20B9${r.pivot.toFixed(2)} (${r.depths.map(d => d.toFixed(0)).join("\u2192")}%)`;
        const plan = r.mode === "manas" || r.mode === "learned" ? { entry: r.trigger, sl: r.sl } : r.mode === "india" ? { entry: r.entry, sl: r.sl } : r.mode === "vcp2" ? { entry: r.pivot, sl: r.sl } : r.mode === "rvol" ? { entry: r.close, sl: r.sl } : {};
        if (addToList(dest, { symbol: r.symbol, addedOn: ymd(new Date()), price: r.close, priceDate: r.date, note, source: "Scanner", ...plan })) n++;
      }
      wlSave(); refreshPrices(res.map(r => r.symbol));
      toast(`Added ${n} to ${dest.name}${res.length - n ? ` (${res.length - n} already there)` : ""}`);
    },
  });
};
$("vClear").onclick = () => { vcp = { results: [], scanned: 0, universe: "", at: null }; try { localStorage.removeItem(VCP_KEY); } catch {} renderVcp(); $("vProg").hidden = true; };
// keep the scan button's count current when Step 1 / watchlists change
const _refresh = refresh;
refresh = function () { _refresh(); vcpUniverseLabels(); };
const _renderWatch = renderWatch;
renderWatch = function () { _renderWatch(); vcpUniverseLabels(); };

restore();
$("pdOpts").hidden = !$("pdOn").checked;
refresh();
renderSaved();
renderVcp();
renderWatch();
refreshPrices();
