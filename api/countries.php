<?php
declare(strict_types=1);

/**
 * Liste des pays accessibles à l'utilisateur connecté.
 * Source de vérité : config/countries.php ∩ user_countries.
 */

use Npm\Auth;
use Npm\Config;
use Npm\Http\Json;

require __DIR__ . '/bootstrap.php';

$user = Auth::user();
if ($user === null) {
    Json::error('Non authentifié.', 401);
}

$allowed = array_map('strval', $user['countries'] ?? []);
$all = Config::get('countries', []);

$list = [];
foreach ($allowed as $code) {
    $c = is_array($all[$code] ?? null) ? $all[$code] : null;
    if ($c === null || empty($c['enabled'])) {
        continue;
    }
    $list[] = [
        'code'                 => (string) $code,
        'name'                 => (string) $c['name'],
        'flag'                 => (string) $c['flag'],
        'image'                => 'assets/images/' . strtolower((string) $code) . '.png',
        'modules'              => array_values($c['modules'] ?? []),
        'packet_loss_available'=> (bool) ($c['packet_loss']['available'] ?? false),
    ];
}

Json::ok(['countries' => $list]);