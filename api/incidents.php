<?php
/**
 * API — Historique des incidents (table npm_core.incidents).
 *
 * GET  /api/incidents.php[?country=CI]  → liste les incidents accessibles
 * POST /api/incidents.php               → crée / acquitte / résout un incident
 */
declare(strict_types=1);

use Npm\Audit;
use Npm\Auth;
use Npm\Config;
use Npm\Database;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Rbac;
use Npm\Repositories\NotificationRepository;
use Npm\Repositories\UserRepository;

require_once __DIR__ . '/bootstrap.php';

Auth::requireLogin();
Rbac::require(Auth::role(), 'packet_loss.view');

$userId  = (int) Auth::id();
$user    = Auth::user() ?? [];
$allowed = array_map('strval', $user['countries'] ?? []);
$pdo     = Database::core();
$method  = Json::method();

/* Pays activés dans la configuration (pour un super administrateur sans restriction). */
$enabledCountries = [];
foreach (Config::get('countries', []) as $c) {
    if (is_array($c) && !empty($c['enabled']) && isset($c['code'])) {
        $enabledCountries[] = (string) $c['code'];
    }
}

if ($method === 'GET') {
    $singleId = (int) ($_GET['id'] ?? 0);
    if ($singleId > 0) {
        $stmt = $pdo->prepare('SELECT * FROM incidents WHERE id = ?');
        $stmt->execute([$singleId]);
        $incident = $stmt->fetch();
        if (!$incident) {
            Json::error('Incident introuvable.', 404);
        }
        if (!Auth::superAdmin() && !in_array((string) $incident['country_code'], $allowed, true)) {
            Json::error('Accès refusé : pays non autorisé pour votre compte.', 403);
        }
        $incident['details'] = $incident['details'] !== null
            ? (json_decode((string) $incident['details'], true) ?: null)
            : null;

        $cs = $pdo->prepare(
            'SELECT c.id, c.user_id, c.body, c.created_at, u.full_name
             FROM incident_comments c LEFT JOIN users u ON u.id = c.user_id
             WHERE c.incident_id = ? ORDER BY c.created_at ASC'
        );
        $cs->execute([$singleId]);

        Json::ok(['incident' => $incident, 'comments' => $cs->fetchAll()]);
    }

    $country = strtoupper(trim((string) ($_GET['country'] ?? '')));

    if ($country !== '') {
        if (!Auth::superAdmin() && !in_array($country, $allowed, true)) {
            Json::error('Accès refusé : pays non autorisé pour votre compte.', 403);
        }
        $stmt = $pdo->prepare(
            'SELECT * FROM incidents WHERE country_code = ? ORDER BY started_at DESC LIMIT 500'
        );
        $stmt->execute([$country]);
    } else {
        $scope = Auth::superAdmin() ? $enabledCountries : $allowed;
        if (!$scope) {
            Json::ok(['incidents' => []]);
        }
        $placeholders = implode(', ', array_fill(0, count($scope), '?'));
        $stmt = $pdo->prepare(
            'SELECT * FROM incidents WHERE country_code IN (' . $placeholders . ')
             ORDER BY started_at DESC LIMIT 500'
        );
        $stmt->execute($scope);
    }

    $incidents = array_map(static function (array $row): array {
        $row['details'] = $row['details'] !== null
            ? (json_decode((string) $row['details'], true) ?: null)
            : null;
        return $row;
    }, $stmt->fetchAll());

    Json::ok(['incidents' => $incidents]);
}

if ($method !== 'POST') {
    Json::error('Méthode non autorisée.', 405);
}

Csrf::requireValid();
Rbac::require(Auth::role(), 'alerts.manage');

$input  = Json::input();
$action = (string) ($input['action'] ?? 'create');

