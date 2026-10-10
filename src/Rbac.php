<?php
declare(strict_types=1);

namespace Npm;

use Npm\Http\Json;
use PDO;

/**
 * Contrôle d'accès basé sur les rôles (RBAC).
 *
 * Les permissions proviennent de la table npm_core.role_permissions (éditable
 * via la console « Gestion des rôles »). La matrice historique sert de repli si
 * la table est absente ou vide. SUPER_ADMIN dispose de toutes les permissions.
 */
final class Rbac
{
    public const ROLE_SUPER_ADMIN = 'SUPER_ADMIN';
    public const ROLE_BACK_OFFICE = 'BACK_OFFICE';
    public const ROLE_DIRIGEANT  = 'DIRIGEANT';
    public const ROLE_USER       = 'USER';

    public const ROLES = [
        self::ROLE_SUPER_ADMIN,
        self::ROLE_BACK_OFFICE,
        self::ROLE_DIRIGEANT,
        self::ROLE_USER,
    ];

    public const PERMISSIONS = [
        'packet_loss.view',
        'packet_loss.export',
        'packet_loss.edit',
        'sleeping_cells.view',
        'sleeping_cells.export',
        'kpi_degraded.view',
        'kpi_degraded.export',
        'rna.view',
        'memory.manage',
        'alerts.manage',
        'automations.manage',
        'users.manage',
        'roles.manage',
        'countries.manage',
        'audit.view',
    ];

    /** Matrice de repli (utilisée uniquement si role_permissions est indisponible). */
    private const MATRIX = [
        self::ROLE_SUPER_ADMIN => '*',
        self::ROLE_BACK_OFFICE => [
            'packet_loss.view', 'packet_loss.export', 'packet_loss.edit',
            'sleeping_cells.view', 'sleeping_cells.export',
            'kpi_degraded.view', 'kpi_degraded.export',
            'rna.view', 'memory.manage', 'alerts.manage',
        ],
        self::ROLE_DIRIGEANT => [
            'packet_loss.view', 'packet_loss.export',
            'sleeping_cells.view', 'sleeping_cells.export',
            'kpi_degraded.view', 'kpi_degraded.export',
            'rna.view',
        ],
        self::ROLE_USER => [
            'packet_loss.view',
            'sleeping_cells.view',
            'kpi_degraded.view',
            'rna.view',
        ],
    ];

    /** @var array<string,list<string>> */
    private static array $cache = [];

    public static function isValidRole(?string $role): bool
    {
        return $role !== null && in_array($role, self::ROLES, true);
    }

    public static function isValidPermission(string $permission): bool
    {
        return in_array($permission, self::PERMISSIONS, true);
    }

    /** @return list<string> */
    public static function permissionsFor(string $role): array
    {
        if (isset(self::$cache[$role])) {
            return self::$cache[$role];
        }
        if ($role === self::ROLE_SUPER_ADMIN) {
            return self::$cache[$role] = self::PERMISSIONS;
        }

        $perms = [];
        try {
            $stmt = Database::core()->prepare(
                'SELECT rp.permission FROM role_permissions rp
                 JOIN roles r ON r.id = rp.role_id WHERE r.name = ?'
            );
            $stmt->execute([$role]);
            $perms = array_values(array_filter(
                array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN)),
                static fn (string $p): bool => self::isValidPermission($p)
            ));
        } catch (\Throwable $e) {
            $perms = [];
        }

        if (!$perms && isset(self::MATRIX[$role]) && is_array(self::MATRIX[$role])) {
            $perms = self::MATRIX[$role];
        }

        return self::$cache[$role] = $perms;
    }

    public static function can(?string $role, string $permission): bool
    {
        if ($role === null) {
            return false;
        }
        if ($role === self::ROLE_SUPER_ADMIN) {
            return true;
        }
        return in_array($permission, self::permissionsFor($role), true);
    }

    public static function require(?string $role, string $permission): void
    {
        if (!self::can($role, $permission)) {
            Json::error('Accès refusé.', 403);
        }
    }

    public static function flushCache(): void
    {
        self::$cache = [];
    }

    /** @param list<string> $permissions */
    public static function setPermissions(string $role, array $permissions): void
    {
        if (!self::isValidRole($role)) {
            return;
        }
        $valid = array_values(array_filter(
            array_unique(array_map('strval', $permissions)),
            static fn (string $p): bool => self::isValidPermission($p)
        ));

        $pdo = Database::core();
        $stmt = $pdo->prepare('SELECT id FROM roles WHERE name = ?');
        $stmt->execute([$role]);
        $roleId = (int) $stmt->fetchColumn();
        if ($roleId <= 0) {
            return;
        }

        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM role_permissions WHERE role_id = ?')->execute([$roleId]);
            $ins = $pdo->prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)');
            foreach ($valid as $p) {
                $ins->execute([$roleId, $p]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        self::flushCache();
    }
}
