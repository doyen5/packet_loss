<?php
declare(strict_types=1);

/**
 * Centre de notifications de l'utilisateur connecté.
 *   GET  : liste + nombre non lues
 *   POST : { action: "read", id } | { action: "read_all" }
 */

use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Repositories\NotificationRepository;

require __DIR__ . '/../bootstrap.php';

Auth::requireLogin();
$userId = (int) Auth::id();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    Json::ok([
        'notifications' => NotificationRepository::listForUser($userId),
        'unread'        => NotificationRepository::unreadCount($userId),
    ]);
}

Json::requireMethod('POST');
Csrf::requireValid();

$input = Json::input();
$action = (string) ($input['action'] ?? '');

if ($action === 'read') {
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) {
        Json::error('Identifiant invalide.', 422);
    }
    NotificationRepository::markRead($userId, $id);
    Json::ok(['message' => 'Notification lue.', 'unread' => NotificationRepository::unreadCount($userId)]);
}

if ($action === 'read_all') {
    NotificationRepository::markAllRead($userId);
    Json::ok(['message' => 'Toutes les notifications sont lues.', 'unread' => 0]);
}

Json::error('Action inconnue.', 422);
