/* ============================================================
   Administration — console (utilisateurs + supervision)
   ============================================================ */
(function () {
  let META = null;
  let USERS = [];
  let LOG_PAGE = 1;
  let LOG_ROWS = [];
  let LOG_ACTIONS = [];
  let ROLES_DATA = null;
  let REPORTS_DATA = null;
  const LOADED = {};

  const panel = () => document.getElementById("adminPanel");
  const forbidden = () => document.getElementById("adminForbidden");
  const adminUserLabel = () => document.getElementById("adminUserLabel");
  const usersError = () => document.getElementById("usersError");
  const usersLoading = () => document.getElementById("usersLoading");

  function showError(message) {
    const el = usersError();
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
  }
  function hideError() {
    const el = usersError();
    if (el) el.classList.add("hidden");
  }

  async function api(url, body) {
    const opts = { credentials: "same-origin" };
    if (body) {
      opts.method = "POST";
      opts.headers = { "X-CSRF-Token": PL.csrf || "", "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({ success: false, message: "Réponse invalide" }));
    if (res.status === 401) {
      window.location.href = "login.html";
      throw new Error(data.message);
    }
    if (!res.ok) {
      throw new Error(data.message || "Erreur serveur");
    }
    return data;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /* ---------- Helpers d'affichage ---------- */

  function loadingBlock() {
    return '<div class="admin-message"><i class="fa-solid fa-spinner fa-spin"></i> Chargement...</div>';
  }
  function errorBlock(message) {
    return `<div class="admin-message admin-message--error">${escapeHtml(message)}</div>`;
  }
  function emptyRow(cols, label) {
    return `<tr><td colspan="${cols}" class="admin-muted">${escapeHtml(label || "Aucune donnée.")}</td></tr>`;
  }
  function kpi(value, label, icon, tone) {
    return `<div class="admin-kpi${tone ? " admin-kpi--" + tone : ""}">
      <i class="fa-solid ${icon}"></i>
      <div>
        <span class="admin-kpi__value">${escapeHtml(value)}</span>
        <span class="admin-kpi__label">${escapeHtml(label)}</span>
      </div>
    </div>`;
  }
  function miniTable(headers, rows) {
    if (!rows.length) return '<p class="admin-muted admin-empty">Aucune donnée.</p>';
    return `<table class="admin-table">
      <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  }
  function formatDetails(details) {
    if (details === null || details === undefined || details === "") return "—";
    if (typeof details === "string") {
      try { details = JSON.parse(details); } catch { return details; }
    }
    try { return JSON.stringify(details); } catch { return String(details); }
  }
  function plot(elId, traces, layout) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (typeof Plotly === "undefined") {
      el.innerHTML = '<p class="admin-muted admin-empty">Graphiques indisponibles.</p>';
      return;
    }
    const base = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#93a4c3", size: 12 },
      margin: { l: 44, r: 16, t: 10, b: 34 },
      xaxis: { gridcolor: "rgba(255,255,255,.06)", zerolinecolor: "rgba(255,255,255,.12)" },
      yaxis: { gridcolor: "rgba(255,255,255,.06)", zerolinecolor: "rgba(255,255,255,.12)" },
      showlegend: true,
      legend: { orientation: "h", y: -0.2, font: { size: 11 } },
    };
    Plotly.newPlot(el, traces, Object.assign(base, layout || {}), { responsive: true, displayModeBar: false });
  }

  /* ---------- Vue d'ensemble ---------- */

  async function loadStats() {
    const kpis = document.getElementById("ovKpis");
    kpis.innerHTML = loadingBlock();
    try {
      const d = await api("api/admin/stats.php");
      const k = d.kpis;
      kpis.innerHTML =
        kpi(k.users_total, "Utilisateurs", "fa-users") +
        kpi(k.users_active, "Comptes actifs", "fa-user-check", "ok") +
        kpi(k.incidents_open, "Incidents ouverts", "fa-triangle-exclamation", "warn") +
        kpi(k.alerts_enabled + " / " + k.alerts_total, "Alertes actives", "fa-bell") +
        kpi(k.rules_active + " / " + k.rules_total, "Règles actives", "fa-scale-balanced") +
        kpi(k.countries, "Pays", "fa-globe");

      const s = d.series;
      plot("chartLogins", [
        { x: s.days, y: s.logins_ok, type: "scatter", mode: "lines", name: "Réussies", line: { color: "#3fb950" } },
        { x: s.days, y: s.logins_fail, type: "scatter", mode: "lines", name: "Échouées", line: { color: "#e5534b" } },
      ]);
      plot("chartAudit", [{ x: s.days, y: s.audit, type: "bar", name: "Actions", marker: { color: "#2f81f7" } }], { showlegend: false });
      plot("chartIncidents", [{ x: s.days, y: s.incidents, type: "bar", name: "Incidents", marker: { color: "#e3a008" } }], { showlegend: false });
      plot("chartRoles", [{
        labels: d.users_by_role.map(r => r.role),
        values: d.users_by_role.map(r => r.count),
        type: "pie", hole: 0.5, textinfo: "label+value",
        marker: { colors: ["#2f81f7", "#3fb950", "#e3a008", "#e5534b", "#a371f7"] },
      }], { showlegend: false });
      plot("chartIncCountry", [{
        x: d.incidents_by_country.map(i => i.country),
        y: d.incidents_by_country.map(i => i.count),
        type: "bar", marker: { color: "#2f81f7" },
      }], { showlegend: false });

      document.getElementById("ovTopSites").innerHTML =
        miniTable(["Site", "Pays", "Incidents"], d.top_open_sites.map(r => [r.site, r.country, r.count]));
      document.getElementById("ovTopActions").innerHTML =
        miniTable(["Action", "Nb"], d.top_actions.map(r => [r.action, r.count]));

      loadHealth();
    } catch (e) {
      kpis.innerHTML = errorBlock(e.message);
    }
  }

  async function loadHealth() {
    const el = document.getElementById("healthBody");
    if (!el) return;
    el.innerHTML = loadingBlock();
    try {
      const d = await api("api/health.php");
      const h = d.health;
      const rows = h.databases.map(db => `<tr>
        <td>${escapeHtml(db.label)}</td>
        <td>${db.ok ? '<span class="admin-pill admin-pill--ok">OK</span>' : '<span class="admin-pill admin-pill--danger">Erreur</span>'}</td>
        <td class="admin-muted">${db.latency_ms != null ? escapeHtml(db.latency_ms) + " ms" : "—"}</td>
        <td class="admin-muted">${db.error ? escapeHtml(db.error) : ""}</td>
      </tr>`).join("");
      el.innerHTML = `<table class="admin-table">
          <thead><tr><th>Cible</th><th>État</th><th>Latence</th><th>Détail</th></tr></thead>
          <tbody>${rows}</tbody></table>
        <p class="admin-muted" style="margin-top:10px">
          PHP ${escapeHtml(h.app.php_version)} · env ${escapeHtml(h.app.environment)} ·
          debug ${h.app.debug ? "activé" : "désactivé"} · mail ${escapeHtml(h.app.mail_driver)} ·
          statut global <strong>${escapeHtml(h.status)}</strong>
        </p>`;
    } catch (e) {
      el.innerHTML = errorBlock(e.message);
    }
  }

  /* ---------- Automatisations ---------- */

  async function loadAutomations() {
    const kpis = document.getElementById("autoKpis");
    kpis.innerHTML = loadingBlock();
    try {
      const d = await api("api/admin/automations.php");
      const s = d.summary;
      kpis.innerHTML =
        kpi(s.settings_total, "Configurations", "fa-sliders") +
        kpi(s.settings_enabled, "Configurations actives", "fa-toggle-on", "ok") +
        kpi(s.rules_total, "Règles fines", "fa-scale-balanced") +
        kpi(s.rules_active, "Règles actives", "fa-circle-check", "ok");

      document.getElementById("autoSettingsCount").textContent = `${d.settings.length} ligne(s)`;
      document.getElementById("autoRulesCount").textContent = `${d.rules.length} ligne(s)`;

      document.getElementById("autoSettingsBody").innerHTML = d.settings.map(a => `<tr>
        <td><div class="admin-user"><strong>${escapeHtml(a.user_name || "—")}</strong><span>${escapeHtml(a.user_email || "")}</span></div></td>
        <td><span class="admin-tag">${escapeHtml(a.country)}</span></td>
        <td>${escapeHtml(a.email)}</td>
        <td>${escapeHtml(a.frequency)}</td>
        <td>${escapeHtml(a.threshold)} %</td>
        <td>${escapeHtml(a.sites_count)}</td>
        <td>${a.enabled ? '<span class="admin-pill admin-pill--ok">Activée</span>' : '<span class="admin-pill">Désactivée</span>'}</td>
        <td class="admin-muted">${a.last_run_at ? escapeHtml(a.last_run_at) : "—"}</td>
        <td class="admin-muted">${a.last_triggered_at ? escapeHtml(a.last_triggered_at) : "—"}</td>
      </tr>`).join("") || emptyRow(9);

      document.getElementById("autoRulesBody").innerHTML = d.rules.map(r => `<tr>
        <td>${escapeHtml(r.user_name || "—")}</td>
        <td><span class="admin-tag">${escapeHtml(r.country)}</span></td>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.site ? escapeHtml(r.site) : "—"}</td>
        <td>${escapeHtml(r.metric)} ${escapeHtml(r.operator)} ${escapeHtml(r.threshold)}</td>
        <td>${escapeHtml(r.channels)}</td>
        <td>${r.active ? '<span class="admin-pill admin-pill--ok">Active</span>' : '<span class="admin-pill">Inactive</span>'}</td>
        <td class="admin-muted">${r.last_triggered_at ? escapeHtml(r.last_triggered_at) : "—"}</td>
      </tr>`).join("") || emptyRow(8);
    } catch (e) {
      kpis.innerHTML = errorBlock(e.message);
    }
  }

  /* ---------- Journaux ---------- */

  async function loadLogs(page) {
    LOG_PAGE = Math.max(1, page || 1);
    const body = document.getElementById("logsBody");
    body.innerHTML = emptyRow(6, "Chargement...");

    const params = new URLSearchParams();
    const action = document.getElementById("logAction").value;
    const from = document.getElementById("logFrom").value;
    const to = document.getElementById("logTo").value;
    const q = document.getElementById("logQ").value.trim();
    if (action) params.set("action", action);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q) params.set("q", q);
    params.set("page", String(LOG_PAGE));
    params.set("per_page", "25");

    try {
      const d = await api("api/admin/logs.php?" + params.toString());

      const sel = document.getElementById("logAction");
      if (sel.options.length <= 1 && d.actions) {
        d.actions.forEach(a => {
          const o = document.createElement("option");
          o.value = a;
          o.textContent = a;
          sel.appendChild(o);
        });
        sel.value = action;
      }

      document.getElementById("logsCount").textContent = `${d.total} entrée(s)`;
      LOG_ROWS = d.rows || [];
      LOG_ACTIONS = d.actions || [];
      body.innerHTML = d.rows.map(r => `<tr>
        <td class="admin-muted">${escapeHtml(r.created_at)}</td>
        <td>${r.user_name
          ? `<div class="admin-user"><strong>${escapeHtml(r.user_name)}</strong><span>${escapeHtml(r.user_email)}</span></div>`
          : '<span class="admin-muted">système</span>'}</td>
        <td><span class="admin-tag">${escapeHtml(r.action)}</span></td>
        <td>${r.entity ? escapeHtml(r.entity) + (r.entity_id ? " #" + escapeHtml(r.entity_id) : "") : "—"}</td>
        <td class="admin-muted">${escapeHtml(r.ip || "—")}</td>
        <td class="admin-muted admin-details" title="${escapeHtml(formatDetails(r.details))}">${escapeHtml(formatDetails(r.details))}</td>
      </tr>`).join("") || emptyRow(6);

      document.getElementById("logsPageInfo").textContent = `Page ${d.page} / ${Math.max(1, d.pages)}`;
      document.getElementById("logsPrev").disabled = d.page <= 1;
      document.getElementById("logsNext").disabled = d.page >= d.pages;
    } catch (e) {
      body.innerHTML = `<tr><td colspan="6" class="admin-message--error">${escapeHtml(e.message)}</td></tr>`;
    }
  }

  /* ---------- Export des journaux ---------- */

  function exportLogs(format) {
    if (!LOG_ROWS.length) {
      alert("Aucune donnée à exporter.");
      return;
    }
    const headers = ["Date", "Utilisateur", "Email", "Action", "Entité", "ID", "IP", "Détails"];
    const rows = LOG_ROWS.map(r => [
      r.created_at, r.user_name || "système", r.user_email || "", r.action,
      r.entity || "", r.entity_id || "", r.ip || "", formatDetails(r.details)
    ]);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

    if (format === "xlsx" && window.XLSX) {
      const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Journaux");
      XLSX.writeFile(wb, `journaux_${stamp}.xlsx`);
      return;
    }

    const csv = [headers].concat(rows)
      .map(r => r.map(c => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `journaux_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- Rôles ---------- */

  async function loadRoles() {
    const el = document.getElementById("rolesBody");
    el.innerHTML = loadingBlock();
    try {
      const d = await api("api/admin/roles.php");
      ROLES_DATA = d;
      el.innerHTML = d.roles.map(role => `
        <div class="admin-role-block" data-role="${escapeHtml(role.name)}">
          <div class="admin-role-block__head">
            <h3>${escapeHtml(role.name)}</h3>
            ${role.locked
              ? '<span class="admin-muted">Toutes les permissions (non modifiable)</span>'
              : '<button class="admin-btn admin-btn--sm admin-btn--primary js-role-save">Enregistrer</button>'}
          </div>
          <div class="admin-checks">
            ${d.catalog.map(p => `<label class="admin-check">
              <input type="checkbox" value="${escapeHtml(p)}" ${role.permissions.includes(p) ? "checked" : ""} ${role.locked ? "disabled" : ""}>
              <span>${escapeHtml(p)}</span>
            </label>`).join("")}
          </div>
        </div>`).join("");
    } catch (e) {
      el.innerHTML = errorBlock(e.message);
    }
  }

  async function saveRole(block) {
    const role = block.dataset.role;
    const permissions = Array.from(block.querySelectorAll("input[type=checkbox]:checked")).map(i => i.value);
    try {
      await api("api/admin/roles.php", { action: "set", role, permissions });
      loadRoles();
    } catch (e) {
      alert(e.message);
    }
  }

  /* ---------- Rapports ---------- */

  async function loadReports() {
    const el = document.getElementById("reportsBody");
    el.innerHTML = emptyRow(7, "Chargement...");
    try {
      const d = await api("api/admin/reports.php");
      REPORTS_DATA = d;

      const cSel = document.getElementById("rpCountry");
      cSel.innerHTML = d.countries
        .map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.code)} — ${escapeHtml(c.name)}</option>`).join("");
      const uSel = document.getElementById("rpUser");
      uSel.innerHTML = d.users
        .map(u => `<option value="${u.id}">${escapeHtml(u.full_name)} (${escapeHtml(u.email)})</option>`).join("");

      document.getElementById("reportsCount").textContent = `${d.schedules.length} planification(s)`;
      el.innerHTML = d.schedules.map(s => `<tr data-id="${s.id}">
        <td><span class="admin-tag">${escapeHtml(s.country_code)}</span></td>
        <td>${escapeHtml(s.user_name || "—")}</td>
        <td>${escapeHtml(s.frequency)}</td>
        <td class="admin-muted">${escapeHtml(s.recipients)}</td>
        <td>${s.enabled ? '<span class="admin-pill admin-pill--ok">Active</span>' : '<span class="admin-pill">Inactive</span>'}</td>
        <td class="admin-muted">${s.last_sent_at ? escapeHtml(s.last_sent_at) : "—"}</td>
        <td class="admin-actions">
          <button class="admin-btn admin-btn--sm js-rp-toggle">${s.enabled ? "Désactiver" : "Activer"}</button>
          <button class="admin-btn admin-btn--sm admin-btn--danger js-rp-delete">Supprimer</button>
        </td>
      </tr>`).join("") || emptyRow(7);
    } catch (e) {
      el.innerHTML = `<tr><td colspan="7" class="admin-message--error">${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function createReport(e) {
    e.preventDefault();
    try {
      await api("api/admin/reports.php", {
        action: "create",
        country: document.getElementById("rpCountry").value,
        user_id: Number(document.getElementById("rpUser").value),
        frequency: document.getElementById("rpFreq").value,
        recipients: document.getElementById("rpRecipients").value.trim()
      });
      document.getElementById("rpRecipients").value = "";
      await loadReports();
    } catch (err) {
      alert(err.message);
    }
  }

  function reportsClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = btn.closest("tr");
    if (!tr) return;
    const id = Number(tr.dataset.id);
    if (btn.classList.contains("js-rp-toggle")) {
      const sched = (REPORTS_DATA.schedules || []).find(s => s.id === id);
      api("api/admin/reports.php", { action: "toggle", id, enabled: !(sched && sched.enabled) })
        .then(loadReports).catch(err => alert(err.message));
    } else if (btn.classList.contains("js-rp-delete")) {
      if (!confirm("Supprimer cette planification ?")) return;
      api("api/admin/reports.php", { action: "delete", id })
        .then(loadReports).catch(err => alert(err.message));
    }
  }

  /* ---------- Sécurité ---------- */

  async function loadSecurity() {
    const kpis = document.getElementById("secKpis");
    kpis.innerHTML = loadingBlock();
    try {
      const d = await api("api/admin/sessions.php");
      const s = d.summary;
      kpis.innerHTML =
        kpi(s.last24_total, "Tentatives (24 h)", "fa-right-to-bracket") +
        kpi(s.last24_ok, "Réussies (24 h)", "fa-circle-check", "ok") +
        kpi(s.last24_fail, "Échouées (24 h)", "fa-circle-xmark", "warn") +
        kpi(s.last24_ips, "IP distinctes (24 h)", "fa-network-wired");

      plot("chartSec", [
        { x: d.series.days, y: d.series.logins_ok, type: "bar", name: "Réussies", marker: { color: "#3fb950" } },
        { x: d.series.days, y: d.series.logins_fail, type: "bar", name: "Échouées", marker: { color: "#e5534b" } },
      ], { barmode: "stack" });

      document.getElementById("secFailEmail").innerHTML =
        miniTable(["Email", "Échecs"], d.fail_by_email.map(r => [r.email, r.count]));
      document.getElementById("secFailIp").innerHTML =
        miniTable(["IP", "Échecs"], d.fail_by_ip.map(r => [r.ip, r.count]));

      document.getElementById("secRecentBody").innerHTML = d.recent.map(r => `<tr>
        <td class="admin-muted">${escapeHtml(r.attempted_at)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td class="admin-muted">${escapeHtml(r.ip)}</td>
        <td>${r.success ? '<span class="admin-pill admin-pill--ok">Réussie</span>' : '<span class="admin-pill admin-pill--danger">Échouée</span>'}</td>
      </tr>`).join("") || emptyRow(4);
    } catch (e) {
      kpis.innerHTML = errorBlock(e.message);
    }
  }

  /* ---------- Onglets ---------- */

  function switchTab(name) {
    document.querySelectorAll(".admin-tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
    document.querySelectorAll(".admin-tabpanel").forEach(p => p.classList.toggle("hidden", p.id !== "tab-" + name));

    if (!LOADED[name]) {
      LOADED[name] = true;
      if (name === "overview") loadStats();
      else if (name === "automations") loadAutomations();
      else if (name === "logs") loadLogs(1);
      else if (name === "security") loadSecurity();
      else if (name === "users") loadUsers();
      else if (name === "roles") loadRoles();
      else if (name === "reports") loadReports();
    }
    window.dispatchEvent(new Event("resize"));
  }

  /* ---------- Utilisateurs ---------- */

  function renderRoleSelect(id, selected) {
    const sel = document.getElementById(id);
    sel.innerHTML = META.roles.map(r =>
      `<option value="${r}" ${r === selected ? "selected" : ""}>${r}</option>`).join("");
  }

  function renderCountryChecks(containerId, selected) {
    const cont = document.getElementById(containerId);
    cont.innerHTML = META.countries.map(c => {
      const enabled = c.enabled ? 1 : 0;
      const checked = selected.includes(c.code) ? "checked" : "";
      return `
        <label class="admin-check">
          <input type="checkbox" value="${c.code}" ${checked} ${enabled ? "" : "disabled"}>
          <span>${c.flag} ${c.name} (${c.code})</span>
        </label>`;
    }).join("");
  }

  function countriesOfUser(user) {
    return (user.countries || []).map(c => {
      const info = META.countries.find(x => x.code === c);
      return info ? `${info.flag} ${c}` : c;
    }).join(", ") || "—";
  }

  function renderTable() {
    const tbody = document.getElementById("usersTableBody");
    tbody.innerHTML = USERS.map(u => `
      <tr data-id="${u.id}">
        <td>
          <div class="admin-user">
            <strong>${escapeHtml(u.full_name)}</strong>
            <span>${escapeHtml(u.email)}</span>
          </div>
        </td>
        <td>
          <select class="admin-input admin-input--sm js-role" ${u.id === META.current_user_id ? "disabled" : ""}>
            ${META.roles.map(r => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}
          </select>
        </td>
        <td title="${escapeHtml(countriesOfUser(u))}">
          <span class="admin-taglist">${(u.countries || []).map(code => {
            const info = META.countries.find(x => x.code === code);
            return `<span class="admin-tag">${info ? info.flag : ""} ${code}</span>`;
          }).join(" ")}</span>
          <button class="admin-link js-countries" title="Modifier les pays"><i class="fa-solid fa-pen"></i> Pays</button>
        </td>
        <td class="admin-muted">${u.last_login ? escapeHtml(u.last_login) : "Jamais"}</td>
        <td>
          <div class="admin-actions">
            <button class="admin-btn admin-btn--sm js-active ${u.is_active ? "admin-btn--danger-soft" : "admin-btn--success-soft"}"
                    ${u.id === META.current_user_id ? "disabled" : ""}>
              ${u.is_active ? "Désactiver" : "Activer"}
            </button>
            <button class="admin-btn admin-btn--sm js-password">Mot de passe</button>
            <button class="admin-btn admin-btn--sm admin-btn--danger js-delete"
                    ${u.id === META.current_user_id ? "disabled" : ""}>Supprimer</button>
          </div>
        </td>
      </tr>`).join("");
  }

  async function loadUsers() {
    try {
      hideError();
      const data = await api("api/admin/users.php");
      META = data.meta;
      USERS = data.users;
      renderRoleSelect("nuRole", META.roles[0]);
      renderCountryChecks("nuCountries", META.countries.filter(c => c.enabled).map(c => c.code));
      renderTable();
      document.getElementById("usersCount").textContent = `${USERS.length} compte(s)`;
      usersLoading().classList.add("hidden");
    } catch (err) {
      usersLoading().classList.add("hidden");
      showError(err.message);
    }
  }

  async function createUser(e) {
    e.preventDefault();
    const email = document.getElementById("nuEmail").value.trim();
    const fullName = document.getElementById("nuName").value.trim();
    const password = document.getElementById("nuPassword").value;
    const role = document.getElementById("nuRole").value;
    const countries = Array.from(document.querySelectorAll("#nuCountries input:checked")).map(i => i.value);

    try {
      await api("api/admin/users.php", {
        action: "create", email, full_name: fullName, password, role, countries
      });
      document.getElementById("nuEmail").value = "";
      document.getElementById("nuName").value = "";
      document.getElementById("nuPassword").value = "";
      await loadUsers();
    } catch (err) {
      showError(err.message);
    }
  }

  function rowAction(e, fn) {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    const tr = btn.closest("tr");
    fn(tr, btn);
  }

  async function onRoleChange(tr) {
    const id = Number(tr.dataset.id);
    const role = tr.querySelector(".js-role").value;
    try {
      await api("api/admin/users.php", { action: "update", id, role });
      await loadUsers();
    } catch (err) { showError(err.message); }
  }

  async function onActive(tr, btn) {
    const id = Number(tr.dataset.id);
    const is_active = btn.textContent.trim() === "Activer";
    if (!is_active && !confirm("Désactiver ce compte ? Il ne pourra plus se connecter.")) return;
    try {
      await api("api/admin/users.php", { action: "update", id, is_active });
      await loadUsers();
    } catch (err) { showError(err.message); }
  }

  async function onPassword(tr) {
    const id = Number(tr.dataset.id);
    const pw = prompt("Nouveau mot de passe (8 caractères minimum) :");
    if (!pw) return;
    try {
      await api("api/admin/users.php", { action: "password", id, password: pw });
      await loadUsers();
    } catch (err) { showError(err.message); }
  }

  async function onCountries(tr) {
    const id = Number(tr.dataset.id);
    const user = USERS.find(u => u.id === id);
    if (!user) return;

    const hint = META.countries.map(c => `${c.code}`).join(", ");
    const value = prompt(`Pays accessibles (codes séparés par des virgules).\nDisponibles : ${hint}`);
    if (value === null) return;

    const countries = value.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    const valid = META.countries.map(c => c.code);
    if (!countries.every(c => valid.includes(c))) {
      showError("Un ou plusieurs codes pays invalides.");
      return;
    }

    try {
      await api("api/admin/users.php", { action: "update", id, countries });
      await loadUsers();
    } catch (err) { showError(err.message); }
  }

  async function onDelete(tr) {
    const id = Number(tr.dataset.id);
    const user = USERS.find(u => u.id === id);
    if (!confirm(`Supprimer définitivement ${user ? user.email : id} ?`)) return;
    try {
      await api("api/admin/users.php", { action: "delete", id });
      await loadUsers();
    } catch (err) { showError(err.message); }
  }

  function rowActionChange(e) {
    const tr = e.target.closest("tr");
    if (tr) onRoleChange(tr);
  }

  /* ---------- Init ---------- */

  function init() {
    PL.requireAuth().then(() => {
      adminUserLabel().textContent = PL.session
        ? `${PL.session.full_name} — ${PL.session.role}`
        : "";

      if (!PL.superAdmin()) {
        panel().classList.add("hidden");
        forbidden().classList.remove("hidden");
        return;
      }

      panel().classList.remove("hidden");
      forbidden().classList.add("hidden");

      document.querySelectorAll(".admin-tab").forEach(btn => {
        btn.addEventListener("click", () => switchTab(btn.dataset.tab));
      });

      document.getElementById("createUserForm").addEventListener("submit", createUser);

      document.getElementById("usersTableBody").addEventListener("change", (e) => {
        if (e.target.classList.contains("js-role")) rowActionChange(e);
      });
      document.getElementById("usersTableBody").addEventListener("click", (e) => {
        rowAction(e, (tr, btn) => {
          if (btn.classList.contains("js-active")) onActive(tr, btn);
          else if (btn.classList.contains("js-password")) onPassword(tr);
          else if (btn.classList.contains("js-countries")) onCountries(tr);
          else if (btn.classList.contains("js-delete")) onDelete(tr);
        });
      });

      document.getElementById("logFilters").addEventListener("submit", (e) => {
        e.preventDefault();
        loadLogs(1);
      });
      document.getElementById("logsPrev").addEventListener("click", () => loadLogs(LOG_PAGE - 1));
      document.getElementById("logsNext").addEventListener("click", () => loadLogs(LOG_PAGE + 1));

      document.getElementById("logsExportBtn").addEventListener("click", () => exportLogs("csv"));
      document.getElementById("logsExcelBtn").addEventListener("click", () => exportLogs("xlsx"));

      const rolesBody = document.getElementById("rolesBody");
      if (rolesBody) {
        rolesBody.addEventListener("click", (e) => {
          const btn = e.target.closest(".js-role-save");
          if (btn) saveRole(btn.closest(".admin-role-block"));
        });
      }

      const reportForm = document.getElementById("createReportForm");
      if (reportForm) reportForm.addEventListener("submit", createReport);
      const reportsBody = document.getElementById("reportsBody");
      if (reportsBody) reportsBody.addEventListener("click", reportsClick);

      document.getElementById("backToMenuBtn").addEventListener("click", () => {
        window.location.href = "menu.html";
      });
      document.getElementById("adminLogoutBtn").addEventListener("click", () => PL.logout());

      switchTab("overview");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
