<?php
declare(strict_types=1);

namespace Npm;

use Npm\Http\Json;
use Npm\Repositories\SessionRepository;
use Npm\Repositories\UserRepository;
use Npm\Security\Otp;
use Npm\Security\RateLimiter;

/**
 * Authentification et session.
 *
 * - start()            : démarrage de session sécurisée (idempotent)
 * - attempt()          : vérifie les identifiants (+ rate-limit, 2FA éventuel)
 * - completeTwoFactor(): finalise une connexion après validation OTP
 * - user/check/id/role : lecture de l'utilisateur courant
 * - logout()           : révocation du jeton + destruction de la session
 *
 * La session est liée à un jeton révocable (user_sessions) et versionnée
 * (users.session_version) : elle est invalidée si le jeton est révoqué ou si
 * la version change (changement de mot de passe, « déconnecter partout »).
 */
final class Auth
{
    public const THROTTLE_LIMIT  = 5;    // échecs par email (fenêtre)
    public const THROTTLE_WINDOW = 15;   // minutes
    public const IP_LIMIT        = 30;   // tentatives par IP (fenêtre)
    public const IP_WINDOW       = 15;   // minutes
    public const PENDING_2FA_TTL = 600;  // 10 minutes

    private static bool $started = false;
    private static bool $validated = false;

    public static function start(): void
    {
        if (self::$started || session_status() === PHP_SESSION_ACTIVE) {
            self::$started = true;
            self::validateOnce();
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
        self::validateOnce();
    }

    /** Valide la session courante une seule fois par requête. */
    private static function validateOnce(): void
    {
        if (self::$validated) {
            return;
        }
        self::$validated = true;

        if (empty($_SESSION['user_id'])) {
            return;
        }

        $userId = (int) $_SESSION['user_id'];
        $token  = (string) ($_SESSION['sess_token'] ?? '');

        try {
            if ($token === '' || !SessionRepository::isValid($token)) {
                self::clearSession();
                return;
            }
            if ((int) ($_SESSION['session_version'] ?? -1) !== UserRepository::sessionVersion($userId)) {
                self::clearSession();
                return;
            }
            SessionRepository::touch($token);
        } catch (\Throwable $e) {
            // Erreur DB transitoire : on ne déconnecte pas (disponibilité).
        }
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
     * @return array{success:bool, reason?:string, two_factor?:bool, user?:array}
     */
    public static function attempt(string $email, string $password): array
    {
        self::start();
        $ip = self::clientIp();

        if (UserRepository::recentFailures($email, $ip, self::THROTTLE_WINDOW) >= self::THROTTLE_LIMIT) {
            return ['success' => false, 'reason' => 'throttled'];
        }
        if ($ip !== null) {
            try {
                if (!RateLimiter::hit('login_ip:' . $ip, self::IP_LIMIT, self::IP_WINDOW)) {
                    return ['success' => false, 'reason' => 'throttled'];
                }
            } catch (\Throwable $e) {
                // ignore
            }
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
        if ($ip !== null) {
            try { RateLimiter::clear('login_ip:' . $ip); } catch (\Throwable $e) {}
        }

        if ((int) ($user['two_factor_enabled'] ?? 0) === 1) {
            Otp::issue((int) $user['id'], (string) $user['email'], 'login');
            $_SESSION['pending_2fa'] = ['user_id' => (int) $user['id'], 'ts' => time()];
            return ['success' => false, 'two_factor' => true, 'reason' => '2fa_required'];
        }

        UserRepository::touchLastLogin((int) $user['id']);
        $sessionUser = self::establishSession((int) $user['id']);
        return ['success' => true, 'user' => $sessionUser];
    }

    public static function pendingTwoFactor(): ?int
    {
        self::start();
        $p = $_SESSION['pending_2fa'] ?? null;
        if (!is_array($p)) {
            return null;
        }
        if (time() - (int) ($p['ts'] ?? 0) > self::PENDING_2FA_TTL) {
            unset($_SESSION['pending_2fa']);
            return null;
        }
        $id = (int) ($p['user_id'] ?? 0);
        return $id > 0 ? $id : null;
    }

    public static function completeTwoFactor(int $userId): bool
    {
        self::start();
        $user = UserRepository::findById($userId);
        if ($user === null || !(int) $user['is_active']) {
            return false;
        }
        unset($_SESSION['pending_2fa']);
        UserRepository::touchLastLogin($userId);
        self::establishSession($userId);
        return true;
    }

    /** @return list<string> */
    public static function permissions(): array
    {
        $user = self::user();
        return isset($user['permissions']) && is_array($user['permissions'])
            ? $user['permissions']
            : [];
    }

    /** Fait tourner le jeton de la session courante (sans déconnexion). */
    public static function refreshSession(): void
    {
        self::start();
        $id = self::id();
        if ($id === null) {
            return;
        }
        $token = bin2hex(random_bytes(32));
        SessionRepository::create($id, $token, self::clientIp(), $_SERVER['HTTP_USER_AGENT'] ?? null);
        $_SESSION['sess_token']      = $token;
        $_SESSION['session_version'] = UserRepository::sessionVersion($id);
    }

    public static function superAdmin(): bool
    {
        return self::role() === Rbac::ROLE_SUPER_ADMIN;
    }

    public static function logout(): void
    {
        self::start();
        $token = (string) ($_SESSION['sess_token'] ?? '');
        if ($token !== '') {
            try { SessionRepository::revoke($token); } catch (\Throwable $e) {}
        }
        self::clearSession();
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
        self::$started = false;
        self::$validated = false;
    }

    /** Crée une session liée à un jeton révocable. */
    private static function establishSession(int $userId): array
    {
        $sessionUser = self::userFromId($userId);
        session_regenerate_id(true);

        $token = bin2hex(random_bytes(32));
        SessionRepository::create($userId, $token, self::clientIp(), $_SERVER['HTTP_USER_AGENT'] ?? null);

        $_SESSION['user_id']         = $userId;
        $_SESSION['user']            = $sessionUser;
        $_SESSION['sess_token']      = $token;
        $_SESSION['session_version'] = UserRepository::sessionVersion($userId);

        return $sessionUser;
    }

    private static function clearSession(): void
    {
        $_SESSION = [];
    }

    private static function clientIp(): ?string
    {
        return isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : null;
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
}
