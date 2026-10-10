<?php
declare(strict_types=1);

/**
 * Changement de mot de passe : POST { current_password, new_password }
 * Authentification + protection CSRF requises.
 *
 * Le changement invalide toutes les autres sessions de l'utilisateur
 * (session_version + révocation des jetons) tout en gardant la session
 * courante active.
 */

use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Repositories\SessionRepository;
use Npm\Repositories\UserRepository;
use Npm\Security\PasswordPolicy;

require __DIR__ . '/../bootstrap.php';

Json::requireMethod('POST');
Auth::requireLogin();
Csrf::requireValid();

$input = Json::input();
$current = (string) ($input['current_password'] ?? '');
$new = (string) ($input['new_password'] ?? '');

$policyError = PasswordPolicy::validate($new);
if ($policyError !== null) {
    Json::error($policyError, 422);
}

$userId = (int) Auth::id();
$user = UserRepository::findById($userId);
if ($user === null) {
    Json::error('Utilisateur introuvable.', 404);
}

if (!password_verify($current, (string) $user['password_hash'])) {
    Json::error('Mot de passe actuel incorrect.', 400);
}

if (password_verify($new, (string) $user['password_hash'])) {
    Json::error('Le nouveau mot de passe doit être différent de l\'actuel.', 422);
}

UserRepository::updatePassword($userId, password_hash($new, PASSWORD_DEFAULT));

// Invalidation globale puis ré-établissement de la session courante.
UserRepository::bumpSessionVersion($userId);
SessionRepository::revokeAllForUser($userId);
Auth::refreshSession();

Json::ok(['message' => 'Mot de passe modifié. Les autres sessions ont été déconnectées.']);
