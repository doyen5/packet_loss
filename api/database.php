<?php
declare(strict_types=1);

/**
 * Connexion PDO historique — conservée pour compatibilité.
 *
 * Les identifiants ne sont PLUS dans le code : ils proviennent de .env
 * via Npm\Database. getPDO() pointe sur la base métier de la Côte d'Ivoire
 * (source historique). Le routage multi-pays sera introduit au Lot 3/4.
 */

require_once __DIR__ . '/bootstrap.php';

use Npm\Database;

function getPDO(?string $country = 'CI'): PDO
{
    return Database::country($country ?? 'CI');
}
