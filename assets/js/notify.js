/* ============================================================
   Cloche de notifications (partagée par toutes les pages)
   Injecte un bouton + panneau dans la barre d'actions.
   ============================================================ */
(function () {
  "use strict";

  const POLL_MS = 60000;
  let panelEl = null;
  let badgeEl = null;
  let open = false;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmt(v) {
    if (!v) return "";
    const d = new Date(String(v).replace(" ", "T"));
    return isNaN(d) ? String(v) : d.toLocaleString("fr-FR");
  }

  function actionsContainer() {
    return document.querySelector(".home-topbar__actions, .topbar__actions, .admin-topbar__inner");
  }

  function build() {
    const host = actionsContainer();
    if (!host) return false;

    const wrap = document.createElement("div");
    wrap.className = "notif-wrap";
    wrap.style.position = "relative";
    wrap.innerHTML = `
      <button id="notifBell" class="home-action topbar__action" title="Notifications"
              style="position:relative;background:none;border:none;cursor:pointer;font-size:16px;padding:8px">
        <i class="fa-solid fa-bell"></i>
        <span id="notifBadge" style="display:none;position:absolute;top:0;right:0;min-width:16px;height:16px;
              padding:0 4px;font-size:10px;line-height:16px;text-align:center;color:#fff;background:#f43f5e;border-radius:999px"></span>
      </button>
      <div id="notifPanel" style="display:none;position:absolute;right:0;top:calc(100% + 8px);width:340px;max-height:420px;
           overflow:auto;background:var(--c-surface,#fff);border:1px solid var(--c-border,#e5e7eb);border-radius:12px;
           box-shadow:0 10px 25px rgba(15,23,42,.15);z-index:5000;padding:8px"></div>`;
    host.appendChild(wrap);

    panelEl = wrap.querySelector("#notifPanel");
    badgeEl = wrap.querySelector("#notifBadge");

    wrap.querySelector("#notifBell").addEventListener("click", (e) => {
      e.stopPropagation();
      open = !open;
      panelEl.style.display = open ? "block" : "none";
      if (open) load();
    });
    document.addEventListener("click", (e) => {
      if (open && !wrap.contains(e.target)) {
        open = false;
        panelEl.style.display = "none";
      }
    });
    return true;
  }

  function renderBadge(count) {
    if (!badgeEl) return;
    if (count > 0) {
      badgeEl.textContent = count > 99 ? "99+" : String(count);
      badgeEl.style.display = "inline-block";
    } else {
      badgeEl.style.display = "none";
    }
  }

  async function load() {
    try {
      const res = await fetch("api/account/notifications.php", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success) return;
      renderBadge(data.unread || 0);
      if (!open || !panelEl) return;

      const items = data.notifications || [];
      if (!items.length) {
        panelEl.innerHTML = '<p style="padding:16px;color:var(--c-text-muted,#64748b);font-size:13px">Aucune notification.</p>';
        return;
      }
      panelEl.innerHTML = items.map((n) => `
        <div class="notif-item" data-id="${n.id}" style="padding:10px 12px;border-radius:8px;cursor:${n.link ? "pointer" : "default"};
             ${n.is_read ? "" : "background:rgba(79,70,229,.08);"}">
          <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;font-weight:600;color:var(--c-text,#0f172a)">
            <span>${esc(n.title)}</span><span style="color:var(--c-text-faint,#94a3b8);font-weight:400;white-space:nowrap">${esc(fmt(n.created_at))}</span>
          </div>
          <p style="margin:4px 0 0;font-size:12.5px;color:var(--c-text-muted,#64748b)">${esc(n.message || "")}</p>
        </div>`).join("");

      panelEl.querySelectorAll(".notif-item").forEach((el) => {
        el.addEventListener("click", async () => {
          const id = el.getAttribute("data-id");
          const item = items.find((x) => String(x.id) === id);
          try {
            await fetch("api/account/notifications.php", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json", "X-CSRF-Token": (window.PL && PL.csrf) || "" },
              body: JSON.stringify({ action: "read", id: Number(id) })
            });
          } catch (_) {}
          el.style.background = "transparent";
          if (item && item.link) window.location.href = item.link;
          else load();
        });
      });
    } catch (_) {}
  }

  function start() {
    if (!build()) return;
    load();
    setInterval(load, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
