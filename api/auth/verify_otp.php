<?php
declare(strict_types=1);

/**
 * Vérification du code 2FA : POST { code }
 * Complète une connexion initiée par login.php lorsque la 2FA est activée.
 */

use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Security\Otp;

require __DIR__ . '/../bootstrap.php';

Json::requireMethod('POST');
Csrf::requireValid();

$userId = Auth::pendingTwoFactor();
if ($userId === null) {
    Json::error('Aucune vérification en attente. Reconnectez-vous.', 400);
}

$input = Json::input();
$code = preg_replace('/\D/', '', (string) ($input['code'] ?? '')) ?? '';
if (strlen($code) !== 6) {
    Json::error('Code invalide.', 422);
}

$result = Otp::verify($userId, $code, 'login');
if (!$result['ok']) {
    $messages = [
        'no_code'   => 'Aucun code actif. Demandez-en un nouveau.',
        'expired'   => 'Code expiré. Reconnectez-vous.',
        'too_many'  => 'Trop de tentatives. Reconnectez-vous.',
        'invalid'   => 'Code incorrect.',
    ];
    Json::error($messages[$result['reason'] ?? 'invalid'] ?? 'Code incorrect.', 401);
}

if (!Auth::completeTwoFactor($userId)) {
    Json::error('Connexion impossible.', 401);
}

$user = Auth::user();
Json::ok([
    'user'        => $user,
    'permissions' => $user['permissions'] ?? [],
    'csrf'        => Csrf::token(),
    'redirect'    => 'index.html',
]);
