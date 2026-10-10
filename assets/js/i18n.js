/* ============================================================
   i18n — Internationalisation légère (FR / EN)
   ------------------------------------------------------------
   - Langue stockée dans localStorage (clé pl_lang, défaut "fr").
   - Traduit les éléments portant :
       data-i18n            -> textContent
       data-i18n-html       -> innerHTML
       data-i18n-title      -> attribut title
       data-i18n-placeholder-> attribut placeholder
   - Expose window.PL.I18N = { t, getLang, setLang, apply, mount }
   ============================================================ */
(function () {
  "use strict";

  const DICT = {
    fr: {
      "lang.name": "Français",
      "lang.other": "English",
      "lang.title": "Passer en anglais",
      "brand.tagline": "Plateforme de supervision et d'analyse réseau",

      "nav.back": "Retour",
      "nav.home": "Accueil",
      "nav.admin": "Administration",
      "nav.account": "Mon compte",
      "nav.logout": "Déconnexion",
      "nav.theme": "Basculer le thème",
      "nav.modules": "Modules",
      "nav.help": "Aide",
      "nav.wallboard": "Wallboard",
      "nav.saved": "Sauvegardes",
      "nav.alerts": "Alertes",
      "nav.auto": "Auto",

      "home.eyebrow": "Sélection du pays",
      "home.title": "Choisissez votre <span>pays</span>",
      "home.subtitle": "Sélectionnez un pays pour accéder aux modules d'analyse réseau disponibles.",
      "home.loading": "Chargement des pays...",
      "home.footer": "D'autres fonctionnalités seront ajoutées prochainement. Contactez l'administrateur pour en ajouter.",

      "menu.back": "Changer de pays",
      "menu.title": "Que souhaitez-vous <span>visualiser</span> ?",
      "menu.subtitle": "Choisissez un module d'analyse pour démarrer votre consultation.",

      "login.tagline": "Analyse réseau avancée",
      "login.email": "Email",
      "login.password": "Mot de passe",
      "login.submit": "Se connecter",
      "login.otp.hint": "Saisissez le code à 6 chiffres envoyé par email.",
      "login.otp.label": "Code de vérification",
      "login.otp.submit": "Vérifier",
      "login.otp.back": "Retour",
      "login.hint": "Accès réservé aux administrateurs réseau.",

      "account.title": "Mon <span>compte</span>",
      "account.profile.title": "Profil",
      "account.profile.sub": "Identité et préférences par défaut.",
      "account.field.fullname": "Nom complet",
      "account.field.email": "Email",
      "account.field.role": "Rôle",
      "account.field.countries": "Pays autorisés",
      "account.field.theme": "Thème par défaut",
      "account.field.threshold": "Seuil par défaut (%)",
      "account.field.refresh": "Rafraîchissement (s)",
      "account.field.emailAlerts": "Recevoir les alertes par email",
      "account.profile.save": "Enregistrer le profil",
      "account.security.title": "Sécurité",
      "account.security.sub": "Mot de passe et double authentification.",
      "account.field.pwCurrent": "Mot de passe actuel",
      "account.field.pwNew": "Nouveau mot de passe",
      "account.field.pwConfirm": "Confirmer",
      "account.security.changePw": "Changer le mot de passe",
      "account.security.tfa": "Double authentification (email)",
      "account.security.enable": "Activer",
      "account.security.disable": "Désactiver",
      "account.security.confirmEnable": "Confirmer l'activation",
      "account.security.code": "Code à 6 chiffres",
      "account.sessions.title": "Sessions actives",
      "account.sessions.sub": "Appareils connectés à votre compte.",
      "account.sessions.others": "Déconnecter les autres sessions",
      "account.sessions.all": "Déconnecter partout",
      "account.sessions.device": "Appareil",
      "account.sessions.ip": "IP",
      "account.sessions.last": "Dernière activité",
      "account.notifs.title": "Notifications",
      "account.notifs.sub": "Messages et événements récents.",
      "account.notifs.readAll": "Tout marquer comme lu",

      "admin.tab.overview": "Vue d'ensemble",
      "admin.tab.automations": "Automatisations",
      "admin.tab.logs": "Journaux",
      "admin.tab.security": "Sécurité",
      "admin.tab.users": "Utilisateurs",
      "admin.tab.roles": "Rôles",
      "admin.tab.reports": "Rapports",
      "admin.title": "Administration",
      "admin.back": "Retour",

      "pl.brand.tagline": "Analyse réseau avancée <em>•</em> Seuil <strong>0.1%</strong>"
    },
    en: {
      "lang.name": "English",
      "lang.other": "Français",
      "lang.title": "Switch to French",
      "brand.tagline": "Network supervision and analysis platform",

      "nav.back": "Back",
      "nav.home": "Home",
      "nav.admin": "Administration",
      "nav.account": "My account",
      "nav.logout": "Log out",
      "nav.theme": "Toggle theme",
      "nav.modules": "Modules",
      "nav.help": "Help",
      "nav.wallboard": "Wallboard",
      "nav.saved": "Saved",
      "nav.alerts": "Alerts",
      "nav.auto": "Auto",

      "home.eyebrow": "Country selection",
      "home.title": "Choose your <span>country</span>",
      "home.subtitle": "Select a country to access the available network analysis modules.",
      "home.loading": "Loading countries...",
      "home.footer": "More features will be added soon. Contact the administrator to request one.",

      "menu.back": "Change country",
      "menu.title": "What would you like to <span>view</span>?",
      "menu.subtitle": "Choose an analysis module to start your session.",

      "login.tagline": "Advanced network analysis",
      "login.email": "Email",
      "login.password": "Password",
      "login.submit": "Sign in",
      "login.otp.hint": "Enter the 6-digit code sent by email.",
      "login.otp.label": "Verification code",
      "login.otp.submit": "Verify",
      "login.otp.back": "Back",
      "login.hint": "Access restricted to network administrators.",

      "account.title": "My <span>account</span>",
      "account.profile.title": "Profile",
      "account.profile.sub": "Identity and default preferences.",
      "account.field.fullname": "Full name",
      "account.field.email": "Email",
      "account.field.role": "Role",
      "account.field.countries": "Allowed countries",
      "account.field.theme": "Default theme",
      "account.field.threshold": "Default threshold (%)",
      "account.field.refresh": "Refresh (s)",
      "account.field.emailAlerts": "Receive email alerts",
      "account.profile.save": "Save profile",
      "account.security.title": "Security",
      "account.security.sub": "Password and two-factor authentication.",
      "account.field.pwCurrent": "Current password",
      "account.field.pwNew": "New password",
      "account.field.pwConfirm": "Confirm",
      "account.security.changePw": "Change password",
      "account.security.tfa": "Two-factor authentication (email)",
      "account.security.enable": "Enable",
      "account.security.disable": "Disable",
      "account.security.confirmEnable": "Confirm activation",
      "account.security.code": "6-digit code",
      "account.sessions.title": "Active sessions",
      "account.sessions.sub": "Devices connected to your account.",
      "account.sessions.others": "Log out other sessions",
      "account.sessions.all": "Log out everywhere",
      "account.sessions.device": "Device",
      "account.sessions.ip": "IP",
      "account.sessions.last": "Last activity",
      "account.notifs.title": "Notifications",
      "account.notifs.sub": "Recent messages and events.",
      "account.notifs.readAll": "Mark all as read",

      "admin.tab.overview": "Overview",
      "admin.tab.automations": "Automations",
      "admin.tab.logs": "Logs",
      "admin.tab.security": "Security",
      "admin.tab.users": "Users",
      "admin.tab.roles": "Roles",
      "admin.tab.reports": "Reports",
      "admin.title": "Administration",
      "admin.back": "Back",

      "pl.brand.tagline": "Advanced network analysis <em>•</em> Threshold <strong>0.1%</strong>"
    }
  };

  const LS_KEY = "pl_lang";

  function getLang() {
    try {
      const v = localStorage.getItem(LS_KEY);
      if (v === "fr" || v === "en") return v;
    } catch (_) {}
    return "fr";
  }

  function t(key) {
    const lang = getLang();
    const pack = DICT[lang] || DICT.fr;
    if (Object.prototype.hasOwnProperty.call(pack, key)) return pack[key];
    if (Object.prototype.hasOwnProperty.call(DICT.fr, key)) return DICT.fr[key];
    return key;
  }

  function apply(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    root.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    document.documentElement.lang = getLang();
  }

  function updateButton() {
    const btn = document.getElementById("langSwitchBtn");
    if (!btn) return;
    const label = btn.querySelector(".lang-switch__label");
    const next = getLang() === "fr" ? "EN" : "FR";
    if (label) label.textContent = next;
    btn.setAttribute("title", t("lang.title"));
  }

  function setLang(lang) {
    lang = lang === "en" ? "en" : "fr";
    try { localStorage.setItem(LS_KEY, lang); } catch (_) {}
    apply();
    updateButton();
    document.dispatchEvent(new CustomEvent("pl:langchange", { detail: { lang: lang } }));
  }

  function mount() {
    if (document.getElementById("langSwitchBtn")) return;

    const host =
      document.querySelector(".home-topbar__actions") ||
      document.querySelector(".topbar__actions") ||
      document.querySelector(".admin-topbar__inner") ||
      document.getElementById("langSwitch");

    const btn = document.createElement("button");
    btn.id = "langSwitchBtn";
    btn.type = "button";
    btn.innerHTML = '<i class="fa-solid fa-language"></i><span class="lang-switch__label"></span>';

    if (host) {
      btn.className = host.classList.contains("topbar__actions")
        ? "topbar__action"
        : host.classList.contains("admin-topbar__inner")
          ? "admin-action"
          : "home-action";
      host.insertBefore(btn, host.firstChild);
    } else {
      btn.className = "lang-switch-fixed";
      btn.style.cssText =
        "position:fixed;top:14px;right:14px;z-index:9999;display:inline-flex;align-items:center;gap:6px;" +
        "padding:7px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.14);cursor:pointer;" +
        "background:#1e1b4b;color:#fff;font-size:12px;font-weight:700";
      document.body.appendChild(btn);
    }

    btn.addEventListener("click", function () {
      setLang(getLang() === "fr" ? "en" : "fr");
    });
    updateButton();
  }

  function boot() {
    apply();
    mount();
    updateButton();
  }

  window.PL = window.PL || {};
  window.PL.I18N = { t: t, getLang: getLang, setLang: setLang, apply: apply, mount: mount, DICT: DICT };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
