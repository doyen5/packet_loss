<?php
declare(strict_types=1);

/**
 * Création d'un utilisateur applicatif (npm_core).
 *
 * Usage :
 *   php bin/create_user.php <email> <mot_de_passe|-> "<nom complet>" [ROLE] [CI,BJ]
 *
 *   - mot_de_passe "-" : un mot de passe aléatoire est généré et affiché
 *   - ROLE par défaut   : USER (voir Npm\Rbac::ROLES)
 *   - pays par défaut   : CI
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Script en ligne de commande uniquement.\n");
    exit(1);
}

use Npm\Database;
use Npm\Rbac;
use Npm\Validator;

require __DIR__ . '/../api/bootstrap.php';

$args = array_slice($argv, 1);
if (count($args) < 2) {
    fwrite(STDERR, "Usage: php bin/create_user.php <email> <mot_de_passe|-> \"<nom complet>\" [ROLE] [CI,BJ]\n");
    exit(1);
}

$email = trim($args[0]);
$password = $args[1];
$fullName = trim($args[2] ?? '');
$role = strtoupper(trim($args[3] ?? Rbac::ROLE_USER));
$countriesArg = strtoupper(trim($args[4] ?? 'CI'));

if (!Validator::email($email)) {
    fwrite(STDERR, "Email invalide : $email\n");
    exit(1);
}
if ($fullName === '') {
    fwrite(STDERR, "Nom complet requis.\n");
    exit(1);
}
if (!Rbac::isValidRole($role)) {
    fwrite(STDERR, "Rôle invalide : $role (attendu : " . implode(', ', Rbac::ROLES) . ")\n");
    exit(1);
}

$generated = false;
if ($password === '-' || $password === '') {
    $password = bin2hex(random_bytes(9));
    $generated = true;
}

$codes = $countriesArg === '' ? [] : array_values(array_filter(array_map('trim', explode(',', $countriesArg))));

$pdo = Database::core();

$roleStmt = $pdo->prepare('SELECT id FROM roles WHERE name = ?');
$roleStmt->execute([$role]);
$roleId = $roleStmt->fetchColumn();
if ($roleId === false) {
    fwrite(STDERR, "Rôle introuvable en base : $role (lancer bin/migrate.php d'abord)\n");
    exit(1);
}

foreach ($codes as $code) {
    $check = $pdo->prepare('SELECT COUNT(*) FROM countries WHERE code = ?');
    $check->execute([$code]);
    if ((int) $check->fetchColumn() === 0) {
        fwrite(STDERR, "Pays inconnu : $code\n");
        exit(1);
    }
}

try {
    $pdo->beginTransaction();

    $insert = $pdo->prepare(
        'INSERT INTO users (email, password_hash, full_name, role_id, is_active) VALUES (?, ?, ?, ?, 1)'
    );
    $insert->execute([$email, password_hash($password, PASSWORD_DEFAULT), $fullName, (int) $roleId]);
    $userId = (int) $pdo->lastInsertId();

    $assign = $pdo->prepare('INSERT INTO user_countries (user_id, country_code) VALUES (?, ?)');
    foreach ($codes as $code) {
        $assign->execute([$userId, $code]);
    }

    $pdo->commit();
} catch (\Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, "Échec de création : " . $e->getMessage() . "\n");
    exit(1);
}

echo "Utilisateur créé : $email (id=$userId, rôle=$role, pays=" . implode(',', $codes) . ")\n";
if ($generated) {
    echo "Mot de passe généré (à changer au 1er login) : $password\n";
}
