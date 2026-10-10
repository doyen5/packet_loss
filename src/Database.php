<?php
declare(strict_types=1);

namespace Npm;

use PDO;
use RuntimeException;

/**
 * Connexions PDO.
 *
 * - core()          : base applicative centrale (npm_core) : users, roles, sessions, ...
 * - country($code)  : base métier du pays, en LECTURE SEULE (prismis)
 *
 * Les identifiants proviennent exclusivement de l'environnement (config/database.php).
 */
final class Database
{
    /** @var array<string,PDO> */
    private static array $pool = [];

    public static function core(): PDO
    {
        return self::connection('core');
    }

    /**
     * Connexion à la base métier d'un pays.
     *
     * Le descripteur du pays (config/countries.php) peut définir une clé
     * "connection" pour lire une autre base que la sienne (ex. le Togo lit
     * la base CI). Par défaut on utilise "countries.<CODE>".
     */
    public static function country(string $code): PDO
    {
        $code = strtoupper($code);

        $override = Config::get('countries.' . $code . '.connection');
        $key = (is_string($override) && $override !== '')
            ? $override
            : 'countries.' . $code;

        return self::connection($key);
    }

    public static function connection(string $key): PDO
    {
        if (isset(self::$pool[$key])) {
            return self::$pool[$key];
        }

        $cfg = Config::get('database.' . $key);
        if (!is_array($cfg)) {
            throw new RuntimeException('Configuration de base de données introuvable : ' . $key);
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            (string) $cfg['host'],
            (int) $cfg['port'],
            (string) $cfg['name']
        );

        $pdo = new PDO($dsn, (string) $cfg['user'], (string) $cfg['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_TIMEOUT => 30,
        ]);
        $pdo->exec('SET NAMES utf8mb4');

        return self::$pool[$key] = $pdo;
    }

    private function __construct()
    {
    }
}
