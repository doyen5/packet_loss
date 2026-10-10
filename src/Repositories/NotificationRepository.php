<?php
declare(strict_types=1);

namespace Npm\Repositories;

use Npm\Database;
use PDO;

/**
 * Centre de notifications (npm_core.notifications).
 *
 * Une notification avec user_id NULL est une diffusion à tous les comptes.
 */
final class NotificationRepository
{
    public static function create(?int $userId, string $title, string $message, string $type = 'info', ?string $link = null): void
    {
        Database::core()->prepare(
            'INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)'
        )->execute([$userId, $type, $title, $message, $link]);
    }

    /** @return list<array<string,mixed>> */
    public static function listForUser(int $userId, int $limit = 30): array
    {
        $stmt = Database::core()->prepare(
            'SELECT id, user_id, type, title, message, link, is_read, created_at
             FROM notifications WHERE user_id = ? OR user_id IS NULL
             ORDER BY created_at DESC LIMIT ?'
        );
        $stmt->bindValue(1, $userId, PDO::PARAM_INT);
        $stmt->bindValue(2, $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public static function unreadCount(int $userId): int
    {
        $stmt = Database::core()->prepare(
            'SELECT COUNT(*) FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0'
        );
        $stmt->execute([$userId]);
        return (int) $stmt->fetchColumn();
    }

    public static function markRead(int $userId, int $id): void
    {
        Database::core()->prepare(
            'UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)'
        )->execute([$id, $userId]);
    }

    public static function markAllRead(int $userId): void
    {
        Database::core()->prepare(
            'UPDATE notifications SET is_read = 1 WHERE user_id = ? OR user_id IS NULL'
        )->execute([$userId]);
    }
}
