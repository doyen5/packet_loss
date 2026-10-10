<?php
declare(strict_types=1);

/**
 * Gestion des rôles et permissions (console d'administration).
 *
 * GET  api/admin/roles.php                  → rôles + catalogue des permissions
 * POST api/admin/roles.php {action:"set"}   → remplace les permissions d'un rôle
 *
 * Réservé aux comptes disposant de la permission roles.manage.
 */

use Npm\Audit;
use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Rbac;

require __DIR__ . '/../bootstrap.php';

Auth::requireLogin();
Rbac::require(Auth::role(), 'roles.manage');

$meId = (int) Auth::id();
$method = Json::method();

if ($method === 'GET') {
    $roles = [];
    foreach (Rbac::ROLES as $name) {
        $roles[] = [
            'name'        => $name,
            'permissions' => Rbac::permissionsFor($name),
            'locked'      => $name === Rbac::ROLE_SUPER_ADMIN,
        ];
    }
    Json::ok([
        'roles'   => $roles,
        'catalog' => Rbac::PERMISSIONS,
    ]);
}

if ($method !== 'POST') {
    Json::error('Méthode non autorisée.', 405);
}

Csrf::requireValid();
$input = Json::input();
$action = (string) ($input['action'] ?? '');

if ($action === 'set') {
    $role = strtoupper(trim((string) ($input['role'] ?? '')));
    if (!Rbac::isValidRole($role)) {
        Json::error('Rôle invalide.', 422);
    }
    if ($role === Rbac::ROLE_SUPER_ADMIN) {
        Json::error('Le rôle SUPER_ADMIN dispose toujours de toutes les permissions.', 422);
    }

    $permissions = is_array($input['permissions'] ?? null) ? $input['permissions'] : [];
    $invalid = array_values(array_filter(
        array_map('strval', $permissions),
        static fn (string $p): bool => !Rbac::isValidPermission($p)
    ));
    if ($invalid) {
        Json::error('Permission(s) inconnue(s) : ' . implode(', ', $invalid), 422);
    }

    Rbac::setPermissions($role, $permissions);
    Audit::log($meId, 'roles.set', 'role', $role, ['permissions' => array_values($permissions)]);

    Json::ok([
        'message'     => 'Permissions mises à jour.',
        'role'        => $role,
        'permissions' => Rbac::permissionsFor($role),
    ]);
}

Json::error('Action inconnue.', 422);
