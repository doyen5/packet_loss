<?php
declare(strict_types=1);

/**
 * Exécuteur de migrations.
 *
 * Usage :
 *   php bin/migrate.php              # applique les migrations (base npm_core)
 *   php bin/migrate.php --create-db  # crée npm_core si absent, puis applique
 *
 * Les fichiers sont lus dans sql/migrations/*.sql (ordre alphabétique) et
 * enregistrés dans la table schema_migrations.
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Script en ligne de commande uniquement.\n");
    exit(1);
}

use Npm\Config;
use Npm\Env;
use Npm\Database;

require __DIR__ . '/../api/bootstrap.php';

$options = $argv ?? [];
$createDb = in_array('--create-db', $options, true);

$core = Config::get('database.core');
if (!is_array($core)) {
    fwrite(STDERR, "Configuration 'database.core' introuvable.\n");
    exit(1);
}

if ($createDb) {
    $dsn = sprintf('mysql:host=%s;port=%d;charset=utf8mb4', (string) $core['host'], (int) $core['port']);
    $pdo = new PDO($dsn, (string) $core['user'], (string) $core['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
    $dbName = (string) $core['name'];
    $pdo->exec(sprintf(
        'CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
        str_replace('`', '', $dbName)
    ));
    echo "[db] Base '$dbName' prête.\n";
}

$pdo = Database::core();
$pdo->exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations ('
    . ' migration VARCHAR(191) NOT NULL PRIMARY KEY,'
    . ' applied_at DATETIME NOT NULL'
    . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

$applied = $pdo->query('SELECT migration FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
$applied = array_flip($applied);

$files = glob(__DIR__ . '/../sql/migrations/*.sql') ?: [];
sort($files);

/**
 * Découpe un script SQL en instructions, en ignorant les lignes de commentaire.
 *
 * @return list<string>
 */
function splitStatements(string $sql): array
{
    $statements = [];
    $buffer = '';
    foreach (preg_split('/\r\n|\r|\n/', $sql) ?: [] as $line) {
        $trimmed = ltrim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '--')) {
            continue;
        }
        $buffer .= $line . "\n";
        if (str_ends_with(rtrim($line), ';')) {
            $statements[] = trim($buffer);
            $buffer = '';
        }
    }
    if (trim($buffer) !== '') {
        $statements[] = trim($buffer);
    }
    return $statements;
}

$ran = 0;
foreach ($files as $file) {
    $name = basename($file);
    if (isset($applied[$name])) {
        echo "= $name (déjà appliquée)\n";
        continue;
    }

    echo "+ $name ... ";
    $sql = file_get_contents($file) ?: '';
    try {
        $statements = splitStatements($sql);
        foreach ($statements as $statement) {
            $pdo->exec($statement);
        }
        $stmt = $pdo->prepare('INSERT INTO schema_migrations (migration, applied_at) VALUES (?, NOW())');
        $stmt->execute([$name]);
        echo "OK (" . count($statements) . " instructions)\n";
        $ran++;
    } catch (\Throwable $e) {
        echo "ÉCHEC\n";
        fwrite(STDERR, '  ' . $e->getMessage() . "\n");
        exit(1);
    }
}

echo "Migrations appliquées : $ran\n";
