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
                u.last_login, u.session_version, u.two_factor_enabled, u.preferences,
                r.name AS role
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

    public static function idsForCountry(string $code): array
    {
        $stmt = Database::core()->prepare('SELECT user_id FROM user_countries WHERE country_code = ?');
        $stmt->execute([$code]);
        return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
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

    public static function updateFullName(int $userId, string $fullName): void
    {
        Database::core()->prepare('UPDATE users SET full_name = ? WHERE id = ?')->execute([$fullName, $userId]);
    }

    public static function sessionVersion(int $userId): int
    {
        $stmt = Database::core()->prepare('SELECT session_version FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $v = $stmt->fetchColumn();
        return $v === false ? 0 : (int) $v;
    }

    /** Invalide toutes les sessions existantes de l'utilisateur. */
    public static function bumpSessionVersion(int $userId): void
    {
        Database::core()->prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?')
            ->execute([$userId]);
    }

    public static function setTwoFactor(int $userId, bool $enabled): void
    {
        Database::core()->prepare('UPDATE users SET two_factor_enabled = ? WHERE id = ?')
            ->execute([$enabled ? 1 : 0, $userId]);
    }

    /** @return array<string,mixed> */
    public static function preferences(int $userId): array
    {
        $stmt = Database::core()->prepare('SELECT preferences FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $json = $stmt->fetchColumn();
        $data = $json !== false && $json !== null ? json_decode((string) $json, true) : [];
        return is_array($data) ? $data : [];
    }

    /** @param array<string,mixed> $prefs */
    public static function setPreferences(int $userId, array $prefs): void
    {
        Database::core()->prepare('UPDATE users SET preferences = ? WHERE id = ?')
            ->execute([json_encode($prefs, JSON_UNESCAPED_UNICODE), $userId]);
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