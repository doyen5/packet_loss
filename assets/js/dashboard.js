/* =========================================================
   PACKET LOSS DASHBOARD — JS v13
   ---------------------------------------------------------
   Nouveautés v13 :
   - NOUVEAU : sélecteur "Vue jour / Vue brute" pour les
     graphiques par site.
       * Vue jour  : une graduation par jour, axe Y fixé
                     pour inclure le seuil 0.1%, courbe
                     lissée. (comportement actuel)
       * Vue brute : toutes les mesures horaires, axe Y
                     auto-échelonné, lignes droites.
                     (comportement identique à l'export Excel)
   - NOUVEAU : l'export Excel utilise désormais la même
     configuration que la "Vue jour" :
       * dtick = 'D1' (une graduation par jour)
       * Y fixé pour inclure la ligne seuil 0.1%
       * courbe lissée
       * annotation "Seuil 0.1%"

   Correctifs v12 conservés :
   - Affichage de toutes les dates sur l'axe X (dtick D1)
   - Rotation auto des libellés si > 12 jours

   Correctifs v11 conservés :
   - Clic sur n'importe quel marqueur → mode HUB actif
   - selectSite() générique
   - renderHubDetails() extrait

   Correctifs v10 conservés :
   - safeOn() défensif
   - init() après DOMContentLoaded
   - période par défaut = 7 jours
   ========================================================= */

"use strict";

/* =========================================================
   CONSTANTES
   ========================================================= */
const API_URL      = "api/packet_loss.php";
const LOCATION_URL = "data/sites_location.json";
const THRESHOLD    = 0.1;

const NETWORK_LINKS_URLS = {
  FH:   "data/lien_fh.geojson",
  FO:   "data/lien_fo.geojson",
  TR:   "data/lien_transmission.geojson",
  TOPO: "data/lien_wdm_topology.geojson"
};

const LINK_COLORS = {
  FH:   "#f28c28",
  FO:   "#a719d2",
  TR:   "#2af010",
  TOPO: "#61daff"
};

const LINK_LABELS = {
  FH:   "FH",
  FO:   "FO",
  TR:   "Transmission",
  TOPO: "WDM"
};

const CI_CENTER = [7.54, -5.55];
const CI_ZOOM   = 7;

/* =========================================================
   ÉTAT GLOBAL
   ========================================================= */
let locationIndex     = {};
let networkLinks      = { FH: [], FO: [], TR: [], TOPO: [] };
let siteLinkIndex     = {};
let map               = null;
let mapMarkers        = [];
let mapLinkLayers     = {};
let lastResult        = null;
let lastFilteredRows  = [];
let lastSiteStats     = [];

/* NOUVEAU v13 : mode d'affichage des graphiques par site.
   - 'day' : vue synthétique (1 point par jour, seuil visible)
   - 'raw' : vue brute horaire (identique à l'export Excel) */
let chartViewMode = "day";

const siteTrends = {};

const mapFilterState = {
  vendor:    "ALL",
  linkType:  "ALL",
  showSites: true,
  showFO:    true,
  showFH:    true,
  showTR:    true,
  showTOPO:  true
};

let networkGraph      = null;
let hubScores         = [];
let selectedHub       = null;
let hubHighlightLayer = null;

const hubFilterState = {
  active:      false,
  hubSite:     null,
  neighborSet: new Set()
};

const $ = id => document.getElementById(id);

/* =========================================================
   HELPER DÉFENSIF
   ========================================================= */
function safeOn(id, event, handler){
  const el = document.getElementById(id);
  if(!el){
    console.warn(`[DOM] Élément #${id} introuvable dans le HTML — écouteur "${event}" non attaché.`);
    return null;
  }
  el.addEventListener(event, handler);
  return el;
}

