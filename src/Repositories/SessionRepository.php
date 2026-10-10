<?php
declare(strict_types=1);

namespace Npm\Repositories;

use Npm\Database;

/**
 * Sessions applicatives révocables (npm_core.user_sessions).
 *
 * Chaque session PHP possède un jeton aléatoire stocké à la fois en session et
 * en base. La révocation (déconnexion ciblée, "déconnecter partout") rend le
 * jeton invalide et force la fermeture de la session correspondante.
 */
final class SessionRepository
{
    public static function create(int $userId, string $token, ?string $ip, ?string $ua): void
    {
        $ua = $ua !== null ? mb_substr($ua, 0, 255) : null;
        Database::core()->prepare(
            'INSERT INTO user_sessions (user_id, token, ip, user_agent) VALUES (?, ?, ?, ?)'
        )->execute([$userId, $token, $ip, $ua]);
    }

    public static function touch(string $token): void
    {
        Database::core()->prepare('UPDATE user_sessions SET last_seen_at = NOW() WHERE token = ?')->execute([$token]);
    }

    public static function isValid(string $token): bool
    {
        if ($token === '') {
            return false;
        }
        $stmt = Database::core()->prepare('SELECT revoked FROM user_sessions WHERE token = ?');
        $stmt->execute([$token]);
        $revoked = $stmt->fetchColumn();
        return $revoked !== false && (int) $revoked === 0;
    }

    public static function revoke(string $token): void
    {
        Database::core()->prepare('UPDATE user_sessions SET revoked = 1 WHERE token = ?')->execute([$token]);
    }

    public static function revokeAllForUser(int $userId): void
    {
        Database::core()->prepare('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?')->execute([$userId]);
    }

    public static function revokeById(int $id, int $userId): void
    {
        Database::core()->prepare(
            'UPDATE user_sessions SET revoked = 1 WHERE id = ? AND user_id = ?'
        )->execute([$id, $userId]);
    }

    public static function idForToken(string $token): ?int
    {
        $stmt = Database::core()->prepare('SELECT id FROM user_sessions WHERE token = ?');
        $stmt->execute([$token]);
        $id = $stmt->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    /** Révoque toutes les sessions sauf celle du jeton courant. */
    public static function revokeOthers(int $userId, string $token): void
    {
        Database::core()->prepare(
            'UPDATE user_sessions SET revoked = 1 WHERE user_id = ? AND token <> ?'
        )->execute([$userId, $token]);
    }

    /** @return list<array<string,mixed>> */
    public static function listForUser(int $userId): array
    {
        $stmt = Database::core()->prepare(
            'SELECT id, ip, user_agent, created_at, last_seen_at, revoked
             FROM user_sessions WHERE user_id = ? AND revoked = 0
             ORDER BY last_seen_at DESC LIMIT 50'
        );
        $stmt->execute([$userId]);
        return $stmt->fetchAll();
    }

    public static function purge(int $days = 60): int
    {
        $cutoff = date('Y-m-d H:i:s', time() - $days * 86400);
        $stmt = Database::core()->prepare('DELETE FROM user_sessions WHERE last_seen_at < ?');
        $stmt->execute([$cutoff]);
        return $stmt->rowCount();
    }
}
