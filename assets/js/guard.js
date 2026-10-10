/* ============================================================
   Authentification / Garde de session
   ============================================================ */
(function () {
  const PAGE_LOGIN = "login.html";
  const URL_ME = "api/auth/me.php";
  const URL_LOGOUT = "api/auth/logout.php";

  window.PL = window.PL || {};

  let sessionPromise = null;

  PL.csrf = null;
  PL.permissions = [];
  PL.session = null;

  /* Récupère la session courante ; redirige vers la connexion si 401. */
  PL.requireAuth = function () {
    if (sessionPromise) return sessionPromise;
    sessionPromise = fetch(URL_ME, { credentials: "same-origin" })
      .then(function (res) {
        if (res.status === 401) {
          window.location.href = PAGE_LOGIN;
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.success || !data.user) {
          window.location.href = PAGE_LOGIN;
          return null;
        }
        PL.session = data.user;
        PL.csrf = data.csrf;
        PL.permissions = data.user.permissions || [];
        document.body.classList.add("auth-ready");
        return PL.session;
      })
      .catch(function () {
        window.location.href = PAGE_LOGIN;
        return null;
      });
    return sessionPromise;
  };

  /* Fetch avec jeton CSRF pour les méthodes d'écriture. */
  PL.fetch = function (url, options) {
    options = options || {};
    var opts = Object.assign({ credentials: "same-origin" }, options);

    if (opts.method && opts.method.toUpperCase() !== "GET") {
      opts.headers = Object.assign({
        "X-CSRF-Token": PL.csrf || "",
        "Content-Type": "application/json"
      }, opts.headers || {});
    }

    return fetch(url, opts).then(function (res) {
      if (res.status === 401) {
        window.location.href = PAGE_LOGIN;
        throw new Error("Session expirée.");
      }
      return res;
    });
  };

  PL.can = function (permission) {
    if (PL.session && PL.session.super_admin) return true;
    return (PL.permissions || []).indexOf(permission) !== -1;
  };

  PL.superAdmin = function () {
    return !!(PL.session && PL.session.super_admin);
  };

  /* Déconnexion : API, nettoyage localStorage, retour connexion. */
  PL.logout = async function () {
    try {
      await fetch(URL_LOGOUT, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": PL.csrf || "" }
      });
    } catch (err) { /* la déconnexion locale est suffisante */ }
    PL.session = null;
    PL.csrf = null;
    PL.permissions = [];
    try { localStorage.removeItem("pl_country"); } catch (_) {}
    window.location.href = PAGE_LOGIN;
  };

  document.addEventListener("DOMContentLoaded", function () {
    PL.requireAuth().then(function () {
      document.querySelectorAll("[data-admin-only]").forEach(function (el) {
        el.classList.toggle("hidden", !PL.superAdmin());
      });
    });
  });
})();