<?php
declare(strict_types=1);

/**
 * Rapports planifiés par email (npm_core.report_schedules).
 *
 * GET  api/admin/reports.php                    → liste des planifications
 * POST api/admin/reports.php {action:"create"}  → création
 * POST api/admin/reports.php {action:"update"}  → modification
 * POST api/admin/reports.php {action:"toggle"}  → activer/désactiver
 * POST api/admin/reports.php {action:"delete"}  → suppression
 *
 * Réservé aux comptes disposant de la permission automations.manage.
 */

use Npm\Audit;
use Npm\Auth;
use Npm\Database;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Rbac;

require __DIR__ . '/../bootstrap.php';

Auth::requireLogin();
Rbac::require(Auth::role(), 'automations.manage');

$meId = (int) Auth::id();
$method = Json::method();
$pdo = Database::core();
$frequencies = ['daily', 'weekly', 'monthly'];

function cleanRecipients(string $raw): string
{
    $parts = preg_split('/[\s,;]+/', $raw) ?: [];
    $valid = [];
    foreach ($parts as $p) {
        $p = trim($p);
        if ($p !== '' && filter_var($p, FILTER_VALIDATE_EMAIL)) {
            $valid[] = $p;
        }
    }
    return implode(',', array_values(array_unique($valid)));
}

if ($method === 'GET') {
    $rows = $pdo->query(
        'SELECT rs.*, u.full_name AS user_name, u.email AS user_email
         FROM report_schedules rs JOIN users u ON u.id = rs.user_id
         ORDER BY rs.created_at DESC'
    )->fetchAll();
    Json::ok([
        'schedules' => $rows,
        'frequencies' => $frequencies,
        'countries' => $pdo->query('SELECT code, name FROM countries WHERE enabled = 1 ORDER BY code')->fetchAll(),
        'users' => $pdo->query('SELECT id, full_name, email FROM users WHERE is_active = 1 ORDER BY full_name')->fetchAll(),
    ]);
}

if ($method !== 'POST') {
    Json::error('Méthode non autorisée.', 405);
}

Csrf::requireValid();
$input = Json::input();
$action = (string) ($input['action'] ?? '');

$country = strtoupper(trim((string) ($input['country'] ?? '')));
$frequency = strtolower(trim((string) ($input['frequency'] ?? 'weekly')));
$recipients = cleanRecipients((string) ($input['recipients'] ?? ''));

$validate = static function () use ($country, $frequency, $recipients): array {
    if ($country === '') {
        Json::error('Pays requis.', 422);
    }
    if (!in_array($frequency, ['daily', 'weekly', 'monthly'], true)) {
        Json::error('Fréquence invalide.', 422);
    }
    if ($recipients === '') {
        Json::error('Au moins un destinataire email valide est requis.', 422);
    }
    return [$country, $frequency, $recipients];
};

if ($action === 'create') {
    [$country, $frequency, $recipients] = $validate();
    $userId = (int) ($input['user_id'] ?? $meId);
    $u = $pdo->prepare('SELECT id FROM users WHERE id = ? AND is_active = 1');
    $u->execute([$userId]);
    if (!$u->fetchColumn()) {
        Json::error('Utilisateur introuvable.', 404);
    }
    $stmt = $pdo->prepare(
        'INSERT INTO report_schedules (user_id, country_code, frequency, recipients, enabled)
         VALUES (?, ?, ?, ?, 1)'
    );
    $stmt->execute([$userId, $country, $frequency, $recipients]);
    $id = (int) $pdo->lastInsertId();
    Audit::log($meId, 'reports.create', 'report_schedules', (string) $id, ['country' => $country, 'frequency' => $frequency]);
    Json::ok(['id' => $id]);
}

if ($action === 'update') {
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) {
        Json::error('Identifiant requis.', 422);
    }
    [$country, $frequency, $recipients] = $validate();
    $stmt = $pdo->prepare(
        'UPDATE report_schedules SET country_code = ?, frequency = ?, recipients = ? WHERE id = ?'
    );
    $stmt->execute([$country, $frequency, $recipients, $id]);
    Audit::log($meId, 'reports.update', 'report_schedules', (string) $id);
    Json::ok(['id' => $id]);
}

if ($action === 'toggle') {
    $id = (int) ($input['id'] ?? 0);
    $enabled = !empty($input['enabled']) ? 1 : 0;
    if ($id <= 0) {
        Json::error('Identifiant requis.', 422);
    }
    $pdo->prepare('UPDATE report_schedules SET enabled = ? WHERE id = ?')->execute([$enabled, $id]);
    Audit::log($meId, 'reports.toggle', 'report_schedules', (string) $id, ['enabled' => (bool) $enabled]);
    Json::ok(['id' => $id, 'enabled' => (bool) $enabled]);
}

if ($action === 'delete') {
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) {
        Json::error('Identifiant requis.', 422);
    }
    $pdo->prepare('DELETE FROM report_schedules WHERE id = ?')->execute([$id]);
    Audit::log($meId, 'reports.delete', 'report_schedules', (string) $id);
    Json::ok(['id' => $id]);
}

Json::error('Action inconnue.', 422);