function checkRequiredElements(){
  const required = [
    "periodPreset", "startDate", "endDate", "hourRange", "vendor",
    "sitesFile", "sitesPaste", "excelFile", "sitesFileName",
    "analyzeBtn", "resetBtn", "requestInfo", "message",
    "dashboard", "emptyState",
    "kSitesRequested", "kSitesData", "kRows", "kMax", "kAvg", "kImpacted",
    "kNoData", "kNoDataKpi", "kDegrading", "kStable", "kImproving",
    "summaryVendor", "summaryHourRange", "summaryPeriod",
    "noDataPanel", "noDataCount", "noDataList",
    "globalChart", "worstTableBody",
    "mapVendorFilter", "mapLinkFilter",
    "toggleSites", "toggleFO", "toggleFH", "toggleTR", "toggleTOPO", "toggleHubs",
    "mapLayout", "map", "mapInfo",
    "hubPanelToggle", "hubPanelToggleFloat", "hubList", "hubDetails",
    "siteSearch", "siteSort", "trendFilter", "siteGrid",
    "exportBar", "exportPdfBtn", "exportImgBtn",
    "degradedExportBar", "degradedCount",
    "exportDegradedPdfBtn", "exportDegradedImgBtn", "exportDegradedXlsBtn",
    /* NOUVEAU v13 */
    "viewToggle"
  ];
  const optional = ["clearHubFilterBtn","mapResetFloatBtn","hubPanelBody"];
  const missingRequired = required.filter(id => !document.getElementById(id));
  const missingOptional = optional.filter(id => !document.getElementById(id));
  if(missingRequired.length){
    console.error("❌ Éléments HTML OBLIGATOIRES manquants :", missingRequired);
  }
  if(missingOptional.length){
    console.warn("⚠️ Éléments HTML optionnels manquants :", missingOptional);
  }
  if(!missingRequired.length && !missingOptional.length){
    console.log("✅ Tous les éléments HTML attendus sont présents.");
  }
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
   VÉRIFICATION DES DÉPENDANCES JS
   ========================================================= */
(function checkDependencies(){
  const missing  = [];
  const optional = [];

  if(typeof Plotly === "undefined") missing.push("Plotly");
  if(typeof L      === "undefined") missing.push("Leaflet");

  const hasJsPDF   = (window.jspdf && window.jspdf.jsPDF) || (typeof window.jsPDF !== "undefined");
  const hasExcelJS = typeof window.ExcelJS !== "undefined";

  if(!hasJsPDF)                          optional.push("jsPDF");
  if(typeof XLSX        === "undefined") optional.push("XLSX");
  if(!hasExcelJS)                        optional.push("ExcelJS (trends Excel désactivés)");
  if(typeof html2canvas === "undefined") optional.push("html2canvas");
  if(typeof window.DOMPurify === "undefined") optional.push("DOMPurify");

  if(missing.length){
    const msg = "Bibliothèques critiques manquantes : " + missing.join(", ");
    console.error(msg);
    window.addEventListener("DOMContentLoaded", () => {
      const box = document.getElementById("message");
      if(box){ box.textContent = "⚠️ " + msg; box.classList.remove("hidden"); }
    });
  } else if(optional.length){
    console.warn("Fonctions désactivées :", optional.join(" | "));
  }
})();

/* =========================================================
   UTILITAIRES
   ========================================================= */
function normalizeSite(v){
  return String(v ?? "").replace(/\uFEFF/g,"").trim().toUpperCase();
}
function parseSitesText(text){
  const values = String(text ?? "")
    .split(/[\s,;]+/).map(normalizeSite).filter(Boolean);
  return [...new Set(values)];
}
function formatNumber(v,digits=4){
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
  if(!Number.isFinite(target)){
    el.textContent = finalText;
    return;
  }
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

/* =========================================================
   Calcul du nombre de jours uniques
   ========================================================= */
function countUniqueDays(rows){
  if(!rows || !rows.length) return 0;
  const days = new Set();
  rows.forEach(r => {
    const dt = makeDateTime(r);
    if(dt) days.add(dt.slice(0, 10));
  });
  return days.size;
}

/* =========================================================
   Config X-axis "Vue jour" : une graduation par jour
   ========================================================= */
function buildXAxisConfigDay(rows, options = {}){
  const nDays = countUniqueDays(rows);
  const tickangle = nDays > 12 ? -45 : 0;
  const extraBottom = nDays > 12 ? 20 : 0;

  return {
    axis: {
      type: "date",
      title: options.title !== undefined
        ? options.title
        : { text: "Date", font: { size: 11, color: "#64748b" } },
      tickformat: "%d/%m",
      dtick: "D1",
      tickmode: "linear",
      tickangle,
      gridcolor: "#f8fafc",
      linecolor: "#e2e8f0",
      tickfont: { size: options.tickSize || 9.5, color: "#64748b" },
      automargin: true
    },
    extraBottom
  };
}

/* =========================================================
   NOUVEAU v13 — Config X-axis "Vue brute"
   ---------------------------------------------------------
   Affiche toutes les mesures horaires avec un format
   "JJ/MM HH:MM" et une rotation automatique.
   ========================================================= */
function buildXAxisConfigRaw(rows, options = {}){
  const nPoints = (rows || []).length;
  /* Rotation systématique : beaucoup de points horaires */
  const tickangle = nPoints > 20 ? -45 : -30;
  const extraBottom = nPoints > 20 ? 30 : 20;

  return {
    axis: {
      type: "date",
      title: options.title !== undefined
        ? options.title
        : { text: "Date et heure", font: { size: 11, color: "#64748b" } },
      tickformat: "%d/%m %H:%M",
      /* Auto-échelonnage : Plotly choisit, mais on limite
         le nombre max de ticks pour éviter le chevauchement. */
      nticks: Math.min(nPoints, 20),
      tickangle,
      gridcolor: "#f8fafc",
      linecolor: "#e2e8f0",
      tickfont: { size: options.tickSize || 9.5, color: "#64748b" },
      automargin: true
    },
    extraBottom
  };
}

/* =========================================================
   NOUVEAU v13 — Calcul de la plage Y pour "Vue jour"
   ---------------------------------------------------------
   On force l'axe Y à inclure la ligne du seuil 0.1%.
   Cela rend les petits pics visuellement corrects par
   rapport au seuil métier.
   ========================================================= */
function computeFixedYRange(rows){
  const values = (rows || []).map(r => Number(r.packet_loss) || 0);
  const maxVal = values.length ? Math.max(...values) : 0;

  /* On prend au minimum le seuil * 1.25 pour que la ligne
     du seuil ne soit jamais collée au bord haut. */
  const upper = Math.max(THRESHOLD * 1.25, maxVal * 1.2, 0.05);

  return [0, upper];
}

/* =========================================================
   CALCUL DU TEMPS DE DÉGRADATION
   ========================================================= */
function computeDegradedDuration(siteRows){
  if (!siteRows || !siteRows.length){
    return { totalHours:0, longestRun:0, pct:0, totalMeasured:0 };
  }
  const sorted = [...siteRows].sort((a, b) => {
    const da = makeDateTime(a) || "";
    const db = makeDateTime(b) || "";
    return da.localeCompare(db);
  });

  let totalDegraded = 0;
  let longestRun    = 0;
  let currentRun    = 0;
  let prevTs        = null;
  const ONE_HOUR    = 60 * 60 * 1000;
  const MAX_GAP     = ONE_HOUR * 1.5;

  sorted.forEach(row => {
    const value = Number(row.packet_loss) || 0;
    const ts    = new Date(makeDateTime(row) || 0).getTime();

    if (value > THRESHOLD){
      totalDegraded++;
      if (prevTs !== null && ts - prevTs <= MAX_GAP){ currentRun++; }
      else { currentRun = 1; }
      if (currentRun > longestRun) longestRun = currentRun;
    } else { currentRun = 0; }
    prevTs = ts;
  });

  const total = sorted.length;
  const pct   = total ? (totalDegraded / total) * 100 : 0;

  return { totalHours: totalDegraded, longestRun, pct, totalMeasured: total };
}

/* =========================================================
   PÉRIODES
   ========================================================= */
function setPeriod(period){
  const presetEl = $("periodPreset");
  const startEl  = $("startDate");
  const endEl    = $("endDate");
  if(!startEl || !endEl) return;

  const end = new Date();
  let start = new Date(end);
  if(period==="7")       start.setDate(start.getDate()-6);
  else if(period==="14") start.setDate(start.getDate()-13);
  else if(period==="30") start.setDate(start.getDate()-29);

  if(period==="CUSTOM"){
    startEl.disabled = false;
    endEl.disabled   = false;
    return;
  }
  startEl.disabled = true;
  endEl.disabled   = true;
  startEl.value    = toDateInput(start);
  endEl.value      = toDateInput(end);
}

function initPeriod(){
  const presetEl = $("periodPreset");
  if(presetEl) presetEl.value = "7";
  setPeriod("7");
}

/* =========================================================
   CHARGEMENT LOCALISATIONS + LIENS
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
    if(infoEl) infoEl.textContent = "Référentiel de localisation non disponible.";
    console.warn(e);
  }
}

async function loadNetworkLinks(){
  const promises = Object.entries(NETWORK_LINKS_URLS).map(async ([type, url]) => {
    try{
      const r = await fetch(url,{cache:"no-store"});
      if(!r.ok) throw new Error();
      const g = await r.json();
      networkLinks[type] = Array.isArray(g.features) ? g.features : [];
      console.log(`[Réseau] ${type} (${LINK_LABELS[type]}) : ${networkLinks[type].length} lien(s)`);
    }catch(e){
      networkLinks[type] = [];
      console.warn(`[Réseau] ${type} (${LINK_LABELS[type]}) : fichier indisponible`);
    }
  });
  await Promise.all(promises);
  buildSiteLinkIndex();
}

function buildSiteLinkIndex(){
  siteLinkIndex = {};
  const SITE_ID_REGEX = /\b([A-Z]{2}\d{3,4})\b/g;

  for(const type of ["FO","FH","TR","TOPO"]){
    for(const f of networkLinks[type] || []){
      const text = `${f.properties?.description || ""} ${f.properties?.name || ""}`;
      const ids  = text.match(SITE_ID_REGEX) || [];
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

  const hasFO   = !!types.FO;
  const hasFH   = !!types.FH;
  const hasTR   = !!types.TR;
  const hasTOPO = !!types.TOPO;

  if(hasFO && hasFH) return { code:"both", label:"FO + FH", badgeClass:"both", dotClass:"both", icon:"fa-circle-nodes" };
  if(hasFO)          return { code:"fo",   label:"FO",   badgeClass:"fo",   dotClass:"fo",   icon:"fa-circle-nodes" };
  if(hasFH)          return { code:"fh",   label:"FH",   badgeClass:"fh",   dotClass:"fh",   icon:"fa-tower-broadcast" };
  if(hasTR)          return { code:"tr",   label:"Transmission", badgeClass:"tr", dotClass:"tr", icon:"fa-tower-cell" };
  if(hasTOPO)        return { code:"topo", label:"WDM", badgeClass:"topo", dotClass:"topo", icon:"fa-network-wired" };

  return { code:"unknown", label:"—", badgeClass:"unknown", dotClass:"unknown", icon:"" };
}

/* =========================================================
   IMPORTS
   ========================================================= */
safeOn("sitesFile", "change", async e=>{
  const file = e.target.files[0]; if(!file) return;
  const nameEl = $("sitesFileName");
  if(nameEl) nameEl.textContent = file.name;
  const pasteEl = $("sitesPaste");
  if(pasteEl) pasteEl.value = parseSitesText(await file.text()).join("\n");
});

safeOn("excelFile", "change", async e=>{
  const file = e.target.files[0]; if(!file) return;
  if(typeof XLSX === "undefined"){
    return showMessage("Import Excel indisponible (XLSX manquant).");
  }
  try{
    const wb = XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws,{defval:""});
    const sites = [];
    for(const row of rows){
      const key = Object.keys(row).find(k =>
        ["site","sites","site_id","siteid"].includes(String(k).trim().toLowerCase()));
      if(key){
        const s = normalizeSite(row[key]);
        if(s) sites.push(s);
      }
    }
    const pasteEl = $("sitesPaste");
    if(pasteEl) pasteEl.value = [...new Set(sites)].join("\n");
    showMessage(`${new Set(sites).size} site(s) récupéré(s) depuis l'Excel.`);
  }catch(err){
    console.error(err);
    showMessage("Impossible de lire l'Excel.");
  }
});

/* =========================================================
   FILTRE PLAGE HORAIRE
   ========================================================= */
function filterRowsByHour(rows, hourRange){
  if(!hourRange || hourRange === "all") return rows;
  const [start, end] = hourRange.split("-").map(Number);
  return rows.filter(row=>{
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

  const sites     = parseSitesText($("sitesPaste")?.value || "");
  const start     = $("startDate")?.value || "";
  const end       = $("endDate")?.value || "";
  const vendor    = $("vendor")?.value || "ALL";

  if(!sites.length)  return showMessage("Veuillez importer ou coller au moins un site.");
  if(!start || !end) return showMessage("Veuillez renseigner les dates.");
  if(start > end)    return showMessage("La date début doit être antérieure ou égale à la date fin.");

  const btn = $("analyzeBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Analyse..."; }
  setStatus("Analyse...", "loading");

  const infoEl = $("requestInfo");
  if(infoEl){
    infoEl.classList.remove("hidden");
    infoEl.textContent = `${sites.length} site(s) • ${start} → ${end}`;
  }

  try{
    const response = await fetch(API_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({sites,vendor,start_date:start,end_date:end})
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
    if(btn){ btn.disabled = false; btn.textContent = "Analyser"; }
  }
}

/* =========================================================
   RENDU DU DASHBOARD
   ========================================================= */
function renderDashboard(result){
  const dash = $("dashboard");
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
  animateCounter($("kImpacted"), String(Number(result.summary?.impacted_sites||0)));

  animateCounter($("kNoDataKpi"), String(Number(result.sites_without_data_count||0)));

  const trendCounts = computeTrendCounts(siteStats, filteredRows);
  animateCounter($("kDegrading"), String(trendCounts.degrading));
  animateCounter($("kStable"),    String(trendCounts.stable));
  animateCounter($("kImproving"), String(trendCounts.improving));

  const kNoData = $("kNoData");
  if(kNoData) kNoData.textContent = Number(result.sites_without_data_count||0).toLocaleString("fr-FR");

  const summaryVendor = $("summaryVendor");
  if(summaryVendor) summaryVendor.textContent = result.vendor==="ALL" ? "Tous" : result.vendor;

  const hourLabels = {
    "all":"Toute la journée","00-06":"Nuit","06-12":"Matin","12-18":"Après-midi","18-24":"Soir"
  };
  const summaryHour = $("summaryHourRange");
  if(summaryHour) summaryHour.textContent = hourLabels[hourRange] || "-";

  const summaryPeriod = $("summaryPeriod");
  if(summaryPeriod) summaryPeriod.textContent =
    `${formatDateFR(result.start_date)} → ${formatDateFR(result.end_date)}`;

  const degradedCount = siteStats.filter(s => Number(s.avg_packet_loss) > THRESHOLD).length;
  const degCount = $("degradedCount");
  if(degCount) degCount.textContent = degradedCount;
  const degBar = $("degradedExportBar");
  if(degBar) degBar.classList.toggle("hidden", degradedCount === 0);

  renderNoDataSites(result);
  renderGlobalChart(filteredRows);
  renderWorstTable(siteStats);

  buildNetworkGraph();

  renderMap(siteStats);
  renderHubPanel(siteStats);

  renderSiteGrid(siteStats, filteredRows);
}

/* =========================================================
   CALCUL DES COMPTEURS DE TENDANCE
   ========================================================= */
function computeTrendCounts(siteStats, rows){
  const grouped = {};
  rows.forEach(r=>{
    const site = normalizeSite(r.Site);
    if(!site) return;
    (grouped[site] ||= []).push(r);
  });

  let degrading = 0, stable = 0, improving = 0;

  siteStats.forEach(s=>{
    const siteRows = grouped[normalizeSite(s.Site)];
    if(!siteRows || !siteRows.length) return;
    const trend = computeSiteTrend(siteRows);
    if(trend.trend === "degrading")      degrading++;
    else if(trend.trend === "improving") improving++;
    else                                  stable++;
  });

  return { degrading, stable, improving };
}

/* =========================================================
   RECALCUL DES STATS PAR SITE
   ========================================================= */
function recomputeSiteStats(rawSites, rows){
  const bySite = {};
  rows.forEach(r=>{
    const site = normalizeSite(r.Site);
    if(!site) return;
    (bySite[site] ||= []).push(r);
  });

  const stats = [];
  for(const [site, siteRows] of Object.entries(bySite)){
    const values = siteRows.map(r => Number(r.packet_loss) || 0);
    const n      = values.length;
    const avg    = values.reduce((s,v)=>s+v,0) / n;
    const max    = Math.max(...values);
    const min    = Math.min(...values);
    const above  = values.filter(v => v > THRESHOLD).length;
    const link   = getSiteLinkInfo(site);
    const degraded = computeDegradedDuration(siteRows);

    stats.push({
      Site: site,
      vendor: siteRows[0]?.vendor || "",
      avg_packet_loss: avg,
      min_packet_loss: min,
      max_packet_loss: max,
      nb_mesures: n,
      above_threshold: above,
      above_threshold_pct: (above/n)*100,
      status: avg > THRESHOLD ? "IMPACTE" : "NORMAL",
      link_type: link.code,
      degradedDuration: degraded
    });
  }
  stats.sort((a,b)=>b.avg_packet_loss - a.avg_packet_loss);
  return stats;
}

function renderNoDataSites(result){
  const sites = Array.isArray(result.sites_without_data) ? result.sites_without_data : [];
  const box   = $("noDataPanel");
  const countEl = $("noDataCount");
  const listEl  = $("noDataList");
  if(!box || !listEl) return;

  const count = Number(result.sites_without_data_count || sites.length || 0);

  if(!count){
    box.classList.add("hidden");
    listEl.textContent = "";
    return;
  }
  box.classList.remove("hidden");
  if(countEl) countEl.textContent = count.toLocaleString("fr-FR");
  listEl.textContent = "";
  if(sites.length){
    sites.forEach(site=>{
      const item = document.createElement("span");
      item.className = "no-data-site";
      item.textContent = site;
      listEl.appendChild(item);
    });
  } else {
    const item = document.createElement("span");
    item.className = "no-data-site";
    item.textContent = "Liste non fournie par l'API.";
    listEl.appendChild(item);
  }
}

/* =========================================================
   GRAPHE GLOBAL — conserve la "Vue jour" (lisible)
   ========================================================= */
function renderGlobalChart(rows){
  const container = $("globalChart");
  if(!container) return;

  const aggregate = {};
  rows.forEach(row=>{
    const dt    = makeDateTime(row);
    const value = Number(row.packet_loss);
    if(!dt || !Number.isFinite(value)) return;
    if(!aggregate[dt]) aggregate[dt] = {sum:0,count:0};
    aggregate[dt].sum += value;
    aggregate[dt].count += 1;
  });

  const points = Object.keys(aggregate).sort().map(dt=>({
    x:dt, y:aggregate[dt].sum/aggregate[dt].count
  }));

  if(!points.length){
    container.textContent =
      "Aucune donnée disponible pour la période et la plage horaire sélectionnées.";
    return;
  }

  const xConf = buildXAxisConfigDay(rows, {
    title: { text:"Date", font:{size:11,color:"#64748b"} },
    tickSize: 10.5
  });

  Plotly.newPlot("globalChart",[
    {
      x:points.map(p=>p.x), y:points.map(p=>p.y),
      type:"scatter", mode:"lines+markers", name:"Packet Loss",
      line:{color:"#2563eb",width:2.2,shape:"spline",smoothing:0.6},
      marker:{color:"#f97316",size:5,line:{color:"#fff",width:1}},
      fill:"tozeroy",
      fillcolor:"rgba(37,99,235,.06)",
      hovertemplate:"%{x|%d/%m %H:%M}<br>Packet Loss : <b>%{y:.4f}%</b><extra></extra>"
    },
    {
      x:points.map(p=>p.x), y:points.map(()=>THRESHOLD),
      type:"scatter", mode:"lines", name:"Seuil 0.1%",
      line:{dash:"dash",color:"#ef4444",width:1.5},
      hovertemplate:"Seuil : 0.1%<extra></extra>"
    }
  ],{
    margin:{ l:55, r:20, t:15, b: 80 + xConf.extraBottom },
    paper_bgcolor:"#ffffff", plot_bgcolor:"#ffffff",
    font:{family:"Inter, Segoe UI, Arial", size:11, color:"#334155"},
    hovermode:"x unified",
    hoverlabel:{bgcolor:"#0f172a",bordercolor:"#0f172a",font:{color:"#fff",size:12}},
    legend:{orientation:"h",y:1.08,x:0,font:{size:11}},
    xaxis: xConf.axis,
    yaxis:{
      title:{text:"Packet Loss (%)",font:{size:11,color:"#64748b"}},
      rangemode:"tozero", gridcolor:"#f1f5f9", linecolor:"#e2e8f0",
      tickfont:{size:10.5,color:"#64748b"},
      automargin: true
    }
  },{
    responsive: true,
    displaylogo: false,
    displayModeBar: true,
    modeBarButtonsToRemove: [
      'lasso2d','select2d',
      'hoverClosestCartesian','hoverCompareCartesian',
      'toggleSpikelines','zoom2d','pan2d'
    ],
    toImageButtonOptions: {
      format: 'png',
      filename: 'packet-loss-global',
      height: 700,
      width: 1400,
      scale: 2
    }
  });
}

/* =========================================================
   TABLEAU WORST
   ========================================================= */
function renderWorstTable(sites){
  const body = $("worstTableBody");
  if(!body) return;
  const top  = (sites || []).slice(0, 10);

  if(!top.length){
    body.innerHTML = `<tr><td colspan="9" class="empty-table">Aucune donnée disponible.</td></tr>`;
    return;
  }

  body.innerHTML = top.map((s,i)=>{
    const bad = Number(s.avg_packet_loss) > THRESHOLD;
    const vendorClass = normalizeSite(s.vendor)==="HUAWEI" ? "vendor-huawei" : "vendor-ericsson";
    const link = getSiteLinkInfo(normalizeSite(s.Site));
    const deg  = s.degradedDuration || {totalHours:0,longestRun:0};

    return `
      <tr>
        <td><strong>#${i+1}</strong></td>
        <td><strong>${escapeHtml(s.Site)}</strong></td>
        <td><span class="vendor-badge ${vendorClass}">${escapeHtml(s.vendor)}</span></td>
        <td><span class="link-badge ${link.badgeClass}">
              ${link.icon ? `<i class="fa-solid ${link.icon}"></i>` : ""}
              ${link.label}
            </span></td>
        <td class="num"><strong>${formatNumber(s.avg_packet_loss)}%</strong></td>
        <td class="num">${formatNumber(s.max_packet_loss)}%</td>
        <td class="num degraded-cell" title="Cumul total au-dessus du seuil • Plus longue période : ${formatDuration(deg.longestRun)}">
          ${formatDuration(deg.totalHours)}
        </td>
        <td class="num">${Number(s.above_threshold||0).toLocaleString("fr-FR")}</td>
        <td><span class="status-badge ${bad?"status-bad":"status-good"}">${bad?"IMPACTE":"NORMAL"}</span></td>
      </tr>`;
  }).join("");
}

/* =========================================================
   CARTE — INIT
   ========================================================= */
function initMap(){
  if(map) return;
  const mapEl = $("map");
  if(!mapEl){ console.warn("[Carte] Élément #map introuvable"); return; }
  map = L.map("map",{
    center:CI_CENTER, zoom:CI_ZOOM, minZoom:6, maxZoom:14,
    maxBounds:[[4.0,-9.0],[11.0,-1.5]], maxBoundsViscosity:0.85,
    preferCanvas: true
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    attribution:"© OpenStreetMap", crossOrigin:true
  }).addTo(map);
}

/* =========================================================
   CARTE — LIENS RÉSEAU
   ========================================================= */
function renderNetworkLinksOnMap(){
  if(!map) return;
  Object.values(mapLinkLayers).forEach(layer=>{ if(layer) layer.remove(); });
  mapLinkLayers = {};

  const toggles = {
    FO:   mapFilterState.showFO,
    FH:   mapFilterState.showFH,
    TR:   mapFilterState.showTR,
    TOPO: mapFilterState.showTOPO
  };
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
        const ids  = (text.match(/\b([A-Z]{2}\d{3,4})\b/g) || []);
        const touchesHub      = ids.includes(hubFilterState.hubSite);
        const touchesNeighbor = ids.some(id => hubFilterState.neighborSet.has(id) && id !== hubFilterState.hubSite);
        const isHubToNeighbor = touchesHub && touchesNeighbor;
        if(!isHubToNeighbor) continue;
      }

      const coords = f.geometry.coordinates.map(([lng,lat]) => [lat,lng]);
      if(coords.length < 2) continue;

      const line = L.polyline(coords,{
        color, weight: 2.2, opacity: 0.85,
        smoothFactor: 1.2, interactive: true
      });

      const name = f.properties?.name || "";
      const desc = f.properties?.description || "";
      line.bindTooltip(`
        <div>
          <div style="font-weight:900;color:#fbbf24;margin-bottom:3px">${label}</div>
          <div style="font-weight:800">${escapeHtml(name)}</div>
          <div style="font-size:11px;opacity:.85">${escapeHtml(desc)}</div>
        </div>`,
        { sticky:true, direction:"top", className:"map-hover-tooltip", interactive:false }
      );
      lines.push(line);
    }
    if(lines.length){
      mapLinkLayers[type] = L.layerGroup(lines).addTo(map);
    }
  }
}

/* =========================================================
   CARTE — MARQUEURS
   ========================================================= */
function renderMapMarkers(sites){
  if(!map) return;
  mapMarkers.forEach(m=>m.remove());
  mapMarkers = [];

  let filtered;

  if(hubFilterState.active){
    filtered = [];
    hubFilterState.neighborSet.forEach(siteCode => {
      const code = normalizeSite(siteCode);
      const loc = locationIndex[code];
      if(!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lng))){
        return;
      }
      const stat = sites.find(s => normalizeSite(s.Site) === code);
      if(stat){
        filtered.push(stat);
      } else {
        filtered.push({
          Site:              code,
          vendor:            loc.vendor || "",
          avg_packet_loss:   0,
          max_packet_loss:   0,
          nb_mesures:        0,
          above_threshold:   0,
          degradedDuration:  { totalHours:0, longestRun:0, pct:0, totalMeasured:0 },
          isPlaceholder:     true
        });
      }
    });
  }
  else{
    filtered = sites;
    if(mapFilterState.vendor !== "ALL"){
      filtered = filtered.filter(s => normalizeSite(s.vendor) === mapFilterState.vendor);
    }
    if(mapFilterState.linkType !== "ALL"){
      filtered = filtered.filter(s => {
        const info = siteLinkIndex[normalizeSite(s.Site)] || {};
        return !!info[mapFilterState.linkType];
      });
    }
  }

  let mapped = 0;

  filtered.forEach(site=>{
    const code = normalizeSite(site.Site);
    const loc  = locationIndex[code];
    if(!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lng))) return;

    const linkInfo    = getSiteLinkInfo(code);
    const vendorClass = normalizeSite(site.vendor)==="HUAWEI" ? "huawei" : "ericsson";
    const isHub       = hubFilterState.active && code === hubFilterState.hubSite;
    const isPlaceholder = !!site.isPlaceholder;

    const dotClass = isHub
      ? "hub-dot"
      : isPlaceholder
        ? "site-marker-dot unknown"
        : `site-marker-dot ${linkInfo.dotClass}`;

    const icon = L.divIcon({
      className: "site-marker-wrapper",
      html: `
        <div class="site-marker">
          <span class="${dotClass}"></span>
          <span class="site-marker-id ${vendorClass}">${escapeHtml(code)}</span>
        </div>`,
      iconSize:   [20, 20],
      iconAnchor: [10, 10]
    });

    const marker = L.marker([Number(loc.lat), Number(loc.lng)], {
      icon, riseOnHover: true, keyboard: false, interactive: true
    }).addTo(map);

    marker.on("click", (ev) => {
      if(ev && ev.originalEvent) L.DomEvent.stopPropagation(ev);
      selectSite(code);
    });

    const packetLoss = Number(site.avg_packet_loss);
    const bad = !isPlaceholder && packetLoss > THRESHOLD;
    const deg = site.degradedDuration || {totalHours:0,longestRun:0};

    const dataSection = isPlaceholder
      ? `<div class="map-tooltip-row" style="opacity:.7;font-style:italic">
           Pas de données Packet Loss pour ce site
         </div>`
      : `
        <div class="map-tooltip-packet ${bad?"bad":"good"}">
          Packet Loss : ${formatNumber(packetLoss)}%
        </div>
        <div class="map-tooltip-row"><strong>Temps dégradé :</strong> ${formatDuration(deg.totalHours)}</div>
        <div class="map-tooltip-status ${bad?"bad":"good"}">
          ${bad ? "Au-dessus du seuil" : "Dans le seuil"}
        </div>`;

    marker.bindTooltip(`
      <div class="map-tooltip-site">${escapeHtml(code)}${isHub ? " ⭐ HUB" : ""}</div>
      <div class="map-tooltip-row"><strong>Région :</strong> ${escapeHtml(loc.region||"-")}</div>
      <div class="map-tooltip-row"><strong>Localité :</strong> ${escapeHtml(loc.localite||"-")}</div>
      <div class="map-tooltip-row"><strong>Vendor :</strong> ${escapeHtml(site.vendor||loc.vendor||"-")}</div>
      <div class="map-tooltip-row"><strong>Type de lien :</strong> ${linkInfo.label}</div>
      ${dataSection}
      <div class="map-tooltip-row" style="margin-top:6px;font-size:10px;opacity:.7">
        💡 Cliquez pour isoler ce site
      </div>`,
      { sticky:true, direction:"top", offset:[0,-22], opacity:1,
        className:"map-hover-tooltip", interactive:false }
    );

    mapMarkers.push(marker);
    mapped++;
  });

  const infoEl = $("mapInfo");
  if(!infoEl) return;

  if(hubFilterState.active){
    const totalNeighbors = hubFilterState.neighborSet.size - 1;
    infoEl.textContent =
      `Filtre HUB actif : ${hubFilterState.hubSite} • ${mapped} site(s) affiché(s) sur ${totalNeighbors} voisin(s) direct(s)`;
  } else {
    const total = sites.length;
    const vendorLabel = mapFilterState.vendor === "ALL" ? "tous vendors" : mapFilterState.vendor;
    const linkLabel   = mapFilterState.linkType === "ALL" ? "tous liens" : LINK_LABELS[mapFilterState.linkType] || mapFilterState.linkType;
    infoEl.textContent = `${mapped} site(s) affiché(s) sur ${total} • ${vendorLabel} • ${linkLabel}`;
  }
}

