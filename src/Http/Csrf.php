<?php
declare(strict_types=1);

namespace Npm\Http;

use Npm\Auth;

/**
 * Protection CSRF basée sur un jeton de session.
 *
 * Le client envoie le jeton via l'en-tête X-CSRF-Token (ou le champ _csrf).
 */
final class Csrf
{
    private const SESSION_KEY = '_csrf_token';

    public static function token(): string
    {
        Auth::start();
        if (empty($_SESSION[self::SESSION_KEY])) {
            $_SESSION[self::SESSION_KEY] = bin2hex(random_bytes(32));
        }
        return (string) $_SESSION[self::SESSION_KEY];
    }

    public static function validate(?string $token): bool
    {
        Auth::start();
        if (empty($_SESSION[self::SESSION_KEY])) {
            return false;
        }
        return is_string($token) && $token !== '' && hash_equals((string) $_SESSION[self::SESSION_KEY], $token);
    }

    /** Contrôle le jeton reçu dans la requête courante. */
    public static function checkRequest(): bool
    {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['_csrf'] ?? null);
        return self::validate(is_string($token) ? $token : null);
    }

    /** Stoppe la requête (403) si le jeton est absent/invalide. */
    public static function requireValid(): void
    {
        if (!self::checkRequest()) {
            Json::error('Jeton CSRF invalide ou manquant.', 403);
        }
    }
}
