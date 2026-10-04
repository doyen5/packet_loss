/* =========================================================
   HOME / MENU — Logique partagée
   ---------------------------------------------------------
   - Détecte automatiquement sur quelle page on est
     (index.html = accueil, menu.html = choix du module)
   - Charge la liste des pays
   - Gère le thème sombre (partagé avec le dashboard)
   - Gère les redirections
   ========================================================= */

"use strict";

/* =========================================================
   CONFIGURATION DES PAYS
   ---------------------------------------------------------
   Pour ajouter un pays, il suffit d'ajouter une entrée ici.
   - code : ISO 2 lettres (utilisé dans l'URL)
   - name : nom affiché
   - flag : emoji drapeau
   - status : "active" (disponible) ou "soon" (à venir)
   - description : texte descriptif
   - modules : liste des modules disponibles pour ce pays
   ========================================================= */
const COUNTRIES = [
  {
    code: "CI",
    name: "Côte d'Ivoire",
    flag: "🇨🇮",
    image: "assets/images/ci.png",
    status: "active",
    description: "Analyse du Packet Loss sur le réseau ivoirien. Détection des HUBs, corrélations et prédictions.",
    modules: [
      {
        id: "packet_loss",
        label: "Packet Loss",
        page: "packet_loss.html",
        status: "active"
      }
    ]
  },
  {
    code: "TG",
    name: "Togo",
    flag: "🇹🇬",
    image: "assets/images/tg.png",
    status: "active",
    description: "Analyse du Packet Loss sur le réseau togolais. Détection des HUBs, corrélations et prédictions.",
    modules: [
      {
        id: "packet_loss",
        label: "Packet Loss",
        page: "packet_loss.html",
        status: "active"
      }
    ]
  },
  {
    code: "BJ",
    name: "Bénin",
    flag: "🇧🇯",
    image: "assets/images/bj.png",
    status: "active",
    description: "Analyse du Packet Loss sur le réseau béninois. Détection des HUBs, corrélations et prédictions.",
    modules: [
      {
        id: "packet_loss",
        label: "Packet Loss",
        page: "packet_loss.html",
        status: "active"
      }
    ]
  },
  {
    code: "NE",
    name: "Niger",
    flag: "🇳🇪",
    image: "assets/images/ne.png",
    status: "active",
    description: "Analyse du Packet Loss sur le réseau nigérien. Détection des HUBs, corrélations et prédictions.",
    modules: [
      {
        id: "packet_loss",
        label: "Packet Loss",
        page: "packet_loss.html",
        status: "active"
      }
    ]
  },
  {
    code: "CF",
    name: "Centrafrique",
    flag: "🇨🇫",
    image: "assets/images/cf.png",
    status: "active",
    description: "Analyse du Packet Loss sur le réseau centrafricain. Détection des HUBs, corrélations et prédictions.",
    modules: [
      {
        id: "packet_loss",
        label: "Packet Loss",
        page: "packet_loss.html",
        status: "active"
      }
    ]
  }
];

/* =========================================================
   CATALOGUE DES MODULES
   ---------------------------------------------------------
   Définit tous les modules possibles (utilisé par menu.html)
   Pour chaque module :
   - id           : identifiant technique unique
   - title        : titre affiché
   - icon         : icône Font Awesome
   - colorClass   : couleur du thème (primary / sky / violet / orange)
   - description  : description courte
   - features     : liste des fonctionnalités (max 5)
   - page         : nom du fichier HTML à charger
   - status       : "active" ou "soon"
   ========================================================= */
