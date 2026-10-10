<?php
declare(strict_types=1);

namespace Npm;

/**
 * Dépôt de configuration minimal, chargé depuis le dossier config/.
 * Accès par notation pointée : Config::get('database.core.host').
 */
final class Config
{
    /** @var array<string,mixed> */
    private static array $items = [];
    private static bool $loaded = false;

    public static function load(string $dir): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;

        foreach (glob($dir . '/*.php') ?: [] as $file) {
            $key = basename($file, '.php');
            $config = require $file;
            if (is_array($config)) {
                self::$items[$key] = $config;
            }
        }
    }

    /** @return mixed */
    public static function get(string $key, mixed $default = null): mixed
    {
        $value = self::$items;
        foreach (explode('.', $key) as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return $default;
            }
            $value = $value[$segment];
        }
        return $value;
    }
}
