<?php
declare(strict_types=1);

/**
 * Profil de l'utilisateur connecté.
 *   GET  : lecture (nom, email, rôle, pays, 2FA, préférences)
 *   POST : mise à jour { full_name, preferences }
 */

use Npm\Audit;
use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Repositories\UserRepository;

require __DIR__ . '/../bootstrap.php';

Auth::requireLogin();
$userId = (int) Auth::id();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $row = UserRepository::findById($userId);
    if ($row === null) {
        Json::error('Utilisateur introuvable.', 404);
    }
    Json::ok([
        'profile' => [
            'id'                 => (int) $row['id'],
            'email'              => (string) $row['email'],
            'full_name'          => (string) $row['full_name'],
            'role'               => (string) $row['role'],
            'countries'          => UserRepository::countriesFor($userId),
            'two_factor_enabled' => (int) $row['two_factor_enabled'] === 1,
            'preferences'        => UserRepository::preferences($userId),
            'last_login'         => $row['last_login'],
        ],
    ]);
}

Json::requireMethod('POST');
Csrf::requireValid();

$input = Json::input();
$fullName = trim((string) ($input['full_name'] ?? ''));
if (mb_strlen($fullName) < 2) {
    Json::error('Nom complet trop court.', 422);
}
if (mb_strlen($fullName) > 120) {
    Json::error('Nom complet trop long.', 422);
}

$allowed = ['theme', 'defaultCountry', 'defaultThreshold', 'refreshSeconds', 'emailAlerts'];
$prefs = [];
$rawPrefs = $input['preferences'] ?? null;
if (is_array($rawPrefs)) {
    foreach ($allowed as $key) {
        if (array_key_exists($key, $rawPrefs)) {
            $prefs[$key] = $rawPrefs[$key];
        }
    }
}

UserRepository::updateFullName($userId, $fullName);
UserRepository::setPreferences($userId, $prefs);

if (isset($_SESSION['user']) && is_array($_SESSION['user'])) {
    $_SESSION['user']['full_name'] = $fullName;
}

Audit::log($userId, 'account.profile', 'user', (string) $userId, ['preferences' => array_keys($prefs)]);
Json::ok(['message' => 'Profil mis à jour.', 'profile' => ['full_name' => $fullName, 'preferences' => $prefs]]);
