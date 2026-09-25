<?php
/**
 * PACKET LOSS - CONNEXION PDO
 *
 * Les identifiants restent côté serveur et ne sont jamais exposés
 * au navigateur.
 *
 * ⚠️ VERSION DE TEST LOCAL
 * Le mot de passe est exposé en clair pour permettre les tests sur
 * localhost. En production, revenir à la variable d'environnement
 * DB_PASSWORD (voir historique Git).
 */
declare(strict_types=1);

const DB_HOST = '10.171.16.120';
const DB_PORT = 3306;
const DB_NAME = 'prismis';
const DB_USER = 'root';

/* ⚠️ Mot de passe en clair — UNIQUEMENT pour test local */
const DB_PASSWORD = 'performance';

function getPDO(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        DB_HOST, DB_PORT, DB_NAME
    );

    $pdo = new PDO($dsn, DB_USER, DB_PASSWORD, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 30
    ]);

    $pdo->exec("SET NAMES utf8mb4");
    return $pdo;
}