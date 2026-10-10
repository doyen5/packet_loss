<?php
declare(strict_types=1);

namespace Npm;

use Npm\Http\Json;
use Npm\Repositories\UserRepository;

/**
 * Authentification et session.
 *
 * - start()      : démarrage de session sécurisée (idempotent)
 * - attempt()    : vérification des identifiants, session + last_login
 * - check/user   : lecture de l'utilisateur courant
 */
final class Auth
{
    public const THROTTLE_LIMIT  = 5;
    public const THROTTLE_WINDOW = 15;

    private static bool $started = false;

    public static function start(): void
    {
        if (self::$started || session_status() === PHP_SESSION_ACTIVE) {
            self::$started = true;
            return;
        }

        $lifetime = Config::get('app.session.lifetime', 28800);
        if (is_int($lifetime) && $lifetime > 0) {
            ini_set('session.gc_maxlifetime', (string) $lifetime);
        }

        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure'   => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        ]);
        session_name((string) Config::get('app.session.name', 'pl_session'));
        session_start();
        self::$started = true;
    }

    public static function check(): bool
    {
        self::start();
        return !empty($_SESSION['user_id']);
    }

    public static function id(): ?int
    {
        self::start();
        return isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null;
    }

    public static function user(): ?array
    {
        self::start();
        $user = $_SESSION['user'] ?? null;
        return is_array($user) ? $user : null;
    }

    public static function role(): ?string
    {
        $user = self::user();
        return isset($user['role']) ? (string) $user['role'] : null;
    }

    public static function requireLogin(): void
    {
        if (!self::check()) {
            Json::error('Authentification requise.', 401);
        }
    }

    /**
     * Tente une connexion.
     *
     * @return array{success:bool, reason?:string, user?:array}
     */
    public static function attempt(string $email, string $password): array
    {
        self::start();
        $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : null;

        if (UserRepository::recentFailures($email, $ip, self::THROTTLE_WINDOW) >= self::THROTTLE_LIMIT) {
            return ['success' => false, 'reason' => 'throttled'];
        }

        $user = UserRepository::findByEmail($email);
        if ($user === null || !password_verify((string) $password, (string) $user['password_hash'])) {
            UserRepository::recordLoginAttempt($email, $ip, false);
            return ['success' => false, 'reason' => 'invalid_credentials'];
        }

        if (!(int) $user['is_active']) {
            return ['success' => false, 'reason' => 'inactive'];
        }

        UserRepository::recordLoginAttempt($email, $ip, true);
        UserRepository::touchLastLogin((int) $user['id']);
        session_regenerate_id(true);

        $sessionUser = self::userFromId((int) $user['id']);
        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['user'] = $sessionUser;

        return ['success' => true, 'user' => $sessionUser];
    }

    /** @return list<string> */
    public static function permissions(): array
    {
        $user = self::user();
        return isset($user['permissions']) && is_array($user['permissions'])
            ? $user['permissions']
            : [];
    }

    public static function superAdmin(): bool
    {
        return self::role() === Rbac::ROLE_SUPER_ADMIN;
    }

    /** Construction de l'utilisateur stocké en session. */
    private static function userFromId(int $userId): array
    {
        $row = UserRepository::findById($userId);
        if ($row === null) {
            throw new \RuntimeException('Utilisateur introuvable (id=' . $userId . ')');
        }
        return [
            'id'          => (int) $row['id'],
            'email'       => (string) $row['email'],
            'full_name'   => (string) $row['full_name'],
            'role'        => (string) $row['role'],
            'countries'   => UserRepository::countriesFor($userId),
            'permissions' => Rbac::permissionsFor((string) $row['role']),
            'super_admin' => (string) $row['role'] === Rbac::ROLE_SUPER_ADMIN,
        ];
    }

    public static function logout(): void
    {
        self::start();
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
        self::$started = false;
    }
}
