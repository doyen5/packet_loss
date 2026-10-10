<?php
declare(strict_types=1);

use Npm\Env;

Env::load(dirname(__DIR__) . '/.env');

return [
    'env'   => Env::get('APP_ENV', 'local'),
    'debug' => Env::bool('APP_DEBUG', false),
    'url'   => rtrim((string) Env::get('APP_URL', 'http://localhost/PACKET_LOSS'), '/'),
    'name'  => Env::get('APP_NAME', 'Packet Loss Intelligence'),

    'session' => [
        'name'     => Env::get('SESSION_NAME', 'pl_session'),
        'lifetime' => Env::int('SESSION_LIFETIME', 28800),
    ],

    'mail' => [
        'driver' => Env::get('MAIL_DRIVER', 'log'),
        'from'   => Env::get('MAIL_FROM', 'alerts@packetloss.local'),
    ],

    'sms' => [
        'driver' => Env::get('SMS_DRIVER', 'log'),
    ],
];
