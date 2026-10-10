<?php
declare(strict_types=1);

/**
 * Journaux d'audit (console d'administration).
 *
 * GET api/admin/logs.php
 *   ?action=...   filtre sur le code d'action (ex. users.create)
 *   ?user_id=...  filtre sur l'utilisateur
 *   ?from=YYYY-MM-DD &to=YYYY-MM-DD  filtre sur la plage de dates
 *   ?q=...        recherche libre (action, entité, détails)
 *   ?page=1&per_page=25
 *
 * Renvoie les lignes paginées + le total.
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

$where  = [];
$params = [];

$action = trim((string) ($_GET['action'] ?? ''));
if ($action !== '') {
    $where[] = 'a.action = ?';
    $params[] = $action;
}

$userId = (int) ($_GET['user_id'] ?? 0);
if ($userId > 0) {
    $where[] = 'a.user_id = ?';
    $params[] = $userId;
}

$from = trim((string) ($_GET['from'] ?? ''));
if ($from !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
    $where[] = 'a.created_at >= ?';
    $params[] = $from . ' 00:00:00';
}

$to = trim((string) ($_GET['to'] ?? ''));
if ($to !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
    $where[] = 'a.created_at <= ?';
    $params[] = $to . ' 23:59:59';
}

$q = trim((string) ($_GET['q'] ?? ''));
if ($q !== '') {
    $where[] = '(a.action LIKE ? OR a.entity LIKE ? OR a.entity_id LIKE ? OR a.details LIKE ?)';
    $like = '%' . $q . '%';
    array_push($params, $like, $like, $like, $like);
}

$whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

$page    = max(1, (int) ($_GET['page'] ?? 1));
$perPage = (int) ($_GET['per_page'] ?? 25);
$perPage = max(1, min(100, $perPage));
$offset  = ($page - 1) * $perPage;

$countStmt = $pdo->prepare("SELECT COUNT(*) FROM audit_log a {$whereSql}");
$countStmt->execute($params);
$total = (int) $countStmt->fetchColumn();

$sql = "SELECT a.id, a.user_id, a.action, a.entity, a.entity_id, a.details, a.ip, a.created_at,
               u.full_name, u.email
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        {$whereSql}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT {$perPage} OFFSET {$offset}";
$stmt = $pdo->prepare($sql);
$stmt->execute($params);

$rows = [];
foreach ($stmt->fetchAll() as $row) {
    $rows[] = [
        'id'         => (int) $row['id'],
        'user_id'    => $row['user_id'] !== null ? (int) $row['user_id'] : null,
        'user_name'  => (string) ($row['full_name'] ?? ''),
        'user_email' => (string) ($row['email'] ?? ''),
        'action'     => (string) $row['action'],
        'entity'     => (string) ($row['entity'] ?? ''),
        'entity_id'  => (string) ($row['entity_id'] ?? ''),
        'details'    => $row['details'],   // JSON brut (affiché côté client)
        'ip'         => (string) ($row['ip'] ?? ''),
        'created_at' => (string) $row['created_at'],
    ];
}

/* Liste des actions distinctes, pour alimenter le filtre côté client. */
$actions = $pdo->query(
    'SELECT DISTINCT action FROM audit_log ORDER BY action'
)->fetchAll(PDO::FETCH_COLUMN);

Json::ok([
    'rows'     => $rows,
    'total'    => $total,
    'page'     => $page,
    'per_page' => $perPage,
    'pages'    => (int) ceil($total / $perPage),
    'actions'  => array_values($actions),
]);
