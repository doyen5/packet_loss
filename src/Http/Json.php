<?php
declare(strict_types=1);

namespace Npm\Http;

/**
 * Réponses et lectures JSON normalisées pour les endpoints.
 */
final class Json
{
    public static function response(array $data, int $status = 200): never
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function ok(array $data = [], int $status = 200): never
    {
        self::response(array_merge(['success' => true], $data), $status);
    }

    public static function error(string $message, int $status = 400, array $extra = []): never
    {
        self::response(array_merge(['success' => false, 'message' => $message], $extra), $status);
    }

    /** Corps de requête décodé ; tableau vide si invalide. */
    public static function input(): array
    {
        $raw = file_get_contents('php://input') ?: '';
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }

    public static function method(): string
    {
        return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    }

    public static function requireMethod(string ...$allowed): void
    {
        if (!in_array(self::method(), array_map('strtoupper', $allowed), true)) {
            self::error('Méthode non autorisée.', 405);
        }
    }
}
