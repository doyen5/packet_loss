/* =========================================================
   PACKET LOSS DASHBOARD — JS v20
   ---------------------------------------------------------
   Corrections v20 :
   - initV19() appelée directement (les onglets, modales,
     wallboard fonctionnent enfin)
   - updateDataFreshness() appelée au boot et toutes les 60s
   - Mode "HUB auto" : détecte les HUBs liés aux sites
     analysés et affiche leurs voisins avec statut d'impact
   - Amélioration lisibilité dark mode (les couleurs
     viennent des CSS variables --chart-*)

   Conservé :
   - v19 : onglets Fiabilité/Corrélations/Heatmap/Prédictions,
     wallboard, aide, alertes actives, marqueurs, zoom sync
   - v18 : mode sombre, sauvegardes, annotations, seuils,
     overlay, comparaison, alertes email
   - v17 : sans export PDF/Image
   - v14 : KPI Taux de couverture
   - v13 : Vue jour / Vue brute
   - v12 : dtick D1 sur l'axe X
   - v11 : Clic marqueur → mode HUB actif
   ========================================================= */

"use strict";

/* =========================================================
   CONSTANTES
   ========================================================= */
const API_URL           = "api/packet_loss.php";
const ALERTS_SAVE_URL   = "api/save_alerts.php";
const ALERTS_TEST_URL   = "api/test_alert.php";
const LOCATION_URL      = "data/sites_location.json";
const DEFAULT_THRESHOLD = 0.1;
const HISTORICAL_SAMPLES = 7;

const LS_KEYS = {
  THEME:       "pl_theme",
  SAVED:       "pl_saved_analyses",
  ANNOTATIONS: "pl_annotations",
  THRESHOLDS:  "pl_site_thresholds",
  DEFAULT_THR: "pl_default_threshold",
  OVERLAY:     "pl_overlay_sites",
  AUTO_HUB:    "pl_auto_hub",
  WB_DURATION: "pl_wallboard_duration",
  WB_REFRESH:  "pl_wallboard_refresh"
};

const NETWORK_LINKS_URLS = {
  FH:   "data/lien_fh.geojson",
  FO:   "data/lien_fo.geojson",
  TR:   "data/lien_transmission.geojson",
  TOPO: "data/lien_wdm_topology.geojson"
};

const LINK_COLORS = { FH:"#f28c28", FO:"#a719d2", TR:"#2af010", TOPO:"#61daff" };
const LINK_LABELS = { FH:"FH", FO:"FO", TR:"Transmission", TOPO:"WDM" };
const CI_CENTER = [7.54, -5.55];
const CI_ZOOM   = 7;

const OVERLAY_COLORS = [
  "#2563eb","#f43f5e","#10b981","#f97316","#8b5cf6","#0ea5e9",
  "#a719d2","#eab308","#ec4899","#14b8a6","#f59e0b","#6366f1"
];

/* =========================================================
   ÉTAT GLOBAL
   ========================================================= */
let locationIndex    = {};
let networkLinks     = { FH: [], FO: [], TR: [], TOPO: [] };
let siteLinkIndex    = {};
let map              = null;
let mapMarkers       = [];
let mapLinkLayers    = {};
let lastResult       = null;
let lastFilteredRows = [];
let lastSiteStats    = [];
let chartViewMode    = "day";

let siteTrends    = {};
let networkGraph  = null;
let hubScores     = [];
let selectedHub   = null;

let siteThresholds   = {};
let defaultThreshold = DEFAULT_THRESHOLD;
let overlaySites     = [];
let currentAnnotations = {};
let pendingAnnotation  = null;

let compareMode      = false;
let compareResult    = null;

let correlationMatrix = null;
let correlationSites  = [];
let activeTab         = "sites";

let autoHubMode      = true;
let autoHubData      = null;

let wallboardState = {
  active: false,
  slideIndex: 0,
  timer: null,
  duration: 30,
  refresh: 10,
  slides: []
};

let rectFilterActive = false;
let rectFilter = null;

/* Heatmap sur la carte */
let heatmapLayer = null;
let heatmapActive = false;

const mapFilterState = {
  vendor:"ALL", linkType:"ALL",
  showSites:true, showFO:true, showFH:true, showTR:true, showTOPO:true
};

const hubFilterState = { active:false, hubSite:null, neighborSet:new Set() };

const $ = id => document.getElementById(id);

/* =========================================================
   HELPERS STORAGE
   ========================================================= */
function storageGet(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  }catch(_){ return fallback; }
}
function storageSet(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch(_){}
}

/* =========================================================
   SEUILS PAR SITE
   ========================================================= */
function thresholdFor(site){
  const s = normalizeSite(site);
  if(s && Object.prototype.hasOwnProperty.call(siteThresholds, s)){
    return Number(siteThresholds[s]);
  }
  return defaultThreshold;
}

/* =========================================================
   HELPER DÉFENSIF
   ========================================================= */
function safeOn(id, event, handler){
  const el = document.getElementById(id);
  if(!el){
    console.warn(`[DOM] Élément #${id} introuvable — écouteur "${event}" non attaché.`);
    return null;
  }
  el.addEventListener(event, handler);
  return el;
}

function checkRequiredElements(){
  const required = [
    "periodPreset","startDate","endDate","hourRange","vendor",
    "sitesFile","sitesPaste","excelFile","sitesFileName",
    "analyzeBtn","resetBtn","requestInfo","message",
    "dashboard","emptyState",
    "kSitesRequested","kSitesData","kRows","kMax","kAvg","kImpacted",
    "kNoData","kNoDataKpi","kDegrading","kStable","kImproving",
    "summaryVendor","summaryHourRange","summaryPeriod","summaryThreshold",
    "noDataPanel","noDataCount","noDataList",
    "globalChart","worstTableBody",
    "mapVendorFilter","mapLinkFilter",
    "toggleSites","toggleFO","toggleFH","toggleTR","toggleTOPO","toggleHubs",
    "mapLayout","map","mapInfo",
    "hubPanelToggle","hubPanelToggleFloat","hubList","hubDetails",
    "siteSearch","siteSort","trendFilter","siteGrid",
    "viewToggle",
    "darkModeBtn","savedBtn","alertsBtn",
    "saveAnalysisBtn","overlayBtn","autoHubBtn",
    "compareToggleBtn","compareBlock","thresholdsBtn"
  ];
  const missing = required.filter(id => !document.getElementById(id));
  if(missing.length) console.error("❌ Éléments HTML obligatoires manquants :", missing);
}

/* =========================================================
   STATUT SERVEUR
   ========================================================= */
function setStatus(text, state){
  const wrap = $("apiStatusWrap");
  const span = $("apiStatus");
  if(!wrap || !span) return;
  span.textContent = text;
  wrap.classList.remove("is-error","is-loading");
  if(state === "error")   wrap.classList.add("is-error");
  if(state === "loading") wrap.classList.add("is-loading");
}

/* =========================================================
   VÉRIFICATION DÉPENDANCES
   ========================================================= */
function checkDependencies(){
  const missing = [];
  if(typeof Plotly === "undefined") missing.push("Plotly");
  if(typeof L === "undefined") missing.push("Leaflet");
  if(missing.length){
    const msg = "Bibliothèques critiques manquantes : " + missing.join(", ");
    console.error(msg);
    const box = document.getElementById("message");
    if(box){ box.textContent = "⚠️ " + msg; box.classList.remove("hidden"); }
  }
}

/* =========================================================
   UTILITAIRES
   ========================================================= */
function normalizeSite(v){
  return String(v ?? "").replace(/\uFEFF/g,"").trim().toUpperCase();
}
function parseSitesText(text){
  const values = String(text ?? "").split(/[\s,;]+/).map(normalizeSite).filter(Boolean);
  return [...new Set(values)];
}
function formatNumber(v, digits=4){
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("fr-FR",{minimumFractionDigits:digits,maximumFractionDigits:digits})
    : "-";
}
function escapeHtml(v){
  return String(v ?? "").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
function toDateInput(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function formatDateFR(value){
  if(!value) return "-";
  const p = String(value).split("-");
  return p.length===3 ? `${p[2]}/${p[1]}/${p[0]}` : String(value);
}
function makeDateTime(row){
  const date = String(row.ladate || "").trim();
  const hour = String(row.hour ?? "00:00:00").trim();
  if(!date) return null;
  let h = hour;
  if(/^\d+$/.test(h))                h = `${h.padStart(2,"0")}:00:00`;
  else if(/^\d{1,2}:\d{2}$/.test(h)) h = `${h.padStart(5,"0")}:00`;
  return `${date}T${h}`;
}
function rowHour(row){
  const h = String(row.hour ?? "0").trim();
  const n = parseInt(h.split(":")[0], 10);
  return Number.isNaN(n) ? 0 : n;
}
function formatDuration(hours){
  const n = Number(hours) || 0;
  const rounded = Math.round(n);
  if (rounded <= 0) return "0h";
  if (rounded === 1) return "1h";
  return `${rounded}h`;
}
function animateCounter(el, finalText){
  if(!el) return;
  const isPercent = String(finalText).includes("%");
  const target = parseFloat(String(finalText).replace("%","").replace(/\s/g,"").replace(",","."));
  if(!Number.isFinite(target)){ el.textContent = finalText; return; }
  const digits = isPercent ? 4 : 0;
  const duration = 600;
  const start = performance.now();
  function step(now){
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = target * eased;
    const txt = isPercent
      ? value.toLocaleString("fr-FR",{minimumFractionDigits:digits,maximumFractionDigits:digits}) + "%"
      : Math.round(value).toLocaleString("fr-FR");
    el.textContent = txt;
    if(t < 1) requestAnimationFrame(step);
    else el.textContent = finalText;
  }
  requestAnimationFrame(step);
}
function countUniqueDays(rows){
  if(!rows || !rows.length) return 0;
  const days = new Set();
  rows.forEach(r => { const dt = makeDateTime(r); if(dt) days.add(dt.slice(0,10)); });
  return days.size;
}
function buildXAxisConfigDay(rows, options = {}){
  const nDays = countUniqueDays(rows);
  const tickangle = nDays > 12 ? -45 : 0;
  const extraBottom = nDays > 12 ? 20 : 0;
  return {
    axis: {
      type:"date",
      title: options.title !== undefined ? options.title : { text:"Date", font:{size:11,color:getChartTextColor()} },
      tickformat:"%d/%m", dtick:"D1", tickmode:"linear", tickangle,
      gridcolor: getChartGridColor(), linecolor: getChartLineColor(),
      tickfont:{ size: options.tickSize || 9.5, color: getChartTextColor() },
      automargin: true
    },
    extraBottom
  };
}
function buildXAxisConfigRaw(rows, options = {}){
  const nPoints = (rows || []).length;
  const tickangle = nPoints > 20 ? -45 : -30;
  const extraBottom = nPoints > 20 ? 30 : 20;
  return {
    axis: {
      type:"date",
      title: options.title !== undefined ? options.title : { text:"Date et heure", font:{size:11,color:getChartTextColor()} },
      tickformat:"%d/%m %H:%M",
      nticks: Math.min(nPoints, 20),
      tickangle, gridcolor: getChartGridColor(), linecolor: getChartLineColor(),
      tickfont:{ size: options.tickSize || 9.5, color: getChartTextColor() },
      automargin: true
    },
    extraBottom
  };
}
function computeFixedYRange(rows, site){
  const threshold = site ? thresholdFor(site) : defaultThreshold;
  const values = (rows || []).map(r => Number(r.packet_loss) || 0);
  const maxVal = values.length ? Math.max(...values) : 0;
  const upper = Math.max(threshold * 1.25, maxVal * 1.2, 0.05);
  return [0, upper];
}

/* Couleurs de charts selon le thème */
function isDark(){
  return document.documentElement.getAttribute("data-theme") === "dark";
}
function getChartBg(){ return isDark() ? "#131c2e" : "#ffffff"; }
function getChartGridColor(){ return isDark() ? "#1f2b44" : "#f8fafc"; }
function getChartLineColor(){ return isDark() ? "#2d3b5a" : "#e2e8f0"; }
function getChartTextColor(){ return isDark() ? "#cbd5e1" : "#64748b"; }

/* =========================================================
   MODE SOMBRE
   ========================================================= */
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  const btn = $("darkModeBtn");
  if(btn){
    const i = btn.querySelector("i");
    if(i) i.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }
  /* Redessine tous les charts si une analyse existe */
  if(lastResult && lastSiteStats.length){
    renderGlobalChart(lastFilteredRows);
    renderSiteGrid(lastSiteStats, lastFilteredRows);
    if(correlationSites.length && activeTab === "correlation") renderCorrelation();
    if(activeTab === "heatmap") renderHeatmap();
    if(!$("overlayPanel")?.classList.contains("hidden")) renderOverlayChart();
    if(compareResult) renderCompareResults();
  }
}
function initTheme(){
  const saved = storageGet(LS_KEYS.THEME, "light");
  applyTheme(saved);
  safeOn("darkModeBtn", "click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    storageSet(LS_KEYS.THEME, next);
    applyTheme(next);
  });
}

/* =========================================================
   SEUILS PAR SITE — INIT
   ========================================================= */
function initThresholds(){
  siteThresholds   = storageGet(LS_KEYS.THRESHOLDS, {});
  defaultThreshold = Number(storageGet(LS_KEYS.DEFAULT_THR, DEFAULT_THRESHOLD));
  const el = $("defaultThresholdValue");
  if(el) el.textContent = defaultThreshold.toFixed(2);
  const input = $("defaultThresholdInput");
  if(input) input.value = defaultThreshold;
}
function saveThresholds(){
  storageSet(LS_KEYS.THRESHOLDS, siteThresholds);
  storageSet(LS_KEYS.DEFAULT_THR, defaultThreshold);
}
function renderThresholdsList(){
  const list = $("thresholdsList");
  if(!list) return;
  const search = normalizeSite($("thresholdSearch")?.value || "");
  const entries = Object.entries(siteThresholds)
    .filter(([s]) => !search || s.includes(search))
    .sort((a,b) => a[0].localeCompare(b[0]));
  if(!entries.length){
    list.innerHTML = `<p class="thresholds-list__empty">Aucun seuil personnalisé. Utilisez le formulaire ci-dessous.</p>`;
    return;
  }
  list.innerHTML = entries.map(([site, val]) => `
    <div class="threshold-row" data-site="${escapeHtml(site)}">
      <span class="threshold-row__site">${escapeHtml(site)}</span>
      <span class="threshold-row__value">${Number(val).toFixed(2)} %</span>
      <button class="threshold-row__remove" data-remove="${escapeHtml(site)}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>`).join("");
  list.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      delete siteThresholds[btn.dataset.remove];
      saveThresholds();
      renderThresholdsList();
      if(lastResult) recomputeAndRerender();
    });
  });
}
function recomputeAndRerender(){
  if(!lastResult) return;
  const hourRange = $("hourRange")?.value || "all";
  const filteredRows = filterRowsByHour(lastResult.rows || [], hourRange);
  lastFilteredRows = filteredRows;
  const siteStats = recomputeSiteStats(lastResult.sites || [], filteredRows);
  lastSiteStats = siteStats;
  const impacted = siteStats.filter(s => Number(s.avg_packet_loss) > thresholdFor(s.Site)).length;
  animateCounter($("kImpacted"), String(impacted));
  const trendCounts = computeTrendCounts(siteStats, filteredRows);
  animateCounter($("kDegrading"), String(trendCounts.degrading));
  animateCounter($("kStable"),    String(trendCounts.stable));
  animateCounter($("kImproving"), String(trendCounts.improving));
  renderWorstTable(siteStats);
  renderSiteGrid(siteStats, filteredRows);
  renderGlobalChart(filteredRows);
  if(autoHubMode) renderHubsForAnalyzedSites();
}
function bindThresholdsModal(){
  safeOn("thresholdsBtn", "click", () => { renderThresholdsList(); openModal("thresholdsModal"); });
  safeOn("thresholdSearch", "input", renderThresholdsList);
  safeOn("thresholdAddBtn", "click", () => {
    const siteInput = $("thresholdSiteInput");
    const valueInput = $("thresholdValueInput");
    const site = normalizeSite(siteInput?.value || "");
    const value = Number(valueInput?.value || 0);
    if(!site || !value || value <= 0){
      return showMessage("Veuillez saisir un site valide et une valeur > 0.");
    }
    siteThresholds[site] = value;
    saveThresholds();
    siteInput.value = ""; valueInput.value = "";
    renderThresholdsList();
    showMessage(`Seuil de ${site} défini à ${value} %`);
    if(lastResult) recomputeAndRerender();
  });
  safeOn("defaultThresholdInput", "change", e => {
    const v = Number(e.target.value);
    if(v > 0){
      defaultThreshold = v;
      saveThresholds();
      const el = $("defaultThresholdValue");
      if(el) el.textContent = v.toFixed(2);
      if(lastResult) recomputeAndRerender();
    }
  });
}

/* =========================================================
   ANALYSES SAUVEGARDÉES
   ========================================================= */
function getSavedAnalyses(){ return storageGet(LS_KEYS.SAVED, []); }
function saveCurrentAnalysis(){
  if(!lastResult) return showMessage("Aucune analyse à sauvegarder.");
  const name = prompt("Nom de l'analyse :", `Analyse du ${new Date().toLocaleDateString("fr-FR")}`);
  if(!name) return;
  const entry = {
    id: "an_" + Date.now(),
    name,
    date: new Date().toISOString(),
    sites: parseSitesText($("sitesPaste")?.value || ""),
    start: $("startDate")?.value || "",
    end: $("endDate")?.value || "",
    vendor: $("vendor")?.value || "ALL",
    hourRange: $("hourRange")?.value || "all"
  };
  const all = getSavedAnalyses();
  all.unshift(entry);
  storageSet(LS_KEYS.SAVED, all.slice(0, 50));
  showMessage(`Analyse sauvegardée : ${name}`);
}
function renderSavedList(){
  const list = $("savedList");
  if(!list) return;
  const all = getSavedAnalyses();
  if(!all.length){
    list.innerHTML = `<div class="saved-empty">
      <i class="fa-solid fa-bookmark"></i>
      Aucune analyse sauvegardée pour le moment.<br>
      Lancez une analyse puis cliquez sur <strong>Sauvegarder</strong>.
    </div>`;
    return;
  }
  list.innerHTML = all.map(a => `
    <div class="saved-item" data-id="${escapeHtml(a.id)}">
      <div class="saved-item__main">
        <div class="saved-item__name">${escapeHtml(a.name)}</div>
        <div class="saved-item__meta">
          <span><i class="fa-regular fa-calendar"></i> ${formatDateFR(a.start)} → ${formatDateFR(a.end)}</span>
          <span><i class="fa-solid fa-tower-broadcast"></i> ${escapeHtml(a.vendor)}</span>
          <span><i class="fa-solid fa-location-dot"></i> ${a.sites.length} site(s)</span>
        </div>
      </div>
      <div class="saved-item__actions">
        <button class="saved-item__btn" data-load="${escapeHtml(a.id)}" title="Charger">
          <i class="fa-solid fa-play"></i>
        </button>
        <button class="saved-item__btn saved-item__btn--danger" data-delete="${escapeHtml(a.id)}" title="Supprimer">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`).join("");
  list.querySelectorAll("[data-load]").forEach(btn => {
    btn.addEventListener("click", () => loadSavedAnalysis(btn.dataset.load));
  });
  list.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => {
      const all = getSavedAnalyses().filter(x => x.id !== btn.dataset.delete);
      storageSet(LS_KEYS.SAVED, all);
      renderSavedList();
    });
  });
}
function loadSavedAnalysis(id){
  const entry = getSavedAnalyses().find(x => x.id === id);
  if(!entry) return;
  const p = $("sitesPaste"); if(p) p.value = entry.sites.join("\n");
  const s = $("startDate"); if(s) s.value = entry.start;
  const e = $("endDate"); if(e) e.value = entry.end;
  const v = $("vendor"); if(v) v.value = entry.vendor;
  const h = $("hourRange"); if(h) h.value = entry.hourRange;
  const pp = $("periodPreset"); if(pp) pp.value = "CUSTOM";
  closeModal("savedModal");
  showMessage(`Analyse "${entry.name}" chargée.`);
  runAnalysis();
}
function bindSavedModal(){
  safeOn("savedBtn", "click", () => { renderSavedList(); openModal("savedModal"); });
  safeOn("saveAnalysisBtn", "click", saveCurrentAnalysis);
}

