/* ============================================================
   Mon compte — profil, sécurité, sessions, notifications
   ============================================================ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function showError(msg) {
    const el = $("accountError");
    el.textContent = msg;
    el.classList.remove("hidden");
    $("accountSuccess").classList.add("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showSuccess(msg) {
    const el = $("accountSuccess");
    el.textContent = msg;
    el.classList.remove("hidden");
    $("accountError").classList.add("hidden");
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Erreur serveur.");
    return data;
  }

  async function postJson(url, body) {
    const res = await PL.fetch(url, { method: "POST", body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Erreur serveur.");
    return data;
  }

  function formatDate(v) {
    if (!v) return "—";
    const d = new Date(String(v).replace(" ", "T"));
    return isNaN(d) ? String(v) : d.toLocaleString("fr-FR");
  }

  /* ---------------- Profil ---------------- */
  async function loadProfile() {
    const data = await getJson("api/account/profile.php");
    const p = data.profile;
    $("accountSubtitle").textContent = p.email;
    $("pfFullName").value = p.full_name;
    $("pfEmail").value = p.email;
    $("pfRole").value = p.role;
    $("pfCountries").value = (p.countries || []).join(", ");
    const prefs = p.preferences || {};
    $("pfTheme").value = prefs.theme === "dark" ? "dark" : "light";
    $("pfThreshold").value = prefs.defaultThreshold != null ? prefs.defaultThreshold : 0.1;
    $("pfRefresh").value = prefs.refreshSeconds != null ? prefs.refreshSeconds : 60;
    $("pfEmailAlerts").checked = prefs.emailAlerts !== false;
    update2faStatus(p.two_factor_enabled);
  }

  async function saveProfile() {
    $("pfSaveBtn").disabled = true;
    try {
      await postJson("api/account/profile.php", {
        full_name: $("pfFullName").value.trim(),
        preferences: {
          theme: $("pfTheme").value,
          defaultThreshold: Number($("pfThreshold").value) || 0.1,
          refreshSeconds: Number($("pfRefresh").value) || 60,
          emailAlerts: $("pfEmailAlerts").checked
        }
      });
      showSuccess("Profil enregistré.");
    } catch (e) {
      showError(e.message);
    } finally {
      $("pfSaveBtn").disabled = false;
    }
  }

  /* ---------------- Mot de passe ---------------- */
  async function changePassword() {
    const current = $("pwCurrent").value;
    const next = $("pwNew").value;
    const confirm = $("pwConfirm").value;
    if (next !== confirm) {
      showError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }
    $("pwSaveBtn").disabled = true;
    try {
      await postJson("api/auth/change_password.php", { current_password: current, new_password: next });
      $("pwCurrent").value = $("pwNew").value = $("pwConfirm").value = "";
      showSuccess("Mot de passe modifié. Les autres sessions ont été déconnectées.");
      loadSessions();
    } catch (e) {
      showError(e.message);
    } finally {
      $("pwSaveBtn").disabled = false;
    }
  }

  /* ---------------- 2FA ---------------- */
  function update2faStatus(enabled) {
    $("tfaStatus").textContent = enabled
      ? "Activée — un code est demandé à chaque connexion."
      : "Désactivée — recommandez de l'activer.";
    $("tfaEnableBtn").classList.toggle("hidden", !!enabled);
    $("tfaDisableBtn").classList.toggle("hidden", !enabled);
    if (enabled) $("tfaConfirmBox").classList.add("hidden");
  }

  async function enable2fa() {
    try {
      await postJson("api/account/two_factor.php", { action: "enable" });
      $("tfaConfirmBox").classList.remove("hidden");
      $("tfaCode").value = "";
      $("tfaCode").focus();
      showSuccess("Un code a été envoyé par email. Saisissez-le pour confirmer.");
    } catch (e) {
      showError(e.message);
    }
  }

  async function confirm2fa() {
    try {
      await postJson("api/account/two_factor.php", { action: "confirm", code: $("tfaCode").value.trim() });
      update2faStatus(true);
      showSuccess("Double authentification activée.");
    } catch (e) {
      showError(e.message);
    }
  }

  async function disable2fa() {
    const password = window.prompt("Saisissez votre mot de passe pour désactiver la 2FA :");
    if (!password) return;
    try {
      await postJson("api/account/two_factor.php", { action: "disable", password: password });
      update2faStatus(false);
      showSuccess("Double authentification désactivée.");
    } catch (e) {
      showError(e.message);
    }
  }

  /* ---------------- Sessions ---------------- */
  async function loadSessions() {
    try {
      const data = await getJson("api/account/sessions.php");
      const rows = data.sessions || [];
      const body = $("sessionsBody");
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="4" class="account-muted">Aucune session.</td></tr>';
        return;
      }
      body.innerHTML = rows.map((s) => `<tr>
        <td>${s.current ? '<span class="account-badge">Session actuelle</span> ' : ""}${esc(s.user_agent || "Appareil inconnu")}</td>
        <td>${esc(s.ip || "—")}</td>
        <td>${esc(formatDate(s.last_seen_at))}</td>
        <td>${s.current ? "" : `<button class="account-btn account-btn--small account-btn--danger" data-revoke="${s.id}">Révoquer</button>`}</td>
      </tr>`).join("");
      body.querySelectorAll("[data-revoke]").forEach((btn) => {
        btn.addEventListener("click", () => revokeSession(btn.getAttribute("data-revoke")));
      });
    } catch (e) {
      showError(e.message);
    }
  }

  async function revokeSession(id) {
    try {
      await postJson("api/account/sessions.php", { action: "revoke", id: Number(id) });
      loadSessions();
    } catch (e) {
      showError(e.message);
    }
  }

  async function revoke(action) {
    try {
      await postJson("api/account/sessions.php", { action: action });
      if (action === "revoke_all") {
        await PL.logout();
        return;
      }
      loadSessions();
      showSuccess("Sessions mises à jour.");
    } catch (e) {
      showError(e.message);
    }
  }

  /* ---------------- Notifications ---------------- */
  async function loadNotifications() {
    try {
      const data = await getJson("api/account/notifications.php");
      const list = $("notifList");
      const items = data.notifications || [];
      if (!items.length) {
        list.innerHTML = '<li class="account-muted">Aucune notification.</li>';
        return;
      }
      list.innerHTML = items.map((n) => `<li class="account-notif ${n.is_read ? "" : "account-notif--unread"}" data-id="${n.id}">
        <div class="account-notif__head"><strong>${esc(n.title)}</strong><span>${esc(formatDate(n.created_at))}</span></div>
        <p>${esc(n.message || "")}</p>
      </li>`).join("");
      list.querySelectorAll("[data-id]").forEach((li) => {
        li.addEventListener("click", () => markRead(li.getAttribute("data-id")));
      });
    } catch (e) {
      showError(e.message);
    }
  }

  async function markRead(id) {
    try {
      await postJson("api/account/notifications.php", { action: "read", id: Number(id) });
      loadNotifications();
    } catch (e) {
      showError(e.message);
    }
  }

  async function markAllRead() {
    try {
      await postJson("api/account/notifications.php", { action: "read_all" });
      loadNotifications();
      showSuccess("Toutes les notifications sont lues.");
    } catch (e) {
      showError(e.message);
    }
  }

  /* ---------------- Thème ---------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const icon = document.querySelector("#darkModeBtn i");
    if (icon) icon.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }

  function initTheme() {
    let saved = "light";
    try { saved = localStorage.getItem("pl_theme") || "light"; } catch (_) {}
    applyTheme(saved);
    const btn = $("darkModeBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme") || "light";
        const next = cur === "dark" ? "light" : "dark";
        try { localStorage.setItem("pl_theme", next); } catch (_) {}
        applyTheme(next);
      });
    }
  }

  /* ---------------- Init ---------------- */
  document.addEventListener("DOMContentLoaded", async function () {
    initTheme();
    const session = await PL.requireAuth();
    if (!session) return;

    $("pfSaveBtn").addEventListener("click", saveProfile);
    $("pwSaveBtn").addEventListener("click", changePassword);
    $("tfaEnableBtn").addEventListener("click", enable2fa);
    $("tfaConfirmBtn").addEventListener("click", confirm2fa);
    $("tfaDisableBtn").addEventListener("click", disable2fa);
    $("sessOthersBtn").addEventListener("click", () => revoke("revoke_others"));
    $("sessAllBtn").addEventListener("click", () => {
      if (window.confirm("Fermer toutes les sessions, y compris la session actuelle ?")) revoke("revoke_all");
    });
    $("notifReadAllBtn").addEventListener("click", markAllRead);
    const logoutBtn = $("logoutAccountBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", () => PL.logout());

    loadProfile().catch((e) => showError(e.message));
    loadSessions();
    loadNotifications();
  });
})();
