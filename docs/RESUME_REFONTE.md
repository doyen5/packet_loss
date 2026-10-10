# Refonte PACKET_LOSS — Récapitulatif détaillé

> Document de suivi du chantier de refonte. Dernière mise à jour : chantier Lots 0→5 + intégration Togo.
> UI et commentaires en français (convention du projet).

---

## 1. Contexte & objectif

L'application **Packet Loss Intelligence** (dashboard de supervision réseau) était initialement une
application PHP + JS vanilla monolithique : pas d'authentification, pas de multi-pays, credentials de
base de données en clair, état stocké dans des fichiers JSON locaux, requêtes SQL dupliquées.

La refonte vise à :

- sécuriser l'accès (auth, rôles, sessions, CSRF, audit) ;
- rendre l'application **multi-pays** (CI, BJ, TG) avec routage serveur par pays ;
- déplacer l'état applicatif des fichiers JSON vers **MySQL** (base `npm_core`) ;
- conserver **à l'identique** la requête SQL métier Packet Loss (Ericsson + Huawei) ;
- ajouter une console d'administration ;
- purger les secrets de l'historique Git et retirer les fichiers morts.

Pas de build, pas de package manager, pas de tests automatisés : vérification par `php -l`,
`node --check` et appels HTTP réels. Repo servi par WAMP sur `http://localhost:8080/PACKET_LOSS/`.

---

## 2. Architecture cible

```
index.html (choix pays)  →  menu.html (choix module)  →  packet_loss.html (dashboard)
        │                          │
        └──────── api/countries.php ┘ (liste filtrée par compte)
                                   │
                    api/packet_loss.php (auth + RBAC + pays)
                                   │
                     src/PacketLossAnalyzer.php  ──  SQL métier (verbatim)
                                   │
                        src/Database.php (pool par pays)
```

- **Bootstrap** : `api/bootstrap.php` charge `config/*.php` + `src/` (autoload Composer-like).
- **Config** : `src/Config.php` (notation pointée), `src/Env.php` lit `.env` (gitignoré).
- **Connexions** : `src/Database.php` fournit un pool PDO par clé pays (`countries.CI`, etc.).
- **Auth/RBAC** : `src/Auth.php`, `src/Rbac.php`, `src/Audit.php`, `src/Repositories/UserRepository.php`.
- **HTTP** : `src/Http/Json.php` (réponses JSON normalisées), `src/Http/Csrf.php` (jeton CSRF).
- **Front** : `assets/js/{home,auth,guard,admin,dashboard}.js`.

---

## 3. Détail des lots

### Lot 0 — Fondations
- `.env` / `.env.example` + `src/Env.php` : credentials et secrets sortis du code.
- `api/bootstrap.php`, `src/Config.php`, `src/Database.php` (pool), `src/Logger.php`,
  `src/Validator.php`, `src/Http/Json.php`, `src/Http/Csrf.php`, `config/{app,database,auth}.php`.
- Conventions : `declare(strict_types=1)`, en-têtes JSON `application/json; charset=utf-8`.

### Lot 1 — Base applicative `npm_core`
- Base MySQL dédiée sur le serveur CI. Migrations :
  - `sql/migrations/0001_create_schema.sql` (users, roles, sessions, audit_log, incidents…),
  - `sql/migrations/0002_seed_reference.sql` (rôles, permissions, compte admin initial),
  - `sql/schema.sql` (schéma de référence).
- `src/Repositories/UserRepository.php` (accès users), `bin/migrate.php` (exécution des migrations).

### Lot 2 — Authentification, Rôles, Console admin
- `src/Auth.php` (login/logout/session), `src/Rbac.php` (`Rbac::require($role, 'permission')`),
  `src/Audit.php` (journalisation).
- Endpoints : `api/auth/{login,logout,me,register,verify,reset_password,change_password,session_check}.php`,
  `api/admin/users.php`, `api/countries.php`.
- Pages : `login.html`, `admin.html`. JS : `assets/js/{auth,guard,admin}.js` ; CSS `assets/css/{auth,admin}.css`.
- **RBAC** : rôles hiérarchiques ; `SUPER_ADMIN` a la permission `*` et bypass la restriction pays.