/* =========================================================
   ANNOTATIONS
   ========================================================= */
function loadAnnotations(){ currentAnnotations = storageGet(LS_KEYS.ANNOTATIONS, {}); }
function saveAnnotations(){ storageSet(LS_KEYS.ANNOTATIONS, currentAnnotations); }
function openAnnotationModal(site, ts){
  pendingAnnotation = { site, ts };
  const ctx = $("annotationContext");
  if(ctx) ctx.textContent = `${site} • ${new Date(ts).toLocaleString("fr-FR")}`;
  const list = currentAnnotations[site] || [];
  const existing = list.find(a => Math.abs(a.ts - ts) < 60000);
  const del = $("annotationDeleteBtn");
  if(del) del.classList.toggle("hidden", !existing);
  const txt = $("annotationText");
  const typ = $("annotationType");
  if(existing){
    if(txt) txt.value = existing.text;
    if(typ) typ.value = existing.type;
  } else {
    if(txt) txt.value = "";
    if(typ) typ.value = "incident";
  }
  openModal("annotationModal");
}
function bindAnnotationModal(){
  safeOn("annotationSaveBtn", "click", () => {
    if(!pendingAnnotation) return;
    const text = ($("annotationText")?.value || "").trim();
    const type = $("annotationType")?.value || "info";
    if(!text) return showMessage("Veuillez saisir une note.");
    const site = pendingAnnotation.site;
    if(!currentAnnotations[site]) currentAnnotations[site] = [];
    currentAnnotations[site] = currentAnnotations[site].filter(a => Math.abs(a.ts - pendingAnnotation.ts) >= 60000);
    currentAnnotations[site].push({ ts: pendingAnnotation.ts, text, type });
    saveAnnotations();
    closeModal("annotationModal");
    const rows = lastFilteredRows.filter(r => normalizeSite(r.Site) === site);
    if(rows.length){
      const safeId = `chart-${site.replace(/[^A-Z0-9_-]/g,"-")}`;
      renderSiteChart(safeId, rows, site);
    }
  });
  safeOn("annotationDeleteBtn", "click", () => {
    if(!pendingAnnotation) return;
    const site = pendingAnnotation.site;
    currentAnnotations[site] = (currentAnnotations[site] || []).filter(a => Math.abs(a.ts - pendingAnnotation.ts) >= 60000);
    saveAnnotations();
    closeModal("annotationModal");
    const rows = lastFilteredRows.filter(r => normalizeSite(r.Site) === site);
    if(rows.length){
      const safeId = `chart-${site.replace(/[^A-Z0-9_-]/g,"-")}`;
      renderSiteChart(safeId, rows, site);
    }
  });
}

/* =========================================================
   MODALES
   ========================================================= */
function openModal(id){
  const m = $(id);
  if(!m) return;
  m.classList.remove("hidden");
}
function closeModal(id){
  const m = $(id);
  if(!m) return;
  m.classList.add("hidden");
}
function bindModalClosers(){
  document.querySelectorAll("[data-close]").forEach(el => {
    el.addEventListener("click", () => closeModal(el.dataset.close));
  });
  document.addEventListener("keydown", e => {
    if(e.key === "Escape"){
      document.querySelectorAll(".modal:not(.hidden)").forEach(m => m.classList.add("hidden"));
    }
  });
}

/* =========================================================
   PÉRIODE
   ========================================================= */
function setPeriod(period){
  const startEl = $("startDate");
  const endEl   = $("endDate");
  if(!startEl || !endEl) return;
  const end = new Date();
  let start = new Date(end);
  if(period==="7")       start.setDate(start.getDate()-6);
  else if(period==="14") start.setDate(start.getDate()-13);
  else if(period==="30") start.setDate(start.getDate()-29);
  if(period==="CUSTOM"){ startEl.disabled = false; endEl.disabled = false; return; }
  startEl.disabled = true;
  endEl.disabled   = true;
  startEl.value    = toDateInput(start);
  endEl.value      = toDateInput(end);
  const cur = $("compareCurrentRange");
  if(cur) cur.textContent = `${formatDateFR(startEl.value)} → ${formatDateFR(endEl.value)}`;
}
function initPeriod(){
  const presetEl = $("periodPreset");
  if(presetEl) presetEl.value = "7";
  setPeriod("7");
}

/* =========================================================
   IMPORTS
   ========================================================= */
safeOn("sitesFile", "change", async e => {
  const file = e.target.files[0]; if(!file) return;
  const nameEl = $("sitesFileName");
  if(nameEl) nameEl.textContent = file.name;
  const pasteEl = $("sitesPaste");
  if(pasteEl) pasteEl.value = parseSitesText(await file.text()).join("\n");
});
safeOn("excelFile", "change", async e => {
  const file = e.target.files[0]; if(!file) return;
  if(typeof XLSX === "undefined") return showMessage("Import Excel indisponible (XLSX manquant).");
  try{
    const wb = XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws,{defval:""});
    const sites = [];
    for(const row of rows){
      const key = Object.keys(row).find(k =>
        ["site","sites","site_id","siteid"].includes(String(k).trim().toLowerCase()));
      if(key){ const s = normalizeSite(row[key]); if(s) sites.push(s); }
    }
    const pasteEl = $("sitesPaste");
    if(pasteEl) pasteEl.value = [...new Set(sites)].join("\n");
    showMessage(`${new Set(sites).size} site(s) récupéré(s).`);
  }catch(err){ console.error(err); showMessage("Impossible de lire l'Excel."); }
});

/* =========================================================
   LOCALISATION + LIENS
   ========================================================= */
async function loadLocations(){
  try{
    const r = await fetch(LOCATION_URL,{cache:"no-store"});
    if(!r.ok) throw new Error("Référentiel absent");
    locationIndex = await r.json();
    const infoEl = $("mapInfo");
    if(infoEl) infoEl.textContent = `${Object.keys(locationIndex).length} localisations chargées.`;
  }catch(e){
    locationIndex = {};
    const infoEl = $("mapInfo");
    if(infoEl) infoEl.textContent = "Référentiel non disponible.";
  }
}
async function loadNetworkLinks(){
  await Promise.all(Object.entries(NETWORK_LINKS_URLS).map(async ([type, url]) => {
    try{
      const r = await fetch(url,{cache:"no-store"});
      if(!r.ok) throw new Error();
      const g = await r.json();
      networkLinks[type] = Array.isArray(g.features) ? g.features : [];
    }catch(_){ networkLinks[type] = []; }
  }));
  buildSiteLinkIndex();
}
function buildSiteLinkIndex(){
  siteLinkIndex = {};
  const RX = /\b([A-Z]{2}\d{3,4})\b/g;
  for(const type of ["FO","FH","TR","TOPO"]){
    for(const f of networkLinks[type] || []){
      const text = `${f.properties?.description || ""} ${f.properties?.name || ""}`;
      const ids = text.match(RX) || [];
      for(const id of ids){
        if(!siteLinkIndex[id]) siteLinkIndex[id] = {};
        siteLinkIndex[id][type] = true;
      }
    }
  }
}
function getSiteLinkInfo(siteId){
  const types = siteLinkIndex[siteId];
  if(!types) return { code:"unknown", label:"—", badgeClass:"unknown", dotClass:"unknown", icon:"" };
  const hasFO = !!types.FO, hasFH = !!types.FH, hasTR = !!types.TR, hasTOPO = !!types.TOPO;
  if(hasFO && hasFH) return { code:"both", label:"FO + FH", badgeClass:"both", dotClass:"both", icon:"fa-circle-nodes" };
  if(hasFO)          return { code:"fo",   label:"FO",   badgeClass:"fo",   dotClass:"fo",   icon:"fa-circle-nodes" };
  if(hasFH)          return { code:"fh",   label:"FH",   badgeClass:"fh",   dotClass:"fh",   icon:"fa-tower-broadcast" };
  if(hasTR)          return { code:"tr",   label:"Transmission", badgeClass:"tr", dotClass:"tr", icon:"fa-tower-cell" };
  if(hasTOPO)        return { code:"topo", label:"WDM", badgeClass:"topo", dotClass:"topo", icon:"fa-network-wired" };
  return { code:"unknown", label:"—", badgeClass:"unknown", dotClass:"unknown", icon:"" };
}

/* =========================================================
   FILTRE PLAGE HORAIRE
   ========================================================= */
function filterRowsByHour(rows, hourRange){
  if(!hourRange || hourRange === "all") return rows;
  const [start, end] = hourRange.split("-").map(Number);
  return rows.filter(row => {
    const h = rowHour(row);
    if(end === 24) return h >= start;
    return h >= start && h < end;
  });
}

/* =========================================================
   ANALYSE
   ========================================================= */
async function runAnalysis(){
  clearMessage();
  const sites  = parseSitesText($("sitesPaste")?.value || "");
  const start  = $("startDate")?.value || "";
  const end    = $("endDate")?.value || "";
  const vendor = $("vendor")?.value || "ALL";

  if(!sites.length)  return showMessage("Veuillez importer ou coller au moins un site.");
  if(!start || !end) return showMessage("Veuillez renseigner les dates.");
  if(start > end)    return showMessage("La date début doit être antérieure ou égale à la date fin.");

  const btn = $("analyzeBtn");
  if(btn){ btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyse...'; }
  setStatus("Analyse...", "loading");

  const infoEl = $("requestInfo");
  if(infoEl){
    infoEl.classList.remove("hidden");
    infoEl.textContent = `${sites.length} site(s) • ${start} → ${end}`;
  }

  try{
    const response = await fetch(API_URL,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ sites, vendor, start_date:start, end_date:end })
    });
    const result = await response.json();
    if(!response.ok || !result.success) throw new Error(result.message || "Erreur API.");
    lastResult = result;
    renderDashboard(result);
    setStatus("OK", "ok");
  }catch(e){
    console.error(e);
    showMessage(`Erreur : ${e.message}`);
    setStatus("Erreur", "error");
  }finally{
    if(btn){ btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Analyser'; }
  }
}

/* =========================================================
   RENDU DU DASHBOARD
   ========================================================= */
function renderDashboard(result){
  const dash  = $("dashboard");
  const empty = $("emptyState");
  if(dash) dash.classList.remove("hidden");
  if(empty) empty.classList.add("hidden");
  clearHubFilter();

  const hourRange    = $("hourRange")?.value || "all";
  const allRows      = result.rows || [];
  const filteredRows = filterRowsByHour(allRows, hourRange);
  lastFilteredRows   = filteredRows;

  const siteStats = recomputeSiteStats(result.sites || [], filteredRows);
  lastSiteStats   = siteStats;

  animateCounter($("kSitesRequested"), String(Number(result.requested_sites_count||0)));
  animateCounter($("kSitesData"),      String(Number(siteStats.length||0)));
  animateCounter($("kRows"),           String(Number(filteredRows.length||0)));
  animateCounter($("kMax"), `${formatNumber(result.summary?.max_packet_loss)}%`);
  animateCounter($("kAvg"), `${formatNumber(result.summary?.avg_packet_loss)}%`);
  const impacted = siteStats.filter(s => Number(s.avg_packet_loss) > thresholdFor(s.Site)).length;
  animateCounter($("kImpacted"), String(impacted));
  animateCounter($("kNoDataKpi"), String(Number(result.sites_without_data_count||0)));

  const totalRequested = Number(result.requested_sites_count || 0);
  const totalWithData  = Number(siteStats.length || 0);
  const coveragePct    = totalRequested > 0 ? Math.round((totalWithData / totalRequested) * 100) : 0;
  const covEl = $("kCoverage");  if(covEl) covEl.textContent = coveragePct + "%";
  const covBar = $("kCoverageBar");
  if(covBar) setTimeout(() => { covBar.style.width = coveragePct + "%"; }, 50);

  const trendCounts = computeTrendCounts(siteStats, filteredRows);
  animateCounter($("kDegrading"), String(trendCounts.degrading));
  animateCounter($("kStable"),    String(trendCounts.stable));
  animateCounter($("kImproving"), String(trendCounts.improving));

  const kNoData = $("kNoData");
  if(kNoData) kNoData.textContent = Number(result.sites_without_data_count||0).toLocaleString("fr-FR");

  const summaryVendor = $("summaryVendor");
  if(summaryVendor) summaryVendor.textContent = result.vendor==="ALL" ? "Tous" : result.vendor;

  const summaryThreshold = $("summaryThreshold");
  if(summaryThreshold) summaryThreshold.textContent = defaultThreshold.toFixed(2) + "%";

  const hourLabels = { "all":"Toute la journée","00-06":"Nuit","06-12":"Matin","12-18":"Après-midi","18-24":"Soir" };
  const summaryHour = $("summaryHourRange");
  if(summaryHour) summaryHour.textContent = hourLabels[hourRange] || "-";

  const summaryPeriod = $("summaryPeriod");
  if(summaryPeriod) summaryPeriod.textContent =
    `${formatDateFR(result.start_date)} → ${formatDateFR(result.end_date)}`;

  renderNoDataSites(result);
  renderGlobalChart(filteredRows);
  renderWorstTable(siteStats);

  buildNetworkGraph();
  renderMap(siteStats);
  renderHubPanel(siteStats);

  renderSiteGrid(siteStats, filteredRows);

  /* Nouveau : mode HUB automatique */
  if(autoHubMode) renderHubsForAnalyzedSites();

  /* Met à jour la fraîcheur */
  updateDataFreshness();

  /* Rend les onglets actifs */
  onDashboardRendered();
}

/* =========================================================
   CALCULS
   ========================================================= */
function computeTrendCounts(siteStats, rows){
  const grouped = {};
  rows.forEach(r => {
    const site = normalizeSite(r.Site);
    if(!site) return;
    (grouped[site] ||= []).push(r);
  });
  let degrading = 0, stable = 0, improving = 0;
  siteStats.forEach(s => {
    const siteRows = grouped[normalizeSite(s.Site)];
    if(!siteRows || !siteRows.length) return;
    const t = computeSiteTrend(siteRows);
    if(t.trend === "degrading") degrading++;
    else if(t.trend === "improving") improving++;
    else stable++;
  });
  return { degrading, stable, improving };
}
function recomputeSiteStats(rawSites, rows){
  const bySite = {};
  rows.forEach(r => {
    const site = normalizeSite(r.Site);
    if(!site) return;
    (bySite[site] ||= []).push(r);
  });
  const stats = [];
  for(const [site, siteRows] of Object.entries(bySite)){
    const values = siteRows.map(r => Number(r.packet_loss) || 0);
    const n = values.length;
    const avg = values.reduce((s,v)=>s+v,0) / n;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const thr = thresholdFor(site);
    const above = values.filter(v => v > thr).length;
    const link = getSiteLinkInfo(site);
    const degraded = computeDegradedDuration(siteRows, site);
    stats.push({
      Site: site,
      vendor: siteRows[0]?.vendor || "",
      avg_packet_loss: avg,
      min_packet_loss: min,
      max_packet_loss: max,
      nb_mesures: n,
      above_threshold: above,
      above_threshold_pct: (above/n)*100,
      status: avg > thr ? "IMPACTE" : "NORMAL",
      link_type: link.code,
      degradedDuration: degraded,
      threshold: thr
    });
  }
  stats.sort((a,b) => b.avg_packet_loss - a.avg_packet_loss);
  return stats;
}
function computeDegradedDuration(siteRows, site){
  const thr = site ? thresholdFor(site) : defaultThreshold;
  if(!siteRows || !siteRows.length) return { totalHours:0, longestRun:0, pct:0, totalMeasured:0 };
  const sorted = [...siteRows].sort((a,b) => {
    const da = makeDateTime(a) || "", db = makeDateTime(b) || "";
    return da.localeCompare(db);
  });
  let totalDegraded = 0, longestRun = 0, currentRun = 0, prevTs = null;
  const ONE_HOUR = 60 * 60 * 1000;
  const MAX_GAP = ONE_HOUR * 1.5;
  sorted.forEach(row => {
    const value = Number(row.packet_loss) || 0;
    const ts = new Date(makeDateTime(row) || 0).getTime();
    if(value > thr){
      totalDegraded++;
      if(prevTs !== null && ts - prevTs <= MAX_GAP) currentRun++;
      else currentRun = 1;
      if(currentRun > longestRun) longestRun = currentRun;
    } else currentRun = 0;
    prevTs = ts;
  });
  const total = sorted.length;
  return { totalHours: totalDegraded, longestRun, pct: total ? (totalDegraded/total)*100 : 0, totalMeasured: total };
}
function renderNoDataSites(result){
  const sites = Array.isArray(result.sites_without_data) ? result.sites_without_data : [];
  const box = $("noDataPanel");
  const countEl = $("noDataCount");
  const listEl = $("noDataList");
  if(!box || !listEl) return;
  const count = Number(result.sites_without_data_count || sites.length || 0);
  if(!count){ box.classList.add("hidden"); listEl.textContent = ""; return; }
  box.classList.remove("hidden");
  if(countEl) countEl.textContent = count.toLocaleString("fr-FR");
  listEl.textContent = "";
  if(sites.length){
    sites.forEach(site => {
      const item = document.createElement("span");
      item.className = "no-data-site";
      item.textContent = site;
      listEl.appendChild(item);
    });
  } else {
    const item = document.createElement("span");
    item.className = "no-data-site";
    item.textContent = "Liste non fournie.";
    listEl.appendChild(item);
  }
}

/* =========================================================
   GRAPHE GLOBAL
   ========================================================= */