/* =========================================================
   CARTE — RENDU GLOBAL
   ========================================================= */
function renderMap(sites){
  initMap();
  if(!map) return;

  if(!hubFilterState.active){
    map.setView(CI_CENTER, CI_ZOOM, { animate:false });
  }

  renderNetworkLinksOnMap();

  if(mapFilterState.showSites){
    renderMapMarkers(sites);
  } else {
    mapMarkers.forEach(m=>m.remove());
    mapMarkers = [];
    const infoEl = $("mapInfo");
    if(infoEl) infoEl.textContent = "Couche « Sites » désactivée";
  }
}

/* =========================================================
   ÉCOUTEURS FILTRES CARTE
   ========================================================= */
safeOn("mapVendorFilter", "change", e=>{
  mapFilterState.vendor = e.target.value;
  if(lastResult) renderMap(lastSiteStats);
});
safeOn("mapLinkFilter", "change", e=>{
  mapFilterState.linkType = e.target.value;
  if(lastResult) renderMap(lastSiteStats);
});
safeOn("toggleSites", "change", e=>{
  mapFilterState.showSites = e.target.checked;
  if(lastResult) renderMap(lastSiteStats);
});
safeOn("toggleFO", "change", e=>{
  mapFilterState.showFO = e.target.checked;
  renderNetworkLinksOnMap();
});
safeOn("toggleFH", "change", e=>{
  mapFilterState.showFH = e.target.checked;
  renderNetworkLinksOnMap();
});
safeOn("toggleTR", "change", e=>{
  mapFilterState.showTR = e.target.checked;
  renderNetworkLinksOnMap();
});
safeOn("toggleTOPO", "change", e=>{
  mapFilterState.showTOPO = e.target.checked;
  renderNetworkLinksOnMap();
});

/* =========================================================
   GRAPHE RÉSEAU
   ========================================================= */
