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

  // Watchlist entry: dashed line at the added price + star on the added candle
  if (mark && mark.price) {
    if (mark.price >= minP && mark.price <= maxP) {
      const y = Y(mark.price);
      ctx.save();
      ctx.strokeStyle = "rgba(124,58,237,0.9)"; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(leftPad, y); ctx.lineTo(CW - rightPad, y); ctx.stroke();
      ctx.restore();
      ctx.font = `bold 9px ${FONT}`; ctx.fillStyle = "rgb(124,58,237)"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`Added ${mark.price.toFixed(2)}`, CW - rightPad + 4, y);
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

/* ───────── Watchlist (stocks picked while studying the PDF) ───────── */
const WKEY = "gc:watch";
let watch = [];
try { watch = JSON.parse(localStorage.getItem(WKEY) || "[]"); } catch { watch = []; }
const livePrice = {};   // symbol -> { close, date } fetched this session

function watchSave() { try { localStorage.setItem(WKEY, JSON.stringify(watch)); } catch {} renderWatch(); }
function watchHas(sym) { return watch.some(w => w.symbol === sym); }
function watchAdd(item) { if (!watchHas(item.symbol)) { watch.unshift(item); watchSave(); refreshPrices([item.symbol]); } }
function watchRemove(sym) { watch = watch.filter(w => w.symbol !== sym); watchSave(); }

function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 1800);
}

function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);
}
function fmtD(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${+d} ${MON[+m - 1]} ${y.slice(2)}`;
}

let watchOrder = [];
function renderWatch() {
  $("watchCard").hidden = !watch.length;
  $("wCount").textContent = watch.length;
  const sort = $("wSort").value;
  const chg = w => (w.price && livePrice[w.symbol] ? (livePrice[w.symbol].close - w.price) / w.price * 100 : null);
  const list = [...watch];
  if (sort === "best") list.sort((a, b) => (chg(b) ?? -1e9) - (chg(a) ?? -1e9));
  else if (sort === "worst") list.sort((a, b) => (chg(a) ?? 1e9) - (chg(b) ?? 1e9));
  else if (sort === "az") list.sort((a, b) => a.symbol.localeCompare(b.symbol));
  watchOrder = list.map(w => w.symbol);
  const box = $("watchList");
  box.innerHTML = "";
  for (const w of list) {
    const lp = livePrice[w.symbol], c = chg(w);
    const row = document.createElement("div");
    row.className = "wrow";
    row.innerHTML = `
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
      ce.title = `${days} day${days === 1 ? "" : "s"}`;
      const sub = document.createElement("small");
      sub.textContent = `${days}d`;
      ce.appendChild(sub);
    } else ce.textContent = "";
    row.querySelector(".note").onclick = () => {
      const v = prompt(`Note for ${w.symbol}`, w.note || "");
      if (v === null) return;
      w.note = v.trim(); watchSave();
    };
    row.querySelector(".del").onclick = e => {
      e.stopPropagation();
      if (!confirm(`Remove ${w.symbol} from watchlist?`)) return;
      watchRemove(w.symbol);
    };
    row.querySelector(".note").addEventListener("click", e => e.stopPropagation(), true);
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Open ${w.symbol} chart`);
    row.onclick = () => openChartWin(w.symbol);
    row.onkeydown = e => { if (e.key === "Enter") openChartWin(w.symbol); };
    box.appendChild(row);
  }
}

async function refreshPrices(symbols) {
  const list = symbols || watch.map(w => w.symbol);
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
$("wRefresh").onclick = () => refreshPrices();

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
  const on = !!(sym && watchHas(sym));
  $("vStar").textContent = on ? "\u2605 In watchlist" : "\u2606 Add";
  $("vStar").setAttribute("aria-pressed", String(on));
  $("vStar").disabled = !sym;
}
$("vStar").onclick = () => {
  const n = viewerPageN;
  const sym = viewerRec && viewerRec.stocks ? viewerRec.stocks[n - 1] : null;
  if (!sym) return;
  if (watchHas(sym)) { watchRemove(sym); toast(`Removed ${sym}`); }
  else {
    const c = viewerRec.closes && viewerRec.closes[n - 1];
    watchAdd({ symbol: sym, addedOn: ymd(new Date()), price: c ? c.close : null, priceDate: c ? c.date : null, note: "", source: viewerRec.name });
    toast(`\u2605 Added ${sym}${c ? ` at \u20B9${c.close.toFixed(2)}` : ""}`);
  }
  updateStar();
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

async function getCharts(sym) {
  const key = `${dailyBars()}|${weeklyBars()}`;
  const hit = chartCache[sym];
  if (hit && hit.key === key) return hit;
  const [d, w] = await Promise.all([fetchCandles(sym, "D"), fetchCandles(sym, "W")]);
  return (chartCache[sym] = { d, w, key });
}

function openChartWin(sym) {
  if (!watchOrder.length) return;
  cwIndex = Math.max(0, watchOrder.indexOf(sym));
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
}

async function showChartAt(i) {
  const n = watchOrder.length;
  if (!n) { closeChartWin(); return; }
  cwIndex = (i + n) % n;
  const sym = watchOrder[cwIndex];
  const w = watch.find(x => x.symbol === sym) || { symbol: sym };
  const token = ++cwToken;
  $("cwTitle").textContent = sym;
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

  const data = await getCharts(sym);
  if (token !== cwToken) return;                 // user already moved on
  const mark = { price: w.price, date: w.priceDate || w.addedOn };
  for (const [id, iv, c, bars] of [["cwDaily", "D", data.d, dailyBars()], ["cwWeekly", "W", data.w, weeklyBars()]]) {
    const cv = $(id);
    cv.width = CW * SCALE; cv.height = CH * SCALE;
    drawChart(cv, sym, iv, c, bars, mark);
  }
  $("cwStatus").hidden = !(data.d.length === 0 && data.w.length === 0);
  $("cwStatus").textContent = "No data for this stock right now.";
  // warm up the neighbours so Next / Prev feel instant
  [1, -1].forEach(k => { const s2 = watchOrder[(cwIndex + k + n) % n]; if (s2 && s2 !== sym) getCharts(s2).catch(() => {}); });
}

$("cwPrev").onclick = () => showChartAt(cwIndex - 1);
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
$("go").onclick = async () => {
  const stocks = filteredStocks();
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
};

restore();
refresh();
renderSaved();
renderWatch();
refreshPrices();
