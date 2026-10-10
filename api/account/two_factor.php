<?php
declare(strict_types=1);

/**
 * Double authentification par email de l'utilisateur connecté.
 *   GET  : statut
 *   POST : { action: "enable" }                    -> envoie un code
 *          { action: "confirm", code }             -> active la 2FA
 *          { action: "disable", password }         -> désactive la 2FA
 */

use Npm\Audit;
use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Repositories\UserRepository;
use Npm\Security\Otp;

require __DIR__ . '/../bootstrap.php';

Auth::requireLogin();
$userId = (int) Auth::id();
$sessionUser = Auth::user();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $row = UserRepository::findById($userId);
    Json::ok(['enabled' => (int) $row['two_factor_enabled'] === 1]);
}

Json::requireMethod('POST');
Csrf::requireValid();

$input = Json::input();
$action = (string) ($input['action'] ?? '');

if ($action === 'enable') {
    Otp::issue($userId, (string) $sessionUser['email'], 'enable_2fa');
    Json::ok(['message' => 'Un code de vérification a été envoyé par email.']);
}

if ($action === 'confirm') {
    $code = preg_replace('/\D/', '', (string) ($input['code'] ?? '')) ?? '';
    if (strlen($code) !== 6) {
        Json::error('Code invalide.', 422);
    }
    $result = Otp::verify($userId, $code, 'enable_2fa');
    if (!$result['ok']) {
        Json::error('Code incorrect ou expiré.', 401);
    }
    UserRepository::setTwoFactor($userId, true);
    Audit::log($userId, 'account.2fa.enable', 'user', (string) $userId);
    Json::ok(['message' => 'Double authentification activée.', 'enabled' => true]);
}

if ($action === 'disable') {
    $password = (string) ($input['password'] ?? '');
    $row = UserRepository::findById($userId);
    if ($row === null || !password_verify($password, (string) $row['password_hash'])) {
        Json::error('Mot de passe incorrect.', 400);
    }
    UserRepository::setTwoFactor($userId, false);
    Audit::log($userId, 'account.2fa.disable', 'user', (string) $userId);
    Json::ok(['message' => 'Double authentification désactivée.', 'enabled' => false]);
}

Json::error('Action inconnue.', 422);