function buildNetworkGraph(){
  const adjacency = new Map();
  const edges     = [];
  const SITE_ID_REGEX = /\b([A-Z]{2}\d{3,4})\b/g;

  for(const type of ["FO","FH","TR","TOPO"]){
    for(const f of networkLinks[type] || []){
      const text = `${f.properties?.description || ""} ${f.properties?.name || ""}`;
      const ids  = (text.match(SITE_ID_REGEX) || []).filter((v,i,a)=>a.indexOf(v)===i);
      if(ids.length < 2) continue;

      const from = ids[0];
      const to   = ids[1];

      if(!adjacency.has(from)) adjacency.set(from, new Set());
      if(!adjacency.has(to))   adjacency.set(to,   new Set());
      adjacency.get(from).add(to);
      adjacency.get(to).add(from);

      edges.push({ from, to, type, name: f.properties?.name || "" });
    }
  }
  networkGraph = { adjacency, edges };
  console.log(`[Graphe] ${adjacency.size} nœuds • ${edges.length} arêtes`);
}

function computeDegree(adjacency){
  const degree = new Map();
  adjacency.forEach((neighbors, node)=>{ degree.set(node, neighbors.size); });
  return degree;
}

function computeBetweenness(adjacency){
  const nodes = [...adjacency.keys()];
  const n     = nodes.length;

  if(n > 600){
    const degree = computeDegree(adjacency);
    const maxDeg = Math.max(...degree.values()) || 1;
    const CB = new Map();
    degree.forEach((d, node)=>CB.set(node, d / maxDeg));
    return CB;
  }

  const CB = new Map(nodes.map(nd => [nd, 0]));

  nodes.forEach(source=>{
    const stack = [], pred = new Map(nodes.map(nd => [nd, []]));
    const sigma = new Map(nodes.map(nd => [nd, 0]));
    const dist  = new Map(nodes.map(nd => [nd, -1]));
    sigma.set(source, 1); dist.set(source, 0);

    const queue = [source];
    while(queue.length){
      const v = queue.shift(); stack.push(v);
      (adjacency.get(v) || new Set()).forEach(w=>{
        if(dist.get(w) < 0){ dist.set(w, dist.get(v) + 1); queue.push(w); }
        if(dist.get(w) === dist.get(v) + 1){
          sigma.set(w, sigma.get(w) + sigma.get(v));
          pred.get(w).push(v);
        }
      });
    }

    const delta = new Map(nodes.map(nd => [nd, 0]));
    while(stack.length){
      const w = stack.pop();
      pred.get(w).forEach(v=>{
        delta.set(v, delta.get(v) + (sigma.get(v)/sigma.get(w)) * (1 + delta.get(w)));
      });
      if(w !== source) CB.set(w, CB.get(w) + delta.get(w));
    }
  });

  const maxCB = Math.max(...CB.values()) || 1;
  CB.forEach((v,k)=>CB.set(k, v/maxCB));
  return CB;
}

function computeCorrelation(hubSite, rowsBySite){
  const hubRows = rowsBySite[hubSite] || [];
  if(!hubRows.length) return { score:0, correlatedSites:[], totalSites:0 };

  const hubHours = new Set(
    hubRows.filter(r => Number(r.packet_loss) > THRESHOLD)
      .map(r => `${r.ladate || ""}-${r.hour ?? ""}`)
  );
  if(hubHours.size === 0) return { score:0, correlatedSites:[], totalSites:0 };

  const correlatedSites = [];
  let totalSites = 0;

  Object.entries(rowsBySite).forEach(([site, rows])=>{
    if(site === hubSite) return;
    totalSites++;
    const siteHours = new Set(
      rows.filter(r => Number(r.packet_loss) > THRESHOLD)
        .map(r => `${r.ladate || ""}-${r.hour ?? ""}`)
    );
    let common = 0;
    hubHours.forEach(h=>{ if(siteHours.has(h)) common++; });
    if(common / hubHours.size >= 0.3){
      correlatedSites.push({ site, commonHours: common, ratio: common / hubHours.size });
    }
  });

  return {
    score: totalSites ? correlatedSites.length / totalSites : 0,
    correlatedSites, totalSites
  };
}

function computeHubScores(rows){
  if(!networkGraph) return [];
  const { adjacency } = networkGraph;
  if(adjacency.size === 0) return [];

  const degree      = computeDegree(adjacency);
  const betweenness = computeBetweenness(adjacency);
  const maxDeg      = Math.max(...degree.values()) || 1;

  const rowsBySite = {};
  rows.forEach(r=>{
    const site = normalizeSite(r.Site);
    if(!site) return;
    (rowsBySite[site] ||= []).push(r);
  });

  const scores = [];
  adjacency.forEach((neighbors, site)=>{
    const deg      = degree.get(site) || 0;
    const degNorm  = deg / maxDeg;
    const betwNorm = betweenness.get(site) || 0;

    let corrScore = 0, correlatedSites = [];
    if(rowsBySite[site]){
      const corr = computeCorrelation(site, rowsBySite);
      corrScore       = corr.score;
      correlatedSites = corr.correlatedSites;
    }

    const score = 0.4 * degNorm + 0.3 * betwNorm + 0.3 * corrScore;

    scores.push({
      site, score, degree: deg,
      betweenness: betwNorm, correlation: corrScore,
      correlatedSites, neighbors: [...neighbors],
      hasData: !!rowsBySite[site],
      avgLoss: rowsBySite[site] ?
        rowsBySite[site].reduce((s,r)=>s+Number(r.packet_loss||0),0) / rowsBySite[site].length : 0
    });
  });

  scores.sort((a,b)=>b.score - a.score);
  const filtered = scores.filter(s => s.degree >= 2 && s.score > 0.05);
  console.log(`[HUB] ${filtered.length} HUB(s) identifié(s) sur ${scores.length} sites`);
  return filtered;
}

/* =========================================================
   PANNEAU HUB
   ========================================================= */
function renderHubPanel(siteStats){
  hubScores = computeHubScores(lastFilteredRows || []);

  const hubList = $("hubList");
  const details = $("hubDetails");
  if(!hubList) return;

  if(details){
    details.classList.add("hidden");
    details.innerHTML = "";
  }

  if(!hubScores.length){
    hubList.innerHTML = `
      <div class="hub-empty">
        <i class="fa-solid fa-diagram-project"></i>
        <p>Aucun HUB identifié.<br>Vérifiez que les fichiers GeoJSON sont bien chargés.</p>
      </div>`;
    return;
  }

  const top = hubScores.slice(0, 8);

  hubList.innerHTML = top.map((hub, i)=>{
    const linkInfo = getSiteLinkInfo(hub.site);
    const vendor   = (siteStats.find(s => normalizeSite(s.Site) === hub.site)?.vendor) || "";
    const vendorClass = normalizeSite(vendor) === "HUAWEI" ? "vendor-huawei" : "vendor-ericsson";
    const isActive = hubFilterState.active && hubFilterState.hubSite === hub.site;

    return `
      <div class="hub-item ${isActive ? "is-active" : ""}" data-site="${escapeHtml(hub.site)}">
        <span class="hub-item__rank">#${i+1}</span>
        <div class="hub-item__main">
          <span class="hub-item__site">${escapeHtml(hub.site)}</span>
          <span class="hub-item__score">${(hub.score * 100).toFixed(0)}%</span>
        </div>
        <div class="hub-item__bar">
          <div class="hub-item__bar-fill" style="width:${(hub.score * 100).toFixed(0)}%"></div>
        </div>
        <div class="hub-item__meta">
          <span><i class="fa-solid fa-diagram-project"></i>${hub.degree} liens</span>
          <span><i class="fa-solid fa-share-nodes"></i>${hub.neighbors.length} voisins</span>
        </div>
        <div class="hub-item__badges">
          <span class="link-badge ${linkInfo.badgeClass}">
            ${linkInfo.icon ? `<i class="fa-solid ${linkInfo.icon}"></i>` : ""}
            ${linkInfo.label}
          </span>
          ${vendor ? `<span class="vendor-badge ${vendorClass}">${escapeHtml(vendor)}</span>` : ""}
        </div>
      </div>`;
  }).join("");

  hubList.querySelectorAll(".hub-item").forEach(item=>{
    item.addEventListener("click", ()=>{
      const site = item.dataset.site;
      selectSite(site);
    });
  });
}

/* =========================================================
   SÉLECTION D'UN SITE (HUB ou non)
   ========================================================= */
function selectSite(siteCode){
  const site = normalizeSite(siteCode);
  if(!site) return;

  let neighbors = [];
  if(networkGraph && networkGraph.adjacency.has(site)){
    neighbors = [...networkGraph.adjacency.get(site)].map(normalizeSite);
  }

  selectedHub                = site;
  hubFilterState.active      = true;
  hubFilterState.hubSite     = site;
  hubFilterState.neighborSet = new Set([site, ...neighbors]);

  const clearBtn = $("clearHubFilterBtn");
  if(clearBtn) clearBtn.classList.remove("hidden");
  const resetFloat = $("mapResetFloatBtn");
  if(resetFloat) resetFloat.classList.remove("hidden");
  const layoutEl = $("mapLayout");
  if(layoutEl) layoutEl.classList.add("is-hub-filtered");

  document.querySelectorAll(".hub-item").forEach(el=>{
    el.classList.toggle("is-active", normalizeSite(el.dataset.site) === site);
  });

  renderHubDetails(site, neighbors);

  if(lastResult && map){
    renderMapMarkers(lastSiteStats);
    renderNetworkLinksOnMap();

    const bounds = L.latLngBounds([]);
    hubFilterState.neighborSet.forEach(siteCode => {
      const l = locationIndex[normalizeSite(siteCode)];
      if(l && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng))){
        bounds.extend([Number(l.lat), Number(l.lng)]);
      }
    });

    if(bounds.isValid()){
      map.fitBounds(bounds, {
        padding: [60, 60],
        maxZoom: 10,
        animate: true
      });
    } else {
      const hubLoc = locationIndex[site];
      if(hubLoc){
        map.setView([Number(hubLoc.lat), Number(hubLoc.lng)], 9, { animate:true });
      }
    }
  }
}

/* =========================================================
   RENDU DU PANNEAU DE DÉTAILS D'UN SITE
   ========================================================= */
function renderHubDetails(siteCode, neighbors){
  const details = $("hubDetails");
  if(!details) return;

  const site = normalizeSite(siteCode);
  const degree = neighbors.length;

  const hub = (hubScores || []).find(h => h.site === site);
  const scoreText = hub ? `Score ${(hub.score*100).toFixed(0)}% • ` : "";
  const titleStar = hub ? " ⭐" : "";

  details.innerHTML = `
    <div class="hub-details__head">
      <i class="fa-solid fa-hubspot"></i>
      <div>
        <h4>${escapeHtml(site)}${titleStar}</h4>
        <p class="hub-details__subtitle">
          ${scoreText}${degree} lien(s) direct(s) • ${neighbors.length} site(s) lié(s)
        </p>
      </div>
    </div>

    <div class="hub-dependents">
      ${neighbors.length ? neighbors.map(depSite => {
        const depStat = (lastSiteStats || []).find(s => normalizeSite(s.Site) === depSite);
        const loss    = depStat ? Number(depStat.avg_packet_loss) : null;
        const isOk    = loss !== null && loss <= THRESHOLD;
        const link    = getSiteLinkInfo(depSite);
        const lossTxt = depStat ? `${formatNumber(loss)}%` : "n/d";
        return `
          <div class="dependent" data-site="${escapeHtml(depSite)}">
            <span class="dependent__site">${escapeHtml(depSite)}</span>
            <span class="link-badge ${link.badgeClass}" style="font-size:9px;padding:2px 6px">
              ${link.label}
            </span>
            <span class="dependent__loss ${isOk ? "is-ok" : ""}">
              ${lossTxt}
            </span>
          </div>`;
      }).join("") : `<div class="dependent-empty">Aucun voisin direct identifié.</div>`}
    </div>
  `;
  details.classList.remove("hidden");

  details.querySelectorAll(".dependent").forEach(el=>{
    el.addEventListener("click", (ev)=>{
      ev.stopPropagation();
      const depSite = el.dataset.site;
      const loc = locationIndex[normalizeSite(depSite)];
      if(loc && map){
        map.setView([Number(loc.lat), Number(loc.lng)], 11, { animate:true });
      }
    });
  });
}

/* =========================================================
   ALIAS RÉTRO-COMPATIBLE
   ========================================================= */