function renderGlobalChart(rows){
  const container = $("globalChart");
  if(!container) return;
  const aggregate = {};
  rows.forEach(row => {
    const dt = makeDateTime(row);
    const value = Number(row.packet_loss);
    if(!dt || !Number.isFinite(value)) return;
    if(!aggregate[dt]) aggregate[dt] = { sum:0, count:0 };
    aggregate[dt].sum += value;
    aggregate[dt].count += 1;
  });
  const points = Object.keys(aggregate).sort().map(dt => ({ x:dt, y:aggregate[dt].sum/aggregate[dt].count }));
  if(!points.length){
    container.textContent = "Aucune donnée disponible.";
    return;
  }
  const xConf = buildXAxisConfigDay(rows, { title:{ text:"Date" }, tickSize:10.5 });
  Plotly.newPlot("globalChart",[
    {
      x:points.map(p=>p.x), y:points.map(p=>p.y),
      type:"scatter", mode:"lines+markers", name:"Packet Loss",
      line:{ color:"#2563eb", width:2.2, shape:"spline", smoothing:0.6 },
      marker:{ color:"#f97316", size:5, line:{ color:getChartBg(), width:1 } },
      fill:"tozeroy", fillcolor: isDark() ? "rgba(37,99,235,.15)" : "rgba(37,99,235,.06)",
      hovertemplate:"%{x|%d/%m %H:%M}<br>Packet Loss : <b>%{y:.4f}%</b><extra></extra>"
    },
    {
      x:points.map(p=>p.x), y:points.map(()=>defaultThreshold),
      type:"scatter", mode:"lines", name:"Seuil par défaut",
      line:{ dash:"dash", color:"#ef4444", width:1.5 },
      hoverinfo:"skip"
    }
  ],{
    margin:{ l:55, r:20, t:15, b:80 + xConf.extraBottom },
    paper_bgcolor: getChartBg(), plot_bgcolor: getChartBg(),
    font:{ family:"Inter, Segoe UI, Arial", size:11, color: getChartTextColor() },
    hovermode:"x unified",
    hoverlabel:{ bgcolor:"#0f172a", bordercolor:"#0f172a", font:{ color:"#fff", size:12 } },
    legend:{ orientation:"h", y:1.08, x:0, font:{ size:11 } },
    xaxis: xConf.axis,
    yaxis:{ title:"Packet Loss (%)", rangemode:"tozero",
      gridcolor: getChartGridColor(), linecolor: getChartLineColor(),
      tickfont:{ size:10.5, color: getChartTextColor() }, automargin:true }
  },{ responsive:true, displaylogo:false,
    modeBarButtonsToRemove:['lasso2d','select2d','hoverClosestCartesian','hoverCompareCartesian','toggleSpikelines','zoom2d','pan2d'] });
  bindSynchronizedZoom();
}

/* =========================================================
   TABLEAU WORST
   ========================================================= */
function renderWorstTable(sites){
  const body = $("worstTableBody");
  if(!body) return;
  const top = (sites || []).slice(0, 10);
  if(!top.length){
    body.innerHTML = `<tr><td colspan="10" class="empty-table">Aucune donnée disponible.</td></tr>`;
    return;
  }
  body.innerHTML = top.map((s,i) => {
    const thr = thresholdFor(s.Site);
    const bad = Number(s.avg_packet_loss) > thr;
    const vendorClass = normalizeSite(s.vendor)==="HUAWEI" ? "vendor-huawei" : "vendor-ericsson";
    const link = getSiteLinkInfo(normalizeSite(s.Site));
    const deg = s.degradedDuration || { totalHours:0, longestRun:0 };
    const score = computeScoreForSite(s.Site, s);
    return `
      <tr>
        <td><strong>#${i+1}</strong></td>
        <td><strong>${escapeHtml(s.Site)}</strong></td>
        <td><span class="vendor-badge ${vendorClass}">${escapeHtml(s.vendor)}</span></td>
        <td><span class="link-badge ${link.badgeClass}">${link.icon ? `<i class="fa-solid ${link.icon}"></i>` : ""}${link.label}</span></td>
        <td class="num"><strong>${formatNumber(s.avg_packet_loss)}%</strong></td>
        <td class="num">${formatNumber(s.max_packet_loss)}%</td>
        <td class="num degraded-cell">${formatDuration(deg.totalHours)}</td>
        <td class="num">${Number(s.above_threshold||0).toLocaleString("fr-FR")}</td>
        <td class="num" style="color:${getScoreColor(score)};font-weight:800">${score}</td>
        <td><span class="status-badge ${bad?"status-bad":"status-good"}">${bad?"IMPACTE":"NORMAL"}</span></td>
      </tr>`;
  }).join("");
}
function computeScoreForSite(site, s){
  const values = (lastFilteredRows || [])
    .filter(r => normalizeSite(r.Site) === normalizeSite(site))
    .map(r => Number(r.packet_loss) || 0);
  if(!values.length) return 0;
  const avg = values.reduce((a,b)=>a+b,0) / values.length;
  const max = Math.max(...values);
  const thr = thresholdFor(site);
  const avgP = Math.min(35, (avg / thr) * 25);
  const maxP = Math.min(25, (max / (thr * 10)) * 25);
  const freqP = Math.min(20, (s.above_threshold || 0) * 0.5);
  const durP = Math.min(20, ((s.degradedDuration?.totalHours || 0) / 24) * 20);
  return Math.max(0, Math.round(100 - avgP - maxP - freqP - durP));
}
function getScoreColor(score){
  if(score >= 80) return "#10b981";
  if(score >= 60) return "#0ea5e9";
  if(score >= 40) return "#f97316";
  return "#f43f5e";
}
function getScoreBadge(score){
  if(score >= 80) return { cls:"reliability-badge--excellent", label:"Excellent" };
  if(score >= 60) return { cls:"reliability-badge--good", label:"Bon" };
  if(score >= 40) return { cls:"reliability-badge--warning", label:"À surveiller" };
  return { cls:"reliability-badge--critical", label:"Critique" };
}

/* =========================================================
   CARTE — INIT
   ========================================================= */
function initMap(){
  if(map) return;
  const mapEl = $("map");
  if(!mapEl) return;
  map = L.map("map",{
    center:CI_CENTER, zoom:CI_ZOOM, minZoom:6, maxZoom:14,
    maxBounds:[[4.0,-9.0],[11.0,-1.5]], maxBoundsViscosity:0.85,
    preferCanvas: true
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    attribution:"© OpenStreetMap", crossOrigin:true
  }).addTo(map);
}
function renderNetworkLinksOnMap(){
  if(!map) return;
  Object.values(mapLinkLayers).forEach(layer => { if(layer) layer.remove(); });
  mapLinkLayers = {};
  const toggles = { FO: mapFilterState.showFO, FH: mapFilterState.showFH, TR: mapFilterState.showTR, TOPO: mapFilterState.showTOPO };
  const linkFilter = mapFilterState.linkType;
  for(const [type, show] of Object.entries(toggles)){
    if(!show) continue;
    if(linkFilter !== "ALL" && linkFilter !== type) continue;
    const features = networkLinks[type];
    if(!features || !features.length) continue;
    const color = LINK_COLORS[type] || "#666";
    const label = LINK_LABELS[type] || type;
    const lines = [];
    for(const f of features){
      if(!f.geometry || f.geometry.type !== "LineString") continue;
      if(hubFilterState.active){
        const text = `${f.properties?.description || ""} ${f.properties?.name || ""}`;
        const ids = (text.match(/\b([A-Z]{2}\d{3,4})\b/g) || []);
        const touchesHub = ids.includes(hubFilterState.hubSite);
        const touchesNeighbor = ids.some(id => hubFilterState.neighborSet.has(id) && id !== hubFilterState.hubSite);
        if(!(touchesHub && touchesNeighbor)) continue;
      }
      const coords = f.geometry.coordinates.map(([lng,lat]) => [lat,lng]);
      if(coords.length < 2) continue;
      const line = L.polyline(coords,{ color, weight:2.2, opacity:0.85, smoothFactor:1.2, interactive:true });
      line.bindTooltip(`<div><div style="font-weight:900;color:#fbbf24;margin-bottom:3px">${label}</div><div style="font-weight:800">${escapeHtml(f.properties?.name||"")}</div><div style="font-size:11px;opacity:.85">${escapeHtml(f.properties?.description||"")}</div></div>`,
        { sticky:true, direction:"top", className:"map-hover-tooltip", interactive:false });
      lines.push(line);
    }
    if(lines.length) mapLinkLayers[type] = L.layerGroup(lines).addTo(map);
  }
}
function renderMapMarkers(sites){
  if(!map) return;
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];
  let filtered;
  if(hubFilterState.active){
    filtered = [];
    hubFilterState.neighborSet.forEach(siteCode => {
      const code = normalizeSite(siteCode);
      const loc = locationIndex[code];
      if(!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lng))) return;
      const stat = sites.find(s => normalizeSite(s.Site) === code);
      if(stat) filtered.push(stat);
      else filtered.push({ Site:code, vendor:loc.vendor||"", avg_packet_loss:0, max_packet_loss:0, nb_mesures:0, above_threshold:0, degradedDuration:{ totalHours:0,longestRun:0 }, isPlaceholder:true });
    });
  } else {
    filtered = sites;
    if(mapFilterState.vendor !== "ALL") filtered = filtered.filter(s => normalizeSite(s.vendor) === mapFilterState.vendor);
    if(mapFilterState.linkType !== "ALL") filtered = filtered.filter(s => (siteLinkIndex[normalizeSite(s.Site)]||{})[mapFilterState.linkType]);
  }
  let mapped = 0;
  filtered.forEach(site => {
    const code = normalizeSite(site.Site);
    const loc = locationIndex[code];
    if(!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lng))) return;
    const linkInfo = getSiteLinkInfo(code);
    const vendorClass = normalizeSite(site.vendor)==="HUAWEI" ? "huawei" : "ericsson";
    const isHub = hubFilterState.active && code === hubFilterState.hubSite;
    const isPlaceholder = !!site.isPlaceholder;
    const dotClass = isHub ? "hub-dot" : (isPlaceholder ? "site-marker-dot unknown" : `site-marker-dot ${linkInfo.dotClass}`);
    const icon = L.divIcon({
      className: "site-marker-wrapper",
      html: `<div class="site-marker"><span class="${dotClass}"></span><span class="site-marker-id ${vendorClass}">${escapeHtml(code)}</span></div>`,
      iconSize:[20,20], iconAnchor:[10,10]
    });
    const marker = L.marker([Number(loc.lat), Number(loc.lng)], { icon, riseOnHover:true, keyboard:false, interactive:true }).addTo(map);
    marker.on("click", ev => { if(ev && ev.originalEvent) L.DomEvent.stopPropagation(ev); selectSite(code); });
    const thr = thresholdFor(code);
    const packetLoss = Number(site.avg_packet_loss);
    const bad = !isPlaceholder && packetLoss > thr;
    const deg = site.degradedDuration || { totalHours:0, longestRun:0 };
    const dataSection = isPlaceholder
      ? `<div class="map-tooltip-row" style="opacity:.7;font-style:italic">Pas de données</div>`
      : `<div class="map-tooltip-packet ${bad?"bad":"good"}">Packet Loss : ${formatNumber(packetLoss)}%</div>
         <div class="map-tooltip-row"><strong>Temps dégradé :</strong> ${formatDuration(deg.totalHours)}</div>
         <div class="map-tooltip-row"><strong>Seuil :</strong> ${thr.toFixed(2)}%</div>
         <div class="map-tooltip-status ${bad?"bad":"good"}">${bad ? "Au-dessus du seuil" : "Dans le seuil"}</div>`;
    marker.bindTooltip(`
      <div class="map-tooltip-site">${escapeHtml(code)}${isHub ? " ⭐ HUB" : ""}</div>
      <div class="map-tooltip-row"><strong>Région :</strong> ${escapeHtml(loc.region||"-")}</div>
      <div class="map-tooltip-row"><strong>Localité :</strong> ${escapeHtml(loc.localite||"-")}</div>
      <div class="map-tooltip-row"><strong>Vendor :</strong> ${escapeHtml(site.vendor||loc.vendor||"-")}</div>
      <div class="map-tooltip-row"><strong>Type :</strong> ${linkInfo.label}</div>
      ${dataSection}
      <div class="map-tooltip-row" style="margin-top:6px;font-size:10px;opacity:.7">💡 Cliquez pour isoler</div>`,
      { sticky:true, direction:"top", offset:[0,-22], opacity:1, className:"map-hover-tooltip", interactive:false });
    mapMarkers.push(marker);
    mapped++;
  });
  const infoEl = $("mapInfo");
  if(!infoEl) return;
  if(hubFilterState.active){
    infoEl.textContent = `Filtre HUB actif : ${hubFilterState.hubSite} • ${mapped} site(s) affiché(s)`;
  } else {
    const total = sites.length;
    const vendorLabel = mapFilterState.vendor === "ALL" ? "tous vendors" : mapFilterState.vendor;
    const linkLabel = mapFilterState.linkType === "ALL" ? "tous liens" : LINK_LABELS[mapFilterState.linkType] || mapFilterState.linkType;
    infoEl.textContent = `${mapped} site(s) affiché(s) sur ${total} • ${vendorLabel} • ${linkLabel}`;
  }
}
function renderMap(sites){
  initMap();
  if(!map) return;

  if(!hubFilterState.active && !heatmapActive){
    map.setView(CI_CENTER, CI_ZOOM, { animate:false });
  }

  /* Si heatmap active, ne pas afficher les couches classiques */
  if(heatmapActive){
    renderMapHeatmap();
    return;
  }

  renderNetworkLinksOnMap();

  if(mapFilterState.showSites){
    renderMapMarkers(sites);
  } else {
    mapMarkers.forEach(m => m.remove());
    mapMarkers = [];
    const infoEl = $("mapInfo");
    if(infoEl) infoEl.textContent = "Couche « Sites » désactivée";
  }
}
safeOn("mapVendorFilter", "change", e => { mapFilterState.vendor = e.target.value; if(lastResult) renderMap(lastSiteStats); });
safeOn("mapLinkFilter", "change", e => { mapFilterState.linkType = e.target.value; if(lastResult) renderMap(lastSiteStats); });
safeOn("toggleSites", "change", e => { mapFilterState.showSites = e.target.checked; if(lastResult) renderMap(lastSiteStats); });
safeOn("toggleFO", "change", e => { mapFilterState.showFO = e.target.checked; renderNetworkLinksOnMap(); });
safeOn("toggleFH", "change", e => { mapFilterState.showFH = e.target.checked; renderNetworkLinksOnMap(); });
safeOn("toggleTR", "change", e => { mapFilterState.showTR = e.target.checked; renderNetworkLinksOnMap(); });
safeOn("toggleTOPO", "change", e => { mapFilterState.showTOPO = e.target.checked; renderNetworkLinksOnMap(); });

/* =========================================================
   GRAPHE RÉSEAU
   ========================================================= */
function buildNetworkGraph(){
  const adjacency = new Map();
  const edges = [];
  const RX = /\b([A-Z]{2}\d{3,4})\b/g;
  for(const type of ["FO","FH","TR","TOPO"]){
    for(const f of networkLinks[type] || []){
      const text = `${f.properties?.description || ""} ${f.properties?.name || ""}`;
      const ids = (text.match(RX) || []).filter((v,i,a) => a.indexOf(v) === i);
      if(ids.length < 2) continue;
      const from = ids[0], to = ids[1];
      if(!adjacency.has(from)) adjacency.set(from, new Set());
      if(!adjacency.has(to)) adjacency.set(to, new Set());
      adjacency.get(from).add(to);
      adjacency.get(to).add(from);
      edges.push({ from, to, type, name: f.properties?.name || "" });
    }
  }
  networkGraph = { adjacency, edges };
}
function computeDegree(adjacency){
  const d = new Map();
  adjacency.forEach((n, node) => d.set(node, n.size));
  return d;
}
function computeBetweenness(adjacency){
  const nodes = [...adjacency.keys()];
  const n = nodes.length;
  if(n > 600){
    const degree = computeDegree(adjacency);
    const maxDeg = Math.max(...degree.values()) || 1;
    const CB = new Map();
    degree.forEach((d, node) => CB.set(node, d/maxDeg));
    return CB;
  }
  const CB = new Map(nodes.map(nd => [nd, 0]));
  nodes.forEach(source => {
    const stack = [], pred = new Map(nodes.map(nd => [nd, []]));
    const sigma = new Map(nodes.map(nd => [nd, 0]));
    const dist = new Map(nodes.map(nd => [nd, -1]));
    sigma.set(source, 1); dist.set(source, 0);
    const queue = [source];
    while(queue.length){
      const v = queue.shift(); stack.push(v);
      (adjacency.get(v) || new Set()).forEach(w => {
        if(dist.get(w) < 0){ dist.set(w, dist.get(v)+1); queue.push(w); }
        if(dist.get(w) === dist.get(v)+1){ sigma.set(w, sigma.get(w)+sigma.get(v)); pred.get(w).push(v); }
      });
    }
    const delta = new Map(nodes.map(nd => [nd, 0]));
    while(stack.length){
      const w = stack.pop();
      pred.get(w).forEach(v => { delta.set(v, delta.get(v) + (sigma.get(v)/sigma.get(w))*(1+delta.get(w))); });
      if(w !== source) CB.set(w, CB.get(w) + delta.get(w));
    }
  });
  const maxCB = Math.max(...CB.values()) || 1;
  CB.forEach((v,k) => CB.set(k, v/maxCB));
  return CB;
}
function computeHubScores(rows){
  if(!networkGraph) return [];
  const { adjacency } = networkGraph;
  if(!adjacency.size) return [];
  const degree = computeDegree(adjacency);
  const betweenness = computeBetweenness(adjacency);
  const maxDeg = Math.max(...degree.values()) || 1;
  const scores = [];
  adjacency.forEach((neighbors, site) => {
    const deg = degree.get(site) || 0;
    const score = 0.7 * (deg / maxDeg) + 0.3 * (betweenness.get(site) || 0);
    scores.push({ site, score, degree: deg, neighbors: [...neighbors] });
  });
  scores.sort((a,b) => b.score - a.score);
  return scores.filter(s => s.degree >= 2 && s.score > 0.05);
}

/* =========================================================
   PANNEAU HUB CLASSIQUE
   ========================================================= */
function renderHubPanel(siteStats){
  hubScores = computeHubScores(lastFilteredRows || []);
  const hubList = $("hubList");
  const details = $("hubDetails");
  if(!hubList) return;
  if(details){ details.classList.add("hidden"); details.innerHTML = ""; }
  if(!hubScores.length){
    hubList.innerHTML = `<div class="hub-empty"><i class="fa-solid fa-diagram-project"></i><p>Aucun HUB identifié.</p></div>`;
    return;
  }
  /* Si mode auto, on n'affiche rien ici : on laisse renderHubsForAnalyzedSites gérer */
  if(autoHubMode) return;
  const top = hubScores.slice(0, 8);
  hubList.innerHTML = top.map((hub, i) => {
    const linkInfo = getSiteLinkInfo(hub.site);
    const vendor = (siteStats.find(s => normalizeSite(s.Site) === hub.site)?.vendor) || "";
    const vendorClass = normalizeSite(vendor) === "HUAWEI" ? "vendor-huawei" : "vendor-ericsson";
    const isActive = hubFilterState.active && hubFilterState.hubSite === hub.site;
    return `
      <div class="hub-item ${isActive ? "is-active" : ""}" data-site="${escapeHtml(hub.site)}">
        <span class="hub-item__rank">#${i+1}</span>
        <div class="hub-item__main">
          <span class="hub-item__site">${escapeHtml(hub.site)}</span>
          <span class="hub-item__score">${(hub.score*100).toFixed(0)}%</span>
        </div>
        <div class="hub-item__bar"><div class="hub-item__bar-fill" style="width:${(hub.score*100).toFixed(0)}%"></div></div>
        <div class="hub-item__meta">
          <span><i class="fa-solid fa-diagram-project"></i>${hub.degree} liens</span>
          <span><i class="fa-solid fa-share-nodes"></i>${hub.neighbors.length} voisins</span>
        </div>
        <div class="hub-item__badges">
          <span class="link-badge ${linkInfo.badgeClass}">${linkInfo.icon ? `<i class="fa-solid ${linkInfo.icon}"></i>` : ""}${linkInfo.label}</span>
          ${vendor ? `<span class="vendor-badge ${vendorClass}">${escapeHtml(vendor)}</span>` : ""}
        </div>
      </div>`;
  }).join("");
  hubList.querySelectorAll(".hub-item").forEach(item => {
    item.addEventListener("click", () => selectSite(item.dataset.site));
  });
}

