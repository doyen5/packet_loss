<?php
declare(strict_types=1);

/**
 * Statistiques de la console d'administration (vue d'ensemble + tendances).
 *
 * GET api/admin/stats.php
 *
 * Renvoie des KPIs (utilisateurs, pays, incidents, automatisations) et des
 * séries temporelles (connexions, activité d'audit, incidents) sur 30 jours,
 * destinées aux graphiques Plotly côté client.
 *
 * Réservé à la permission users.manage.
 */

use Npm\Auth;
use Npm\Database;
use Npm\Http\Json;
use Npm\Rbac;

require __DIR__ . '/../bootstrap.php';

Auth::requireLogin();
Rbac::require(Auth::role(), 'users.manage');
Json::requireMethod('GET');

$pdo = Database::core();

/* ---------------- Utilisateurs ---------------- */
$usersTotal  = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
$usersActive = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE is_active = 1')->fetchColumn();

$usersByRole = [];
foreach ($pdo->query(
    'SELECT r.name, COUNT(u.id) AS c
     FROM roles r LEFT JOIN users u ON u.role_id = r.id
     GROUP BY r.id ORDER BY r.id'
) as $row) {
    $usersByRole[] = ['role' => (string) $row['name'], 'count' => (int) $row['c']];
}

/* ---------------- Pays ---------------- */
$usersByCountry = [];
foreach ($pdo->query(
    'SELECT c.code, c.name, c.flag, c.enabled, COUNT(uc.user_id) AS c
     FROM countries c LEFT JOIN user_countries uc ON uc.country_code = c.code
     GROUP BY c.code ORDER BY c.code'
) as $row) {
    $usersByCountry[] = [
        'code'    => (string) $row['code'],
        'name'    => (string) $row['name'],
        'flag'    => (string) ($row['flag'] ?? ''),
        'enabled' => (bool) (int) $row['enabled'],
        'count'   => (int) $row['c'],
    ];
}

/* ---------------- Incidents ---------------- */
$incidentsByStatus = ['open' => 0, 'acknowledged' => 0, 'resolved' => 0];
foreach ($pdo->query('SELECT status, COUNT(*) AS c FROM incidents GROUP BY status') as $row) {
    $incidentsByStatus[(string) $row['status']] = (int) $row['c'];
}

$incidentsByCountry = [];
foreach ($pdo->query(
    'SELECT country_code, COUNT(*) AS c FROM incidents GROUP BY country_code ORDER BY c DESC'
) as $row) {
    $incidentsByCountry[] = ['country' => (string) $row['country_code'], 'count' => (int) $row['c']];
}

/* Sites les plus impactés (incidents ouverts). */
$topOpenSites = [];
foreach ($pdo->query(
    "SELECT site, country_code, COUNT(*) AS c
     FROM incidents WHERE status = 'open'
     GROUP BY site, country_code ORDER BY c DESC LIMIT 10"
) as $row) {
    $topOpenSites[] = [
        'site'    => (string) $row['site'],
        'country' => (string) $row['country_code'],
        'count'   => (int) $row['c'],
    ];
}

/* ---------------- Automatisations ---------------- */
$alertsTotal   = (int) $pdo->query('SELECT COUNT(*) FROM alert_settings')->fetchColumn();
$alertsEnabled = (int) $pdo->query('SELECT COUNT(*) FROM alert_settings WHERE enabled = 1')->fetchColumn();
$rulesTotal    = (int) $pdo->query('SELECT COUNT(*) FROM alert_rules')->fetchColumn();
$rulesActive   = (int) $pdo->query('SELECT COUNT(*) FROM alert_rules WHERE active = 1')->fetchColumn();

/* ---------------- Séries 30 jours ---------------- */
$days = [];
for ($i = 29; $i >= 0; $i--) {
    $days[] = date('Y-m-d', strtotime("-{$i} day"));
}

$empty = array_fill_keys($days, 0);

/** Fusionne un résultat SQL {jour => valeur} dans une série alignée sur 30 jours. */
$fill = static function (array $byDay) use ($days): array {
    $out = [];
    foreach ($days as $d) {
        $out[] = (int) ($byDay[$d] ?? 0);
    }
    return $out;
};

/* Connexions réussies / échouées par jour. */
$okByDay = $empty;
$failByDay = $empty;
foreach ($pdo->query(
    'SELECT DATE(attempted_at) AS d, success, COUNT(*) AS c
     FROM login_attempts
     WHERE attempted_at >= (CURDATE() - INTERVAL 29 DAY)
     GROUP BY DATE(attempted_at), success'
) as $row) {
    $d = (string) $row['d'];
    if ((int) $row['success'] === 1) {
        $okByDay[$d] = (int) $row['c'];
    } else {
        $failByDay[$d] = (int) $row['c'];
    }
}

/* Activité d'audit par jour. */
$auditByDay = $empty;
foreach ($pdo->query(
    'SELECT DATE(created_at) AS d, COUNT(*) AS c
     FROM audit_log
     WHERE created_at >= (CURDATE() - INTERVAL 29 DAY)
     GROUP BY DATE(created_at)'
) as $row) {
    $auditByDay[(string) $row['d']] = (int) $row['c'];
}

/* Incidents démarrés par jour. */
$incidentByDay = $empty;
foreach ($pdo->query(
    'SELECT DATE(started_at) AS d, COUNT(*) AS c
     FROM incidents
     WHERE started_at >= (CURDATE() - INTERVAL 29 DAY)
     GROUP BY DATE(started_at)'
) as $row) {
    $incidentByDay[(string) $row['d']] = (int) $row['c'];
}

/* Top actions d'audit. */
$topActions = [];
foreach ($pdo->query(
    'SELECT action, COUNT(*) AS c FROM audit_log GROUP BY action ORDER BY c DESC LIMIT 8'
) as $row) {
    $topActions[] = ['action' => (string) $row['action'], 'count' => (int) $row['c']];
}

Json::ok([
    'kpis' => [
        'users_total'      => $usersTotal,
        'users_active'     => $usersActive,
        'users_inactive'   => $usersTotal - $usersActive,
        'incidents_open'        => $incidentsByStatus['open'] ?? 0,
        'incidents_acknowledged' => $incidentsByStatus['acknowledged'] ?? 0,
        'incidents_resolved'     => $incidentsByStatus['resolved'] ?? 0,
        'alerts_total'     => $alertsTotal,
        'alerts_enabled'   => $alertsEnabled,
        'rules_total'      => $rulesTotal,
        'rules_active'     => $rulesActive,
        'countries'        => count($usersByCountry),
    ],
    'users_by_role'      => $usersByRole,
    'users_by_country'   => $usersByCountry,
    'incidents_by_status' => $incidentsByStatus,
    'incidents_by_country' => $incidentsByCountry,
    'top_open_sites'     => $topOpenSites,
    'top_actions'        => $topActions,
    'series' => [
        'days'          => $days,
        'logins_ok'     => $fill($okByDay),
        'logins_fail'   => $fill($failByDay),
        'audit'         => $fill($auditByDay),
        'incidents'     => $fill($incidentByDay),
    ],
]);