function selectHub(site, hubList){
  selectSite(site);
}

/* =========================================================
   EFFACEMENT DU FILTRE HUB
   ========================================================= */
function clearHubFilter(){
  hubFilterState.active      = false;
  hubFilterState.hubSite     = null;
  hubFilterState.neighborSet = new Set();
  selectedHub = null;

  const clearBtn = $("clearHubFilterBtn");
  if(clearBtn) clearBtn.classList.add("hidden");
  const resetFloat = $("mapResetFloatBtn");
  if(resetFloat) resetFloat.classList.add("hidden");
  const layoutEl = $("mapLayout");
  if(layoutEl) layoutEl.classList.remove("is-hub-filtered");
  const details = $("hubDetails");
  if(details){
    details.classList.add("hidden");
    details.innerHTML = "";
  }

  document.querySelectorAll(".hub-item").forEach(el=>{
    el.classList.remove("is-active");
  });

  if(map && lastResult){
    map.setView(CI_CENTER, CI_ZOOM, { animate:true });
    renderMap(lastSiteStats);
  }
}

safeOn("clearHubFilterBtn", "click", clearHubFilter);
safeOn("mapResetFloatBtn", "click", clearHubFilter);

/* =========================================================
   TOGGLE DU PANNEAU HUB
   ========================================================= */
function toggleHubPanel(){
  const layout = $("mapLayout");
  if(!layout) return;
  const isCollapsed = layout.classList.toggle("is-collapsed");
  const float = $("hubPanelToggleFloat");
  if(float) float.classList.toggle("hidden", !isCollapsed);
  setTimeout(()=>{ if(map) map.invalidateSize(); }, 350);
}
safeOn("hubPanelToggle", "click", toggleHubPanel);
safeOn("hubPanelToggleFloat", "click", toggleHubPanel);

/* =========================================================
   VUE HUB UNIQUEMENT
   ========================================================= */
safeOn("toggleHubs", "change", e=>{
  if(!lastResult) return;
  if(e.target.checked){
    const hubSites = new Set(hubScores.map(h => h.site));
    const depSites = new Set();
    hubScores.forEach(h => h.neighbors.forEach(d => depSites.add(normalizeSite(d))));
    const relevant = new Set([...hubSites, ...depSites]);
    const filteredStats = lastSiteStats.filter(s => relevant.has(normalizeSite(s.Site)));
    renderMap(filteredStats);
  } else {
    renderMap(lastSiteStats);
  }
});

/* =========================================================
   NOUVEAU v13 — ÉCOUTEUR DU SÉLECTEUR DE VUE
   ---------------------------------------------------------
   Bascule entre 'day' et 'raw'. Si une analyse existe déjà,
   on redessine immédiatement les graphiques.
   ========================================================= */
function bindViewToggle(){
  const toggle = $("viewToggle");
  if(!toggle) return;
  toggle.querySelectorAll(".view-toggle__btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      if(view === chartViewMode) return;

      /* Met à jour l'état visuel des boutons */
      toggle.querySelectorAll(".view-toggle__btn").forEach(b => {
        b.classList.toggle("is-active", b.dataset.view === view);
      });

      chartViewMode = view;
      console.log(`[Vue] Mode graphique : ${chartViewMode}`);

      /* Redessine les graphiques par site si une analyse existe */
      if(lastResult && lastSiteStats.length){
        renderSiteGrid(lastSiteStats, lastFilteredRows);
      }
    });
  });
}

/* =========================================================
   TENDANCE PAR SITE
   ========================================================= */
function computeSiteTrend(siteRows){
  const sorted = [...siteRows].sort((a,b)=>{
    const da = makeDateTime(a)||"", db = makeDateTime(b)||"";
    return da.localeCompare(db);
  });
  const n = sorted.length;
  if(!n) return {firstAvg:0,secondAvg:0,halfToHalf:0,hoursAbove:0,hoursAbovePct:0,trend:"stable",currentLoss:0};

  const mid        = Math.max(1,Math.floor(n/2));
  const firstHalf  = sorted.slice(0,mid);
  const secondHalf = sorted.slice(mid);

  const avg = arr => arr.length
    ? arr.reduce((s,r)=>s+Number(r.packet_loss||0),0)/arr.length : 0;

  const firstAvg  = avg(firstHalf);
  const secondAvg = avg(secondHalf);

  let halfToHalf;
  if(firstAvg > 0) halfToHalf = ((secondAvg-firstAvg)/firstAvg)*100;
  else             halfToHalf = secondAvg > 0 ? 100 : 0;

  const aboveSet = new Set();
  sorted.forEach(r=>{
    if(Number(r.packet_loss) > THRESHOLD){
      aboveSet.add(`${r.ladate||""}-${r.hour ?? ""}`);
    }
  });
  const hoursAbove    = aboveSet.size;
  const hoursAbovePct = n ? (hoursAbove/n)*100 : 0;

  let trend = "stable";
  if(halfToHalf < -10)     trend = "improving";
  else if(halfToHalf > 10) trend = "degrading";

  const lastRow = sorted[sorted.length-1];
  const currentLoss = Number(lastRow?.packet_loss || 0);

  return {firstAvg,secondAvg,halfToHalf,hoursAbove,hoursAbovePct,trend,currentLoss};
}

/* =========================================================
   CARTES SITE
   ========================================================= */
function renderSiteGrid(siteStats,rows){
  const grid = $("siteGrid");
  if(!grid) return;
  grid.textContent = "";

  const grouped = {};
  rows.forEach(row=>{
    const site = normalizeSite(row.Site);
    if(!site) return;
    (grouped[site] ||= []).push(row);
  });

  siteStats.forEach(s=>{
    const name     = normalizeSite(s.Site);
    const siteRows = grouped[name] || [];
    if(!siteRows.length) return;

    const trend    = computeSiteTrend(siteRows);
    siteTrends[name] = trend;

    const vendorClass = normalizeSite(s.vendor)==="HUAWEI" ? "vendor-huawei" : "vendor-ericsson";
    const linkInfo    = getSiteLinkInfo(name);
    const safeId      = `chart-${name.replace(/[^A-Z0-9_-]/g,"-")}`;
    const deg         = s.degradedDuration || {totalHours:0,longestRun:0};

    const trendIcon = trend.trend === "improving" ? "fa-arrow-trend-down"
                    : trend.trend === "degrading" ? "fa-arrow-trend-up"
                    : "fa-minus";

    const card = document.createElement("article");
    card.className = "site-card";
    card.dataset.avg    = Number(s.avg_packet_loss) || 0;
    card.dataset.max    = Number(s.max_packet_loss) || 0;
    card.dataset.site   = name;
    card.dataset.trend  = trend.trend;
    card.dataset.above  = Number(s.above_threshold||0);
    card.dataset.link   = linkInfo.code;

    const trendLabel = trend.trend === "improving" ? "Amélioration"
                    : trend.trend === "degrading" ? "Dégradation"
                    : "Stable";

    let comment;
    if(trend.trend === "improving"){
      comment = `<strong>Amélioration :</strong> perte passée de ${formatNumber(trend.firstAvg)}% à ${formatNumber(trend.secondAvg)}%. Site dégradé ${formatDuration(deg.totalHours)} (plus longue période : ${formatDuration(deg.longestRun)}).`;
    }else if(trend.trend === "degrading"){
      comment = `<strong>Dégradation :</strong> perte passée de ${formatNumber(trend.firstAvg)}% à ${formatNumber(trend.secondAvg)}%. Site dégradé ${formatDuration(deg.totalHours)} (plus longue période : ${formatDuration(deg.longestRun)}).`;
    }else{
      comment = `<strong>Stable :</strong> perte autour de ${formatNumber(trend.firstAvg)}% → ${formatNumber(trend.secondAvg)}%. Site dégradé ${formatDuration(deg.totalHours)} (plus longue période : ${formatDuration(deg.longestRun)}).`;
    }

    const cardMarkup = `
      <div class="site-card-head">
        <div>
          <div class="site-name">${escapeHtml(name)}</div>
          <div class="site-subtitle">
            <span class="vendor-badge ${vendorClass}">${escapeHtml(s.vendor)}</span>
            <span class="link-badge ${linkInfo.badgeClass}">
              ${linkInfo.icon ? `<i class="fa-solid ${linkInfo.icon}"></i>` : ""}
              ${linkInfo.label}
            </span>
          </div>
        </div>
        <span class="trend-badge ${trend.trend}">
          <i class="fa-solid ${trendIcon}"></i> ${trendLabel}
        </span>
      </div>

      <div class="site-card-body">
        <div class="site-chart-wrapper">
          <div class="site-chart" id="${safeId}"></div>
        </div>

        <div class="site-stats">
          <div class="site-stat" title="Valeur moyenne du Packet Loss">
            <strong>${formatNumber(s.avg_packet_loss)}%</strong>
            <span>Perte moyenne</span>
          </div>
          <div class="site-stat" title="Valeur maximale observée">
            <strong>${formatNumber(s.max_packet_loss)}%</strong>
            <span>Pic maximum</span>
          </div>
          <div class="site-stat" title="Dernière mesure enregistrée">
            <strong>${formatNumber(trend.currentLoss)}%</strong>
            <span>Packet Loss actuel</span>
          </div>
          <div class="site-stat site-stat--degraded" title="Cumul total au-dessus du seuil">
            <strong>${formatDuration(deg.totalHours)}</strong>
            <span>Temps dégradé</span>
          </div>
          <div class="site-stat site-stat--degraded" title="Plus longue période continue au-dessus du seuil">
            <strong>${formatDuration(deg.longestRun)}</strong>
            <span>Plus longue période</span>
          </div>
          <div class="site-stat" title="Nombre total de mesures">
            <strong>${Number(s.nb_mesures||0).toLocaleString("fr-FR")}</strong>
            <span>Mesures</span>
          </div>
        </div>

        <div class="site-comment ${trend.trend}">${comment}</div>
      </div>`;

    if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
      const safe = window.DOMPurify.sanitize(cardMarkup, {
        USE_PROFILES: { html: true },
        RETURN_DOM_FRAGMENT: true
      });
      card.appendChild(safe);
    } else {
      card.innerHTML = cardMarkup;
    }

    grid.appendChild(card);
    renderSiteChart(safeId, siteRows, name);
  });

  applySiteFilters();
}

/* =========================================================
   MINI-GRAPHIQUE PAR SITE — dispatcher
   ---------------------------------------------------------
   NOUVEAU v13 : aiguille vers la fonction de rendu adaptée
   au mode courant ('day' ou 'raw').
   ========================================================= */
function renderSiteChart(id, rows, name){
  if(chartViewMode === "raw"){
    renderSiteChartRaw(id, rows, name);
  } else {
    renderSiteChartDay(id, rows, name);
  }
}

/* =========================================================
   MINI-GRAPHIQUE — VUE JOUR (comportement actuel amélioré)
   ---------------------------------------------------------
   - Une graduation par jour (dtick D1)
   - Axe Y FIXÉ pour inclure le seuil 0.1%
   - Courbe lissée
   - Ligne de seuil visible
   ========================================================= */
