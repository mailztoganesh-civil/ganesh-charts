/* Save as PDF / JPEG.
 *  - Header ⤓ button: this page (the open tab, or the open detail sheet) as JPEG or PDF, or every setup in the
 *    open tab as one PDF (one page per setup: its detail sheet with charts and levels).
 *  - ⤓ button in each detail sheet: that setup as JPEG or PDF.
 * The two libraries (html2canvas, jsPDF) are loaded from cdnjs the first time they are needed.
 * On iPhone / iPad the file goes to the share sheet (Save to Files / Photos); elsewhere it downloads. */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const LIBS = { h2c: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
               pdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" };
const loaded = {};
function load(url) {
  if (!loaded[url]) loaded[url] = new Promise((ok, bad) => { const s = document.createElement("script"); s.src = url; s.onload = ok;
    s.onerror = () => { delete loaded[url]; bad(new Error("Couldn't load the export tool – check the internet connection.")); }; document.head.appendChild(s); });
  return loaded[url];
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
const bg = () => getComputedStyle(document.body).backgroundColor || "#110D1A";
const tabName = () => $("#swView") && !$("#swView").hidden ? "ICT-4H-Sweep" : "Forex-CRT";
function status(t) { const el = $("#exState"); if (el) el.textContent = t; }

/* Render one element (its full height, also the part scrolled out of view) to a canvas. */
async function shoot(el) {
  await load(LIBS.h2c);
  const isPanel = el.classList.contains("panel");
  return window.html2canvas(el, {
    backgroundColor: isPanel ? getComputedStyle(el).backgroundColor : bg(), scale: Math.min(2, window.devicePixelRatio || 1.5), useCORS: true, logging: false,
    windowWidth: document.documentElement.clientWidth, windowHeight: Math.max(document.documentElement.scrollHeight, el.scrollHeight + 200),
    onclone: doc => {                              // in the copy: let the detail sheet grow to its full height
      doc.querySelectorAll(".sheet").forEach(s => { s.style.position = "static"; s.style.background = "transparent"; });
      doc.querySelectorAll(".sheet .panel").forEach(p => { p.style.maxHeight = "none"; p.style.overflow = "visible"; p.style.borderRadius = "0"; });
      doc.querySelectorAll("#exBtn,.exx,#dClose,#swClose").forEach(b => { b.style.visibility = "hidden"; });
    } });
}
async function save(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const jpeg = c => new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
async function pdfOf(canvases, name) {
  await load(LIBS.pdf);
  const { jsPDF } = window.jspdf;
  let doc = null;
  for (const c of canvases) {                    // each page is exactly the size of its picture
    const w = c.width / 2, h = c.height / 2, o = w > h ? "l" : "p";
    if (!doc) doc = new jsPDF({ orientation: o, unit: "px", format: [w, h], hotfixes: ["px_scaling"], compress: true });
    else doc.addPage([w, h], o);
    doc.addImage(c.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, w, h);
  }
  await save(doc.output("blob"), name);
}
/* What "this page" is: an open detail sheet, else the open tab. */
function current() {
  const sw = $("#swSheet"), cr = $("#sheet");
  if (sw && !sw.hidden) return { el: sw.querySelector(".panel"), name: ($("#swTitle").textContent || "setup").replace(/[^\w]+/g, "-") };
  if (cr && !cr.hidden) return { el: cr.querySelector(".panel"), name: ($("#dTitle").textContent || "setup").replace(/[^\w]+/g, "-") };
  return { el: !$("#swView").hidden ? $("#swView") : $("#crtView"), name: tabName() };
}
async function run(kind, target) {
  closeMenu();
  try {
    const t = target || current();
    status("Preparing…");
    const c = await shoot(t.el);
    if (kind === "jpeg") await save(await jpeg(c), `${t.name}_${stamp()}.jpg`);
    else await pdfOf([c], `${t.name}_${stamp()}.pdf`);
    status("");
  } catch (e) { status(e.message || "Export failed."); alertBox(e.message || "Export failed."); }
}
/* Every setup in the open tab -> one PDF, one page per setup (opens each detail sheet in turn). */
async function runAll() {
  closeMenu();
  const sweep = !$("#swView").hidden;
  const rows = sweep ? [...document.querySelectorAll("#swView tr[data-sw]")] : [...document.querySelectorAll("#list .row")];
  if (!rows.length) { alertBox("No setups on this page to save."); return; }
  const sheet = sweep ? $("#swSheet") : $("#sheet"), close = sweep ? $("#swClose") : $("#dClose");
  const pages = [];
  try {
    pages.push(await shoot(sweep ? $("#swView") : $("#crtView")));       // page 1: the screener itself
    for (let i = 0; i < rows.length; i++) {
      status(`Page ${i + 2} of ${rows.length + 1}…`); toast(`Saving ${i + 1} / ${rows.length}…`);
      rows[i].click(); await sleep(250);
      if (sheet.hidden) continue;
      pages.push(await shoot(sheet.querySelector(".panel")));
      close.click(); await sleep(60);
    }
    toast("Making the PDF…");
    await pdfOf(pages, `${tabName()}_all-setups_${stamp()}.pdf`);
    status(""); toast("");
  } catch (e) { if (!sheet.hidden) close.click(); toast(""); alertBox(e.message || "Export failed."); }
}

/* ---------- small UI: header button + menu, ⤓ in each detail sheet ---------- */
function toast(t) {
  let el = $("#exToast");
  if (!el) { el = document.createElement("div"); el.id = "exToast"; el.className = "extoast"; document.body.appendChild(el); }
  el.textContent = t; el.hidden = !t;
}
function alertBox(t) { toast(t); setTimeout(() => toast(""), 3500); }
function closeMenu() { const m = $("#exMenu"); if (m) m.hidden = true; }
function menu() {
  const m = $("#exMenu"); const sheetOpen = !$("#swSheet").hidden || !$("#sheet").hidden;
  $("#exWhat").textContent = sheetOpen ? "This setup (the open detail)" : `This page (${!$("#swView").hidden ? "ICT 4H Sweep" : "CRT"} tab)`;
  $("#exAll").hidden = sheetOpen;
  m.hidden = !m.hidden;
}
const btn = document.createElement("button");
btn.id = "exBtn"; btn.type = "button"; btn.setAttribute("aria-label", "Save as PDF or JPEG"); btn.textContent = "⤓";
$("#refresh").before(btn);
const m = document.createElement("div"); m.id = "exMenu"; m.className = "exmenu"; m.hidden = true;
m.innerHTML = `<div class="muted" id="exWhat"></div>
  <button type="button" data-k="jpeg">Save as JPEG</button><button type="button" data-k="pdf">Save as PDF</button>
  <button type="button" id="exAll">All setups on this tab → one PDF</button><div class="muted" id="exState"></div>`;
document.body.appendChild(m);
btn.onclick = e => { e.stopPropagation(); menu(); };
m.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; e.stopPropagation(); if (b.id === "exAll") runAll(); else run(b.dataset.k); });
document.addEventListener("click", e => { if (!e.target.closest("#exMenu")) closeMenu(); });
// ⤓ in each detail sheet (next to Close) - opens the same menu for that setup
for (const id of ["#dClose", "#swClose"]) {
  const c = $(id); if (!c) continue;
  const b = document.createElement("button"); b.type = "button"; b.className = "x exx"; b.textContent = "⤓"; b.setAttribute("aria-label", "Save this setup");
  b.onclick = e => { e.stopPropagation(); menu(); }; c.before(b);
}
window.FXExport = { run, runAll };
})();