### Lot 3 — Alertes & incidents en MySQL + cron
- Migration `0003_alert_settings.sql` : table `alert_settings` (1 ligne par `user_id` + `country` :
  `email`, `min_hours`, `frequency`, `sites` JSON, `threshold`, `enabled`, `last_run_at`, `last_triggered_at`).
- `src/Mailer.php` : envoi e-mail ; en dev `MAIL_DRIVER=log` écrit dans `logs/mail.log`.
- `src/PacketLossAnalyzer.php` : **SQL métier Ericsson + Huawei déplacé verbatim** (seuls dates,
  sites et noms de tables/colonnes sont paramétrés). Réutilisé par l'API et le cron (zéro duplication).
- `api/packet_loss.php` : wrapper mince = auth + RBAC (`packet_loss.view`) + contrôle pays → analyzer.
- `api/save_alerts.php` : GET(`?country=`)/POST sur `alert_settings` (POST protégé CSRF), audit.
- `api/test_alerts.php` : test d'envoi (auth + CSRF + `Mailer`).
- `api/incidents.php` : DB-backed ; GET filtré aux pays autorisés ; POST `create|acknowledge|resolve`.
- `api/cron_alerts.php` : **CLI uniquement** (403 en HTTP), lit `alert_settings`, gère la fréquence
  (`last_run_at`), crée/actualise des incidents ouverts, envoie les mails.
- Nettoyage : suppression des anciens `data/alert_rules.json` et `data/saved_analyses.json`.

### Lot 4 — Multi-pays + console d'administration
- `config/countries.php` : descripteur par pays (code, nom, drapeau, modules, `packet_loss.*`,
  `connection` optionnel). `country` est validé côté serveur et restreint aux pays du compte.
- `src/Database.php` : `Database::country()` honore `countries.<CODE>.connection` (override de serveur).
- Console admin : `api/admin/{users,sessions,logs,stats,automations}.php`, `assets/js/admin.js`, `admin.html`.
- `assets/js/guard.js` : bascule les éléments `[data-admin-only]` après résolution de l'auth ;
  `menu.html` expose les boutons admin/déconnexion (câblés dans `home.js`).
- `home.js` charge la liste des pays **depuis `api/countries.php`** (plus de liste codée en dur).

### Lot 4 (suite) — Intégration du Togo
- Source sites : `Cell_site_input_Togo update 30 SEPT 2026.xlsx` (feuilles 2G/3G/4G/5G/Resume).
- Référentiel géo généré : `data/sites_location_TG.json` (**1622 clés** : 3G 798 + 4G 575 + 2G 248 + 5G 1 ;
  **709/709** codes `rbs` de la base couverts).
- Particularités Togo (base CI, table `packet_loss_3G_ericsson_togo`, **Ericsson 3G uniquement**) :
  - `config/countries.php` → `country TG` : `connection => 'countries.CI'` (les données Togo sont
    hébergées dans la base CI), `ericsson_table => 'packet_loss_3G_ericsson_togo'`,
    `huawei_raw_table => null`, `site_base_expr => 'full'`, `site_out_expr => 'full'`.
  - `src/PacketLossAnalyzer.php` : **branche Huawei conditionnelle** (omise si pas de table Huawei)
    et **expressions de site paramétrables** (whitelist) :
    - `site_base_expr` : `segment` (défaut, `substring_index(substring_index(rbs,'_',-2),'_',1)`) ou `full` (`rbs`),
    - `site_out_expr` : `right5` (défaut, `right(rbs,5)`) ou `full` (`rbs`).
    - Le Togo utilise `full`/`full` : le « Site » = nom brut de la station (ex. `UAGBETSIKO2`).
  - `assets/js/dashboard.js` : `loadLocations()` charge d'abord `data/sites_location_<PAYS>.json`
    puis retombe sur `data/sites_location.json` (référentiel CI historique).

### Lot 5 — Purge Git & fichiers morts
- **Secret** : le commit initial `4cc4c8e` contenait `api/database.php` avec `const DB_PASSWORD = 'performance';`.
- Purge via `git filter-branch --index-filter` (script `sanitize_db_php.sh`) remplaçant le mot de passe
  par `getenv('DB_PASSWORD')` dans **tout l'historique**, puis nettoyage des refs `refs/original`,
  expiration des reflogs et `git gc --prune=now`.
- **Force-push** effectué sur `origin/main` (GitHub `doyen5/packet_loss`) :
  `2c54000...6cd3cb9 forced update`. Vérification : `git ls-remote origin main` == `git rev-parse main`.
