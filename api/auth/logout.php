<?php
declare(strict_types=1);

/**
 * Déconnexion : POST (CSRF requis)
 */

use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;

require __DIR__ . '/../bootstrap.php';

Json::requireMethod('POST');
Csrf::requireValid();

Auth::logout();
Json::ok();