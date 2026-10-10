<?php
declare(strict_types=1);

/**
 * Automatisations : état des alertes configurées (console d'administration).
 *
 * GET api/admin/automations.php
 *
 * Renvoie :
 *  - settings : une ligne par (utilisateur, pays) de alert_settings, avec la
 *               fréquence, le seuil, les sites surveillés et les dates
 *               d'exécution/déclenchement de l'alerteur ;
 *  - rules    : les règles fines (alert_rules) ;
 *  - summary  : compteurs et dernière activité.
 *
 * Réservé à la permission automations.manage.
 */

use Npm\Auth;
use Npm\Database;
use Npm\Http\Json;
use Npm\Rbac;

require __DIR__ . '/../bootstrap.php';

Auth::requireLogin();
Rbac::require(Auth::role(), 'automations.manage');
Json::requireMethod('GET');

$pdo = Database::core();

/* ---------------- alert_settings (configuration agrégée) ---------------- */
$settings = [];
foreach ($pdo->query(
    'SELECT a.*, u.full_name, u.email AS user_email
     FROM alert_settings a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.country_code, a.user_id'
) as $row) {
    $sites = $row['sites'] !== null ? json_decode((string) $row['sites'], true) : [];
    $sites = is_array($sites) ? array_values($sites) : [];
    $settings[] = [
        'id'                => (int) $row['id'],
        'user_id'           => (int) $row['user_id'],
        'user_name'         => (string) ($row['full_name'] ?? ''),
        'user_email'        => (string) ($row['user_email'] ?? ''),
        'country'           => (string) $row['country_code'],
        'email'             => (string) $row['email'],
        'min_hours'         => (int) $row['min_hours'],
        'frequency'         => (string) $row['frequency'],
        'sites'             => $sites,
        'sites_count'       => count($sites),
        'threshold'         => (float) $row['threshold'],
        'enabled'           => (bool) (int) $row['enabled'],
        'last_run_at'       => $row['last_run_at'],
        'last_triggered_at' => $row['last_triggered_at'],
        'updated_at'        => (string) $row['updated_at'],
    ];
}

/* ---------------- alert_rules (règles fines) ---------------- */
$rules = [];
foreach ($pdo->query(
    'SELECT r.*, u.full_name
     FROM alert_rules r
     LEFT JOIN users u ON u.id = r.user_id
     ORDER BY r.country_code, r.id'
) as $row) {
    $rules[] = [
        'id'                => (int) $row['id'],
        'user_id'           => $row['user_id'] !== null ? (int) $row['user_id'] : null,
        'user_name'         => (string) ($row['full_name'] ?? ''),
        'country'           => (string) $row['country_code'],
        'name'              => (string) $row['name'],
        'site'              => (string) ($row['site'] ?? ''),
        'metric'            => (string) $row['metric'],
        'operator'          => (string) $row['operator'],
        'threshold'         => (float) $row['threshold'],
        'channels'          => (string) $row['channels'],
        'active'            => (bool) (int) $row['active'],
        'last_triggered_at' => $row['last_triggered_at'],
    ];
}

/* ---------------- Synthèse ---------------- */
$dates = static function (array $items, string $key): ?string {
    $best = null;
    foreach ($items as $it) {
        $v = $it[$key] ?? null;
        if ($v !== null && ($best === null || $v > $best)) {
            $best = $v;
        }
    }
    return $best;
};

$enabledCount = count(array_filter($settings, static fn ($s) => $s['enabled']));
$activeRules  = count(array_filter($rules, static fn ($r) => $r['active']));

Json::ok([
    'settings' => $settings,
    'rules'    => $rules,
    'summary'  => [
        'settings_total'    => count($settings),
        'settings_enabled'  => $enabledCount,
        'rules_total'       => count($rules),
        'rules_active'      => $activeRules,
        'last_run_at'       => $dates($settings, 'last_run_at'),
        'last_triggered_at' => $dates($settings, 'last_triggered_at'),
    ],
]);