if ($action === 'create') {
    $countryCode = strtoupper(trim((string) ($input['country'] ?? '')));
    $country = Config::get('countries.' . $countryCode);
    if (!is_array($country) || empty($country['enabled'])) {
        Json::error('Pays inconnu ou désactivé.', 400);
    }
    if (!Auth::superAdmin() && !in_array($countryCode, $allowed, true)) {
        Json::error('Accès refusé : pays non autorisé pour votre compte.', 403);
    }

    $site = strtoupper(trim((string) ($input['site'] ?? '')));
    if ($site === '') {
        Json::error('Site requis.', 400);
    }

    $metric    = trim((string) ($input['metric'] ?? 'packet_loss_rate'));
    $value     = (float) ($input['value'] ?? 0);
    $threshold = (float) ($input['threshold'] ?? 0.1);
    $startedAt = trim((string) ($input['started_at'] ?? '')) ?: date('Y-m-d H:i:s');
    $details   = is_array($input['details'] ?? null) ? $input['details'] : [];

    $stmt = $pdo->prepare(
        'INSERT INTO incidents (country_code, site, metric, value, threshold, status, details, started_at)
         VALUES (?, ?, ?, ?, ?, \'open\', ?, ?)'
    );
    $stmt->execute([
        $countryCode,
        $site,
        $metric,
        $value,
        $threshold,
        json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        $startedAt,
    ]);
    $id = (int) $pdo->lastInsertId();

    Audit::log($userId, 'incident.create', 'incidents', (string) $id, ['site' => $site]);

    Json::ok(['id' => $id]);
}

if ($action === 'acknowledge' || $action === 'resolve') {
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) {
        Json::error('Identifiant requis.', 400);
    }

    $check = $pdo->prepare('SELECT id, country_code FROM incidents WHERE id = ?');
    $check->execute([$id]);
    $incident = $check->fetch();
    if (!$incident) {
        Json::error('Incident introuvable.', 404);
    }
    if (!Auth::superAdmin() && !in_array((string) $incident['country_code'], $allowed, true)) {
        Json::error('Accès refusé : pays non autorisé pour votre compte.', 403);
    }

    if ($action === 'acknowledge') {
        $stmt = $pdo->prepare(
            "UPDATE incidents SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = ?
             WHERE id = ?"
        );
        $stmt->execute([$userId, $id]);
    } else {
        $stmt = $pdo->prepare(
            "UPDATE incidents SET status = 'resolved', resolved_at = NOW() WHERE id = ?"
        );
        $stmt->execute([$id]);
    }

    Audit::log($userId, 'incident.' . $action, 'incidents', (string) $id);

    Json::ok(['id' => $id, 'status' => $action === 'resolve' ? 'resolved' : 'acknowledged']);
}

if ($action === 'assign') {
    $id = (int) ($input['id'] ?? 0);
    $assignee = (int) ($input['assigned_to'] ?? 0);
    if ($id <= 0) {
        Json::error('Identifiant requis.', 400);
    }

    $check = $pdo->prepare('SELECT id, country_code, site FROM incidents WHERE id = ?');
    $check->execute([$id]);
    $incident = $check->fetch();
    if (!$incident) {
        Json::error('Incident introuvable.', 404);
    }
    if (!Auth::superAdmin() && !in_array((string) $incident['country_code'], $allowed, true)) {
        Json::error('Accès refusé : pays non autorisé pour votre compte.', 403);
    }
    if ($assignee > 0) {
        $u = $pdo->prepare('SELECT id FROM users WHERE id = ? AND is_active = 1');
        $u->execute([$assignee]);
        if (!$u->fetchColumn()) {
            Json::error('Utilisateur assigné introuvable.', 404);
        }
    }

    $pdo->prepare('UPDATE incidents SET assigned_to = ? WHERE id = ?')
        ->execute([$assignee > 0 ? $assignee : null, $id]);

    if ($assignee > 0) {
        NotificationRepository::create(
            $assignee,
            'Incident assigné',
            sprintf('Un incident vous a été assigné : %s (%s).', (string) $incident['site'], (string) $incident['country_code']),
            'incident',
            'packet_loss.html'
        );
    }

    Audit::log($userId, 'incident.assign', 'incidents', (string) $id, ['assigned_to' => $assignee]);
    Json::ok(['id' => $id, 'assigned_to' => $assignee > 0 ? $assignee : null]);
}

if ($action === 'comment') {
    $id = (int) ($input['id'] ?? 0);
    $body = trim((string) ($input['comment'] ?? ''));
    if ($id <= 0 || $body === '') {
        Json::error('Identifiant et commentaire requis.', 422);
    }

    $check = $pdo->prepare('SELECT id, country_code, site, assigned_to FROM incidents WHERE id = ?');
    $check->execute([$id]);
    $incident = $check->fetch();
    if (!$incident) {
        Json::error('Incident introuvable.', 404);
    }
    if (!Auth::superAdmin() && !in_array((string) $incident['country_code'], $allowed, true)) {
        Json::error('Accès refusé : pays non autorisé pour votre compte.', 403);
    }

    $pdo->prepare('INSERT INTO incident_comments (incident_id, user_id, body) VALUES (?, ?, ?)')
        ->execute([$id, $userId, mb_substr($body, 0, 2000)]);

    if (!empty($incident['assigned_to']) && (int) $incident['assigned_to'] !== $userId) {
        NotificationRepository::create(
            (int) $incident['assigned_to'],
            'Nouveau commentaire',
            sprintf('Nouveau commentaire sur l\'incident %s.', (string) $incident['site']),
            'info',
            'packet_loss.html'
        );
    }

    Audit::log($userId, 'incident.comment', 'incidents', (string) $id);
    Json::ok(['id' => $id]);
}

Json::error('Action inconnue.', 422);
