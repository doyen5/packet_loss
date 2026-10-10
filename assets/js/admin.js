/* ============================================================
   Administration — console utilisateurs
   ============================================================ */
(function () {
  let META = null;
  let USERS = [];

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

  /* ---------- Rendu ---------- */

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

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /* ---------- Chargement ---------- */

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

  /* ---------- Création ---------- */

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

  /* ---------- Actions sur une ligne ---------- */

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

      document.getElementById("backToMenuBtn").addEventListener("click", () => {
        window.location.href = "menu.html";
      });
      document.getElementById("adminLogoutBtn").addEventListener("click", () => PL.logout());

      loadUsers();
    });
  }

  function rowActionChange(e) {
    const tr = e.target.closest("tr");
    if (tr) onRoleChange(tr);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();