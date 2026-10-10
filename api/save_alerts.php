<?php
/**
 * API — Configuration des alertes email (une par utilisateur et par pays).
 *
 * GET  /api/save_alerts.php?country=CI    → retourne la configuration courante
 * POST /api/save_alerts.php               → enregistre la configuration
 *
 * Remplaçait auparavant data/alert_rules.json ; la configuration est
 * désormais stockée dans npm_core.alert_settings.
 */
declare(strict_types=1);

use Npm\Audit;
use Npm\Auth;
use Npm\Config;
use Npm\Database;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Rbac;

require_once __DIR__ . '/bootstrap.php';

Auth::requireLogin();
Rbac::require(Auth::role(), 'packet_loss.view');

$userId = (int) Auth::id();
$method = Json::method();

$input = $method === 'POST' ? Json::input() : [];
$countryRaw = $method === 'POST'
    ? ($input['country'] ?? '')
    : ($_GET['country'] ?? '');

$countryCode = strtoupper(trim((string) $countryRaw));
$country = Config::get('countries.' . $countryCode);
if (!is_array($country) || empty($country['enabled'])) {
    Json::error('Pays inconnu ou désactivé.', 400);
}

$user = Auth::user() ?? [];
$allowed = array_map('strval', $user['countries'] ?? []);
if (!Auth::superAdmin() && !in_array($countryCode, $allowed, true)) {
    Json::error('Accès refusé : pays non autorisé pour votre compte.', 403);
}

$pdo = Database::core();

/* ----- GET : retourne la configuration ----- */
if ($method === 'GET') {
    $stmt = $pdo->prepare(
        'SELECT email, min_hours, frequency, sites, enabled, updated_at
         FROM alert_settings WHERE user_id = ? AND country_code = ?'
    );
    $stmt->execute([$userId, $countryCode]);
    $row = $stmt->fetch();

    $rules = [
        'email'      => (string) ($row['email'] ?? ''),
        'min_hours'  => (int) ($row['min_hours'] ?? 3),
        'frequency'  => (string) ($row['frequency'] ?? 'hourly'),
        'sites'      => $row ? (json_decode((string) ($row['sites'] ?? '[]'), true) ?: []) : [],
        'enabled'    => $row ? (bool) $row['enabled'] : false,
        'updated_at' => $row['updated_at'] ?? null,
    ];

    Json::ok(['country' => $countryCode, 'rules' => $rules]);
}

/* ----- POST : enregistre ----- */
if ($method !== 'POST') {
    Json::error('Méthode non autorisée.', 405);
}

Csrf::requireValid();

$email = filter_var(trim((string) ($input['email'] ?? '')), FILTER_VALIDATE_EMAIL);
if (!$email) {
    Json::error('Email invalide.', 400);
}

$minHours  = max(1, min(72, (int) ($input['min_hours'] ?? 3)));
$frequency = in_array($input['frequency'] ?? '', ['hourly', 'daily', 'weekly'], true)
    ? (string) $input['frequency']
    : 'hourly';

$sites = [];
foreach ((array) ($input['sites'] ?? []) as $s) {
    if (!is_scalar($s)) {
        continue;
    }
    $site = strtoupper(trim((string) $s));
    if ($site !== '') {
        $sites[] = $site;
    }
}
$sites = array_values(array_unique($sites));

$stmt = $pdo->prepare(
    'INSERT INTO alert_settings (user_id, country_code, email, min_hours, frequency, sites, threshold, enabled)
     VALUES (?, ?, ?, ?, ?, ?, 0.1000, 1)
     ON DUPLICATE KEY UPDATE
        email = VALUES(email),
        min_hours = VALUES(min_hours),
        frequency = VALUES(frequency),
        sites = VALUES(sites),
        enabled = 1'
);
$stmt->execute([
    $userId,
    $countryCode,
    (string) $email,
    $minHours,
    $frequency,
    json_encode($sites, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
]);

Audit::log($userId, 'alert_settings.save', 'alert_settings', $countryCode, [
    'email'     => $email,
    'min_hours' => $minHours,
    'frequency' => $frequency,
    'sites'     => $sites,
]);

Json::ok([
    'country' => $countryCode,
    'rules'   => [
        'email'      => (string) $email,
        'min_hours'  => $minHours,
        'frequency'  => $frequency,
        'sites'      => $sites,
        'enabled'    => true,
        'updated_at' => date('c'),
    ],
]);
