<?php
declare(strict_types=1);

/**
 * Sessions actives de l'utilisateur connecté.
 *   GET  : liste des sessions révocables
 *   POST : { action: "revoke", id } | { action: "revoke_others" } | { action: "revoke_all" }
 */

use Npm\Audit;
use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Repositories\SessionRepository;
use Npm\Repositories\UserRepository;

require __DIR__ . '/../bootstrap.php';

Auth::requireLogin();
$userId = (int) Auth::id();
$currentToken = (string) ($_SESSION['sess_token'] ?? '');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $currentId = $currentToken !== '' ? SessionRepository::idForToken($currentToken) : null;
    $sessions = array_map(static function (array $s) use ($currentId): array {
        return [
            'id'           => (int) $s['id'],
            'ip'           => (string) ($s['ip'] ?? ''),
            'user_agent'   => (string) ($s['user_agent'] ?? ''),
            'created_at'   => (string) $s['created_at'],
            'last_seen_at' => (string) $s['last_seen_at'],
            'current'      => $currentId !== null && (int) $s['id'] === $currentId,
        ];
    }, SessionRepository::listForUser($userId));

    Json::ok(['sessions' => $sessions]);
}

Json::requireMethod('POST');
Csrf::requireValid();

$input = Json::input();
$action = (string) ($input['action'] ?? '');

switch ($action) {
    case 'revoke':
        $id = (int) ($input['id'] ?? 0);
        if ($id <= 0) {
            Json::error('Identifiant de session invalide.', 422);
        }
        SessionRepository::revokeById($id, $userId);
        Audit::log($userId, 'account.session.revoke', 'session', (string) $id);
        Json::ok(['message' => 'Session révoquée.']);
        // no break

    case 'revoke_others':
        if ($currentToken !== '') {
            SessionRepository::revokeOthers($userId, $currentToken);
        }
        Audit::log($userId, 'account.session.revoke_others', 'user', (string) $userId);
        Json::ok(['message' => 'Les autres sessions ont été fermées.']);
        // no break

    case 'revoke_all':
        UserRepository::bumpSessionVersion($userId);
        SessionRepository::revokeAllForUser($userId);
        Auth::refreshSession();
        Audit::log($userId, 'account.session.revoke_all', 'user', (string) $userId);
        Json::ok(['message' => 'Toutes les sessions ont été fermées, y compris celle-ci.']);
        // no break

    default:
        Json::error('Action inconnue.', 422);
}
