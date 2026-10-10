# AGENTS.md

Packet Loss Intelligence — PHP + vanilla JS dashboard served by Apache/WAMP. No build step, no package manager, no test suite, no linter/CI.

## Run / verify
- Must be served over HTTP (WAMP). Repo root is the web root: `http://localhost:8080/PACKET_LOSS/` (this machine's WAMP Apache listens on **:8080**; port 80 is held by IIS). Do NOT open `index.html` via `file://` — API calls will fail.
- Config/secrets now live in `.env` (gitignored; see `.env.example`); app bootstrap is `api/bootstrap.php` + `src/`. DB credentials are no longer hardcoded.
- There is no automated verification. Test by loading pages in a browser; the only CLI check is PHP syntax: `php -l api/packet_loss.php` (PHP is at `C:\PHP\php.exe` or under `C:\wamp64\bin\php\*`).
- Backend expects MySQL reachable at `10.171.16.120` (db `prismis`) via PDO. Credentials come from `.env` (`DB_CI_*`), read through `Npm\Database::country('CI')`; `api/database.php`'s `getPDO()` is kept for compatibility.

## Navigation / architecture
- Flow: `index.html` (country picker) → `menu.html` (module picker) → `packet_loss.html` (dashboard). The country list is loaded at runtime from `api/countries.php` (filtered by the logged-in account) and rendered by `assets/js/home.js`; modules are catalogued in `MODULES_CATALOG` in the same file. Country is passed via `?country=XX` and persisted in `localStorage.pl_country`. Full refonte recap lives in `docs/RESUME_REFONTE.md`.
- `api/packet_loss.php` is the core data API (auth + RBAC wrapper). Its Ericsson+Huawei UNION query — the business reference — lives verbatim in `src/PacketLossAnalyzer.php` (shared with the alerts cron); parameterize dates/sites only, do not rewrite the SQL.
- `assets/js/dashboard.js` (~3400 lines, v23) is the entire dashboard UI/logic (Plotly charts, Leaflet map, saved analyses in localStorage, alerts modal). Frontend-only state; no framework.
- Geo/site data lives in `data/`: `sites_location.json` is the coordinate referential (priority 3G > 4G > 2G > RECAP); `lien_*.geojson` are network links. All are fetched client-side.
- Alert/infra state lives in MySQL (`npm_core`): `api/save_alerts.php` → `alert_settings` (one row per user+country), `api/incidents.php` → `incidents`. `api/cron_alerts.php` is a **CLI-only** cron that reads `alert_settings` (via `src/PacketLossAnalyzer.php`) and emails alerts (`src/Mailer.php`; `MAIL_DRIVER=log` writes `logs/mail.log`).

## Important gotchas
- `country` now drives server-side routing in `api/packet_loss.php`: validated against `config/countries.php` and restricted to the countries assigned to the logged-in account (SUPER_ADMIN bypasses). Each country points at different table/column names.
- Fixed: `dashboard.js` `ALERTS_TEST_URL` points to `api/test_alerts.php` (the real file).
- Threshold is fixed at 0.1% (`DEFAULT_THRESHOLD` in dashboard.js and in `packet_loss.php`).
- Auth/admin/multi-country are now implemented: `src/Auth.php`, `src/Rbac.php`, `src/Repositories/UserRepository.php`, `api/auth/*` (incl. `change_password.php`), `api/admin/*`, `api/countries.php`, `login.html`, `admin.html`, `assets/js/{auth,guard,admin,home}.js`. SMS is still NOT implemented; its empty stubs (`api/sms/*`, `verify.html`, `change_password.html`) were removed in Lot 5 as dead files.
- Togo (`TG`) reads its Packet Loss data from the CI database (`connection => 'countries.CI'` in `config/countries.php`), Ericsson 3G only (`packet_loss_3G_ericsson_togo`), with a dedicated geo referential `data/sites_location_TG.json`. `src/PacketLossAnalyzer.php` omits the Huawei branch when `huawei_raw_table` is null and supports parameterized site expressions (`site_base_expr`/`site_out_expr`).
- `.gitignore` exists. Never commit `.env`; DB state now lives in MySQL `npm_core` and generated logs in `logs/` are ignored.
- README is partly stale: it says libraries load from CDN, but Plotly/SheetJS/Leaflet are bundled locally in `assets/js/`.

## Conventions
- UI text and comments are in French; keep new user-facing strings French.
- No comments unless asked; use `declare(strict_types=1)` and `header('Content-Type: application/json; charset=utf-8')` for new API endpoints (match existing PHP files).