function renderSiteChartDay(id, rows, name){
  const el = document.getElementById(id);
  if(!el) return;
  const sorted = [...rows].sort((a,b)=>{
    const da = makeDateTime(a)||"", db = makeDateTime(b)||"";
    return da.localeCompare(db);
  });

  const x = sorted.map(r=>makeDateTime(r));
  const y = sorted.map(r=>Number(r.packet_loss));

  const annotations = [{
    x: x[x.length-1], y: THRESHOLD,
    xref:"x", yref:"y", text:"Seuil 0.1%",
    showarrow:false, xanchor:"right", yanchor:"bottom",
    font:{size:9,color:"#ef4444"}
  }];

  const xConf = buildXAxisConfigDay(rows, { tickSize: 9.5 });
  const yRange = computeFixedYRange(rows);

  Plotly.newPlot(id,[
    {
      x,y,type:"scatter",mode:"lines+markers",name,
      line:{color:"#2563eb",width:1.8,shape:"spline",smoothing:0.5},
      marker:{color:"#2563eb",size:3.5},
      hovertemplate:"%{x|%d/%m %H:%M}<br>Packet Loss : <b>%{y:.4f}%</b><extra></extra>"
    },
    {
      x, y:x.map(()=>THRESHOLD),
      type:"scatter",mode:"lines",name:"Seuil",
      line:{dash:"dash",color:"#ef4444",width:1.2},
      hovertemplate:"Seuil : 0.1%<extra></extra>"
    }
  ],{
    margin:{ l:38, r:8, t:12, b: 70 + xConf.extraBottom },
    paper_bgcolor:"#fff", plot_bgcolor:"#fff",
    font:{family:"Inter, Segoe UI, Arial",size:10,color:"#64748b"},
    hovermode:"x unified",
    hoverlabel:{bgcolor:"#0f172a",bordercolor:"#0f172a",font:{color:"#fff",size:11}},
    showlegend:false, annotations,
    xaxis: xConf.axis,
    yaxis:{
      title:{text:"%",font:{size:10,color:"#94a3b8"}},
      range: yRange,
      gridcolor:"#f8fafc", linecolor:"#e2e8f0", tickfont:{size:9.5},
      automargin: true
    }
  },{
    responsive: true,
    displaylogo: false,
    displayModeBar: true,
    modeBarButtonsToRemove: [
      'lasso2d','select2d',
      'hoverClosestCartesian','hoverCompareCartesian',
      'toggleSpikelines','zoom2d','pan2d'
    ],
    toImageButtonOptions: {
      format: 'png',
      filename: `packet-loss-${name}-jour`,
      height: 600,
      width: 1200,
      scale: 2
    }
  });
}

/* =========================================================
   MINI-GRAPHIQUE — VUE BRUTE (style Excel)
   ---------------------------------------------------------
   - Toutes les mesures horaires
   - Axe Y AUTO-ÉCHELONNÉ (mise en évidence des pics)
   - Lignes droites (pas de spline)
   - Ligne de seuil visible UNIQUEMENT si le pic dépasse
     le seuil, sinon masquée pour ne pas fausser l'échelle
   ========================================================= */
function renderSiteChartRaw(id, rows, name){
  const el = document.getElementById(id);
  if(!el) return;
  const sorted = [...rows].sort((a,b)=>{
    const da = makeDateTime(a)||"", db = makeDateTime(b)||"";
    return da.localeCompare(db);
  });

  const x = sorted.map(r=>makeDateTime(r));
  const y = sorted.map(r=>Number(r.packet_loss));

  const xConf = buildXAxisConfigRaw(rows, { tickSize: 8.5 });

  /* Auto-échelle : on laisse Plotly choisir, mais on
     ajoute une petite marge au-dessus du max. */
  const maxVal = y.length ? Math.max(...y) : 0;
  const yRange = [0, maxVal * 1.15 || 0.01];

  /* On n'affiche la ligne du seuil que si elle est
     visible dans l'échelle actuelle. */
  const showThresholdLine = maxVal >= THRESHOLD * 0.9;

  const traces = [
    {
      x,y,type:"scatter",mode:"lines+markers",name,
      line:{color:"#2563eb",width:1.8,shape:"linear"},
      marker:{color:"#2563eb",size:3},
      hovertemplate:"%{x|%d/%m %H:%M}<br>Packet Loss : <b>%{y:.6f}%</b><extra></extra>"
    }
  ];

  if(showThresholdLine){
    traces.push({
      x, y: x.map(()=>THRESHOLD),
      type:"scatter", mode:"lines", name:"Seuil",
      line:{dash:"dash",color:"#ef4444",width:1.2},
      hovertemplate:"Seuil : 0.1%<extra></extra>"
    });
  }

  /* Ajustement de l'échelle Y pour inclure le seuil si
     on l'affiche (pour éviter qu'il soit hors cadre). */
  const finalYRange = showThresholdLine
    ? [0, Math.max(maxVal * 1.15, THRESHOLD * 1.15)]
    : yRange;

  Plotly.newPlot(id, traces, {
    margin:{ l:44, r:8, t:12, b: 60 + xConf.extraBottom },
    paper_bgcolor:"#fff", plot_bgcolor:"#fff",
    font:{family:"Inter, Segoe UI, Arial",size:10,color:"#64748b"},
    hovermode:"x unified",
    hoverlabel:{bgcolor:"#0f172a",bordercolor:"#0f172a",font:{color:"#fff",size:11}},
    showlegend:false,
    xaxis: xConf.axis,
    yaxis:{
      title:{text:"%",font:{size:10,color:"#94a3b8"}},
      range: finalYRange,
      gridcolor:"#f8fafc", linecolor:"#e2e8f0", tickfont:{size:9.5},
      automargin: true
    }
  },{
    responsive: true,
    displaylogo: false,
    displayModeBar: true,
    modeBarButtonsToRemove: [
      'lasso2d','select2d',
      'hoverClosestCartesian','hoverCompareCartesian',
      'toggleSpikelines','zoom2d','pan2d'
    ],
    toImageButtonOptions: {
      format: 'png',
      filename: `packet-loss-${name}-brut`,
      height: 600,
      width: 1400,
      scale: 2
    }
  });
}

/* =========================================================
   FILTRES SITE
   ========================================================= */
function applySiteFilters(){
  const searchEl = $("siteSearch");
  const sortEl   = $("siteSort");
  const trendEl  = $("trendFilter");
  const grid     = $("siteGrid");
  if(!grid) return;

  const search = normalizeSite(searchEl?.value || "");
  const sort   = sortEl?.value || "name_asc";
  const trendF = trendEl?.value || "all";
  const cards  = [...grid.querySelectorAll(".site-card")];

  cards.sort((a,b)=>{
    const na   = a.dataset.site || "", nb = b.dataset.site || "";
    const avga = Number(a.dataset.avg || 0);
    const avgb = Number(b.dataset.avg || 0);
    const maxa = Number(a.dataset.max || 0);
    const maxb = Number(b.dataset.max || 0);

    switch(sort){
      case "name_asc":          return na.localeCompare(nb);
      case "worst_degraded":    return avgb - avga;
      case "best_degraded":     return avga - avgb;
      case "highest_avg":       return maxb - maxa;
      case "threshold_exceeded":{
        const aa = Number(a.dataset.above||0);
        const ab = Number(b.dataset.above||0);
        if(aa === 0 && ab > 0) return 1;
        if(ab === 0 && aa > 0) return -1;
        return ab - aa;
      }
      default: return avgb - avga;
    }
  });

  cards.forEach(card=>{
    const name  = normalizeSite(card.dataset.site || "");
    const trend = card.dataset.trend || "stable";
    const above = Number(card.dataset.above || 0);

    let visible = true;
    if(search && !name.includes(search))             visible = false;
    if(trendF !== "all" && trend !== trendF)         visible = false;
    if(sort === "threshold_exceeded" && above <= 0)  visible = false;

    card.style.display = visible ? "" : "none";
    grid.appendChild(card);
  });
}

safeOn("siteSearch", "input", applySiteFilters);
safeOn("siteSort", "change", applySiteFilters);
safeOn("trendFilter", "change", applySiteFilters);

/* =========================================================
   EXPORT PDF / IMAGE
   ========================================================= */
async function captureDashboard(){
  if(typeof html2canvas === "undefined"){
    throw new Error("Export indisponible (html2canvas manquant).");
  }
  const exportBar = $("exportBar");
  const previousDisplay = exportBar ? exportBar.style.display : "";
  if(exportBar) exportBar.style.display = "none";
  const el = $("dashboard");
  if(!el) throw new Error("Élément #dashboard introuvable.");
  try{
    return await html2canvas(el,{
      backgroundColor:"#f8fafc", scale:2, useCORS:true, allowTaint:false, logging:false,
      windowWidth: el.scrollWidth, windowHeight: el.scrollHeight
    });
  }finally{
    if(exportBar) exportBar.style.display = previousDisplay || "";
  }
}

