<?php
declare(strict_types=1);

/**
 * Gestion des utilisateurs (console d'administration).
 *
 * GET  api/admin/users.php                     → liste + rôles + pays
 * POST api/admin/users.php  {action:"create"}  → création
 * POST api/admin/users.php  {action:"update"}  → modification (rôle/actif/nom/pays)
 * POST api/admin/users.php  {action:"password"}→ réinitialisation du mot de passe
 * POST api/admin/users.php  {action:"delete"}  → suppression
 *
 * Réservé aux comptes disposant de la permission users.manage.
 * Toutes les écritures requièrent un jeton CSRF.
 */

use Npm\Audit;
use Npm\Auth;
use Npm\Database;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Rbac;
use Npm\Repositories\UserRepository;
use Npm\Validator;

require __DIR__ . '/../bootstrap.php';

Auth::requireLogin();
Rbac::require(Auth::role(), 'users.manage');

$meId = (int) Auth::id();

function dbCountries(): array
{
    $stmt = Database::core()->query(
        'SELECT code, name, flag, enabled FROM countries ORDER BY code'
    );
    return $stmt->fetchAll();
}

function validateCountries(array $pdoCountries, array $codes): bool
{
    $allowed = array_map(fn ($c) => (string) $c['code'], $pdoCountries);
    foreach ($codes as $code) {
        if (!in_array((string) $code, $allowed, true)) {
            return false;
        }
    }
    return true;
}

if (Json::method() === 'GET') {
    $stmt = Database::core()->query(
        'SELECT u.id, u.email, u.full_name, u.role_id, u.is_active, u.last_login, r.name AS role
         FROM users u JOIN roles r ON r.id = u.role_id
         ORDER BY u.id'
    );
    $users = [];
    foreach ($stmt->fetchAll() as $row) {
        $users[] = [
            'id'         => (int) $row['id'],
            'email'      => (string) $row['email'],
            'full_name'  => (string) $row['full_name'],
            'role'       => (string) $row['role'],
            'is_active'  => (bool) (int) $row['is_active'],
            'last_login' => $row['last_login'],
            'countries'  => UserRepository::countriesFor((int) $row['id']),
        ];
    }

    Json::ok([
        'current_user_id' => $meId,
        'users'           => $users,
        'meta'            => [
            'roles'     => Rbac::ROLES,
            'countries' => dbCountries(),
        ],
    ]);
}

Csrf::requireValid();

$input = Json::input();
$action = strtolower(trim((string) ($input['action'] ?? '')));
$pdoCountries = dbCountries();

switch ($action) {
    case 'create':
        createUser($input, $pdoCountries, $meId);
        break;
    case 'update':
        updateUser($input, $pdoCountries, $meId);
        break;
    case 'password':
        resetPassword($input, $meId);
        break;
    case 'delete':
        deleteUser($input, $meId);
        break;
    default:
        Json::error('Action inconnue.', 400);
}