const MODULES_CATALOG = [
  {
    id: "packet_loss",
    title: "Packet Loss",
    icon: "fa-satellite-dish",
    colorClass: "primary",
    description: "Analyse complète du taux de perte de paquets avec détection des HUBs et corrélations.",
    features: [
      "Analyse multi-périodes",
      "Détection automatique des HUBs",
      "Carte réseau interactive",
      "Heatmap et prédictions",
      "Alertes email automatiques"
    ],
    page: "packet_loss.html",
    status: "active"
  },
  {
    id: "kpis",
    title: "KPIs & Fiabilité",
    icon: "fa-chart-line",
    colorClass: "sky",
    description: "Indicateurs de performance réseau : SLA, MTBF, MTTR, disponibilité.",
    features: [
      "Calcul des SLA",
      "Fiabilité par site",
      "Tendances historiques",
      "Comparaison inter-pays"
    ],
    page: "kpis.html",
    status: "soon"
  },
  {
    id: "capacity",
    title: "Capacité & Trafic",
    icon: "fa-tower-broadcast",
    colorClass: "violet",
    description: "Analyse de la charge réseau, saturation et dimensionnement.",
    features: [
      "Taux d'occupation",
      "Saturation des liens",
      "Recommandations de dimensionnement"
    ],
    page: "capacity.html",
    status: "soon"
  },
  {
    id: "other",
    title: "Autres modules",
    icon: "fa-ellipsis",
    colorClass: "orange",
    description: "D'autres modules d'analyse seront ajoutés prochainement.",
    features: [
      "Nouvelles analyses en développement",
      "Restez connectés pour les mises à jour"
    ],
    page: null,
    status: "soon"
  }
];

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
   THÈME SOMBRE
   ========================================================= */
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("darkModeBtn");
  if(btn){
    const i = btn.querySelector("i");
    if(i) i.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }
}
function initTheme(){
  const saved = storageGet("pl_theme", "light");
  applyTheme(saved);
  const btn = document.getElementById("darkModeBtn");
  if(btn){
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "dark" ? "light" : "dark";
      storageSet("pl_theme", next);
      applyTheme(next);
    });
  }
}

/* =========================================================
   PAGE D'ACCUEIL — Rendu de la grille des pays
   ========================================================= */
function renderCountryGrid(){
  const grid = document.getElementById("countryGrid");
  if(!grid) return;

  grid.innerHTML = COUNTRIES.map((c, i) => {
    const isDisabled = c.status !== "active";
    const badgeClass = isDisabled ? "country-card__badge--soon" : "country-card__badge--active";
    const badgeText = isDisabled ? "Bientôt" : "Disponible";
    const moduleCount = (c.modules || []).length;
    return `
      <div class="country-card ${isDisabled ? "is-disabled" : ""}"
           data-country="${c.code}"
           data-status="${c.status}"
           style="animation-delay:${i * 0.05}s">
        <div class="country-card__head">
          <div class="country-card__flag">
            <img src="${c.image}" alt="${c.name}" class="country-card__flag-img"
                 onerror="this.style.display='none';this.parentElement.textContent='${c.flag}';">
          </div>
          <div class="country-card__info">
            <div class="country-card__name">${c.name}</div>
            <div class="country-card__code">${c.code}</div>
          </div>
        </div>
        <span class="country-card__badge ${badgeClass}">${badgeText}</span>
        <p class="country-card__desc">${c.description}</p>
        <div class="country-card__footer">
          <span class="country-card__modules">
            <i class="fa-solid fa-cube"></i>
            ${moduleCount > 0 ? moduleCount + " module" + (moduleCount > 1 ? "s" : "") : "Aucun"}
          </span>
          <span class="country-card__arrow">
            <i class="fa-solid fa-arrow-right"></i>
          </span>
        </div>
      </div>`;
  }).join("");

  grid.querySelectorAll(".country-card:not(.is-disabled)").forEach(card => {
    card.addEventListener("click", () => {
      const code = card.dataset.country;
      storageSet("pl_country", code);
      window.location.href = `menu.html?country=${encodeURIComponent(code)}`;
    });
  });
}

/* =========================================================
   PAGE MENU — Gestion du pays et rendu des modules
   ========================================================= */
