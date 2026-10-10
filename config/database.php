<?php
declare(strict_types=1);

use Npm\Env;

Env::load(dirname(__DIR__) . '/.env');

/**
 * Connexions de base de données. AUCUN identifiant en dur : tout vient
 * du fichier .env (voir .env.example).
 */
return [
    // Base applicative centrale.
    'core' => [
        'host' => Env::get('DB_CORE_HOST', '127.0.0.1'),
        'port' => Env::int('DB_CORE_PORT', 3306),
        'name' => Env::get('DB_CORE_NAME', 'npm_core'),
        'user' => Env::get('DB_CORE_USER', 'root'),
        'pass' => Env::get('DB_CORE_PASS', ''),
    ],

    // Sources métier par pays (lecture seule).
    'countries' => [
        'CI' => [
            'host' => Env::get('DB_CI_HOST', '127.0.0.1'),
            'port' => Env::int('DB_CI_PORT', 3306),
            'name' => Env::get('DB_CI_NAME', 'prismis'),
            'user' => Env::get('DB_CI_USER', 'root'),
            'pass' => Env::get('DB_CI_PASS', ''),
        ],
        'BJ' => [
            'host' => Env::get('DB_BJ_HOST', '127.0.0.1'),
            'port' => Env::int('DB_BJ_PORT', 3306),
            'name' => Env::get('DB_BJ_NAME', 'prismis'),
            'user' => Env::get('DB_BJ_USER', 'root'),
            'pass' => Env::get('DB_BJ_PASS', ''),
        ],
        'TG' => [
            'host' => Env::get('DB_TG_HOST', '127.0.0.1'),
            'port' => Env::int('DB_TG_PORT', 3306),
            'name' => Env::get('DB_TG_NAME', 'prismis'),
            'user' => Env::get('DB_TG_USER', 'root'),
            'pass' => Env::get('DB_TG_PASS', ''),
        ],
    ],
];