/* =========================================================
   HUB AUTOMATIQUE (nouveau)
   ---------------------------------------------------------
   Pour chaque site analysé, on cherche son HUB parent
   (site central qui le contient dans ses voisins), puis on
   regroupe par HUB avec la liste des sites liés et leur
   statut d'impact.
   ========================================================= */
function computeAutoHubData(){
  if(!networkGraph || !networkGraph.adjacency.size) return null;
  if(!lastSiteStats || !lastSiteStats.length) return null;

  const analyzedSites = new Set(lastSiteStats.map(s => normalizeSite(s.Site)));
  const statBySite = {};
  lastSiteStats.forEach(s => { statBySite[normalizeSite(s.Site)] = s; });

  /* Pour chaque site analysé, on cherche son HUB parent :
     parmi ses voisins directs, celui qui a le plus de connexions. */
  const hubMap = {}; // hubCode -> { sites: Set, isAnalyzed: bool }

  analyzedSites.forEach(siteCode => {
    const neighbors = networkGraph.adjacency.has(siteCode)
      ? [...networkGraph.adjacency.get(siteCode)].map(normalizeSite)
      : [];

    /* Trouve le HUB parent (le voisin avec le plus de degré) */
    let bestHub = null, bestDeg = 0;
    neighbors.forEach(n => {
      const deg = networkGraph.adjacency.get(n)?.size || 0;
      if(deg > bestDeg){ bestDeg = deg; bestHub = n; }
    });

    /* Si le site lui-même est un HUB (deg élevé), on le prend comme son propre HUB */
    const ownDeg = networkGraph.adjacency.get(siteCode)?.size || 0;
    if(ownDeg >= 3 && (!bestHub || ownDeg >= bestDeg)){
      bestHub = siteCode;
    }

    if(!bestHub) return;

    if(!hubMap[bestHub]){
      hubMap[bestHub] = {
        site: bestHub,
        sites: new Set(),
        isAnalyzed: analyzedSites.has(bestHub)
      };
    }
    hubMap[bestHub].sites.add(siteCode);
  });

  /* Pour chaque HUB, ajoute les voisins directs qui ne sont pas déjà dedans */
  Object.values(hubMap).forEach(hub => {
    const neighbors = networkGraph.adjacency.has(hub.site)
      ? [...networkGraph.adjacency.get(hub.site)].map(normalizeSite)
      : [];
    neighbors.forEach(n => hub.sites.add(n));
  });

  /* Construit la structure finale */
  const hubs = Object.values(hubMap).map(hub => {
    const hubStat = statBySite[hub.site];
    const hubThr = thresholdFor(hub.site);
    const hubImpacted = hubStat
      ? Number(hubStat.avg_packet_loss) > hubThr
      : null;
    const linkedSites = [...hub.sites]
      .filter(s => s !== hub.site)
      .map(site => {
        const stat = statBySite[site];
        const thr = thresholdFor(site);
        if(!stat){
          return {
            site, thr,
            status: "unknown",
            avg: null,
            isAnalyzed: false
          };
        }
        return {
          site, thr,
          status: Number(stat.avg_packet_loss) > thr ? "impacted" : "ok",
          avg: Number(stat.avg_packet_loss),
          max: Number(stat.max_packet_loss),
          vendor: stat.vendor,
          isAnalyzed: analyzedSites.has(site)
        };
      })
      .sort((a, b) => {
        /* Priorité : impactés > inconnus > ok, puis par valeur décroissante */
        const p = { impacted: 0, unknown: 1, ok: 2 };
        if(p[a.status] !== p[b.status]) return p[a.status] - p[b.status];
        return (b.avg || 0) - (a.avg || 0);
      });

    const impactedCount = linkedSites.filter(s => s.status === "impacted").length;
    const okCount = linkedSites.filter(s => s.status === "ok").length;

    return {
      site: hub.site,
      isAnalyzed: hub.isAnalyzed,
      hubImpacted,
      hubAvg: hubStat ? Number(hubStat.avg_packet_loss) : null,
      hubThr,
      linkedSites,
      impactedCount,
      okCount,
      totalLinked: linkedSites.length
    };
  });

  /* Trie : HUB impactés en premier, puis par nombre d'impactés */
  hubs.sort((a, b) => {
    if(a.hubImpacted !== b.hubImpacted) return a.hubImpacted ? -1 : 1;
    return b.impactedCount - a.impactedCount;
  });

  return hubs;
}

function renderHubsForAnalyzedSites(){
  if(!autoHubMode) return;
  const hubList = $("hubList");
  const details = $("hubDetails");
  if(!hubList) return;

  autoHubData = computeAutoHubData();

  if(!autoHubData || !autoHubData.length){
    hubList.innerHTML = `<div class="hub-empty">
      <i class="fa-solid fa-circle-info"></i>
      <p>Aucun HUB détecté pour ces sites.<br>Vérifiez que les fichiers GeoJSON sont chargés.</p>
    </div>`;
    return;
  }

  if(details) details.classList.add("hidden");

  hubList.innerHTML = autoHubData.map((hub, i) => {
    const hubBadgeClass = hub.hubImpacted === true ? "status-bad"
                        : hub.hubImpacted === false ? "status-good"
                        : "link-badge unknown";
    const hubBadgeText = hub.hubImpacted === true ? "HUB impacté"
                       : hub.hubImpacted === false ? "HUB sain"
                       : "HUB non analysé";

    const linkInfo = getSiteLinkInfo(hub.site);
    const isActive = hubFilterState.active && hubFilterState.hubSite === hub.site;

    return `
      <div class="hub-item hub-item--auto ${isActive ? "is-active" : ""}" data-site="${escapeHtml(hub.site)}">
        <span class="hub-item__rank">#${i+1}</span>
        <div class="hub-item__main">
          <span class="hub-item__site">${escapeHtml(hub.site)}</span>
          <span class="hub-item__score">${hub.hubAvg !== null ? formatNumber(hub.hubAvg, 3) + "%" : "—"}</span>
        </div>
        <div class="hub-item__badges">
          <span class="status-badge ${hubBadgeClass}">${hubBadgeText}</span>
          <span class="link-badge ${linkInfo.badgeClass}">
            ${linkInfo.icon ? `<i class="fa-solid ${linkInfo.icon}"></i>` : ""}
            ${linkInfo.label}
          </span>
        </div>
        <div class="hub-item__meta" style="margin-top:8px">
          <span><i class="fa-solid fa-link"></i>${hub.totalLinked} site(s) lié(s)</span>
          <span style="color:var(--c-danger-700)"><i class="fa-solid fa-triangle-exclamation"></i>${hub.impactedCount} impacté(s)</span>
          <span style="color:var(--c-success-700)"><i class="fa-solid fa-check"></i>${hub.okCount} sain(s)</span>
        </div>
      </div>`;
  }).join("");

  hubList.querySelectorAll(".hub-item").forEach(item => {
    item.addEventListener("click", () => {
      const site = item.dataset.site;
      selectSite(site);
      /* Affiche les détails détaillés du HUB avec statut des sites liés */
      const hub = autoHubData.find(h => h.site === normalizeSite(site));
      if(hub) renderAutoHubDetails(hub);
    });
  });
}

function renderAutoHubDetails(hub){
  const details = $("hubDetails");
  if(!details) return;

  const hubBadgeClass = hub.hubImpacted === true ? "status-bad"
                      : hub.hubImpacted === false ? "status-good"
                      : "link-badge unknown";
  const hubBadgeText = hub.hubImpacted === true ? "HUB impacté"
                     : hub.hubImpacted === false ? "HUB sain"
                     : "HUB non analysé";

  details.innerHTML = `
    <div class="hub-details__head">
      <i class="fa-solid fa-hubspot"></i>
      <div>
        <h4>${escapeHtml(hub.site)} ⭐</h4>
        <p class="hub-details__subtitle">
          ${hub.totalLinked} site(s) lié(s) • ${hub.impactedCount} impacté(s)
        </p>
        <span class="status-badge ${hubBadgeClass}" style="margin-top:6px;display:inline-flex">${hubBadgeText}</span>
      </div>
    </div>
    <div class="hub-dependents">
      ${hub.linkedSites.map(dep => {
        const statClass = dep.status === "impacted" ? "dependent__loss"
                        : dep.status === "ok" ? "dependent__loss is-ok"
                        : "dependent__loss";
        const statColor = dep.status === "impacted" ? "color:#be123c"
                        : dep.status === "ok" ? "color:#047857"
                        : "color:#64748b";
        const statLabel = dep.status === "impacted" ? "Impacté"
                        : dep.status === "ok" ? "Sain"
                        : "n/d";
        const lossTxt = dep.avg !== null ? `${formatNumber(dep.avg)}%` : "—";
        const link = getSiteLinkInfo(dep.site);
        return `
          <div class="dependent" data-site="${escapeHtml(dep.site)}">
            <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
              <span class="dependent__site">${escapeHtml(dep.site)}</span>
              <span style="font-size:10px;color:var(--c-text-muted)">
                ${link.label} • seuil ${dep.thr.toFixed(2)}%
              </span>
            </div>
            <span class="${statClass}" style="${statColor};font-weight:800;font-size:11.5px;display:inline-flex;align-items:center;gap:4px">
              ${statLabel} ${lossTxt}
            </span>
          </div>`;
      }).join("")}
    </div>`;
  details.classList.remove("hidden");
}

/* Bouton toggle mode HUB auto */
function bindAutoHubBtn(){
  const btn = $("autoHubBtn");
  if(!btn) return;
  /* Initialise l'état depuis le localStorage */
  const saved = storageGet(LS_KEYS.AUTO_HUB, true);
  autoHubMode = saved !== false;
  btn.classList.toggle("is-active", autoHubMode);

  btn.addEventListener("click", () => {
    autoHubMode = !autoHubMode;
    storageSet(LS_KEYS.AUTO_HUB, autoHubMode);
    btn.classList.toggle("is-active", autoHubMode);
    if(lastResult){
      if(autoHubMode){
        renderHubsForAnalyzedSites();
      } else {
        renderHubPanel(lastSiteStats);
      }
    }
  });
}

/* =========================================================
   SÉLECTION D'UN SITE
   ========================================================= */
function selectSite(siteCode){
  const site = normalizeSite(siteCode);
  if(!site) return;
  let neighbors = [];
  if(networkGraph && networkGraph.adjacency.has(site)){
    neighbors = [...networkGraph.adjacency.get(site)].map(normalizeSite);
  }
  selectedHub = site;
  hubFilterState.active = true;
  hubFilterState.hubSite = site;
  hubFilterState.neighborSet = new Set([site, ...neighbors]);
  const resetFloat = $("mapResetFloatBtn");
  if(resetFloat) resetFloat.classList.remove("hidden");
  const layoutEl = $("mapLayout");
  if(layoutEl) layoutEl.classList.add("is-hub-filtered");
  document.querySelectorAll(".hub-item").forEach(el => {
    el.classList.toggle("is-active", normalizeSite(el.dataset.site) === site);
  });
  /* En mode auto, on garde le panneau détaillé du HUB auto */
  if(!autoHubMode) {
    renderHubDetailsClassic(site, neighbors);
  }
  if(lastResult && map){
    renderMapMarkers(lastSiteStats);
    renderNetworkLinksOnMap();
    const bounds = L.latLngBounds([]);
    hubFilterState.neighborSet.forEach(sc => {
      const l = locationIndex[normalizeSite(sc)];
      if(l && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng))) bounds.extend([Number(l.lat), Number(l.lng)]);
    });
    if(bounds.isValid()) map.fitBounds(bounds, { padding:[60,60], maxZoom:10, animate:true });
    else {
      const hubLoc = locationIndex[site];
      if(hubLoc) map.setView([Number(hubLoc.lat), Number(hubLoc.lng)], 9, { animate:true });
    }
  }
}
function renderHubDetailsClassic(siteCode, neighbors){
  const details = $("hubDetails");
  if(!details) return;
  const site = normalizeSite(siteCode);
  const hub = (hubScores || []).find(h => h.site === site);
  const scoreText = hub ? `Score ${(hub.score*100).toFixed(0)}% • ` : "";
  const titleStar = hub ? " ⭐" : "";
  details.innerHTML = `
    <div class="hub-details__head">
      <i class="fa-solid fa-hubspot"></i>
      <div>
        <h4>${escapeHtml(site)}${titleStar}</h4>
        <p class="hub-details__subtitle">${scoreText}${neighbors.length} site(s) lié(s)</p>
      </div>
    </div>
    <div class="hub-dependents">
      ${neighbors.length ? neighbors.map(depSite => {
        const depStat = (lastSiteStats || []).find(s => normalizeSite(s.Site) === depSite);
        const thr = thresholdFor(depSite);
        const loss = depStat ? Number(depStat.avg_packet_loss) : null;
        const isOk = loss !== null && loss <= thr;
        const link = getSiteLinkInfo(depSite);
        const lossTxt = depStat ? `${formatNumber(loss)}%` : "n/d";
        return `
          <div class="dependent" data-site="${escapeHtml(depSite)}">
            <span class="dependent__site">${escapeHtml(depSite)}</span>
            <span class="link-badge ${link.badgeClass}" style="font-size:9px;padding:2px 6px">${link.label}</span>
            <span class="dependent__loss ${isOk ? "is-ok" : ""}">${lossTxt}</span>
          </div>`;
      }).join("") : `<div class="dependent-empty">Aucun voisin direct identifié.</div>`}
    </div>`;
  details.classList.remove("hidden");
  details.querySelectorAll(".dependent").forEach(el => {
    el.addEventListener("click", ev => {
      ev.stopPropagation();
      const loc = locationIndex[normalizeSite(el.dataset.site)];
      if(loc && map) map.setView([Number(loc.lat), Number(loc.lng)], 11, { animate:true });
    });
  });
}
function clearHubFilter(){
  hubFilterState.active = false;
  hubFilterState.hubSite = null;
  hubFilterState.neighborSet = new Set();
  selectedHub = null;
  const resetFloat = $("mapResetFloatBtn");
  if(resetFloat) resetFloat.classList.add("hidden");
  const layoutEl = $("mapLayout");
  if(layoutEl) layoutEl.classList.remove("is-hub-filtered");
  const details = $("hubDetails");
  if(details){ details.classList.add("hidden"); details.innerHTML = ""; }
  document.querySelectorAll(".hub-item").forEach(el => el.classList.remove("is-active"));
    /* Désactive aussi la heatmap si active */
  if(heatmapActive){
    heatmapActive = false;
    const chk = $("toggleHeatmap");
    if(chk) chk.checked = false;
    if(heatmapLayer){
      map.removeLayer(heatmapLayer);
      heatmapLayer = null;
    }
    hideHeatmapLegend();
  }
  if(map && lastResult){
    map.setView(CI_CENTER, CI_ZOOM, { animate:true });
    renderMap(lastSiteStats);
  }
}
safeOn("mapResetFloatBtn", "click", clearHubFilter);
function toggleHubPanel(){
  const layout = $("mapLayout");
  if(!layout) return;
  const isCollapsed = layout.classList.toggle("is-collapsed");
  const float = $("hubPanelToggleFloat");
  if(float) float.classList.toggle("hidden", !isCollapsed);
  setTimeout(() => { if(map) map.invalidateSize(); }, 350);
}
safeOn("hubPanelToggle", "click", toggleHubPanel);
safeOn("hubPanelToggleFloat", "click", toggleHubPanel);
safeOn("toggleHubs", "change", e => {
  if(!lastResult) return;
  if(e.target.checked){
    const hubSites = new Set(hubScores.map(h => h.site));
    const depSites = new Set();
    hubScores.forEach(h => h.neighbors.forEach(d => depSites.add(normalizeSite(d))));
    const relevant = new Set([...hubSites, ...depSites]);
    const filteredStats = lastSiteStats.filter(s => relevant.has(normalizeSite(s.Site)));
    renderMap(filteredStats);
  } else renderMap(lastSiteStats);
});

/* =========================================================
   TENDANCE
   ========================================================= */
function computeSiteTrend(siteRows){
  const sorted = [...siteRows].sort((a,b) => (makeDateTime(a)||"").localeCompare(makeDateTime(b)||""));
  const n = sorted.length;
  if(!n) return { firstAvg:0, secondAvg:0, halfToHalf:0, trend:"stable", currentLoss:0 };
  const mid = Math.max(1, Math.floor(n/2));
  const avg = arr => arr.length ? arr.reduce((s,r) => s+Number(r.packet_loss||0), 0)/arr.length : 0;
  const firstAvg = avg(sorted.slice(0,mid));
  const secondAvg = avg(sorted.slice(mid));
  let halfToHalf;
  if(firstAvg > 0) halfToHalf = ((secondAvg-firstAvg)/firstAvg)*100;
  else halfToHalf = secondAvg > 0 ? 100 : 0;
  let trend = "stable";
  if(halfToHalf < -10) trend = "improving";
  else if(halfToHalf > 10) trend = "degrading";
  const lastRow = sorted[sorted.length-1];
  return { firstAvg, secondAvg, halfToHalf, trend, currentLoss: Number(lastRow?.packet_loss || 0) };
}

/* =========================================================
   CARTES SITE
   ========================================================= */
