<?php
declare(strict_types=1);

namespace Npm\Repositories;

use Npm\Database;
use PDO;

/**
 * Accès aux données utilisateurs (base applicative npm_core).
 */
final class UserRepository
{
    private const SELECT =
        'SELECT u.id, u.email, u.password_hash, u.full_name, u.role_id, u.is_active,
                u.last_login, r.name AS role
         FROM users u JOIN roles r ON r.id = u.role_id';

    public static function findByEmail(string $email): ?array
    {
        $stmt = Database::core()->prepare(self::SELECT . ' WHERE u.email = ?');
        $stmt->execute([$email]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public static function findById(int $id): ?array
    {
        $stmt = Database::core()->prepare(self::SELECT . ' WHERE u.id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** @return list<string> */
    public static function countriesFor(int $userId): array
    {
        $stmt = Database::core()->prepare(
            'SELECT country_code FROM user_countries WHERE user_id = ? ORDER BY country_code'
        );
        $stmt->execute([$userId]);
        return array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN));
    }

    public static function touchLastLogin(int $userId): void
    {
        $stmt = Database::core()->prepare('UPDATE users SET last_login = NOW() WHERE id = ?');
        $stmt->execute([$userId]);
    }

    public static function updatePassword(int $userId, string $hash): void
    {
        $stmt = Database::core()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $stmt->execute([$hash, $userId]);
    }

    public static function recordLoginAttempt(string $email, ?string $ip, bool $success): void
    {
        $stmt = Database::core()->prepare(
            'INSERT INTO login_attempts (email, ip, success) VALUES (?, ?, ?)'
        );
        $stmt->execute([$email, $ip ?? '', $success ? 1 : 0]);
    }

    public static function recentFailures(string $email, ?string $ip, int $minutes = 15): int
    {
        $stmt = Database::core()->prepare(
            'SELECT COUNT(*) FROM login_attempts
             WHERE success = 0 AND (email = ? OR ip = ?)
               AND attempted_at >= (NOW() - INTERVAL ? MINUTE)'
        );
        $stmt->execute([$email, $ip ?? '', $minutes]);
        return (int) $stmt->fetchColumn();
    }
}