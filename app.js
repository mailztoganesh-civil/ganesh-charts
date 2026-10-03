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

async function fetchCandles(symbol, interval) {
  const range = rangeFor(interval, interval === "W" ? weeklyBars() : dailyBars());
  const yi = interval === "W" ? "1wk" : "1d";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${OHLC_API_BASE}?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${yi}`, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    const j = await res.json();
    if (!res.ok || !j.candles) return [];
    return j.candles.map(c => {
      const d = new Date((c.time + 19800) * 1000);
      return { date: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
    });
  } catch { return []; }
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
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
    while (i < list.length) {
      const sym = list[i++];
      try {
        const res = await fetch(`${OHLC_API_BASE}?symbol=${encodeURIComponent(sym)}&range=5d&interval=1d`, { cache: "no-store" });
        const j = await res.json();
        const last = j.candles && j.candles[j.candles.length - 1];
        if (last) {
          const d = new Date((last.time + 19800) * 1000);
          livePrice[sym] = { close: last.close, date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` };
        }
      } catch {}
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
  return (chartCache[sym] = { d, w, key, at: Date.now() });
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
  $("cwStatus").textContent = "No data for this stock right now.";
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
  if (r.mode === "india") {
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
  $("cwStatus").textContent = "No data for this stock right now.";
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
  const piv = [];
  let dir = 0, hi = start, lo = start;
  for (let i = start + 1; i <= end; i++) {
    if (dir === 0) {
      if (H[i] > H[hi]) hi = i;
      if (L[i] < L[lo]) lo = i;
      if (hi > lo && H[hi] >= L[lo] * (1 + pct)) { piv.push({ t: "L", i: lo }); dir = 1; }
      else if (lo > hi && L[lo] <= H[hi] * (1 - pct)) { piv.push({ t: "H", i: hi }); dir = -1; }
    } else if (dir === 1) {
      if (H[i] > H[hi]) hi = i;
      if (L[i] <= H[hi] * (1 - pct)) {
        piv.push({ t: "H", i: hi }); dir = -1;
        lo = hi + 1; for (let k = hi + 1; k <= i; k++) if (L[k] < L[lo]) lo = k;
      }
    } else {
      if (L[i] < L[lo]) lo = i;
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

function vcpSettings() {
  return {
    trend: $("vTrend").checked,
    lookback: +$("vLook").value,
    minC: clampInt($("vMinC").value, 2, 5, 2),
    maxFirst: clampInt($("vMaxFirst").value, 5, 60, 35),
    maxLast: clampInt($("vMaxLast").value, 2, 30, 12),
    maxDist: clampInt($("vDist").value, 1, 25, 6),
    volOn: $("vVol").checked,
    volMax: Math.max(0.2, Math.min(1.5, parseFloat($("vVolMax").value) || 0.8)),
    minPrice: Math.max(0, parseFloat($("vMinPrice").value) || 0),
  };
}

function analyseVcp(c, cfg) {
  const n = c.length;
  if (n < 230) return null;                          // need ~1 year for SMA200 + slope
  const C = c.map(x => x.close), H = c.map(x => x.high), L = c.map(x => x.low), V = c.map(x => x.volume);
  const last = n - 1, close = C[last];
  if (close < cfg.minPrice) return null;
  let trend = false;
  {
    const s50 = smaAt(C, last, 50), s150 = smaAt(C, last, 150), s200 = smaAt(C, last, 200), s200b = smaAt(C, last - 22, 200);
    let hi52 = -Infinity, lo52 = Infinity;
    for (let k = Math.max(0, n - 252); k < n; k++) { hi52 = Math.max(hi52, H[k]); lo52 = Math.min(lo52, L[k]); }
    trend = close > s50 && s50 > s150 && s150 > s200 && s200 > s200b && close >= hi52 * 0.75 && close >= lo52 * 1.3;
    if (cfg.trend && !trend) return null;
  }
  const start = Math.max(0, n - cfg.lookback);
  const piv = zigzag(H, L, start, last, 0.04);
  // base starts at the highest swing high in the lookback
  let baseK = -1;
  piv.forEach((p, k) => { if (p.t === "H" && !p.tent && (baseK < 0 || H[p.i] > H[piv[baseK].i])) baseK = k; });
  if (baseK < 0) return null;
  const depths = [];
  let pivot = null;
  for (let k = baseK; k < piv.length - 1; k++) {
    if (piv[k].t !== "H" || piv[k + 1].t !== "L") continue;
    const ph = H[piv[k].i], tl = L[piv[k + 1].i];
    depths.push((ph - tl) / ph * 100);
    pivot = ph;
  }
  if (depths.length < cfg.minC || pivot === null) return null;
  if (depths[0] > cfg.maxFirst) return null;
  for (let k = 1; k < depths.length; k++) if (depths[k] >= depths[k - 1]) return null;   // each pullback shallower
  if (depths[depths.length - 1] > cfg.maxLast) return null;
  const dist = (pivot - close) / pivot * 100;           // + below pivot, − above (breakout)
  if (dist > cfg.maxDist || dist < -3) return null;
  const v10 = smaAt(V, last, 10), v50 = smaAt(V, last, 50);
  const volRatio = v50 > 0 ? v10 / v50 : 1;
  if (cfg.volOn && volRatio > cfg.volMax) return null;
  return { depths: depths.map(d => Math.round(d * 10) / 10), pivot, close, dist: Math.round(dist * 10) / 10, volRatio: Math.round(volRatio * 100) / 100, trend, date: ymd(c[last].date) };
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

async function fetchNiftyMap() {
  for (const sym of ["^NSEI", "NIFTYBEES"]) {
    const c = await fetchDaily2y(sym);
    if (c.length > 100) return new Map(c.map(x => [ymd(x.date), x.close]));
  }
  return null;
}

async function fetchDaily2y(sym) {
  try {
    const res = await fetch(`${OHLC_API_BASE}?symbol=${encodeURIComponent(sym)}&range=2y&interval=1d`, { cache: "no-store" });
    const j = await res.json();
    if (!res.ok || !j.candles) return [];
    return j.candles.filter(x => x.close > 0 && x.high > 0 && x.low > 0).map(x => {
      const d = new Date((x.time + 19800) * 1000);
      return { date: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume || 0 };
    });
  } catch { return []; }
}

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
  const cfg = mode === "india" ? indiaSettings() : vcpSettings();
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
  if (mode === "india") { $("vProgText").textContent = "Loading Nifty for relative strength\u2026"; nifty = await fetchNiftyMap(); upd(); }
  await Promise.all(Array.from({ length: Math.min(5, u.symbols.length) }, async () => {
    while (i < u.symbols.length && !vcpStop) {
      const sym = u.symbols[i++];
      const c = await fetchDaily2y(sym);
      if (!c.length) noData++;
      const r = c.length ? (mode === "india" ? analyseIndia(c, nifty, cfg) : analyseVcp(c, cfg)) : null;
      if (r) { found.push({ symbol: sym, ...r }); if (c.length) livePrice[sym] = { close: r.close, date: r.date }; }
      done++; upd();
      if (found.length && done % 10 === 0) { vcp = { results: sortVcp(found), scanned: done, universe: u.name, at: Date.now(), mode }; renderVcp(); }
    }
  }));
  vcp = { results: sortVcp(found), scanned: done, universe: u.name, at: Date.now(), stopped: vcpStop, noData, mode, niftyOk: mode !== "india" || !!nifty };
  try { localStorage.setItem(VCP_KEY, JSON.stringify(vcp)); } catch {}
  try { wakeLock?.release(); } catch {}
  vcpBusy = false;
  $("vProgText").textContent = `${vcpStop ? "Stopped" : "Done"}: ${done} scanned, ${found.length} found${noData ? ` (${noData} without data)` : ""}${mode === "india" && !nifty ? ". Nifty data unavailable, RS filter skipped" : ""}.`;
  vcpUniverseLabels();
  renderVcp();
}
// Classic: closest to pivot first. India: inside bars first, then the tightest risk
const sortVcp = arr => [...arr].sort((a, b) => a.mode === "india"
  ? (b.ib - a.ib) || (a.risk - b.risk)
  : Math.abs(a.dist) - Math.abs(b.dist));

function vcpSource() {
  const order = vcp.results.map(r => r.symbol);
  return { kind: "vcp", name: vcp.mode === "india" ? "Momentum scan" : "VCP scan", symbols: order, item: sym => vcp.results.find(r => r.symbol === sym) };
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
  const india = $("vMode").value === "india";
  $("setIndia").hidden = !india; $("setVcp").hidden = india;
  $("vDesc").textContent = india
    ? "Momentum stocks resting quietly: big 3-month run-up, beating Nifty, liquid, tight 5-day range just above a rising 21 EMA, volume drying up. Inside bars (incl. Ankur Patel\u2019s 2-day pattern) are tagged and listed first, with entry and stop-loss."
    : "Classic Minervini VCP: stage 2 uptrend, 2+ pullbacks each shallower than the last, volume drying up, price near the pivot.";
  try { localStorage.setItem("gc:vcpmode", $("vMode").value); } catch {}
}
$("vMode").onchange = vcpModeUI;
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
        const note = r.mode === "india"
          ? `Entry \u20B9${r.entry.toFixed(2)} SL \u20B9${r.sl.toFixed(2)} (${r.tags.join(", ")})`
          : `VCP pivot \u20B9${r.pivot.toFixed(2)} (${r.depths.map(d => d.toFixed(0)).join("\u2192")}%)`;
        if (addToList(dest, { symbol: r.symbol, addedOn: ymd(new Date()), price: r.close, priceDate: r.date, note, source: "Scanner" })) n++;
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
refresh();
renderSaved();
renderVcp();
renderWatch();
refreshPrices();