- **Fichiers morts (0 octet) supprimés** : `verify.html`, `change_password.html`,
  `api/sms/sender.php`, `api/sms/providers/{log,orange}.php`.
- **Note** : le mot de passe reste techniquement dans les objets orphelins côté GitHub tant que son GC
  n'est pas passé. **Le mot de passe doit être changé côté MySQL** (rotation) — recommandé même après purge.

---

## 4. Configuration pays (`config/countries.php`)

Clés d'un descripteur pays :

| Clé | Rôle |
|-----|------|
| `code`, `name`, `flag`, `image` | présentation |
| `enabled` | pays activé |
| `modules` | modules disponibles (ex. `['packet_loss']`) |
| `connection` | (optionnel) clé de connexion DB si différente du pays, ex. `countries.CI` |
| `packet_loss.available` | module packet loss actif |
| `packet_loss.ericsson_table` | table Ericsson |
| `packet_loss.huawei_raw_table` / `adjacent_table` / `adjacent_site_col` | branche Huawei (null si absente) |
| `packet_loss.site_base_expr` | `segment` (défaut) ou `full` |
| `packet_loss.site_out_expr` | `right5` (défaut) ou `full` |

---

## 5. Sécurité

- Credentials uniquement via `.env` (gitignoré) ; lecture par `src/Env.php`.
- Mots de passe utilisateurs hachés (`password_hash`).
- Sessions serveur (`SESSION_NAME=pl_session`), contrôle par `api/auth/session_check.php`.
- **CSRF** obligatoire sur tous les POST (`src/Http/Csrf.php`).
- **RBAC** centralisé (`src/Rbac.php`) + **audit** des actions sensibles (`src/Audit.php`).
- `api/cron_alerts.php` refusé en HTTP (CLI only).

---

## 6. Tests réalisés (manuels)

| Domaine | Vérification | Résultat |
|---------|--------------|----------|
| Syntaxe | `php -l` sur tous les fichiers PHP (45) | OK |
| Syntaxe JS | `node --check` sur tous les JS (12) | OK |
| Auth | login, session, logout, restriction pays | OK |
| Admin | création utilisateur, rôles, pays filtrés, 403 non-admin, CSRF | OK |
| Packet Loss CI | régression `AC002` (48 lignes, inchangée après refonte) | OK |
| Packet Loss TG | `UAGBETSIKO2/UABASSE/UTOTSV` → 2519 lignes, vendor Ericsson | OK |
| Alertes | `save_alerts` GET/POST, `test_alerts`, CSRF | OK |
| Incidents | create → acknowledge, filtrage pays | OK |
| Cron | CLI : gating fréquence, mail + incident ouverts ; HTTP : 403 | OK |
| Purge Git | pickaxe `performance` dans `*.php` → vide ; remote == local | OK |

---

## 7. Points ouverts / à faire

- **Rotation du mot de passe MySQL** `performance` (le secret a été exposé publiquement).
- Normalisation des codes sites **Bénin** (`right(rbs,5)` tronque les noms longs) — décision différée.
- Modules `kpis` / `capacity` encore en statut « soon » dans `home.js` (non implémentés).
- SMS : non implémenté (stubs vides supprimés au Lot 5).
- Le refactor est **présent dans le répertoire de travail mais non commité** (l'historique poussé
  contient uniquement la purge) ; à committer/pousser quand validé.

---

## 8. Fichiers clés

```
api/bootstrap.php                      Amorçage (config + autoload)
api/packet_loss.php                    API Packet Loss (auth+RBAC+pays → analyzer)
src/PacketLossAnalyzer.php             Requête SQL métier (Ericsson+Huawei) + paramétrage pays
src/Database.php                       Pool PDO + override de connexion par pays
src/Auth.php, src/Rbac.php, src/Audit.php      Auth / permissions / audit
src/Mailer.php, api/cron_alerts.php    Notifications et cron d'alertes
config/countries.php                   Descripteurs pays (CI, BJ, TG)
data/sites_location.json               Référentiel géo historique (CI)
data/sites_location_TG.json            Référentiel géo Togo (généré)
assets/js/dashboard.js                 UI/logique du dashboard (référentiel par pays)
sql/migrations/*.sql                   Schéma npm_core + alert_settings
```
