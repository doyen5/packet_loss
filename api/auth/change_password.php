<?php
declare(strict_types=1);

/**
 * Changement de mot de passe : POST { current_password, new_password }
 * Authentification + protection CSRF requises.
 */

use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Repositories\UserRepository;

require __DIR__ . '/../bootstrap.php';

Json::requireMethod('POST');
Auth::requireLogin();
Csrf::requireValid();

$input = Json::input();
$current = (string) ($input['current_password'] ?? '');
$new = (string) ($input['new_password'] ?? '');

if (mb_strlen($new) < 8) {
    Json::error('Le nouveau mot de passe doit contenir au moins 8 caractères.', 422);
}

$user = UserRepository::findById((int) Auth::id());
if ($user === null) {
    Json::error('Utilisateur introuvable.', 404);
}

if (!password_verify($current, (string) $user['password_hash'])) {
    Json::error('Mot de passe actuel incorrect.', 400);
}

if (password_verify($new, (string) $user['password_hash'])) {
    Json::error('Le nouveau mot de passe doit être différent de l\'actuel.', 422);
}

UserRepository::updatePassword((int) $user['id'], password_hash($new, PASSWORD_DEFAULT));

Json::ok(['message' => 'Mot de passe modifié.']);