<?php
declare(strict_types=1);

namespace Npm;

use Npm\Database;

/**
 * Journal d'audit applicatif (table audit_log de npm_core).
 */
final class Audit
{
    public static function log(
        ?int $userId,
        string $action,
        ?string $entity = null,
        ?string $entityId = null,
        array $details = []
    ): void {
        $stmt = Database::core()->prepare(
            'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $userId,
            $action,
            $entity,
            $entityId,
            json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : null,
        ]);
    }
}