async function exportImage(){
  try{
    const canvas = await captureDashboard();
    const link = document.createElement("a");
    link.download = `packet-loss-report-${new Date().toISOString().slice(0,10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }catch(e){
    console.error(e);
    showMessage("Échec de l'export image : " + e.message);
  }
}

async function exportPDF(){
  try{
    const JsPDFCtor =
      (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF
      : (typeof window.jsPDF !== "undefined") ? window.jsPDF
      : null;
    if(!JsPDFCtor) throw new Error("jsPDF non chargé.");

    const pdf        = new JsPDFCtor({orientation:"portrait",unit:"mm",format:"a4"});
    const pageWidth  = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin     = 5;
    const imgWidth   = pageWidth - margin*2;
    const usableH    = pageHeight - margin*2;

    const exportBar     = $("exportBar");
    const dashboard     = $("dashboard");
    const siteGrid      = $("siteGrid");
    const siteGridPanel = siteGrid ? siteGrid.closest("section.panel") : null;
    if(!dashboard || !siteGrid || !siteGridPanel) throw new Error("Éléments HTML manquants.");

    const prevExportDisplay = exportBar ? exportBar.style.display : "";
    const prevPanelDisplay  = siteGridPanel.style.display;

    const allCards     = [...siteGrid.querySelectorAll(".site-card")];
    const visibleCards = allCards.filter(c => c.style.display !== "none");
    const originalDisplays = allCards.map(c => c.style.display);

    if(exportBar) exportBar.style.display = "none";

    try{
      siteGridPanel.style.display = "none";
      await new Promise(r => setTimeout(r, 120));
      if(map) map.invalidateSize();

      const topCanvas = await html2canvas(dashboard,{
        backgroundColor:"#f8fafc", scale:2, useCORS:true, allowTaint:false, logging:false,
        windowWidth: dashboard.scrollWidth, windowHeight: dashboard.scrollHeight
      });
      const topImgData = topCanvas.toDataURL("image/png");
      const topImgH    = (topCanvas.height * imgWidth) / topCanvas.width;

      let heightLeft = topImgH;
      let position   = margin;
      pdf.addImage(topImgData,"PNG",margin,position,imgWidth,topImgH);
      heightLeft -= usableH;

      while(heightLeft > 0){
        position = heightLeft - topImgH + margin;
        pdf.addPage();
        pdf.addImage(topImgData,"PNG",margin,position,imgWidth,topImgH);
        heightLeft -= usableH;
      }

      siteGridPanel.style.display = prevPanelDisplay || "";
      if(!visibleCards.length){
        pdf.save(`packet-loss-report-${new Date().toISOString().slice(0,10)}.pdf`);
        return;
      }
      allCards.forEach(c => c.style.display = "none");

      const CARDS_PER_PAGE = 12;
      for(let i=0; i<visibleCards.length; i+=CARDS_PER_PAGE){
        const group = visibleCards.slice(i,i+CARDS_PER_PAGE);
        group.forEach(c => c.style.display = "");
        await new Promise(r => setTimeout(r, 180));

        const gridCanvas = await html2canvas(siteGrid,{
          backgroundColor:"#f8fafc", scale:2, useCORS:true, allowTaint:false, logging:false,
          windowWidth: siteGrid.scrollWidth, windowHeight: siteGrid.scrollHeight
        });
        const gridImgData = gridCanvas.toDataURL("image/png");
        let finalImgW = imgWidth;
        let finalImgH = (gridCanvas.height * imgWidth) / gridCanvas.width;
        if(finalImgH > usableH){
          const ratio = usableH / finalImgH;
          finalImgW = imgWidth * ratio;
          finalImgH = usableH;
        }
        const xOffset = margin + (imgWidth - finalImgW) / 2;
        pdf.addPage();
        pdf.addImage(gridImgData,"PNG",xOffset,margin,finalImgW,finalImgH);
        group.forEach(c => c.style.display = "none");
      }

      pdf.save(`packet-loss-report-${new Date().toISOString().slice(0,10)}.pdf`);
    }finally{
      if(exportBar) exportBar.style.display = prevExportDisplay || "";
      siteGridPanel.style.display = prevPanelDisplay || "";
      allCards.forEach((c,idx) => { c.style.display = originalDisplays[idx] || ""; });
      if(map) setTimeout(() => map.invalidateSize(), 50);
    }
  }catch(e){
    console.error(e);
    showMessage("Échec de l'export PDF : " + e.message);
  }
}

safeOn("exportPdfBtn", "click", exportPDF);
safeOn("exportImgBtn", "click", exportImage);

/* =========================================================
   RAPPORT DÉGRADÉ — DOM
   ========================================================= */
function buildDegradedReportDOM(degradedSites){
  const container = document.createElement("div");
  container.id = "degradedReportOffscreen";

  const period = lastResult ?
    `${formatDateFR(lastResult.start_date)} → ${formatDateFR(lastResult.end_date)}` : "-";
  const vendor = lastResult?.vendor === "ALL" ? "Tous" : (lastResult?.vendor || "-");
  const hourLabels = {
    "all":"Toute la journée","00-06":"Nuit (00h-06h)","06-12":"Matin (06h-12h)",
    "12-18":"Après-midi (12h-18h)","18-24":"Soir (18h-24h)"
  };
  const hourRange = $("hourRange")?.value || "all";
  const hourLabel = hourLabels[hourRange] || "Toute la journée";
  const totalSites = lastResult?.requested_sites_count || 0;
  const generatedAt = new Date().toLocaleString("fr-FR", {
    day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"
  });

  const rowsBySite = {};
  (lastFilteredRows || []).forEach(r => {
    const site = normalizeSite(r.Site);
    if (!site) return;
    (rowsBySite[site] ||= []).push(r);
  });

  const html = `
    <div class="degraded-report__header">
      <div class="degraded-report__title">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <div>
          <h1>Rapport des sites dégradés</h1>
          <p>Seuil critique : <strong>0.1%</strong> • ${degradedSites.length} site(s) concerné(s)</p>
        </div>
      </div>
      <div class="degraded-report__meta">
        <p><strong>Période :</strong> ${period}</p>
        <p><strong>Plage horaire :</strong> ${hourLabel}</p>
        <p><strong>Vendor :</strong> ${vendor}</p>
        <p><strong>Généré le :</strong> ${generatedAt}</p>
      </div>
    </div>

    <div class="degraded-report__summary-kpi">
      <div class="degraded-report__kpi"><span>Sites dégradés</span><strong>${degradedSites.length}</strong></div>
      <div class="degraded-report__kpi"><span>Sites analysés</span><strong>${totalSites}</strong></div>
      <div class="degraded-report__kpi">
        <span>Ratio dégradé</span>
        <strong>${totalSites ? ((degradedSites.length / totalSites) * 100).toFixed(1) : 0}%</strong>
      </div>
    </div>

    <div class="degraded-report__section">
      <h2>Synthèse par site</h2>
      <table class="degraded-report__table">
        <thead>
          <tr>
            <th>#</th><th>Site</th><th>Vendor</th><th>Lien</th>
            <th>Perte moy.</th><th>Max</th><th>Temps dégradé</th><th>Plus longue période</th>
          </tr>
        </thead>
        <tbody>
          ${degradedSites.map((s, i) => {
            const link = getSiteLinkInfo(normalizeSite(s.Site));
            const deg  = s.degradedDuration || {totalHours:0,longestRun:0};
            return `
              <tr>
                <td>#${i + 1}</td>
                <td><strong>${escapeHtml(s.Site)}</strong></td>
                <td>${escapeHtml(s.vendor)}</td>
                <td>${link.label}</td>
                <td>${formatNumber(s.avg_packet_loss)}%</td>
                <td>${formatNumber(s.max_packet_loss)}%</td>
                <td>${formatDuration(deg.totalHours)}</td>
                <td>${formatDuration(deg.longestRun)}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>

    <div class="degraded-report__section">
      <h2>Graphiques de tendance</h2>
      <p class="degraded-report__hint">Évolution horaire du Packet Loss pour chaque site dégradé. Ligne rouge = seuil 0.1%.</p>
      <div class="degraded-report__charts">
        ${degradedSites.map(s => {
          const siteId = `report-chart-${s.Site.replace(/[^A-Z0-9_-]/g, "-")}`;
          const link   = getSiteLinkInfo(normalizeSite(s.Site));
          return `
            <div class="degraded-report__chart-card">
              <h3>${escapeHtml(s.Site)} <span class="degraded-report__badge">${link.label}</span></h3>
              <div class="degraded-report__chart" id="${siteId}"></div>
            </div>`;
        }).join("")}
      </div>
    </div>
  `;

  if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
    container.innerHTML = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } else {
    container.innerHTML = html;
  }

  return { container, rowsBySite };
}

/* =========================================================
   GRAPHIQUE DU RAPPORT DÉGRADÉ — utilise la Vue jour
   ========================================================= */
function renderReportChart(id, rows){
  const el = document.getElementById(id);
  if(!el) return;
  const sorted = [...rows].sort((a, b) => {
    const da = makeDateTime(a) || "", db = makeDateTime(b) || "";
    return da.localeCompare(db);
  });
  const x = sorted.map(r => makeDateTime(r));
  const y = sorted.map(r => Number(r.packet_loss));

  const xConf = buildXAxisConfigDay(rows, { tickSize: 9.5 });
  const yRange = computeFixedYRange(rows);

  Plotly.newPlot(id, [
    {
      x, y, type:"scatter", mode:"lines+markers",
      line:{ color:"#2563eb", width:2, shape:"spline", smoothing:0.5 },
      marker:{ color:"#2563eb", size:4 },
      fill:"tozeroy", fillcolor:"rgba(37,99,235,.08)",
      hovertemplate:"%{x|%d/%m %H:%M}<br>Packet Loss : <b>%{y:.4f}%</b><extra></extra>"
    },
    {
      x, y: x.map(() => THRESHOLD),
      type:"scatter", mode:"lines",
      line:{ dash:"dash", color:"#ef4444", width:1.2 },
      hoverinfo:"skip"
    }
  ], {
    margin:{ l:38, r:8, t:12, b: 46 + xConf.extraBottom },
    paper_bgcolor:"#fff", plot_bgcolor:"#fff",
    font:{ family:"Inter, Segoe UI, Arial", size:10, color:"#64748b" },
    hovermode:"x unified", showlegend:false,
    xaxis: xConf.axis,
    yaxis:{
      range: yRange,
      gridcolor:"#f8fafc", linecolor:"#e2e8f0",
      tickfont:{ size:9.5 },
      automargin: true
    }
  }, {
    responsive: true,
    displaylogo: false,
    displayModeBar: true,
    modeBarButtonsToRemove: [
      'lasso2d','select2d',
      'hoverClosestCartesian','hoverCompareCartesian',
      'toggleSpikelines','zoom2d','pan2d'
    ],
    toImageButtonOptions: {
      format: 'png',
      filename: `degraded-${id}`,
      height: 600,
      width: 1200,
      scale: 2
    }
  });
}

async function generateDegradedReportCanvas(){
  const degradedSites = (lastSiteStats || []).filter(s =>
    Number(s.avg_packet_loss) > THRESHOLD
  );
  if (!degradedSites.length){
    throw new Error("Aucun site dégradé à inclure dans le rapport.");
  }
  if (typeof html2canvas === "undefined"){
    throw new Error("Export indisponible (html2canvas manquant).");
  }

  const { container, rowsBySite } = buildDegradedReportDOM(degradedSites);
  document.body.appendChild(container);
  await new Promise(resolve => setTimeout(resolve, 150));

  degradedSites.forEach(s => {
    const siteId = `report-chart-${s.Site.replace(/[^A-Z0-9_-]/g, "-")}`;
    const rows   = rowsBySite[normalizeSite(s.Site)] || [];
    if (rows.length) renderReportChart(siteId, rows);
  });
  await new Promise(resolve => setTimeout(resolve, 400));

  try{
    return await html2canvas(container, {
      backgroundColor:"#ffffff", scale:2,
      useCORS:true, allowTaint:false, logging:false,
      windowWidth: container.scrollWidth,
      windowHeight: container.scrollHeight
    });
  } finally { container.remove(); }
}

safeOn("exportDegradedPdfBtn", "click", async () => {
  try{
    const JsPDFCtor =
      (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF
      : (typeof window.jsPDF !== "undefined") ? window.jsPDF : null;
    if(!JsPDFCtor) throw new Error("jsPDF non chargé.");

    const canvas = await generateDegradedReportCanvas();
    const imgData = canvas.toDataURL("image/png");

    const pdf        = new JsPDFCtor({orientation:"portrait",unit:"mm",format:"a4"});
    const pageWidth  = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin     = 5;
    const imgWidth   = pageWidth - margin*2;
    const imgHeight  = (canvas.height * imgWidth) / canvas.width;
    const usableH    = pageHeight - margin*2;

    let heightLeft = imgHeight, position = margin;
    pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    heightLeft -= usableH;
    while (heightLeft > 0){
      position = heightLeft - imgHeight + margin;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= usableH;
    }
    pdf.save(`sites-degrades-${new Date().toISOString().slice(0,10)}.pdf`);
  }catch(e){
    console.error(e);
    showMessage("Échec de l'export PDF des sites dégradés : " + e.message);
  }
});

safeOn("exportDegradedImgBtn", "click", async () => {
  try{
    const canvas = await generateDegradedReportCanvas();
    const link = document.createElement("a");
    link.download = `sites-degrades-${new Date().toISOString().slice(0,10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }catch(e){
    console.error(e);
    showMessage("Échec de l'export Image des sites dégradés : " + e.message);
  }
});

/* =========================================================
   EXPORT EXCEL DÉGRADÉ — utilise la Vue jour pour l'export
   ---------------------------------------------------------
   NOUVEAU v13 : les graphiques exportés dans Excel
   suivent la même logique que la "Vue jour" :
   - dtick D1 (une graduation par jour)
   - Y fixé pour inclure le seuil
   - ligne de seuil visible
   - courbe lissée
   ========================================================= */
async function generateSiteTrendImage(rows){
  const sorted = [...rows].sort((a, b) => {
    const da = makeDateTime(a) || "", db = makeDateTime(b) || "";
    return da.localeCompare(db);
  });
  const x = sorted.map(r => makeDateTime(r));
  const y = sorted.map(r => Number(r.packet_loss));

  const div = document.createElement("div");
  div.style.position = "absolute";
  div.style.left = "-99999px";
  div.style.top = "0";
  div.style.width = "900px";
  div.style.height = "300px";
  document.body.appendChild(div);

  try{
    /* Configuration identique à la Vue jour */
    const xConf = buildXAxisConfigDay(rows, { tickSize: 10 });
    const yRange = computeFixedYRange(rows);

    await Plotly.newPlot(div, [
      {
        x, y, type:"scatter", mode:"lines+markers",
        line:{ color:"#2563eb", width:2, shape:"spline", smoothing:0.5 },
        marker:{ color:"#2563eb", size:4 },
        fill:"tozeroy", fillcolor:"rgba(37,99,235,.08)"
      },
      {
        x, y: x.map(() => THRESHOLD),
        type:"scatter", mode:"lines",
        line:{ dash:"dash", color:"#ef4444", width:1.2 }
      }
    ], {
      margin:{ l:50, r:20, t:20, b: 40 + xConf.extraBottom },
      paper_bgcolor:"#ffffff", plot_bgcolor:"#ffffff",
      font:{ family:"Arial", size:10, color:"#334155" },
      showlegend:false,
      xaxis: xConf.axis,
      yaxis:{
        range: yRange,
        title:{ text:"Packet Loss (%)", font:{ size:10 } }
      }
    }, { staticPlot: true, displayModeBar: false });

    await new Promise(r => setTimeout(r, 200));

    return await Plotly.toImage(div, { format:"png", width:900, height:300, scale:2 });
  } finally { div.remove(); }
}

safeOn("exportDegradedXlsBtn", "click", async () => {
  try{
    const degradedSites = (lastSiteStats || []).filter(s =>
      Number(s.avg_packet_loss) > THRESHOLD
    );
    if (!degradedSites.length) throw new Error("Aucun site dégradé à exporter.");

    const rowsBySite = {};
    (lastFilteredRows || []).forEach(r => {
      const site = normalizeSite(r.Site);
      if (!site) return;
      (rowsBySite[site] ||= []).push(r);
    });

    const summaryData = degradedSites.map((s, i) => {
      const link = getSiteLinkInfo(normalizeSite(s.Site));
      const deg  = s.degradedDuration || {totalHours:0,longestRun:0};
      return {
        "Rang": i + 1, "Site": s.Site, "Vendor": s.vendor, "Lien": link.label,
        "Perte moyenne (%)": Number(Number(s.avg_packet_loss).toFixed(4)),
        "Perte max (%)": Number(Number(s.max_packet_loss).toFixed(4)),
        "Temps dégradé (h)": deg.totalHours,
        "Plus longue période (h)": deg.longestRun,
        "Nb mesures": s.nb_mesures,
        "Nb heures > 0.1%": s.above_threshold,
        "Statut": s.status
      };
    });

    const degradedNames = new Set(degradedSites.map(s => normalizeSite(s.Site)));
    const detailData = (lastFilteredRows || [])
      .filter(r => degradedNames.has(normalizeSite(r.Site)))
      .map(r => ({
        "Site": normalizeSite(r.Site), "Date": r.ladate, "Heure": r.hour,
        "Packet Loss (%)": Number(Number(r.packet_loss).toFixed(6)),
        "Vendor": r.vendor, "RBS": r.rbs
      }));

    const filename = `sites-degrades-${new Date().toISOString().slice(0,10)}.xlsx`;

    if (typeof window.ExcelJS !== "undefined"){
      const wb = new window.ExcelJS.Workbook();
      wb.creator = "Packet Loss Intelligence Dashboard";
      wb.created = new Date();

      const ws1 = wb.addWorksheet("Sites dégradés", { views:[{ state:"frozen", ySplit:1 }] });
      ws1.columns = [
        { header:"Rang", key:"r", width:6 },
        { header:"Site", key:"s", width:14 },
        { header:"Vendor", key:"v", width:12 },
        { header:"Lien", key:"l", width:14 },
        { header:"Perte moyenne (%)", key:"avg", width:16 },
        { header:"Perte max (%)", key:"max", width:12 },
        { header:"Temps dégradé (h)", key:"t", width:16 },
        { header:"Plus longue période (h)", key:"p", width:20 },
        { header:"Nb mesures", key:"n", width:12 },
        { header:"Nb heures > 0.1%", key:"ab", width:16 },
        { header:"Statut", key:"st", width:12 }
      ];
      ws1.getRow(1).font = { bold:true, color:{ argb:"FFFFFFFF" } };
      ws1.getRow(1).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFB91C1C" } };
      ws1.getRow(1).alignment = { vertical:"middle", horizontal:"center" };
      summaryData.forEach(row => ws1.addRow({
        r: row["Rang"], s: row["Site"], v: row["Vendor"], l: row["Lien"],
        avg: row["Perte moyenne (%)"], max: row["Perte max (%)"],
        t: row["Temps dégradé (h)"], p: row["Plus longue période (h)"],
        n: row["Nb mesures"], ab: row["Nb heures > 0.1%"], st: row["Statut"]
      }));

      const ws2 = wb.addWorksheet("Tendances");
      ws2.columns = [
        { header:"Site", key:"site", width:14 },
        { header:"Tendance", key:"tr", width:14 },
        { header:"Moy. 1ère moitié", key:"h1", width:18 },
        { header:"Moy. 2ème moitié", key:"h2", width:18 },
        { header:"Évolution (%)", key:"ev", width:14 },
        { header:"Temps dégradé (h)", key:"td", width:16 },
        { header:"Plus longue (h)", key:"pl", width:14 },
        { header:"Mesures", key:"m", width:10 }
      ];
      ws2.getRow(1).font = { bold:true, color:{ argb:"FFFFFFFF" } };
      ws2.getRow(1).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF1E40AF" } };
      ws2.getRow(1).alignment = { vertical:"middle", horizontal:"center" };

      let currentRow = 2;
      const CHART_HEIGHT = 16;

      for (let i = 0; i < degradedSites.length; i++){
        const s = degradedSites[i];
        const trend = computeSiteTrend(rowsBySite[normalizeSite(s.Site)] || []);
        const deg   = s.degradedDuration || { totalHours:0, longestRun:0 };

        ws2.addRow({
          site: s.Site,
          tr:   trend.trend === "improving" ? "Amélioration"
                : trend.trend === "degrading" ? "Dégradation" : "Stable",
          h1: Number(Number(trend.firstAvg).toFixed(4)),
          h2: Number(Number(trend.secondAvg).toFixed(4)),
          ev: Number(trend.halfToHalf.toFixed(1)),
          td: deg.totalHours, pl: deg.longestRun, m: s.nb_mesures
        });

        try{
          const rows = rowsBySite[normalizeSite(s.Site)] || [];
          if (rows.length){
            const dataUrl = await generateSiteTrendImage(rows);
            const base64  = dataUrl.split(",")[1];
            const imgId   = wb.addImage({ base64, extension:"png" });
            ws2.addImage(imgId, {
              tl: { col: 8.5, row: currentRow - 1 },
              ext: { width: 700, height: 260 },
              editAs: "oneCell"
            });
            currentRow += CHART_HEIGHT + 1;
          }
        }catch(err){
          console.warn("Graphique non généré pour", s.Site, err);
          currentRow += 2;
        }
      }

      ws2.eachRow(row => {
        row.eachCell(cell => {
          cell.border = {
            top:{style:"thin",color:{argb:"FFE5E7EB"}},
            left:{style:"thin",color:{argb:"FFE5E7EB"}},
            bottom:{style:"thin",color:{argb:"FFE5E7EB"}},
            right:{style:"thin",color:{argb:"FFE5E7EB"}}
          };
        });
      });

      const ws3 = wb.addWorksheet("Mesures détaillées", { views:[{ state:"frozen", ySplit:1 }] });
      ws3.columns = [
        { header:"Site", key:"s", width:14 },
        { header:"Date", key:"d", width:14 },
        { header:"Heure", key:"h", width:10 },
        { header:"Packet Loss (%)", key:"pl", width:16 },
        { header:"Vendor", key:"v", width:12 },
        { header:"RBS", key:"r", width:22 }
      ];
      ws3.getRow(1).font = { bold:true, color:{ argb:"FFFFFFFF" } };
      ws3.getRow(1).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF334155" } };
      detailData.forEach(r => ws3.addRow({
        s: r["Site"], d: r["Date"], h: r["Heure"],
        pl: r["Packet Loss (%)"], v: r["Vendor"], r: r["RBS"]
      }));

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename; link.click();
      URL.revokeObjectURL(url);
      return;
    }

    console.warn("ExcelJS non chargé : export Excel sans graphiques.");
    const wb  = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(summaryData);

    const trendsData = degradedSites.map((s) => {
      const trend = computeSiteTrend(rowsBySite[normalizeSite(s.Site)] || []);
      const deg   = s.degradedDuration || { totalHours:0, longestRun:0 };
      return {
        "Site": s.Site,
        "Tendance": trend.trend === "improving" ? "Amélioration"
                  : trend.trend === "degrading" ? "Dégradation" : "Stable",
        "Moy. 1ère moitié": Number(Number(trend.firstAvg).toFixed(4)),
        "Moy. 2ème moitié": Number(Number(trend.secondAvg).toFixed(4)),
        "Évolution (%)": Number(trend.halfToHalf.toFixed(1)),
        "Temps dégradé (h)": deg.totalHours,
        "Plus longue (h)": deg.longestRun,
        "Mesures": s.nb_mesures
      };
    });
    const ws2 = XLSX.utils.json_to_sheet(trendsData);
    const ws3 = XLSX.utils.json_to_sheet(detailData);

    ws1["!cols"] = [{wch:6},{wch:14},{wch:12},{wch:14},{wch:16},{wch:12},{wch:16},{wch:20},{wch:12},{wch:16},{wch:12}];
    ws2["!cols"] = [{wch:14},{wch:14},{wch:18},{wch:18},{wch:14},{wch:16},{wch:14},{wch:10}];
    ws3["!cols"] = [{wch:14},{wch:14},{wch:10},{wch:16},{wch:12},{wch:22}];

    XLSX.utils.book_append_sheet(wb, ws1, "Sites dégradés");
    XLSX.utils.book_append_sheet(wb, ws2, "Tendances");
    XLSX.utils.book_append_sheet(wb, ws3, "Mesures détaillées");
    XLSX.writeFile(wb, filename);

  }catch(e){
    console.error(e);
    showMessage("Échec de l'export Excel : " + e.message);
  }
});

/* =========================================================
   RESET
   ========================================================= */
safeOn("resetBtn", "click", ()=>{
  const sitesFile = $("sitesFile"); if(sitesFile) sitesFile.value = "";
  const excelFile = $("excelFile"); if(excelFile) excelFile.value = "";
  const sitesPaste = $("sitesPaste"); if(sitesPaste) sitesPaste.value = "";
  const sitesFileName = $("sitesFileName"); if(sitesFileName) sitesFileName.textContent = "Aucun fichier sélectionné";
  const vendor = $("vendor"); if(vendor) vendor.value = "ALL";
  const hourRange = $("hourRange"); if(hourRange) hourRange.value = "all";
  const siteSort = $("siteSort"); if(siteSort) siteSort.value = "name_asc";
  const trendFilter = $("trendFilter"); if(trendFilter) trendFilter.value = "all";
  const siteSearch = $("siteSearch"); if(siteSearch) siteSearch.value = "";

  /* Reset de la vue graphique sur "day" (comportement par défaut) */
  chartViewMode = "day";
  const toggle = $("viewToggle");
  if(toggle){
    toggle.querySelectorAll(".view-toggle__btn").forEach(b => {
      b.classList.toggle("is-active", b.dataset.view === "day");
    });
  }

  initPeriod();

  const mv = $("mapVendorFilter"); if(mv) mv.value = "ALL";
  const ml = $("mapLinkFilter"); if(ml) ml.value = "ALL";
  const tSites = $("toggleSites"); if(tSites) tSites.checked = true;
  const tFO = $("toggleFO"); if(tFO) tFO.checked = true;
  const tFH = $("toggleFH"); if(tFH) tFH.checked = true;
  const tTR = $("toggleTR"); if(tTR) tTR.checked = true;
  const tTOPO = $("toggleTOPO"); if(tTOPO) tTOPO.checked = true;
  const tHubs = $("toggleHubs"); if(tHubs) tHubs.checked = false;

  mapFilterState.vendor    = "ALL";
  mapFilterState.linkType  = "ALL";
  mapFilterState.showSites = true;
  mapFilterState.showFO    = true;
  mapFilterState.showFH    = true;
  mapFilterState.showTR    = true;
  mapFilterState.showTOPO  = true;

  const dash = $("dashboard"); if(dash) dash.classList.add("hidden");
  const empty = $("emptyState"); if(empty) empty.classList.remove("hidden");
  const reqInfo = $("requestInfo"); if(reqInfo) reqInfo.classList.add("hidden");
  clearMessage();
  setStatus("Prêt", "ok");

  if(map){
    mapMarkers.forEach(m=>m.remove());
    mapMarkers = [];
    Object.values(mapLinkLayers).forEach(l => { if(l) l.remove(); });
    mapLinkLayers = {};
    map.setView(CI_CENTER,CI_ZOOM,{animate:false});
  }

  if(hubHighlightLayer){ hubHighlightLayer.remove(); hubHighlightLayer = null; }
  hubScores    = [];
  selectedHub  = null;
  networkGraph = null;

  clearHubFilter();

  const hubList = $("hubList");
  if(hubList) hubList.innerHTML = `
    <div class="hub-empty">
      <i class="fa-solid fa-circle-info"></i>
      <p>Lancez une analyse pour identifier les HUBs.</p>
    </div>`;
  const hubDetails = $("hubDetails"); if(hubDetails) hubDetails.classList.add("hidden");
  const mapLayout = $("mapLayout"); if(mapLayout) mapLayout.classList.remove("is-collapsed");
  const float = $("hubPanelToggleFloat"); if(float) float.classList.add("hidden");

  lastResult       = null;
  lastFilteredRows = [];
  lastSiteStats    = [];
  Object.keys(siteTrends).forEach(k=>delete siteTrends[k]);
});

/* =========================================================
   MESSAGES
   ========================================================= */
function showMessage(msg){
  const el = $("message");
  if(!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearMessage(){
  const el = $("message");
  if(!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

/* =========================================================
   INITIALISATION
   ========================================================= */
async function init(){
  checkRequiredElements();
  initPeriod();

  safeOn("periodPreset", "change", e => setPeriod(e.target.value));
  safeOn("analyzeBtn",   "click",  runAnalysis);

  /* NOUVEAU v13 : branchement du sélecteur de vue */
  bindViewToggle();

  await Promise.all([loadLocations(), loadNetworkLinks()]);

  console.log("🚀 Dashboard initialisé. Période par défaut : 7 jours. v13 : modes jour/brut + Excel cohérent.");
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}