function renderSiteGrid(siteStats, rows){
  const grid = $("siteGrid");
  if(!grid) return;
  grid.textContent = "";
  const grouped = {};
  rows.forEach(row => {
    const site = normalizeSite(row.Site);
    if(!site) return;
    (grouped[site] ||= []).push(row);
  });
  siteStats.forEach(s => {
    const name = normalizeSite(s.Site);
    const siteRows = grouped[name] || [];
    if(!siteRows.length) return;
    const trend = computeSiteTrend(siteRows);
    siteTrends[name] = trend;
    const vendorClass = normalizeSite(s.vendor)==="HUAWEI" ? "vendor-huawei" : "vendor-ericsson";
    const linkInfo = getSiteLinkInfo(name);
    const safeId = `chart-${name.replace(/[^A-Z0-9_-]/g,"-")}`;
    const deg = s.degradedDuration || { totalHours:0, longestRun:0 };
    const thr = thresholdFor(name);
    const trendIcon = trend.trend === "improving" ? "fa-arrow-trend-down"
                    : trend.trend === "degrading" ? "fa-arrow-trend-up"
                    : "fa-minus";
    const card = document.createElement("article");
    card.className = "site-card";
    card.dataset.avg = Number(s.avg_packet_loss) || 0;
    card.dataset.max = Number(s.max_packet_loss) || 0;
    card.dataset.site = name;
    card.dataset.trend = trend.trend;
    card.dataset.above = Number(s.above_threshold||0);
    card.dataset.link = linkInfo.code;
    const trendLabel = trend.trend === "improving" ? "Amélioration"
                    : trend.trend === "degrading" ? "Dégradation"
                    : "Stable";
    let comment;
    if(trend.trend === "improving"){
      comment = `<strong>Amélioration :</strong> perte passée de ${formatNumber(trend.firstAvg)}% à ${formatNumber(trend.secondAvg)}%. Site dégradé ${formatDuration(deg.totalHours)}.`;
    } else if(trend.trend === "degrading"){
      comment = `<strong>Dégradation :</strong> perte passée de ${formatNumber(trend.firstAvg)}% à ${formatNumber(trend.secondAvg)}%. Site dégradé ${formatDuration(deg.totalHours)}.`;
    } else {
      comment = `<strong>Stable :</strong> perte autour de ${formatNumber(trend.firstAvg)}% → ${formatNumber(trend.secondAvg)}%. Site dégradé ${formatDuration(deg.totalHours)}.`;
    }
    const cardMarkup = `
      <div class="site-card-head">
        <div>
          <div class="site-name">${escapeHtml(name)}</div>
          <div class="site-subtitle">
            <span class="vendor-badge ${vendorClass}">${escapeHtml(s.vendor)}</span>
            <span class="link-badge ${linkInfo.badgeClass}">${linkInfo.icon ? `<i class="fa-solid ${linkInfo.icon}"></i>` : ""}${linkInfo.label}</span>
            <span class="link-badge unknown" title="Seuil appliqué">Seuil ${thr.toFixed(2)}%</span>
          </div>
        </div>
        <span class="trend-badge ${trend.trend}">
          <i class="fa-solid ${trendIcon}"></i> ${trendLabel}
        </span>
      </div>
      <div class="site-card-body">
        <div class="site-chart-wrapper"><div class="site-chart" id="${safeId}"></div></div>
        <div class="site-stats">
          <div class="site-stat"><strong>${formatNumber(s.avg_packet_loss)}%</strong><span>Perte moyenne</span></div>
          <div class="site-stat"><strong>${formatNumber(s.max_packet_loss)}%</strong><span>Pic maximum</span></div>
          <div class="site-stat"><strong>${formatNumber(trend.currentLoss)}%</strong><span>Actuel</span></div>
          <div class="site-stat site-stat--degraded"><strong>${formatDuration(deg.totalHours)}</strong><span>Temps dégradé</span></div>
          <div class="site-stat site-stat--degraded"><strong>${formatDuration(deg.longestRun)}</strong><span>Plus longue</span></div>
          <div class="site-stat"><strong>${Number(s.nb_mesures||0).toLocaleString("fr-FR")}</strong><span>Mesures</span></div>
        </div>
        <div class="site-comment ${trend.trend}">${comment}</div>
      </div>`;
    if(window.DOMPurify && typeof window.DOMPurify.sanitize === "function"){
      const safe = window.DOMPurify.sanitize(cardMarkup, { USE_PROFILES:{ html:true }, RETURN_DOM_FRAGMENT:true });
      card.appendChild(safe);
    } else card.innerHTML = cardMarkup;
    grid.appendChild(card);
    renderSiteChart(safeId, siteRows, name);
  });
  applySiteFilters();
}

/* =========================================================
   GRAPHIQUE PAR SITE
   ========================================================= */
function renderSiteChart(id, rows, name){
  if(chartViewMode === "raw") renderSiteChartRaw(id, rows, name);
  else renderSiteChartDay(id, rows, name);
}
function renderSiteChartDay(id, rows, name){
  const el = document.getElementById(id);
  if(!el) return;
  const sorted = [...rows].sort((a,b) => (makeDateTime(a)||"").localeCompare(makeDateTime(b)||""));
  const x = sorted.map(r => makeDateTime(r));
  const y = sorted.map(r => Number(r.packet_loss));
  const thr = thresholdFor(name);
  const annotations = [{
    x: x[x.length-1], y: thr, xref:"x", yref:"y",
    text:`Seuil ${thr.toFixed(2)}%`, showarrow:false,
    xanchor:"right", yanchor:"bottom", font:{ size:9, color:"#ef4444" }
  }];
  const xConf = buildXAxisConfigDay(rows, { tickSize:9.5 });
  const yRange = computeFixedYRange(rows, name);
  Plotly.newPlot(id, [
    {
      x, y, type:"scatter", mode:"lines+markers", name,
      line:{ color:"#2563eb", width:1.8, shape:"spline", smoothing:0.5 },
      marker:{ color:"#2563eb", size:3.5 },
      hovertemplate:"%{x|%d/%m %H:%M}<br>Packet Loss : <b>%{y:.4f}%</b><extra></extra>"
    },
    {
      x, y: x.map(() => thr), type:"scatter", mode:"lines", name:"Seuil",
      line:{ dash:"dash", color:"#ef4444", width:1.2 }, hoverinfo:"skip"
    }
  ], {
    margin:{ l:38, r:8, t:12, b:70 + xConf.extraBottom },
    paper_bgcolor: getChartBg(), plot_bgcolor: getChartBg(),
    font:{ family:"Inter, Segoe UI, Arial", size:10, color: getChartTextColor() },
    hovermode:"x unified",
    hoverlabel:{ bgcolor:"#0f172a", bordercolor:"#0f172a", font:{ color:"#fff", size:11 } },
    showlegend:false, annotations,
    xaxis: xConf.axis,
    yaxis:{ title:{ text:"%", font:{ size:10, color: getChartTextColor() } }, range: yRange,
      gridcolor: getChartGridColor(), linecolor: getChartLineColor(),
      tickfont:{ size:9.5, color: getChartTextColor() }, automargin:true }
  }, {
    responsive:true, displaylogo:false, displayModeBar:true,
    modeBarButtonsToRemove:['lasso2d','select2d','hoverClosestCartesian','hoverCompareCartesian','toggleSpikelines','zoom2d','pan2d']
  });
  addChartMarkers(id, rows, name);
}
function renderSiteChartRaw(id, rows, name){
  const el = document.getElementById(id);
  if(!el) return;
  const sorted = [...rows].sort((a,b) => (makeDateTime(a)||"").localeCompare(makeDateTime(b)||""));
  const x = sorted.map(r => makeDateTime(r));
  const y = sorted.map(r => Number(r.packet_loss));
  const thr = thresholdFor(name);
  const xConf = buildXAxisConfigRaw(rows, { tickSize:8.5 });
  const maxVal = y.length ? Math.max(...y) : 0;
  const showThresholdLine = maxVal >= thr * 0.9;
  const traces = [{
    x, y, type:"scatter", mode:"lines+markers", name,
    line:{ color:"#2563eb", width:1.8, shape:"linear" },
    marker:{ color:"#2563eb", size:3 },
    hovertemplate:"%{x|%d/%m %H:%M}<br>Packet Loss : <b>%{y:.6f}%</b><extra></extra>"
  }];
  if(showThresholdLine){
    traces.push({ x, y: x.map(() => thr), type:"scatter", mode:"lines", name:"Seuil",
      line:{ dash:"dash", color:"#ef4444", width:1.2 }, hoverinfo:"skip" });
  }
  const yRange = showThresholdLine ? [0, Math.max(maxVal * 1.15, thr * 1.15)] : [0, maxVal * 1.15 || 0.01];
  Plotly.newPlot(id, traces, {
    margin:{ l:44, r:8, t:12, b:60 + xConf.extraBottom },
    paper_bgcolor: getChartBg(), plot_bgcolor: getChartBg(),
    font:{ family:"Inter, Segoe UI, Arial", size:10, color: getChartTextColor() },
    hovermode:"x unified", showlegend:false,
    xaxis: xConf.axis,
    yaxis:{ title:{ text:"%", font:{ size:10 } }, range: yRange,
      gridcolor: getChartGridColor(), linecolor: getChartLineColor(),
      tickfont:{ size:9.5, color: getChartTextColor() }, automargin:true }
  }, {
    responsive:true, displaylogo:false, displayModeBar:true,
    modeBarButtonsToRemove:['lasso2d','select2d','hoverClosestCartesian','hoverCompareCartesian','toggleSpikelines','zoom2d','pan2d']
  });
  addChartMarkers(id, rows, name);
}

/* =========================================================
   MARQUEURS SUR CHART
   ========================================================= */
function addChartMarkers(chartId, rows, site){
  const thr = thresholdFor(site);
  const sorted = [...rows].sort((a,b) => (makeDateTime(a)||"").localeCompare(makeDateTime(b)||""));
  if(!sorted.length) return;
  const annotations = [];
  const firstDeg = sorted.find(r => (Number(r.packet_loss)||0) > thr);
  if(firstDeg){
    annotations.push({
      x: makeDateTime(firstDeg),
      y: Number(firstDeg.packet_loss),
      text: "Début",
      showarrow: true, arrowhead: 2, arrowcolor: "#f97316",
      ax: 0, ay: -30,
      font: { size: 9, color: "#f97316" },
      bgcolor: "rgba(255,247,237,.95)", bordercolor: "#fed7aa", borderpad: 3
    });
  }
  let maxRow = null, maxVal = -Infinity;
  sorted.forEach(r => {
    const v = Number(r.packet_loss) || 0;
    if(v > maxVal){ maxVal = v; maxRow = r; }
  });
  if(maxRow && maxVal > thr){
    annotations.push({
      x: makeDateTime(maxRow),
      y: maxVal,
      text: `Pic ${formatNumber(maxVal)}%`,
      showarrow: true, arrowhead: 2, arrowcolor: "#be123c",
      ax: 0, ay: -40,
      font: { size: 9, color: "#be123c" },
      bgcolor: "rgba(255,241,242,.95)", bordercolor: "#fecdd3", borderpad: 3
    });
  }
  if(maxRow){
    const maxIdx = sorted.indexOf(maxRow);
    for(let i = maxIdx + 1; i < sorted.length; i++){
      if((Number(sorted[i].packet_loss)||0) <= thr){
        annotations.push({
          x: makeDateTime(sorted[i]),
          y: Number(sorted[i].packet_loss),
          text: "Fin",
          showarrow: true, arrowhead: 2, arrowcolor: "#10b981",
          ax: 0, ay: -30,
          font: { size: 9, color: "#047857" },
          bgcolor: "rgba(236,253,245,.95)", bordercolor: "#a7f3d0", borderpad: 3
        });
        break;
      }
    }
  }
  if(annotations.length){
    try{
      const el = document.getElementById(chartId);
      if(!el || !el._fullLayout) return;
      const existing = (el._fullLayout.annotations || []).filter(a => a.text && a.text.startsWith("Seuil"));
      Plotly.relayout(chartId, { annotations: annotations.concat(existing) });
    }catch(_){}
  }
}

/* =========================================================
   FILTRES SITE
   ========================================================= */
function applySiteFilters(){
  const search = normalizeSite($("siteSearch")?.value || "");
  const sort = $("siteSort")?.value || "name_asc";
  const trendF = $("trendFilter")?.value || "all";
  const grid = $("siteGrid");
  if(!grid) return;
  const cards = [...grid.querySelectorAll(".site-card")];
  cards.sort((a,b) => {
    const na = a.dataset.site || "", nb = b.dataset.site || "";
    const avga = Number(a.dataset.avg || 0), avgb = Number(b.dataset.avg || 0);
    const maxa = Number(a.dataset.max || 0), maxb = Number(b.dataset.max || 0);
    switch(sort){
      case "name_asc": return na.localeCompare(nb);
      case "worst_degraded": return avgb - avga;
      case "fastest_degrading": {
        const rowsA = lastFilteredRows.filter(r => normalizeSite(r.Site) === na);
        const rowsB = lastFilteredRows.filter(r => normalizeSite(r.Site) === nb);
        return computeTrendSlope(rowsB) - computeTrendSlope(rowsA);
      }
      case "best_degraded": return avga - avgb;
      case "highest_avg": return maxb - maxa;
      case "worst_score": {
        const sA = lastSiteStats.find(s => normalizeSite(s.Site) === na);
        const sB = lastSiteStats.find(s => normalizeSite(s.Site) === nb);
        const scA = sA ? computeScoreForSite(na, sA) : 100;
        const scB = sB ? computeScoreForSite(nb, sB) : 100;
        return scA - scB;
      }
      case "threshold_exceeded": {
        const aa = Number(a.dataset.above||0), ab = Number(b.dataset.above||0);
        if(aa === 0 && ab > 0) return 1;
        if(ab === 0 && aa > 0) return -1;
        return ab - aa;
      }
      default: return avgb - avga;
    }
  });
  cards.forEach(card => {
    const name = normalizeSite(card.dataset.site || "");
    const trend = card.dataset.trend || "stable";
    const above = Number(card.dataset.above || 0);
    let visible = true;
    if(search && !name.includes(search)) visible = false;
    if(trendF !== "all" && trend !== trendF) visible = false;
    if(sort === "threshold_exceeded" && above <= 0) visible = false;
    card.style.display = visible ? "" : "none";
    grid.appendChild(card);
  });
}
safeOn("siteSearch", "input", applySiteFilters);
safeOn("siteSort", "change", applySiteFilters);
safeOn("trendFilter", "change", applySiteFilters);

/* =========================================================
   VIEW TOGGLE
   ========================================================= */
function bindViewToggle(){
  const toggle = $("viewToggle");
  if(!toggle) return;
  toggle.querySelectorAll(".view-toggle__btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      if(view === chartViewMode) return;
      toggle.querySelectorAll(".view-toggle__btn").forEach(b => {
        b.classList.toggle("is-active", b.dataset.view === view);
      });
      chartViewMode = view;
      if(lastResult && lastSiteStats.length){
        renderSiteGrid(lastSiteStats, lastFilteredRows);
      }
    });
  });
}

/* =========================================================
   ONGLETS — Fiabilité / Corrélations / Heatmap / Prédictions
   ========================================================= */
function bindTabs(){
  document.querySelectorAll("#detailTabs .tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const t = tab.dataset.tab;
      activeTab = t;
      document.querySelectorAll("#detailTabs .tab").forEach(x => x.classList.toggle("is-active", x === tab));
      document.querySelectorAll(".tab-content").forEach(c => {
        c.classList.toggle("hidden", c.dataset.tabContent !== t);
      });
      if(t === "reliability") renderReliabilityTable();
      else if(t === "correlation") renderCorrelation();
      else if(t === "heatmap") renderHeatmap();
      else if(t === "predictions") renderPredictions();
    });
  });
  safeOn("correlationTop", "change", renderCorrelation);
  safeOn("correlationThreshold", "input", e => {
    const v = $("correlationThresholdValue");
    if(v) v.textContent = e.target.value + "%";
    renderCorrelation();
  });
  safeOn("heatmapScope", "change", renderHeatmap);
  safeOn("heatmapSite", "change", renderHeatmap);
}