function createUser(array $input, array $pdoCountries, int $meId): never
{
    $email = strtolower(trim((string) ($input['email'] ?? '')));
    $fullName = trim((string) ($input['full_name'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    $role = strtoupper(trim((string) ($input['role'] ?? '')));
    $countries = array_values(array_filter(array_map('strval', $input['countries'] ?? [])));

    if (!Validator::email($email)) {
        Json::error('Email invalide.', 422);
    }
    if (mb_strlen($fullName) < 2) {
        Json::error('Nom complet trop court.', 422);
    }
    if (mb_strlen($password) < 8) {
        Json::error('Mot de passe : 8 caractères minimum.', 422);
    }
    if (!Rbac::isValidRole($role)) {
        Json::error('Rôle invalide.', 422);
    }
    if (!validateCountries($pdoCountries, $countries)) {
        Json::error('Un ou plusieurs pays invalides.', 422);
    }

    $pdo = Database::core();
    try {
        $pdo->beginTransaction();
        $stmt = $pdo->prepare('SELECT id FROM roles WHERE name = ?');
        $stmt->execute([$role]);
        $roleId = (int) $stmt->fetchColumn();

        $insert = $pdo->prepare(
            'INSERT INTO users (email, password_hash, full_name, role_id, is_active) VALUES (?, ?, ?, ?, 1)'
        );
        $insert->execute([$email, password_hash($password, PASSWORD_DEFAULT), $fullName, $roleId]);
        $userId = (int) $pdo->lastInsertId();

        $assign = $pdo->prepare('INSERT INTO user_countries (user_id, country_code) VALUES (?, ?)');
        foreach ($countries as $code) {
            $assign->execute([$userId, $code]);
        }
        $pdo->commit();
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($e instanceof PDOException && (int) $e->getCode() === 23000) {
            Json::error('Cet email est déjà utilisé.', 409);
        }
        Json::error('Erreur lors de la création.', 500);
    }

    Audit::log($meId, 'users.create', 'user', (string) $userId, [
        'email' => $email, 'role' => $role, 'countries' => $countries,
    ]);

    Json::ok(['message' => 'Utilisateur créé.', 'id' => $userId], 201);
}

function updateUser(array $input, array $pdoCountries, int $meId): never
{
    $userId = (int) ($input['id'] ?? 0);
    if ($userId <= 0) {
        Json::error('Identifiant utilisateur manquant.', 422);
    }

    $pdo = Database::core();
    $row = UserRepository::findById($userId);
    if ($row === null) {
        Json::error('Utilisateur introuvable.', 404);
    }

    $fullName = isset($input['full_name']) ? trim((string) $input['full_name']) : (string) $row['full_name'];
    $role = isset($input['role']) ? strtoupper(trim((string) $input['role'])) : (string) $row['role'];
    $isActive = isset($input['is_active']) ? ((bool) $input['is_active'] ? 1 : 0) : (int) $row['is_active'];
    $countries = isset($input['countries']) ? array_values(array_filter(array_map('strval', $input['countries']))) : null;

    if (mb_strlen($fullName) < 2) {
        Json::error('Nom complet trop court.', 422);
    }
    if (!Rbac::isValidRole($role)) {
        Json::error('Rôle invalide.', 422);
    }
    if ($countries !== null && !validateCountries($pdoCountries, $countries)) {
        Json::error('Un ou plusieurs pays invalides.', 422);
    }

    if ($userId === $meId && ((string) $row['role'] !== $role || (int) $row['is_active'] !== $isActive)) {
        Json::error('Vous ne pouvez pas modifier votre propre rôle ou désactiver votre compte.', 422);
    }

    try {
        $pdo->beginTransaction();
        $stmt = $pdo->prepare('SELECT id FROM roles WHERE name = ?');
        $stmt->execute([$role]);
        $roleId = (int) $stmt->fetchColumn();

        $upd = $pdo->prepare('UPDATE users SET full_name = ?, role_id = ?, is_active = ? WHERE id = ?');
        $upd->execute([$fullName, $roleId, $isActive, $userId]);

        if ($countries !== null) {
            $pdo->prepare('DELETE FROM user_countries WHERE user_id = ?')->execute([$userId]);
            $assign = $pdo->prepare('INSERT INTO user_countries (user_id, country_code) VALUES (?, ?)');
            foreach ($countries as $code) {
                $assign->execute([$userId, $code]);
            }
        }
        $pdo->commit();
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        Json::error('Erreur lors de la mise à jour.', 500);
    }

    Audit::log($meId, 'users.update', 'user', (string) $userId, [
        'role' => $role, 'active' => (bool) $isActive, 'countries' => $countries,
    ]);

    Json::ok(['message' => 'Utilisateur mis à jour.']);
}

function resetPassword(array $input, int $meId): never
{
    $userId = (int) ($input['id'] ?? 0);
    if ($userId <= 0) {
        Json::error('Identifiant utilisateur manquant.', 422);
    }
    $password = (string) ($input['password'] ?? '');
    if (mb_strlen($password) < 8) {
        Json::error('Mot de passe : 8 caractères minimum.', 422);
    }

    $row = UserRepository::findById($userId);
    if ($row === null) {
        Json::error('Utilisateur introuvable.', 404);
    }

    UserRepository::updatePassword($userId, password_hash($password, PASSWORD_DEFAULT));
    Audit::log($meId, 'users.password', 'user', (string) $userId);
    Json::ok(['message' => 'Mot de passe réinitialisé.']);
}

function deleteUser(array $input, int $meId): never
{
    $userId = (int) ($input['id'] ?? 0);
    if ($userId <= 0) {
        Json::error('Identifiant utilisateur manquant.', 422);
    }
    if ($userId === $meId) {
        Json::error('Vous ne pouvez pas supprimer votre propre compte.', 422);
    }

    $row = UserRepository::findById($userId);
    if ($row === null) {
        Json::error('Utilisateur introuvable.', 404);
    }

    Database::core()->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
    Audit::log($meId, 'users.delete', 'user', (string) $userId, ['email' => (string) $row['email']]);
    Json::ok(['message' => 'Utilisateur supprimé.']);
}