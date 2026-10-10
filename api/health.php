<?php
declare(strict_types=1);

/**
 * Santé de la plateforme : GET api/health.php
 *
 * Vérifie la base applicative et la connectivité aux bases métier des pays
 * accessibles à l'utilisateur connecté, avec mesure de latence.
 * Ne renvoie jamais d'identifiants.
 */

use Npm\Auth;
use Npm\Config;
use Npm\Database;
use Npm\Http\Json;

require __DIR__ . '/bootstrap.php';

Auth::requireLogin();

function ping(\PDO $pdo): float
{
    $start = microtime(true);
    $pdo->query('SELECT 1')->fetchColumn();
    return round((microtime(true) - $start) * 1000, 1);
}

$report = [
    'app' => [
        'php_version' => PHP_VERSION,
        'environment' => (string) Config::get('app.env', 'local'),
        'debug'       => (bool) Config::get('app.debug', false),
        'mail_driver' => (string) Config::get('app.mail.driver', 'log'),
        'session'     => (string) Config::get('app.session.name', 'pl_session'),
        'time'        => date('Y-m-d H:i:s'),
    ],
    'databases' => [],
];

/* Base applicative centrale. */
$core = ['label' => 'npm_core (applicatif)', 'code' => 'core', 'ok' => false, 'latency_ms' => null, 'error' => null];
try {
    $core['latency_ms'] = ping(Database::core());
    $core['ok'] = true;
} catch (\Throwable $e) {
    $core['error'] = $e->getMessage();
}
$report['databases'][] = $core;

/* Bases métier par pays accessibles. */
$user = Auth::user() ?? [];
$allowed = array_map('strval', $user['countries'] ?? []);
$all = Config::get('countries', []);

$checkedKeys = [];
foreach ($allowed as $code) {
    $c = is_array($all[$code] ?? null) ? $all[$code] : null;
    if ($c === null || empty($c['enabled'])) {
        continue;
    }
    $key = (string) ($c['connection'] ?? ('countries.' . $code));
    $label = sprintf('%s — %s', (string) $c['name'], $key);
    if (isset($checkedKeys[$key])) {
        continue;
    }
    $checkedKeys[$key] = true;

    $entry = ['label' => $label, 'code' => $code, 'ok' => false, 'latency_ms' => null, 'error' => null];
    try {
        $entry['latency_ms'] = ping(Database::country($code));
        $entry['ok'] = true;
    } catch (\Throwable $e) {
        $entry['error'] = $e->getMessage();
    }
    $report['databases'][] = $entry;
}

$healthy = true;
foreach ($report['databases'] as $db) {
    if (!$db['ok']) {
        $healthy = false;
        break;
    }
}
$report['status'] = $healthy ? 'ok' : 'degraded';

Json::ok(['health' => $report]);
