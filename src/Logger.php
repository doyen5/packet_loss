<?php
declare(strict_types=1);

namespace Npm;

/**
 * Journalisation fichier simple (logs/<canal>.log).
 */
final class Logger
{
    public static function log(string $channel, string $message, array $context = []): void
    {
        $dir = dirname(__DIR__) . '/logs';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        $line = '[' . date('Y-m-d H:i:s') . '] ' . $message;
        if ($context !== []) {
            $line .= ' ' . json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        $line .= PHP_EOL;

        $file = $dir . '/' . preg_replace('/[^a-z0-9_\-]/i', '_', $channel) . '.log';
        @file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
    }

    public static function error(string $message, array $context = []): void
    {
        self::log('errors', $message, $context);
    }

    public static function auth(string $message, array $context = []): void
    {
        self::log('auth', $message, $context);
    }
}
