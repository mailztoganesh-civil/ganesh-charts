/* Ganesh Charts — web version of the SwiftUI app
 * Screener CSV → date filter → daily + weekly charts per stock → PDF (842 × 1190 pt pages).
 * Data via your Cloudflare Worker (nse-charts-proxy) instead of calling Yahoo directly.
 */
const OHLC_API_BASE = "https://nse-charts-proxy.mailztoganesh.workers.dev";
const BATCH_SIZE = 5;          // same as the Swift app
const CW = 800, CH = 460, SCALE = 2;

const $ = id => document.getElementById(id);
const state = { stocks: [], byDate: {}, dates: [], busy: false, urls: [] };

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

function filteredStocks() {
  if (!$("useFilter").checked || !state.dates.length) return state.stocks;
  const from = $("fromDate").value, to = $("toDate").value;
  const seen = new Set();
  for (const [d, list] of Object.entries(state.byDate)) if (d >= from && d <= to) list.forEach(s => seen.add(s));
  return state.stocks.filter(s => seen.has(s));
}

function refresh() {
  const n = filteredStocks().length;
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
  $("step2").hidden = $("step3").hidden = !p.stocks.length;
  refresh();
}

$("csvFile").onchange = async () => {
  const f = $("csvFile").files[0];
  if (!f) return;
  const text = await f.text();
  $("csvFile").value = "";
  try { localStorage.setItem("gc:csv", JSON.stringify({ name: f.name, text })); } catch {}
  loadCSV(f.name, text);
  saveSettings();
};

/* Remember filter + split settings so a reload restores everything */
function saveSettings() {
  try {
    localStorage.setItem("gc:settings", JSON.stringify({
      useFilter: $("useFilter").checked, from: $("fromDate").value, to: $("toDate").value,
      split: document.querySelector('input[name="split"]:checked').value, splitN: $("splitN").value,
    }));
  } catch {}
}
function restore() {
  try {
    const c = JSON.parse(localStorage.getItem("gc:csv") || "null");
    if (c) loadCSV(c.name, c.text);
    const st = JSON.parse(localStorage.getItem("gc:settings") || "null");
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
async function fetchCandles(symbol, interval) {
  const range = interval === "W" ? "2y" : "6mo";
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

function drawChart(canvas, symbol, interval, candles) {
  const ctx = canvas.getContext("2d");
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const topPad = 44, bottomPad = 24, leftPad = 12, rightPad = 72, volH = 70, gap = 8, dateH = 18;
  const chartH = CH - topPad - bottomPad - volH - gap - dateH;
  const chartW = CW - leftPad - rightPad;
  const dc = candles.slice(-120);

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, CW, CH);
  watermark(ctx, CW / 2, CH / 2, 38, "rgba(191,217,255,0.35)");

  if (!dc.length) {
    ctx.font = `bold 18px ${FONT}`; ctx.fillStyle = "gray";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`No data for ${symbol}`, CW / 2, CH / 2);
    return false;
  }

  const s10 = sma(dc, 10), s20 = sma(dc, 20);
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
  for (let step = 0; step < 5; step++) {
    const idx = Math.floor(step * (dc.length - 1) / 4);
    const d = dc[idx].date;
    ctx.fillText(`${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, X(idx) - 14, dateY);
  }

  // Border
  ctx.strokeStyle = "rgb(191,191,191)"; ctx.lineWidth = 0.5;
  ctx.strokeRect(leftPad, topPad, chartW, chartH);
  return true;
}

/* ───────── PDF (port of buildPDF) ───────── */
const PW = 842, PH = 1190, M = 24, HDR = 52, FTR = 28;
const CHART_PDF_H = (PH - M * 2 - HDR - FTR - 8) / 2;

function pdfPage(doc, stock, dailyImg, weeklyImg) {
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
  label("DAILY CHART", dY);
  doc.addImage(dailyImg, "JPEG", M, dY + 16, PW - M * 2, CHART_PDF_H);
  const wY = dY + 16 + CHART_PDF_H + 8;
  label("WEEKLY CHART", wY);
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
    // View opens a new tab, so this page (and the other PDFs) stay put
    row.querySelector(".view").onclick = () => { if (!window.open(url, "_blank")) location.href = url; };
    // Save uses the iOS share sheet (Save to Files) when available
    row.querySelector(".dl").onclick = async () => {
      const file = new File([r.blob], r.name, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
      }
      const a = document.createElement("a");
      a.href = url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove();
    };
    box.appendChild(row);
  }
}
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
    for (let b = 0; b < chunk.length; b += BATCH_SIZE) {
      const batch = chunk.slice(b, b + BATCH_SIZE);
      const data = await Promise.all(batch.map(async s => [s, await fetchCandles(s, "D"), await fetchCandles(s, "W")]));
      for (const [s, d, w] of data) {
        const okD = drawChart(canvas, s, "D", d);
        const di = canvas.toDataURL("image/jpeg", 0.85);
        const okW = drawChart(canvas, s, "W", w);
        const wi = canvas.toDataURL("image/jpeg", 0.85);
        if (!okD && !okW) noData.push(s);
        if (!first) doc.addPage([PW, PH], "portrait");
        first = false;
        pdfPage(doc, s, di, wi);   // page goes straight into the PDF; images aren't kept
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
      await DB.put({ name, order: p, label: parts > 1 ? (from === to ? `Stock ${from}` : `Stocks ${from}\u2013${to}`) : `${chunk.length} stocks`, blob });
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
renderSaved();
