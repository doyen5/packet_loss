<?php
declare(strict_types=1);

/**
 * Bootstrap commun à tous les endpoints API.
 *
 * - Autoload (Composer si installé, sinon PSR-4 maison)
 * - Chargement de .env et de config/
 * - Gestion centralisée des erreurs (JSON)
 * - En-têtes de sécurité
 *
 * La session n'est PAS démarrée automatiquement : les endpoints qui en
 * ont besoin appellent Npm\Auth::start() (fait implicitement par Auth/Csrf).
 */

use Npm\Config;
use Npm\Env;
use Npm\Http\Json;
use Npm\Logger;

$baseDir = dirname(__DIR__);

$composer = $baseDir . '/vendor/autoload.php';
if (is_file($composer)) {
    require_once $composer;
} else {
    spl_autoload_register(static function (string $class) use ($baseDir): void {
        $prefix = 'Npm\\';
        if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
            return;
        }
        $relative = substr($class, strlen($prefix));
        $file = $baseDir . '/src/' . str_replace('\\', '/', $relative) . '.php';
        if (is_file($file)) {
            require_once $file;
        }
    });
}

Env::load($baseDir . '/.env');
Config::load($baseDir . '/config');

$debug = (bool) Config::get('app.debug', false);
ini_set('display_errors', $debug ? '1' : '0');
error_reporting(E_ALL);
ini_set('log_errors', '1');

set_exception_handler(static function (\Throwable $e) use ($debug): void {
    Logger::error($e->getMessage(), [
        'file' => $e->getFile(),
        'line' => $e->getLine(),
    ]);
    Json::error($debug ? $e->getMessage() : 'Erreur interne du serveur.', 500);
});

if (PHP_SAPI !== 'cli' && !headers_sent()) {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin');
}
