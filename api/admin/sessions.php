<?php
declare(strict_types=1);

/**
 * Sécurité des connexions (console d'administration).
 *
 * GET api/admin/sessions.php
 *
 * Il n'existe pas de table de sessions persistée (les sessions sont gérées par
 * PHP). Cette vue s'appuie sur login_attempts : tentatives récentes, taux
 * d'échec sur 24 h, principaux emails/IP en échec et série journalière.
 *
 * Réservé à la permission audit.view.
 */

use Npm\Auth;
use Npm\Database;
use Npm\Http\Json;
use Npm\Rbac;

require __DIR__ . '/../bootstrap.php';

Auth::requireLogin();
Rbac::require(Auth::role(), 'audit.view');
Json::requireMethod('GET');

$pdo = Database::core();

/* ---------------- Totaux 24 h ---------------- */
$since = date('Y-m-d H:i:s', strtotime('-24 hours'));

$stmt = $pdo->prepare(
    'SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS ok,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS fail,
        COUNT(DISTINCT ip) AS ips
     FROM login_attempts WHERE attempted_at >= ?'
);
$stmt->execute([$since]);
$day = $stmt->fetch() ?: ['total' => 0, 'ok' => 0, 'fail' => 0, 'ips' => 0];

/* ---------------- Principaux échecs par email ---------------- */
$failEmails = [];
foreach ($pdo->query(
    'SELECT email, COUNT(*) AS c FROM login_attempts
     WHERE success = 0 AND attempted_at >= (NOW() - INTERVAL 30 DAY)
     GROUP BY email ORDER BY c DESC LIMIT 10'
) as $row) {
    $failEmails[] = ['email' => (string) $row['email'], 'count' => (int) $row['c']];
}

/* ---------------- Principales IP en échec ---------------- */
$failIps = [];
foreach ($pdo->query(
    'SELECT ip, COUNT(*) AS c FROM login_attempts
     WHERE success = 0 AND attempted_at >= (NOW() - INTERVAL 30 DAY)
     GROUP BY ip ORDER BY c DESC LIMIT 10'
) as $row) {
    $failIps[] = ['ip' => (string) $row['ip'], 'count' => (int) $row['c']];
}

/* ---------------- Série 14 jours ---------------- */
$days = [];
for ($i = 13; $i >= 0; $i--) {
    $days[] = date('Y-m-d', strtotime("-{$i} day"));
}
$okByDay   = array_fill_keys($days, 0);
$failByDay = array_fill_keys($days, 0);

foreach ($pdo->query(
    'SELECT DATE(attempted_at) AS d, success, COUNT(*) AS c
     FROM login_attempts
     WHERE attempted_at >= (CURDATE() - INTERVAL 13 DAY)
     GROUP BY DATE(attempted_at), success'
) as $row) {
    $d = (string) $row['d'];
    if ((int) $row['success'] === 1) {
        $okByDay[$d] = (int) $row['c'];
    } else {
        $failByDay[$d] = (int) $row['c'];
    }
}

/* ---------------- Tentatives récentes ---------------- */
$recent = [];
foreach ($pdo->query(
    'SELECT email, ip, success, attempted_at
     FROM login_attempts ORDER BY attempted_at DESC LIMIT 50'
) as $row) {
    $recent[] = [
        'email'        => (string) $row['email'],
        'ip'           => (string) $row['ip'],
        'success'      => (bool) (int) $row['success'],
        'attempted_at' => (string) $row['attempted_at'],
    ];
}

Json::ok([
    'summary' => [
        'last24_total'    => (int) $day['total'],
        'last24_ok'       => (int) $day['ok'],
        'last24_fail'     => (int) $day['fail'],
        'last24_ips'      => (int) $day['ips'],
    ],
    'fail_by_email' => $failEmails,
    'fail_by_ip'    => $failIps,
    'recent'        => $recent,
    'series' => [
        'days'      => $days,
        'logins_ok' => array_values($okByDay),
        'logins_fail' => array_values($failByDay),
    ],
]);
