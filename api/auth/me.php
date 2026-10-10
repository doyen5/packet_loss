<?php
declare(strict_types=1);

/**
 * Session courante : GET
 * Renvoie l'utilisateur connecté + ses permissions + jeton CSRF,
 * ou 401 si non authentifié.
 */

use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;

require __DIR__ . '/../bootstrap.php';

$user = Auth::user();
if ($user === null) {
    Json::error('Non authentifié.', 401);
}

Json::ok([
    'user'        => $user,
    'permissions' => $user['permissions'],
    'csrf'        => Csrf::token(),
]);