/* ----- FIABILITÉ ----- */
function computeReliabilityKpis(site, siteRows, threshold){
  const sorted = [...siteRows].sort((a,b) => (makeDateTime(a)||"").localeCompare(makeDateTime(b)||""));
  const incidents = [];
  let currentIncident = null;
  const ONE_HOUR = 60*60*1000;
  sorted.forEach(row => {
    const value = Number(row.packet_loss) || 0;
    const ts = new Date(makeDateTime(row) || 0).getTime();
    if(value > threshold){
      if(!currentIncident){
        currentIncident = { start: ts, end: ts, count: 1, peak: value };
      } else if(ts - currentIncident.end <= ONE_HOUR * 1.5){
        currentIncident.end = ts;
        currentIncident.count++;
        currentIncident.peak = Math.max(currentIncident.peak, value);
      } else {
        incidents.push(currentIncident);
        currentIncident = { start: ts, end: ts, count: 1, peak: value };
      }
    } else if(currentIncident){
      incidents.push(currentIncident);
      currentIncident = null;
    }
  });
  if(currentIncident) incidents.push(currentIncident);
  const mttrHours = incidents.length
    ? incidents.reduce((s, i) => s + (i.end - i.start) / ONE_HOUR + 1, 0) / incidents.length
    : 0;
  let mtbfHours = 0;
  if(incidents.length >= 2){
    const totalSpan = incidents[incidents.length-1].start - incidents[0].start;
    mtbfHours = (totalSpan / ONE_HOUR) / (incidents.length - 1);
  } else if(sorted.length){
    const span = new Date(makeDateTime(sorted[sorted.length-1]) || 0).getTime()
               - new Date(makeDateTime(sorted[0]) || 0).getTime();
    mtbfHours = span / ONE_HOUR;
  }
  const totalRows = sorted.length;
  const degradedRows = sorted.filter(r => (Number(r.packet_loss)||0) > threshold).length;
  const sla = totalRows ? ((totalRows - degradedRows) / totalRows) * 100 : 100;
  const values = sorted.map(r => Number(r.packet_loss) || 0);
  const avg = values.length ? values.reduce((s,v)=>s+v,0) / values.length : 0;
  const max = values.length ? Math.max(...values) : 0;
  const thr = threshold || defaultThreshold;
  const avgPenalty = Math.min(35, (avg / thr) * 25);
  const maxPenalty = Math.min(25, (max / (thr * 10)) * 25);
  const freqPenalty = Math.min(20, incidents.length * 2);
  const durPenalty = Math.min(20, (mttrHours / 24) * 20);
  const score = Math.max(0, 100 - avgPenalty - maxPenalty - freqPenalty - durPenalty);
  return {
    site,
    sla: Math.round(sla * 100) / 100,
    mtbfHours: Math.round(mtbfHours * 10) / 10,
    mttrHours: Math.round(mttrHours * 10) / 10,
    incidents: incidents.length,
    score: Math.round(score),
    avg, max
  };
}
function renderReliabilityTable(){
  const body = $("reliabilityTableBody");
  if(!body) return;
  const grouped = {};
  (lastFilteredRows || []).forEach(r => {
    const s = normalizeSite(r.Site);
    if(!s) return;
    (grouped[s] ||= []).push(r);
  });
  const rows = [];
  Object.entries(grouped).forEach(([site, list]) => {
    const thr = thresholdFor(site);
    const kpis = computeReliabilityKpis(site, list, thr);
    const vendor = list[0]?.vendor || "-";
    rows.push({ ...kpis, vendor });
  });
  rows.sort((a,b) => a.score - b.score);
  if(!rows.length){
    body.innerHTML = `<tr><td colspan="8" class="empty-table">Aucune donnée.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(r => {
    const badge = getScoreBadge(r.score);
    const color = getScoreColor(r.score);
    return `
      <tr>
        <td><strong>${escapeHtml(r.site)}</strong></td>
        <td>${escapeHtml(r.vendor)}</td>
        <td class="num">${r.sla.toFixed(2)} %</td>
        <td class="num">${r.mtbfHours > 0 ? r.mtbfHours + " h" : "—"}</td>
        <td class="num">${r.mttrHours > 0 ? r.mttrHours + " h" : "—"}</td>
        <td class="num">${r.incidents}</td>
        <td class="num">
          <span class="score-bar"><span class="score-bar__fill" style="width:${r.score}%;background:${color}"></span></span>
          <strong style="color:${color}">${r.score}</strong>
        </td>
        <td><span class="reliability-badge ${badge.cls}">${badge.label}</span></td>
      </tr>`;
  }).join("");
}

/* ----- CORRÉLATION ----- */
function computeCorrelationMatrix(){
  const grouped = {};
  (lastFilteredRows || []).forEach(r => {
    const s = normalizeSite(r.Site);
    if(!s) return;
    (grouped[s] ||= []).push(r);
  });
  const topN = Number($("correlationTop")?.value || 15);
  const top = Object.entries(grouped)
    .map(([site, list]) => {
      const thr = thresholdFor(site);
      const degraded = list.filter(r => (Number(r.packet_loss)||0) > thr).length;
      return { site, list, degraded };
    })
    .sort((a,b) => b.degraded - a.degraded)
    .slice(0, topN);
  const sites = top.map(t => t.site);
  const matrix = {};
  const degradedHours = {};
  top.forEach(t => {
    const thr = thresholdFor(t.site);
    degradedHours[t.site] = new Set(
      t.list.filter(r => (Number(r.packet_loss)||0) > thr)
        .map(r => `${r.ladate||""}-${r.hour ?? ""}`)
    );
  });
  sites.forEach(s1 => {
    matrix[s1] = {};
    sites.forEach(s2 => {
      if(s1 === s2){ matrix[s1][s2] = 100; return; }
      const set1 = degradedHours[s1], set2 = degradedHours[s2];
      if(!set1.size && !set2.size){ matrix[s1][s2] = 0; return; }
      const union = new Set([...set1, ...set2]);
      let inter = 0;
      set1.forEach(h => { if(set2.has(h)) inter++; });
      matrix[s1][s2] = union.size ? Math.round((inter / union.size) * 100) : 0;
    });
  });
  return { sites, matrix };
}
function renderCorrelation(){
  const container = $("correlationPairs");
  const matrixEl = $("correlationMatrix");
  if(!container || !matrixEl) return;
  const result = computeCorrelationMatrix();
  correlationMatrix = result.matrix;
  correlationSites = result.sites;
  const threshold = Number($("correlationThreshold")?.value || 30);
  const pairs = [];
  for(let i = 0; i < result.sites.length; i++){
    for(let j = i+1; j < result.sites.length; j++){
      const s1 = result.sites[i], s2 = result.sites[j];
      const pct = result.matrix[s1][s2];
      if(pct >= threshold) pairs.push({ s1, s2, pct });
    }
  }
  pairs.sort((a,b) => b.pct - a.pct);
  if(!pairs.length){
    container.innerHTML = `<div class="correlation-help"><i class="fa-solid fa-circle-info"></i><p>Aucune corrélation forte détectée avec un seuil de ${threshold}%.</p></div>`;
  } else {
    container.innerHTML = pairs.slice(0, 12).map(p => `
      <div class="correlation-pair" data-s1="${escapeHtml(p.s1)}" data-s2="${escapeHtml(p.s2)}">
        <div class="correlation-pair__head">
          <span class="correlation-pair__sites">${escapeHtml(p.s1)} ↔ ${escapeHtml(p.s2)}</span>
          <span class="correlation-pair__pct">${p.pct}%</span>
        </div>
        <div class="correlation-pair__meta">Dégradations simultanées détectées</div>
      </div>
    `).join("");
    container.querySelectorAll(".correlation-pair").forEach(el => {
      el.addEventListener("click", () => {
        overlaySites = [el.dataset.s1, el.dataset.s2];
        storageSet(LS_KEYS.OVERLAY, overlaySites);
        toggleOverlayPanel(true);
        renderOverlayChips();
        renderOverlayChart();
      });
    });
  }
  const sites = result.sites;
  if(!sites.length){
    matrixEl.innerHTML = "";
    return;
  }
  const html = `
    <table class="matrix-table">
      <thead>
        <tr><th></th>${sites.map(s => `<th>${escapeHtml(s)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${sites.map(s1 => `
          <tr>
            <th>${escapeHtml(s1)}</th>
            ${sites.map(s2 => {
              const pct = result.matrix[s1][s2];
              if(s1 === s2) return `<td class="diagonal">—</td>`;
              const hue = 120 - (pct / 100) * 120;
              const bg = `hsl(${hue}, 75%, 50%)`;
              return `<td style="background:${bg}" title="${escapeHtml(s1)} ↔ ${escapeHtml(s2)} : ${pct}%">${pct}%</td>`;
            }).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>`;
  matrixEl.innerHTML = html;
}

/* ----- HEATMAP ----- */
function renderHeatmap(){
  const container = $("heatmapContainer");
  if(!container) return;
  const scope = $("heatmapScope")?.value || "all";
  const siteSelect = $("heatmapSite");
  if(siteSelect){
    const sites = (lastSiteStats || []).map(s => normalizeSite(s.Site)).sort();
    const currentVal = siteSelect.value;
    siteSelect.innerHTML = `<option value="">— Choisir un site —</option>` +
      sites.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    if(currentVal) siteSelect.value = currentVal;
    siteSelect.classList.toggle("hidden", scope !== "single");
  }
  let rows = lastFilteredRows || [];
  if(scope === "single"){
    const site = siteSelect?.value;
    if(!site){
      container.innerHTML = `<p style="text-align:center;padding:40px;color:var(--c-text-muted)">Choisissez un site pour afficher sa heatmap.</p>`;
      return;
    }
    rows = rows.filter(r => normalizeSite(r.Site) === normalizeSite(site));
  }
  const grid = {};
  for(let d = 0; d < 7; d++){ grid[d] = {}; for(let h = 0; h < 24; h++){ grid[d][h] = { sum:0, n:0 }; } }
  rows.forEach(r => {
    const dt = makeDateTime(r);
    if(!dt) return;
    const date = new Date(dt);
    const dow = (date.getDay() + 6) % 7;
    const h = rowHour(r);
    if(!grid[dow] || !grid[dow][h]) return;
    grid[dow][h].sum += Number(r.packet_loss) || 0;
    grid[dow][h].n++;
  });
  let maxVal = 0;
  Object.values(grid).forEach(row => {
    Object.values(row).forEach(cell => {
      if(cell.n){ maxVal = Math.max(maxVal, cell.sum / cell.n); }
    });
  });
  const days = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
  const hours = Array.from({length:24}, (_,i) => String(i).padStart(2,"0") + "h");
  let html = `<div class="heatmap-grid">
    <div class="heatmap-cell" style="background:transparent"></div>
    ${hours.map(h => `<div class="heatmap-header">${h}</div>`).join("")}
  `;
  for(let d = 0; d < 7; d++){
    html += `<div class="heatmap-day-label">${days[d]}</div>`;
    for(let h = 0; h < 24; h++){
      const cell = grid[d][h];
      const avg = cell.n ? cell.sum / cell.n : 0;
      const intensity = maxVal ? avg / maxVal : 0;
      const hue = 120 - intensity * 120;
      const bg = cell.n ? `hsl(${hue}, 70%, 55%)` : "var(--c-surface-2)";
      const label = cell.n ? `${avg.toFixed(4)}%` : "—";
      html += `<div class="heatmap-cell" style="background:${bg}" title="${days[d]} ${h}h : ${label} (${cell.n} mesures)">${cell.n ? avg.toFixed(2) : ""}</div>`;
    }
  }
  html += `</div>
    <div class="heatmap-legend">
      <span>Faible</span><span class="heatmap-legend__gradient"></span><span>Élevé</span>
    </div>`;
  container.innerHTML = html;
}

/* ----- PRÉDICTIONS ----- */
function computePredictions(){
  const grouped = {};
  (lastFilteredRows || []).forEach(r => {
    const s = normalizeSite(r.Site);
    if(!s) return;
    (grouped[s] ||= []).push(r);
  });
  const results = [];
  Object.entries(grouped).forEach(([site, list]) => {
    const byDay = {};
    list.forEach(r => {
      const dt = makeDateTime(r);
      if(!dt) return;
      const day = dt.slice(0, 10);
      if(!byDay[day]) byDay[day] = { sum:0, n:0 };
      byDay[day].sum += Number(r.packet_loss) || 0;
      byDay[day].n++;
    });
    const days = Object.keys(byDay).sort();
    if(days.length < 3) return;
    const xs = days.map((_, i) => i);
    const ys = days.map(d => byDay[d].sum / byDay[d].n);
    const n = xs.length;
    const sumX = xs.reduce((s,x)=>s+x,0);
    const sumY = ys.reduce((s,y)=>s+y,0);
    const sumXY = xs.reduce((s,x,i)=>s + x*ys[i], 0);
    const sumX2 = xs.reduce((s,x)=>s + x*x, 0);
    const denom = n * sumX2 - sumX * sumX;
    if(denom === 0) return;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const currentAvg = ys[ys.length - 1];
    const pred7 = intercept + slope * (n + 7);
    const pred30 = intercept + slope * (n + 30);
    results.push({ site, currentAvg, slope, pred7: Math.max(0, pred7), pred30: Math.max(0, pred30) });
  });
  results.sort((a,b) => Math.abs(b.slope) - Math.abs(a.slope));
  return results;
}
function renderPredictions(){
  const body = $("predictionsTableBody");
  if(!body) return;
  const preds = computePredictions();
  if(!preds.length){
    body.innerHTML = `<tr><td colspan="6" class="empty-table">Données insuffisantes.</td></tr>`;
    return;
  }
  body.innerHTML = preds.map(p => {
    const trendCls = p.slope > 0.001 ? "prediction-trend--up"
                    : p.slope < -0.001 ? "prediction-trend--down"
                    : "prediction-trend--stable";
    const trendIcon = p.slope > 0.001 ? "fa-arrow-trend-up"
                    : p.slope < -0.001 ? "fa-arrow-trend-down"
                    : "fa-minus";
    const trendLabel = p.slope > 0.001 ? "Hausse"
                    : p.slope < -0.001 ? "Baisse"
                    : "Stable";
    return `
      <tr>
        <td><strong>${escapeHtml(p.site)}</strong></td>
        <td class="num">${formatNumber(p.currentAvg)}%</td>
        <td class="num">${p.slope >= 0 ? "+" : ""}${p.slope.toFixed(6)}%/j</td>
        <td class="num" style="color:${p.pred7 > defaultThreshold ? "#be123c" : "#047857"};font-weight:800">${formatNumber(p.pred7)}%</td>
        <td class="num" style="color:${p.pred30 > defaultThreshold ? "#be123c" : "#047857"};font-weight:800">${formatNumber(p.pred30)}%</td>
        <td><span class="prediction-trend ${trendCls}"><i class="fa-solid ${trendIcon}"></i> ${trendLabel}</span></td>
      </tr>`;
  }).join("");
}

/* ----- DÉTECTION DÉGRADATION RAPIDE ----- */
function computeTrendSlope(siteRows, lastN = 24){
  const sorted = [...siteRows].sort((a,b) => (makeDateTime(a)||"").localeCompare(makeDateTime(b)||""));
  const recent = sorted.slice(-lastN);
  if(recent.length < 3) return 0;
  const n = recent.length;
  const xs = recent.map((_, i) => i);
  const ys = recent.map(r => Number(r.packet_loss) || 0);
  const sumX = xs.reduce((s,x)=>s+x,0);
  const sumY = ys.reduce((s,y)=>s+y,0);
  const sumXY = xs.reduce((s,x,i)=>s + x*ys[i], 0);
  const sumX2 = xs.reduce((s,x)=>s + x*x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if(denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/* =========================================================
   OVERLAY
   ========================================================= */
function toggleOverlayPanel(force){
  const panel = $("overlayPanel");
  if(!panel) return;
  const show = force !== undefined ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !show);
  if(show){ renderOverlayChips(); renderOverlayChart(); }
}
function renderOverlayChips(){
  const chips = $("overlayChips");
  if(!chips) return;
  if(!overlaySites.length){
    chips.innerHTML = `<span class="overlay-chip-empty">Aucun site sélectionné</span>`;
    return;
  }
  chips.innerHTML = overlaySites.map(s => `
    <span class="overlay-chip" data-site="${escapeHtml(s)}">
      ${escapeHtml(s)}
      <span class="overlay-chip__remove" data-remove="${escapeHtml(s)}"><i class="fa-solid fa-xmark"></i></span>
    </span>`).join("");
  chips.querySelectorAll("[data-remove]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      overlaySites = overlaySites.filter(x => x !== el.dataset.remove);
      storageSet(LS_KEYS.OVERLAY, overlaySites);
      renderOverlayChips();
      renderOverlayChart();
    });
  });
}
function renderOverlayChart(){
  const container = $("overlayChart");
  if(!container) return;
  if(!overlaySites.length){
    Plotly.purge(container);
    container.textContent = "Sélectionnez au moins un site pour comparer.";
    return;
  }
  const traces = [];
  overlaySites.forEach((site, idx) => {
    const rows = (lastFilteredRows || [])
      .filter(r => normalizeSite(r.Site) === normalizeSite(site))
      .sort((a,b) => (makeDateTime(a)||"").localeCompare(makeDateTime(b)||""));
    if(!rows.length) return;
    const x = rows.map(r => makeDateTime(r));
    const y = rows.map(r => Number(r.packet_loss));
    const color = OVERLAY_COLORS[idx % OVERLAY_COLORS.length];
    traces.push({
      x, y, type:"scatter", mode:"lines+markers", name: site,
      line:{ color, width:2, shape:"spline", smoothing:0.5 },
      marker:{ color, size:4 },
      hovertemplate:`<b>${escapeHtml(site)}</b><br>%{x|%d/%m %H:%M}<br>Packet Loss : %{y:.4f}%<extra></extra>`
    });
  });
  if(traces.length){
    const allX = traces[0].x;
    traces.push({
      x: allX, y: allX.map(() => defaultThreshold),
      type:"scatter", mode:"lines", name:"Seuil par défaut",
      line:{ dash:"dash", color:"#ef4444", width:1.2 },
      hoverinfo:"skip"
    });
  }
  Plotly.newPlot(container, traces, {
    margin:{ l:55, r:20, t:20, b:80 },
    paper_bgcolor: getChartBg(), plot_bgcolor: getChartBg(),
    font:{ family:"Inter, Segoe UI, Arial", size:11, color: getChartTextColor() },
    hovermode:"x unified",
    hoverlabel:{ bgcolor:"#0f172a", bordercolor:"#0f172a", font:{ color:"#fff", size:12 } },
    legend:{ orientation:"h", y:-0.15, x:0, font:{ size:11 } },
    xaxis:{ type:"date", tickformat:"%d/%m", gridcolor: getChartGridColor(), linecolor: getChartLineColor(), color: getChartTextColor() },
    yaxis:{ title:"Packet Loss (%)", rangemode:"tozero", gridcolor: getChartGridColor(), linecolor: getChartLineColor(), color: getChartTextColor() }
  }, { responsive:true, displaylogo:false, modeBarButtonsToRemove:['lasso2d','select2d','hoverClosestCartesian','hoverCompareCartesian','toggleSpikelines','zoom2d','pan2d'] });
}
function bindOverlay(){
  safeOn("overlayBtn", "click", () => {
    toggleOverlayPanel(true);
    renderOverlayChips();
    renderOverlayChart();
  });
  safeOn("overlayClose", "click", () => toggleOverlayPanel(false));
  safeOn("overlayClearBtn", "click", () => {
    overlaySites = [];
    storageSet(LS_KEYS.OVERLAY, overlaySites);
    renderOverlayChips();
    renderOverlayChart();
  });
  safeOn("overlaySearch", "input", e => {
    const q = normalizeSite(e.target.value || "");
    const box = $("overlaySuggestions");
    if(!box) return;
    if(!q){ box.classList.add("hidden"); box.innerHTML = ""; return; }
    const matches = (lastSiteStats || [])
      .map(s => normalizeSite(s.Site))
      .filter(s => s.includes(q) && !overlaySites.includes(s))
      .slice(0, 12);
    if(!matches.length){ box.classList.add("hidden"); box.innerHTML = ""; return; }
    box.innerHTML = matches.map(s => `
      <div class="overlay-suggestion" data-site="${escapeHtml(s)}">
        <span>${escapeHtml(s)}</span><small>+ Ajouter</small>
      </div>`).join("");
    box.classList.remove("hidden");
    box.querySelectorAll(".overlay-suggestion").forEach(el => {
      el.addEventListener("click", () => {
        const site = el.dataset.site;
        if(!overlaySites.includes(site)){
          overlaySites.push(site);
          storageSet(LS_KEYS.OVERLAY, overlaySites);
          renderOverlayChips();
          renderOverlayChart();
        }
        const inp = $("overlaySearch");
        if(inp) inp.value = "";
        box.classList.add("hidden");
        box.innerHTML = "";
      });
    });
  });
}

/* =========================================================
   COMPARAISON
   ========================================================= */
function toggleCompareBlock(force){
  const block = $("compareBlock");
  if(!block) return;
  const show = force !== undefined ? force : block.classList.contains("hidden");
  compareMode = show;
  block.classList.toggle("hidden", !show);
  if(show){
    const endRef = new Date($("startDate")?.value || new Date());
    endRef.setDate(endRef.getDate() - 1);
    const startRef = new Date(endRef);
    startRef.setDate(startRef.getDate() - 6);
    const s = $("compareRefStart"); if(s) s.value = toDateInput(startRef);
    const e = $("compareRefEnd");   if(e) e.value = toDateInput(endRef);
    const cur = $("compareCurrentRange");
    if(cur) cur.textContent = `${formatDateFR($("startDate")?.value)} → ${formatDateFR($("endDate")?.value)}`;
  }
}
async function runComparison(){
  const sites  = parseSitesText($("sitesPaste")?.value || "");
  const vendor = $("vendor")?.value || "ALL";
  const refS = $("compareRefStart")?.value || "";
  const refE = $("compareRefEnd")?.value || "";
  const curS = $("startDate")?.value || "";
  const curE = $("endDate")?.value || "";
  if(!sites.length) return showMessage("Aucun site à comparer.");
  if(!refS || !refE || !curS || !curE) return showMessage("Dates manquantes.");
  const btn = $("compareRunBtn");
  if(btn){ btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Comparaison...'; }
  try{
    const [resCurrent, resRef] = await Promise.all([
      fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ sites, vendor, start_date: curS, end_date: curE }) }).then(r => r.json()),
      fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ sites, vendor, start_date: refS, end_date: refE }) }).then(r => r.json())
    ]);
    if(!resCurrent.success || !resRef.success) throw new Error("Erreur de comparaison.");
    compareResult = { current: resCurrent, reference: resRef, curS, curE, refS, refE };
    renderCompareResults();
    showMessage("Comparaison terminée.");
  }catch(e){
    console.error(e);
    showMessage("Échec : " + e.message);
  }finally{
    if(btn){ btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Comparer'; }
  }
}
function renderCompareResults(){
  const panel = $("compareResultsPanel");
  if(!panel || !compareResult) return;
  panel.classList.remove("hidden");
  const sub = $("compareResultsSubtitle");
  if(sub){
    sub.textContent = `Courante : ${formatDateFR(compareResult.curS)} → ${formatDateFR(compareResult.curE)}  •  Référence : ${formatDateFR(compareResult.refS)} → ${formatDateFR(compareResult.refE)}`;
  }
  const curRows = compareResult.current.rows || [];
  const refRows = compareResult.reference.rows || [];
  const curAvg = computeGlobalAvg(curRows);
  const refAvg = computeGlobalAvg(refRows);
  const deltaAvg = refAvg > 0 ? ((curAvg - refAvg) / refAvg) * 100 : (curAvg > 0 ? 100 : 0);
  const curMax = computeGlobalMax(curRows);
  const refMax = computeGlobalMax(refRows);
  const curImpacted = countImpacted(curRows);
  const refImpacted = countImpacted(refRows);
  const kpiBox = $("compareSummaryKpi");
  if(kpiBox){
    kpiBox.innerHTML = `
      <div class="compare-kpi">
        <div class="compare-kpi__label">Moyenne</div>
        <div class="compare-kpi__value">${formatNumber(curAvg)}%</div>
        <span class="compare-kpi__delta ${deltaAvg < -5 ? "compare-kpi__delta--good" : deltaAvg > 5 ? "compare-kpi__delta--bad" : "compare-kpi__delta--neutral"}">
          <i class="fa-solid ${deltaAvg < 0 ? "fa-arrow-down" : "fa-arrow-up"}"></i>
          ${Math.abs(deltaAvg).toFixed(1)}% vs réf.
        </span>
      </div>
      <div class="compare-kpi">
        <div class="compare-kpi__label">Pic maximum</div>
        <div class="compare-kpi__value">${formatNumber(curMax)}%</div>
        <span class="compare-kpi__delta compare-kpi__delta--neutral">Réf. : ${formatNumber(refMax)}%</span>
      </div>
      <div class="compare-kpi">
        <div class="compare-kpi__label">Sites impactés</div>
        <div class="compare-kpi__value">${curImpacted}</div>
        <span class="compare-kpi__delta ${curImpacted <= refImpacted ? "compare-kpi__delta--good" : "compare-kpi__delta--bad"}">Réf. : ${refImpacted}</span>
      </div>
      <div class="compare-kpi">
        <div class="compare-kpi__label">Mesures</div>
        <div class="compare-kpi__value">${curRows.length}</div>
        <span class="compare-kpi__delta compare-kpi__delta--neutral">Réf. : ${refRows.length}</span>
      </div>`;
  }
  const curSeries = aggregateByHour(curRows);
  const refSeries = aggregateByHour(refRows);
  Plotly.newPlot("compareChart", [
    {
      x: curSeries.map(p => p.label), y: curSeries.map(p => p.avg),
      type:"scatter", mode:"lines+markers", name:"Période courante",
      line:{ color:"#4f46e5", width:2.2, shape:"spline", smoothing:0.5 },
      marker:{ color:"#4f46e5", size:5 }
    },
    {
      x: refSeries.map(p => p.label), y: refSeries.map(p => p.avg),
      type:"scatter", mode:"lines+markers", name:"Période de référence",
      line:{ color:"#f97316", width:2, dash:"dot", shape:"spline", smoothing:0.5 },
      marker:{ color:"#f97316", size:5 }
    }
  ], {
    margin:{ l:55, r:20, t:20, b:60 },
    paper_bgcolor: getChartBg(), plot_bgcolor: getChartBg(),
    font:{ family:"Inter, Segoe UI, Arial", size:11, color: getChartTextColor() },
    hovermode:"x unified",
    legend:{ orientation:"h", y:-0.15, x:0, font:{ size:11 } },
    xaxis:{ title:"Heure de la journée", gridcolor: getChartGridColor(), linecolor: getChartLineColor(), color: getChartTextColor() },
    yaxis:{ title:"Packet Loss moyen (%)", rangemode:"tozero", gridcolor: getChartGridColor(), linecolor: getChartLineColor(), color: getChartTextColor() }
  }, { responsive:true, displaylogo:false });
}
function aggregateByHour(rows){
  const buckets = {};
  rows.forEach(r => {
    const h = rowHour(r);
    if(!buckets[h]) buckets[h] = { sum:0, n:0 };
    buckets[h].sum += Number(r.packet_loss) || 0;
    buckets[h].n++;
  });
  return Object.keys(buckets).map(Number).sort((a,b)=>a-b).map(h => ({
    label: String(h).padStart(2,"0") + ":00",
    avg: buckets[h].sum / buckets[h].n
  }));
}
function computeGlobalAvg(rows){
  if(!rows.length) return 0;
  return rows.reduce((s,r) => s + (Number(r.packet_loss)||0), 0) / rows.length;
}
function computeGlobalMax(rows){
  if(!rows.length) return 0;
  return Math.max(...rows.map(r => Number(r.packet_loss)||0));
}
function countImpacted(rows){
  const bySite = {};
  rows.forEach(r => {
    const s = normalizeSite(r.Site);
    if(!s) return;
    (bySite[s] ||= []).push(r);
  });
  let count = 0;
  Object.entries(bySite).forEach(([site, list]) => {
    const avg = list.reduce((a,r) => a + (Number(r.packet_loss)||0), 0) / list.length;
    if(avg > thresholdFor(site)) count++;
  });
  return count;
}
function bindCompare(){
  safeOn("compareToggleBtn", "click", () => toggleCompareBlock());
  safeOn("compareCloseBtn", "click", () => toggleCompareBlock(false));
  safeOn("compareRunBtn", "click", runComparison);
  safeOn("compareResultsClose", "click", () => {
    const p = $("compareResultsPanel");
    if(p) p.classList.add("hidden");
  });
}

/* =========================================================
   ALERTES EMAIL (config)
   ========================================================= */
async function loadAlertRules(){
  try{
    const r = await fetch(ALERTS_SAVE_URL, { cache:"no-store" });
    if(!r.ok) throw new Error();
    const data = await r.json();
    if(!data.success || !data.rules) return;
    const rl = data.rules;
    const e = $("alertEmail"); if(e) e.value = rl.email || "";
    const m = $("alertMinHours"); if(m) m.value = rl.min_hours || 3;
    const f = $("alertFrequency"); if(f) f.value = rl.frequency || "hourly";
    const s = $("alertSites"); if(s) s.value = (rl.sites || []).join(" ");
  }catch(_){}
}
async function saveAlertRules(){
  const email = $("alertEmail")?.value?.trim() || "";
  const minHours = Number($("alertMinHours")?.value || 3);
  const frequency = $("alertFrequency")?.value || "hourly";
  const sites = parseSitesText($("alertSites")?.value || "");
  if(!email || !email.includes("@")) return showMessage("Veuillez saisir un email valide.");
  try{
    const r = await fetch(ALERTS_SAVE_URL, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ email, min_hours: minHours, frequency, sites })
    });
    const data = await r.json();
    if(!data.success) throw new Error(data.message || "Erreur serveur.");
    showMessage("Configuration des alertes enregistrée.");
  }catch(e){ showMessage("Échec : " + e.message); }
}
async function testAlert(){
  const email = $("alertEmail")?.value?.trim() || "";
  if(!email) return showMessage("Veuillez saisir un email avant de tester.");
  try{
    const r = await fetch(ALERTS_TEST_URL, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ email })
    });
    const data = await r.json();
    showMessage(data.success ? "Email de test envoyé à " + email : "Échec : " + (data.message||"?"));
  }catch(e){ showMessage("Échec test : " + e.message); }
}
function bindAlerts(){
  safeOn("alertsBtn", "click", () => { loadAlertRules(); openModal("alertsModal"); });
  safeOn("alertSaveBtn", "click", saveAlertRules);
  safeOn("alertTestBtn", "click", testAlert);
}

/* =========================================================
   ALERTES ACTIVES
   ========================================================= */
function computeActiveAlerts(){
  const grouped = {};
  (lastFilteredRows || []).forEach(r => {
    const s = normalizeSite(r.Site);
    if(!s) return;
    (grouped[s] ||= []).push(r);
  });
  const alerts = [];
  Object.entries(grouped).forEach(([site, list]) => {
    const thr = thresholdFor(site);
    const sorted = [...list].sort((a,b) => (makeDateTime(a)||"").localeCompare(makeDateTime(b)||""));
    let consecutive = 0, maxConsecutive = 0, startTs = null;
    sorted.forEach(r => {
      if((Number(r.packet_loss)||0) > thr){
        consecutive++;
        if(!startTs) startTs = makeDateTime(r);
        maxConsecutive = Math.max(maxConsecutive, consecutive);
      } else consecutive = 0;
    });
    if(maxConsecutive >= 2){
      alerts.push({
        site, threshold: thr, hours: maxConsecutive, since: startTs,
        vendor: list[0]?.vendor || "-",
        lastValue: sorted[sorted.length-1]?.packet_loss
      });
    }
  });
  return alerts.sort((a,b) => b.hours - a.hours);
}
function renderActiveAlerts(){
  const list = $("activeAlertsList");
  const badge = $("activeAlertsBadge");
  if(!list) return;
  const alerts = computeActiveAlerts();
  if(badge) badge.textContent = alerts.length;
  if(!alerts.length){
    list.innerHTML = `<div style="text-align:center;padding:30px;color:var(--c-text-muted)">
      <i class="fa-solid fa-check-circle" style="font-size:28px;color:#10b981;display:block;margin-bottom:10px"></i>
      Aucune alerte active. Tous les sites sont dans les seuils.
    </div>`;
    return;
  }
  list.innerHTML = alerts.map(a => `
    <div class="alert-item">
      <div class="alert-item__icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <div class="alert-item__body">
        <div class="alert-item__site">${escapeHtml(a.site)}</div>
        <div class="alert-item__meta">
          <span><i class="fa-regular fa-clock"></i> Depuis <strong>${a.hours}h</strong></span>
          <span><i class="fa-solid fa-gauge-high"></i> Seuil <strong>${a.threshold.toFixed(2)}%</strong></span>
          <span><i class="fa-solid fa-chart-line"></i> Actuel <strong>${formatNumber(a.lastValue)}%</strong></span>
          <span><i class="fa-solid fa-industry"></i> ${escapeHtml(a.vendor)}</span>
        </div>
      </div>
      <div class="alert-item__actions">
        <button class="alert-item__btn" data-locate="${escapeHtml(a.site)}">Localiser</button>
      </div>
    </div>`).join("");
  list.querySelectorAll("[data-locate]").forEach(btn => {
    btn.addEventListener("click", () => {
      const loc = locationIndex[normalizeSite(btn.dataset.locate)];
      if(loc && map) map.setView([Number(loc.lat), Number(loc.lng)], 11, { animate:true });
    });
  });
}
function bindActiveAlerts(){
  safeOn("activeAlertsBtn", "click", () => {
    const panel = $("activeAlertsPanel");
    if(!panel) return;
    const show = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !show);
    if(show) renderActiveAlerts();
  });
  safeOn("activeAlertsClose", "click", () => {
    const panel = $("activeAlertsPanel");
    if(panel) panel.classList.add("hidden");
  });
}

/* =========================================================
   FRAÎCHEUR DES DONNÉES
   ========================================================= */
function updateDataFreshness(){
  const el = $("dataFreshness");
  if(!el) return;
  if(!lastFilteredRows || !lastFilteredRows.length){
    el.textContent = "En attente d'analyse";
    el.parentElement.classList.remove("stale", "error");
    return;
  }
  let maxTs = 0;
  lastFilteredRows.forEach(r => {
    const ts = new Date(makeDateTime(r) || 0).getTime();
    if(ts > maxTs) maxTs = ts;
  });
  if(!maxTs){
    el.textContent = "En attente d'analyse";
    return;
  }
  const diffMin = Math.round((Date.now() - maxTs) / 60000);
  if(diffMin < 60){
    el.textContent = `Dernière mesure il y a ${diffMin} min`;
    el.parentElement.classList.remove("stale", "error");
  } else if(diffMin < 1440){
    el.textContent = `Dernière mesure il y a ${Math.round(diffMin/60)} h`;
    el.parentElement.classList.add("stale");
    el.parentElement.classList.remove("error");
  } else {
    el.textContent = `Dernière mesure il y a ${Math.round(diffMin/1440)} j`;
    el.parentElement.classList.add("error");
    el.parentElement.classList.remove("stale");
  }
}

/* =========================================================
   WALLBOARD
   ========================================================= */
function buildWallboardSlides(){
  wallboardState.slides = [
    { name:"Vue globale", selector:"#globalChart", panel:".panel:has(#globalChart)" },
    { name:"Worst Sites", selector:"#worstTableBody", panel:".panel--worst" },
    { name:"Résumé", selector:".panel--resume", panel:".panel--resume" },
    { name:"Carte réseau", selector:"#mapPanel", panel:"#mapPanel" },
    { name:"Analyse détaillée", selector:"#siteGrid", panel:".panel:has(#siteGrid)" }
  ];
}
function showWallboardSlide(index){
  document.querySelectorAll(".panel").forEach(p => { p.style.display = ""; });
  const slide = wallboardState.slides[index];
  if(!slide) return;
  /* Cache tous les panels sauf celui du slide */
  document.querySelectorAll("#dashboard > .panel, #dashboard > .two-col, #dashboard > .quick-bar, #dashboard > .freshness-bar").forEach(el => {
    el.style.display = "none";
  });
  const target = document.querySelector(slide.panel);
  if(target) target.style.display = "";
  const nameEl = $("wallboardViewName");
  if(nameEl) nameEl.textContent = slide.name;
  setTimeout(() => { if(map) map.invalidateSize(); }, 200);
}
function startWallboard(){
  document.body.classList.add("wallboard-mode");
  const bar = $("wallboardBar");
  if(bar) bar.classList.remove("hidden");
  buildWallboardSlides();
  wallboardState.slideIndex = 0;
  wallboardState.active = true;
  runWallboardCycle();
}
function runWallboardCycle(){
  if(!wallboardState.active) return;
  showWallboardSlide(wallboardState.slideIndex);
  if(wallboardState.timer) clearTimeout(wallboardState.timer);
  wallboardState.timer = setTimeout(() => {
    if(!wallboardState.active) return;
    wallboardState.slideIndex = (wallboardState.slideIndex + 1) % wallboardState.slides.length;
    runWallboardCycle();
  }, wallboardState.duration * 1000);
}
function stopWallboard(){
  wallboardState.active = false;
  if(wallboardState.timer){ clearTimeout(wallboardState.timer); wallboardState.timer = null; }
  document.body.classList.remove("wallboard-mode");
  const bar = $("wallboardBar");
  if(bar) bar.classList.add("hidden");
  document.querySelectorAll("#dashboard > .panel, #dashboard > .two-col, #dashboard > .quick-bar, #dashboard > .freshness-bar").forEach(el => {
    el.style.display = "";
  });
  setTimeout(() => { if(map) map.invalidateSize(); }, 200);
}
function bindWallboard(){
  safeOn("wallboardBtn", "click", () => openModal("wallboardModal"));
  safeOn("wallboardStartBtn", "click", () => {
    const dur = Number($("wallboardDuration")?.value || 30);
    const ref = Number($("wallboardRefresh")?.value || 10);
    wallboardState.duration = dur;
    wallboardState.refresh = ref;
    storageSet(LS_KEYS.WB_DURATION, dur);
    storageSet(LS_KEYS.WB_REFRESH, ref);
    closeModal("wallboardModal");
    startWallboard();
  });
  safeOn("wallboardExit", "click", stopWallboard);
  safeOn("wallboardNext", "click", () => {
    wallboardState.slideIndex = (wallboardState.slideIndex + 1) % wallboardState.slides.length;
    if(wallboardState.timer) clearTimeout(wallboardState.timer);
    runWallboardCycle();
  });
  safeOn("wallboardPrev", "click", () => {
    wallboardState.slideIndex = (wallboardState.slideIndex - 1 + wallboardState.slides.length) % wallboardState.slides.length;
    if(wallboardState.timer) clearTimeout(wallboardState.timer);
    runWallboardCycle();
  });
  safeOn("wallboardPause", "click", () => {
    if(wallboardState.timer){
      clearTimeout(wallboardState.timer);
      wallboardState.timer = null;
      const btn = $("wallboardPause");
      if(btn) btn.innerHTML = '<i class="fa-solid fa-play"></i>';
    } else {
      runWallboardCycle();
      const btn = $("wallboardPause");
      if(btn) btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    }
  });
  /* Recharge les paramètres sauvegardés */
  const d = Number(storageGet(LS_KEYS.WB_DURATION, 30));
  const r = Number(storageGet(LS_KEYS.WB_REFRESH, 10));
  wallboardState.duration = d;
  wallboardState.refresh = r;
  const di = $("wallboardDuration"); if(di) di.value = d;
  const ri = $("wallboardRefresh");  if(ri) ri.value = r;
}

/* =========================================================
   AIDE / GLOSSAIRE
   ========================================================= */
const HELP_CONTENT = {
  guide: `
    <h3>Démarrage rapide</h3>
    <div class="help-step"><div class="help-step__num">1</div><div><strong>Importez vos sites</strong><br>Fichier TXT, Excel, ou collez directement les codes séparés par des espaces.</div></div>
    <div class="help-step"><div class="help-step__num">2</div><div><strong>Définissez la période</strong><br>7 jours par défaut, ou personnalisée. Filtrez aussi par plage horaire.</div></div>
    <div class="help-step"><div class="help-step__num">3</div><div><strong>Choisissez le vendor</strong><br>Tous, Ericsson ou Huawei.</div></div>
    <div class="help-step"><div class="help-step__num">4</div><div><strong>Lancez l'analyse</strong><br>Le dashboard s'affiche avec les KPI, le top des sites dégradés et l'analyse détaillée.</div></div>
    <div class="help-step"><div class="help-step__num">5</div><div><strong>Explorez les onglets</strong><br>Sites, Fiabilité, Corrélations, Heatmap horaire, Prédictions.</div></div>
    <h3>Astuces</h3>
    <ul>
      <li>Le mode <strong>HUB auto</strong> (activé par défaut) n'affiche que les HUBs liés aux sites analysés, avec le statut de chaque site lié.</li>
      <li>Cliquez sur un graphique de site pour y ajouter une annotation.</li>
      <li>Zoomez sur le graphique global : tous les graphiques se synchronisent.</li>
      <li>Définissez des seuils par site pour éviter les faux positifs.</li>
    </ul>`,
  glossary: `
    <h3>Termes techniques</h3>
    <div class="glossary-term"><div class="glossary-term__name">Packet Loss</div><div class="glossary-term__desc">Pourcentage de paquets perdus. Indicateur clé de qualité réseau.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">Seuil</div><div class="glossary-term__desc">Valeur au-delà de laquelle le site est considéré comme dégradé. Par défaut 0,1 %.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">HUB</div><div class="glossary-term__desc">Site central du réseau, connecté à de nombreux autres. Sa panne impacte beaucoup de monde.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">RNC / BSC</div><div class="glossary-term__desc">Contrôleur de réseau radio (3G/2G).</div></div>
    <div class="glossary-term"><div class="glossary-term__name">FO (Fibre Optique)</div><div class="glossary-term__desc">Lien de transport principal en fibre.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">FH (Faisceau Hertzien)</div><div class="glossary-term__desc">Lien radio point-à-point.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">WDM</div><div class="glossary-term__desc">Wavelength Division Multiplexing.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">SLA</div><div class="glossary-term__desc">Service Level Agreement. Engagement de qualité de service.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">MTBF</div><div class="glossary-term__desc">Mean Time Between Failures. Temps moyen entre pannes.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">MTTR</div><div class="glossary-term__desc">Mean Time To Repair. Durée moyenne de résolution.</div></div>`,
  kpis: `
    <h3>Signification des KPIs</h3>
    <div class="glossary-term"><div class="glossary-term__name">Sites demandés</div><div class="glossary-term__desc">Nombre total de sites que vous avez saisis.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">Avec données</div><div class="glossary-term__desc">Sites pour lesquels des mesures ont été trouvées.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">Sans données</div><div class="glossary-term__desc">Sites demandés sans mesure. À vérifier.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">Taux de couverture</div><div class="glossary-term__desc">(Sites avec données / Sites demandés) × 100.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">Impactés</div><div class="glossary-term__desc">Sites dont la moyenne dépasse leur seuil.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">Dégradés / Stables / Améliorés</div><div class="glossary-term__desc">Tendance comparant 1ère et 2ème moitié de période.</div></div>
    <div class="glossary-term"><div class="glossary-term__name">Score qualité</div><div class="glossary-term__desc">Note sur 100 combinant moyenne, pic, fréquence et durée.</div></div>`
};
function showHelpContent(tab){
  const el = $("helpContent");
  if(!el) return;
  el.innerHTML = HELP_CONTENT[tab] || HELP_CONTENT.guide;
}
function bindHelp(){
  safeOn("helpBtn", "click", () => {
    showHelpContent("guide");
    document.querySelectorAll(".help-tab").forEach(t => t.classList.toggle("is-active", t.dataset.help === "guide"));
    openModal("helpModal");
  });
  document.querySelectorAll(".help-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".help-tab").forEach(t => t.classList.toggle("is-active", t === tab));
      showHelpContent(tab.dataset.help);
    });
  });
}

/* =========================================================
   ZOOM SYNCHRONISÉ
   ========================================================= */
function bindSynchronizedZoom(){
  const globalChart = document.getElementById("globalChart");
  if(!globalChart || globalChart._syncBound) return;
  globalChart._syncBound = true;
  globalChart.on("plotly_relayout", (ev) => {
    if(ev["xaxis.range[0]"] === undefined && ev["xaxis.autorange"] !== true) return;
    const x0 = ev["xaxis.range[0]"];
    const x1 = ev["xaxis.range[1]"];
    document.querySelectorAll(".site-chart").forEach(el => {
      if(!el._fullLayout) return;
      try{
        if(ev["xaxis.autorange"]){
          Plotly.relayout(el, { "xaxis.autorange": true });
        } else {
          Plotly.relayout(el, { "xaxis.range": [x0, x1] });
        }
      }catch(_){}
    });
  });
}

/* =========================================================
   RECT FILTER + SIMULATION (carte)
   ========================================================= */
function bindRectangleFilter(){
  safeOn("rectFilterBtn", "click", () => {
    if(!map) return;
    const btn = $("rectFilterBtn");
    if(rectFilterActive){
      if(rectFilter){ rectFilter.remove(); rectFilter = null; }
      rectFilterActive = false;
      btn.classList.remove("is-active");
      renderMap(lastSiteStats);
      return;
    }
    rectFilterActive = true;
    btn.classList.add("is-active");
    const startPt = { lat:null, lng:null };
    const handler = (e) => {
      if(startPt.lat === null){
        startPt.lat = e.latlng.lat;
        startPt.lng = e.latlng.lng;
        return;
      }
      const b = L.latLngBounds(
        [startPt.lat, startPt.lng],
        [e.latlng.lat, e.latlng.lng]
      );
      if(rectFilter) rectFilter.remove();
      rectFilter = L.rectangle(b, { color:"#4f46e5", weight:2, fillOpacity:.1 }).addTo(map);
      const filtered = (lastSiteStats || []).filter(s => {
        const loc = locationIndex[normalizeSite(s.Site)];
        if(!loc) return false;
        return b.contains([Number(loc.lat), Number(loc.lng)]);
      });
      const infoEl = $("mapInfo");
      if(infoEl) infoEl.textContent = `${filtered.length} site(s) dans la zone sélectionnée`;
      renderMapMarkers(filtered);
      map.off("click", handler);
      startPt.lat = null;
      startPt.lng = null;
    };
    map.on("click", handler);
  });
}
function bindOutageSimulation(){
  safeOn("simulateOutageBtn", "click", () => {
    if(!map || !networkGraph) return;
    const site = prompt("Entrez le code d'un site à simuler en panne :");
    if(!site) return;
    const code = normalizeSite(site);
    if(!networkGraph.adjacency.has(code)){
      return showMessage("Ce site n'est pas dans le graphe réseau.");
    }
    const dependents = [...networkGraph.adjacency.get(code)].map(normalizeSite);
    document.querySelectorAll(".site-marker-dot").forEach(dot => {
      const parent = dot.closest(".site-marker");
      const label = parent?.querySelector(".site-marker-id")?.textContent?.trim();
      if(label && dependents.includes(normalizeSite(label))){
        dot.style.background = "#be123c";
        dot.style.boxShadow = "0 0 0 4px rgba(244,63,94,.5)";
      }
    });
    showMessage(`Simulation : panne de ${code} → ${dependents.length} site(s) impacté(s)`);
    setTimeout(() => renderMapMarkers(lastSiteStats), 4000);
  });
}

/* =========================================================
   EXEMPLE
   ========================================================= */
function tryExample(){
  const pasteEl = $("sitesPaste");
  if(!pasteEl) return;
  pasteEl.value = ["AC078","AC155","ET010","ET032","ET247","ET257","ET839",
                   "IM024","IM032","IM178","IM270","IM298","IM344","IM552","IM576"].join("\n");
  const presetEl = $("periodPreset");
  if(presetEl){ presetEl.value = "7"; setPeriod("7"); }
  showMessage("Exemple pré-rempli. Cliquez sur Lancer l'analyse.");
}

/* =========================================================
   RENDER AU CHANGEMENT D'ONGLET
   ========================================================= */
function onDashboardRendered(){
  updateDataFreshness();
  if(activeTab === "reliability") renderReliabilityTable();
  else if(activeTab === "correlation") renderCorrelation();
  else if(activeTab === "heatmap") renderHeatmap();
  else if(activeTab === "predictions") renderPredictions();
  const alerts = computeActiveAlerts();
  const badge = $("activeAlertsBadge");
  if(badge) badge.textContent = alerts.length;
  const panel = $("activeAlertsPanel");
  if(panel && !panel.classList.contains("hidden")) renderActiveAlerts();
  bindSynchronizedZoom();
}

/* =========================================================
   MESSAGES
   ========================================================= */
function showMessage(msg){
  const el = $("message");
  if(!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 6000);
}
function clearMessage(){
  const el = $("message");
  if(!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

/* =========================================================
   RESET
   ========================================================= */
safeOn("resetBtn", "click", () => {
  ["sitesFile","excelFile","sitesPaste"].forEach(id => { const el = $(id); if(el) el.value = ""; });
  const fn = $("sitesFileName"); if(fn) fn.textContent = "Aucun fichier sélectionné";
  const v = $("vendor"); if(v) v.value = "ALL";
  const h = $("hourRange"); if(h) h.value = "all";
  const s = $("siteSort"); if(s) s.value = "name_asc";
  const t = $("trendFilter"); if(t) t.value = "all";
  const ss = $("siteSearch"); if(ss) ss.value = "";

  chartViewMode = "day";
    /* Désactive la heatmap */
  heatmapActive = false;
  const hmChk = $("toggleHeatmap");
  if(hmChk) hmChk.checked = false;
  if(heatmapLayer){ map.removeLayer(heatmapLayer); heatmapLayer = null; }
  hideHeatmapLegend();
  const toggle = $("viewToggle");
  if(toggle) toggle.querySelectorAll(".view-toggle__btn").forEach(b => b.classList.toggle("is-active", b.dataset.view === "day"));

  initPeriod();

  const mv = $("mapVendorFilter"); if(mv) mv.value = "ALL";
  const ml = $("mapLinkFilter"); if(ml) ml.value = "ALL";
  ["toggleSites","toggleFO","toggleFH","toggleTR","toggleTOPO"].forEach(id => { const el = $(id); if(el) el.checked = true; });
  const th = $("toggleHubs"); if(th) th.checked = false;

  mapFilterState.vendor = "ALL";
  mapFilterState.linkType = "ALL";
  mapFilterState.showSites = true;
  mapFilterState.showFO = true;
  mapFilterState.showFH = true;
  mapFilterState.showTR = true;
  mapFilterState.showTOPO = true;

  const dash = $("dashboard"); if(dash) dash.classList.add("hidden");
  const empty = $("emptyState"); if(empty) empty.classList.remove("hidden");
  const ri = $("requestInfo"); if(ri) ri.classList.add("hidden");
  clearMessage();
  setStatus("Prêt", "ok");

  if(map){
    mapMarkers.forEach(m => m.remove());
    mapMarkers = [];
    Object.values(mapLinkLayers).forEach(l => { if(l) l.remove(); });
    mapLinkLayers = {};
    map.setView(CI_CENTER,CI_ZOOM,{animate:false});
  }
  hubScores = []; selectedHub = null; networkGraph = null;
  clearHubFilter();
  const hubList = $("hubList");
  if(hubList) hubList.innerHTML = `<div class="hub-empty"><i class="fa-solid fa-circle-info"></i><p>Lancez une analyse pour identifier les HUBs.</p></div>`;
  const hd = $("hubDetails"); if(hd) hd.classList.add("hidden");
  const mlay = $("mapLayout"); if(mlay) mlay.classList.remove("is-collapsed");
  const float = $("hubPanelToggleFloat"); if(float) float.classList.add("hidden");
  const covEl = $("kCoverage"); if(covEl) covEl.textContent = "0%";
  const covBar = $("kCoverageBar"); if(covBar) covBar.style.width = "0%";
  lastResult = null; lastFilteredRows = []; lastSiteStats = [];
  siteTrends = {};
  toggleOverlayPanel(false);
  const crp = $("compareResultsPanel"); if(crp) crp.classList.add("hidden");
  correlationMatrix = null;
  correlationSites = [];
  autoHubData = null;
  if(wallboardState.active) stopWallboard();
  const aap = $("activeAlertsPanel"); if(aap) aap.classList.add("hidden");
  updateDataFreshness();
});

/* =========================================================
   INITIALISATION
   ========================================================= */
function init(){
  checkDependencies();
  checkRequiredElements();
  initTheme();
  initThresholds();
  loadAnnotations();
  overlaySites = storageGet(LS_KEYS.OVERLAY, []);
  initPeriod();

  safeOn("periodPreset", "change", e => setPeriod(e.target.value));
  safeOn("analyzeBtn", "click", runAnalysis);

  bindViewToggle();
  bindSavedModal();
  bindAnnotationModal();
  bindThresholdsModal();
  bindOverlay();
  bindCompare();
  bindAlerts();
  bindModalClosers();
  bindTabs();
  bindWallboard();
  bindHelp();
  bindActiveAlerts();
  bindRectangleFilter();
  bindOutageSimulation();
  bindAutoHubBtn();
    bindHeatmapToggle();
  safeOn("tryExampleBtn", "click", tryExample);

  /* Charge les données référentielles */
  Promise.all([loadLocations(), loadNetworkLinks()]).then(() => {
    console.log("✅ Données référentielles chargées.");
  });

  /* Met à jour la fraîcheur toutes les 60s */
  setInterval(updateDataFreshness, 60000);
  updateDataFreshness();

  console.log("🚀 Dashboard v20 initialisé.");
}


/* =========================================================
   V20.5 — HEATMAP SUR LA CARTE
   ---------------------------------------------------------
   Affiche un calque de cercles colorés sur la carte :
   - Rayon proportionnel au taux de packet loss moyen
   - Couleur : vert (faible) → jaune → orange → rouge (élevé)
   - Regroupe visuellement les zones à problème
   ========================================================= */
function renderMapHeatmap(){
  if(!map) return;

  /* Nettoie le calque précédent */
  if(heatmapLayer){
    map.removeLayer(heatmapLayer);
    heatmapLayer = null;
  }

  /* Récupère les sites avec localisation et packet loss */
  const data = (lastSiteStats || [])
    .map(s => {
      const code = normalizeSite(s.Site);
      const loc = locationIndex[code];
      if(!loc) return null;
      const lat = Number(loc.lat), lng = Number(loc.lng);
      if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        site: code,
        lat, lng,
        value: Number(s.avg_packet_loss) || 0,
        threshold: thresholdFor(code),
        vendor: s.vendor,
        region: loc.region || "",
        localite: loc.localite || ""
      };
    })
    .filter(Boolean);

  if(!data.length){
    showMessage("Aucune donnée à afficher en heatmap.");
    return;
  }

  /* Détermine la valeur maximale pour la normalisation */
  const maxVal = Math.max(...data.map(d => d.value), 0.01);

  /* Palette : vert → jaune → orange → rouge */
  function colorForValue(v){
    const ratio = Math.min(1, v / maxVal);
    /* HSL : hue de 120 (vert) à 0 (rouge) */
    const hue = 120 - ratio * 120;
    const saturation = 70 + ratio * 20; /* plus c'est rouge, plus c'est saturé */
    const lightness = 55 - ratio * 10;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  /* Rayon de base : plus la valeur est élevée, plus le cercle est grand */
  function radiusForValue(v){
    const ratio = Math.min(1, v / maxVal);
    /* Rayon : 15km minimum + 40km * ratio */
    return 15000 + ratio * 45000;
  }

  const layers = [];

  /* Dessine les cercles, du plus grand au plus petit pour l'effet de superposition */
  const sorted = [...data].sort((a, b) => b.value - a.value);

  sorted.forEach(d => {
    const color = colorForValue(d.value);
    const radius = radiusForValue(d.value);
    const isImpacted = d.value > d.threshold;

    /* Halo extérieur (effet de glow) */
    const halo = L.circle([d.lat, d.lng], {
      radius: radius * 1.4,
      stroke: false,
      fillColor: color,
      fillOpacity: 0.10,
      interactive: false
    });

    /* Cercle principal */
    const circle = L.circle([d.lat, d.lng], {
      radius: radius,
      stroke: true,
      color: color,
      weight: 2,
      opacity: 0.8,
      fillColor: color,
      fillOpacity: 0.35,
      interactive: true
    });

    /* Tooltip au survol */
    const statusLabel = isImpacted ? "Impacté" : "Sain";
    const statusColor = isImpacted ? "#be123c" : "#047857";
    circle.bindTooltip(`
      <div style="font-family:Inter,Segoe UI,Arial,sans-serif">
        <div style="font-weight:900;color:#fbbf24;margin-bottom:5px;font-size:13.5px">${escapeHtml(d.site)}</div>
        <div style="font-weight:800;font-size:14px;margin-bottom:4px">${formatNumber(d.value)}%</div>
        <div style="font-size:10.5px;opacity:.85;margin-bottom:3px">Seuil : ${d.threshold.toFixed(2)}%</div>
        <div style="font-size:10.5px;font-weight:800;color:${statusColor};text-transform:uppercase;letter-spacing:.05em">${statusLabel}</div>
        <div style="font-size:10px;opacity:.7;margin-top:5px">${escapeHtml(d.region)}${d.localite ? " • " + escapeHtml(d.localite) : ""}</div>
      </div>`,
      { sticky:true, direction:"top", className:"map-hover-tooltip", interactive:false }
    );

    /* Clic → mode HUB actif sur ce site */
    circle.on("click", (ev) => {
      if(ev && ev.originalEvent) L.DomEvent.stopPropagation(ev);
      selectSite(d.site);
    });

    layers.push(halo, circle);
  });

  /* Ajoute le groupe au calque */
  heatmapLayer = L.layerGroup(layers).addTo(map);

  /* Affiche la légende */
  showHeatmapLegend(maxVal);
}

function showHeatmapLegend(maxVal){
  hideHeatmapLegend();
  const mapPanel = $("mapPanel");
  if(!mapPanel) return;
  const legend = document.createElement("div");
  legend.className = "map-heatmap-legend";
  legend.id = "mapHeatmapLegend";
  legend.innerHTML = `
    <div class="map-heatmap-legend__title">
      <i class="fa-solid fa-fire"></i> Heatmap Packet Loss
    </div>
    <div class="map-heatmap-legend__scale">
      <span>0%</span>
      <span class="map-heatmap-legend__gradient"></span>
      <span>${formatNumber(maxVal, 2)}%</span>
    </div>
    <div class="map-heatmap-legend__labels">
      <span>Faible</span>
      <span>Élevé</span>
    </div>
    <div class="map-heatmap-legend__info">
      <i class="fa-solid fa-circle-info"></i>
      Rayon et couleur proportionnels au taux de perte moyen.
    </div>
  `;
  mapPanel.appendChild(legend);
}

function hideHeatmapLegend(){
  const el = $("mapHeatmapLegend");
  if(el) el.remove();
}

/* Toggle de la heatmap */
function toggleHeatmap(show){
  heatmapActive = show !== undefined ? show : !heatmapActive;

  /* Synchronise le checkbox */
  const chk = $("toggleHeatmap");
  if(chk) chk.checked = heatmapActive;

  if(heatmapActive){
    /* Cache les marqueurs classiques pour ne pas surcharger */
    const markersVisible = mapFilterState.showSites;
    if(markersVisible){
      mapMarkers.forEach(m => m.remove());
      mapMarkers = [];
    }
    /* Cache aussi les liaisons pour la lisibilité */
    Object.values(mapLinkLayers).forEach(layer => { if(layer) layer.remove(); });
    mapLinkLayers = {};

    renderMapHeatmap();
  } else {
    /* Retire la heatmap */
    if(heatmapLayer){
      map.removeLayer(heatmapLayer);
      heatmapLayer = null;
    }
    hideHeatmapLegend();
    /* Restaure l'affichage classique */
    if(lastResult){
      renderNetworkLinksOnMap();
      if(mapFilterState.showSites) renderMapMarkers(lastSiteStats);
    }
  }
}

/* Bind du checkbox heatmap */
function bindHeatmapToggle(){
  const chk = $("toggleHeatmap");
  if(!chk) return;
  chk.addEventListener("change", e => {
    toggleHeatmap(e.target.checked);
  });
}

/* Point d'entrée : on appelle init() dès que le script est chargé.
   Si le DOM n'est pas prêt, on attend DOMContentLoaded. */
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}