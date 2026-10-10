<?php
declare(strict_types=1);

/**
 * Connexion : POST { email, password }
 */

use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;

require __DIR__ . '/../bootstrap.php';

Json::requireMethod('POST');

$input = Json::input();
$email = strtolower(trim((string) ($input['email'] ?? '')));
$password = (string) ($input['password'] ?? '');

if ($email === '' || $password === '') {
    Json::error('Email et mot de passe requis.', 422);
}

$result = Auth::attempt($email, $password);

if (!empty($result['two_factor'])) {
    Json::ok([
        'two_factor' => true,
        'message'    => 'Un code de vérification vous a été envoyé par email.',
        'csrf'       => Csrf::token(),
    ]);
}

if (!$result['success']) {
    $throttled = ($result['reason'] ?? '') === 'throttled';
    Json::error(
        $throttled ? 'Trop de tentatives. Réessayez plus tard.' : 'Email ou mot de passe incorrect.',
        $throttled ? 429 : 401,
        ['reason' => $result['reason'] ?? 'invalid_credentials']
    );
}

$user = $result['user'];
Json::ok([
    'user'        => $user,
    'permissions' => $user['permissions'],
    'csrf'        => Csrf::token(),
    'redirect'    => 'index.html',
]);