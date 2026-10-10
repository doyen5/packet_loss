<?php
declare(strict_types=1);

namespace Npm;

use Npm\Http\Json;

/**
 * Contrôle d'accès basé sur les rôles (RBAC).
 *
 * Source de vérité unique, alignée sur la matrice (voir README / docs).
 * À appliquer côté serveur sur CHAQUE endpoint sensible, et côté client
 * uniquement pour masquer l'interface.
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

    public static function isValidRole(?string $role): bool
    {
        return $role !== null && in_array($role, self::ROLES, true);
    }

    public static function can(?string $role, string $permission): bool
    {
        if ($role === null) {
            return false;
        }
        $perms = self::MATRIX[$role] ?? [];
        if ($perms === '*') {
            return true;
        }
        return in_array($permission, $perms, true);
    }

    /** @return list<string> */
    public static function permissionsFor(string $role): array
    {
        $perms = self::MATRIX[$role] ?? [];
        return $perms === '*' ? self::PERMISSIONS : $perms;
    }

    public static function require(?string $role, string $permission): void
    {
        if (!self::can($role, $permission)) {
            Json::error('Accès refusé.', 403);
        }
    }
}