function getCountryFromURL(){
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("country");
  if(fromUrl){
    storageSet("pl_country", fromUrl.toUpperCase());
    return fromUrl.toUpperCase();
  }
  return storageGet("pl_country", null);
}

function getCountryConfig(code){
  return COUNTRIES.find(c => c.code === code) || null;
}

function renderMenu(){
  const countryCode = getCountryFromURL();
  const country = getCountryConfig(countryCode);

  /* Si aucun pays valide → redirige vers l'accueil */
  if(!country){
    window.location.href = "index.html";
    return;
  }

  /* Met à jour le badge du pays dans le header */
  const label = document.getElementById("menuCountryLabel");
  if(label) label.textContent = country.name;

  const badge = document.getElementById("menuCountryBadge");
  if(badge){
    badge.innerHTML = `<i class="fa-solid fa-flag"></i> ${country.flag} ${country.name}`;
  }

  /* Filtre les modules disponibles pour ce pays */
  const availableModuleIds = (country.modules || []).map(m => m.id);
  const isCountryActive = country.status === "active";

  /* Rend la grille des modules */
  const grid = document.getElementById("moduleGrid");
  if(!grid) return;

  grid.innerHTML = MODULES_CATALOG.map((m, i) => {
    /* Un module est actif si :
       - le pays est actif
       - ET le module est dans la liste des modules du pays
       Sinon il est désactivé */
    const countryHasModule = isCountryActive && availableModuleIds.includes(m.id);
    const isDisabled = !countryHasModule;
    const badgeClass = countryHasModule ? "module-card__badge--active" : "module-card__badge--soon";
    const badgeText = countryHasModule ? "Disponible" : "Bientôt";
    const stripeClass = `module-card__stripe--${m.colorClass}`;
    const iconClass = `module-card__icon--${m.colorClass}`;

    return `
      <div class="module-card ${isDisabled ? "is-disabled" : ""}"
           data-module="${m.id}"
           data-page="${m.page || ""}"
           data-disabled="${isDisabled}"
           style="animation-delay:${i * 0.06}s">
        <div class="module-card__stripe ${stripeClass}"></div>
        ${!isDisabled ? `<div class="module-card__arrow"><i class="fa-solid fa-arrow-right"></i></div>` : ""}
        <div class="module-card__icon ${iconClass}">
          <i class="fa-solid ${m.icon}"></i>
        </div>
        <h3 class="module-card__title">${m.title}</h3>
        <p class="module-card__desc">${m.description}</p>
        <ul class="module-card__features">
          ${(m.features || []).map(f => `
            <li><i class="fa-solid fa-circle-check"></i> ${f}</li>
          `).join("")}
        </ul>
        <span class="module-card__badge ${badgeClass}">${badgeText}</span>
      </div>`;
  }).join("");

  /* Attache les clics sur les modules actifs */
  grid.querySelectorAll(".module-card:not(.is-disabled)").forEach(card => {
    card.addEventListener("click", () => {
      const page = card.dataset.page;
      if(!page) return;
      /* Redirige vers la page du module avec le pays en paramètre */
      window.location.href = `${page}?country=${encodeURIComponent(countryCode)}`;
    });
  });
}

/* =========================================================
   DÉTECTION AUTOMATIQUE DE LA PAGE
   ========================================================= */
function isHomePage(){
  return document.getElementById("countryGrid") !== null;
}
function isMenuPage(){
  return document.getElementById("moduleGrid") !== null;
}

/* =========================================================
   INITIALISATION
   ========================================================= */
function init(){
  initTheme();

  if(isHomePage()){
    renderCountryGrid();
  } else if(isMenuPage()){
    renderMenu();
    /* Bouton retour à l'accueil */
    const back = document.getElementById("backToHomeBtn");
    if(back){
      back.addEventListener("click", () => {
        window.location.href = "index.html";
      });
    }
  }
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}