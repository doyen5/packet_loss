<?php
declare(strict_types=1);

namespace Npm\Security;

use Npm\Database;

/**
 * Limiteur de débit à fenêtre fixe, persisté en base (npm_core.rate_limits).
 *
 * Utilisé pour protéger la connexion et les endpoints coûteux en SQL.
 */
final class RateLimiter
{
    /**
     * Enregistre une tentative. Retourne true si la requête est autorisée,
     * false si le quota est dépassé sur la fenêtre courante.
     */
    public static function hit(string $key, int $max, int $windowSeconds): bool
    {
        $key = mb_substr($key, 0, 191);
        $pdo = Database::core();
        $now = time();

        $stmt = $pdo->prepare('SELECT hits, UNIX_TIMESTAMP(window_start) AS ws FROM rate_limits WHERE rl_key = ?');
        $stmt->execute([$key]);
        $row = $stmt->fetch();

        if ($row === false || ($now - (int) $row['ws']) >= $windowSeconds) {
            $pdo->prepare(
                'INSERT INTO rate_limits (rl_key, hits, window_start) VALUES (?, 1, NOW())
                 ON DUPLICATE KEY UPDATE hits = 1, window_start = NOW()'
            )->execute([$key]);
            return true;
        }

        if ((int) $row['hits'] >= $max) {
            return false;
        }

        $pdo->prepare('UPDATE rate_limits SET hits = hits + 1 WHERE rl_key = ?')->execute([$key]);
        return true;
    }

    /** Vérifie le quota sans incrémenter. */
    public static function allowed(string $key, int $max, int $windowSeconds): bool
    {
        $key = mb_substr($key, 0, 191);
        $stmt = Database::core()->prepare(
            'SELECT hits, UNIX_TIMESTAMP(window_start) AS ws FROM rate_limits WHERE rl_key = ?'
        );
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        if ($row === false) {
            return true;
        }
        if ((time() - (int) $row['ws']) >= $windowSeconds) {
            return true;
        }
        return (int) $row['hits'] < $max;
    }

    public static function clear(string $key): void
    {
        Database::core()->prepare('DELETE FROM rate_limits WHERE rl_key = ?')->execute([mb_substr($key, 0, 191)]);
    }

    /** Purge les fenêtres expirées depuis plus d'une heure. */
    public static function purge(): int
    {
        $cutoff = date('Y-m-d H:i:s', time() - 3600);
        $stmt = Database::core()->prepare('DELETE FROM rate_limits WHERE window_start < ?');
        $stmt->execute([$cutoff]);
        return $stmt->rowCount();
    }
}
