<?php
/**
 * PACKET LOSS - API
 *
 * POST api/packet_loss.php
 *
 * Reçoit :
 * {
 *   "sites": ["AC078","AC155"],
 *   "vendor": "ALL",
 *   "start_date": "2026-09-09",
 *   "end_date": "2026-09-16",
 *   "country": "CI"
 * }
 *
 * La requête métier Ericsson/Huawei est conservée (voir Npm\PacketLossAnalyzer).
 * Seuls les dates, les sites et le pays sont paramétrés.
 */
declare(strict_types=1);

use Npm\Auth;
use Npm\Config;
use Npm\Http\Json;
use Npm\PacketLossAnalyzer;
use Npm\Rbac;
use Npm\Security\RateLimiter;

require_once __DIR__ . '/bootstrap.php';

/* Authentification + permission de consultation obligatoires. */
Auth::requireLogin();
Rbac::require(Auth::role(), 'packet_loss.view');

/* Limitation de débit : 60 requêtes / minute / utilisateur. */
try {
    if (!RateLimiter::hit('packet_loss:user:' . (string) Auth::id(), 60, 1)) {
        Json::error('Trop de requêtes. Réessayez dans une minute.', 429);
    }
} catch (\Throwable $e) {
    // table rate_limits indisponible : on ne bloque pas l'analyse.
}

Json::requireMethod('POST');

$input = Json::input();
if ($input === []) {
    Json::error('JSON invalide.', 400);
}

/* ============================================================
   1. RÉCUPÉRATION DE TOUS LES SITES IMPORTÉS
   ============================================================ */
$sites = [];
foreach (($input['sites'] ?? []) as $site) {
    if (!is_scalar($site)) {
        continue;
    }
    $site = strtoupper(trim((string) $site));
    if ($site !== '') {
        $sites[] = $site;
    }
}
$sites = array_values(array_unique($sites));

if (!$sites) {
    Json::error('Aucun site.', 400);
}

/*
 * Cette limite est technique uniquement.
 * Il n'existe PAS de liste de sites autorisés.
 */
if (count($sites) > 2000) {
    Json::error('Maximum technique : 2000 sites.', 400);
}

/* ============================================================
   2. DATES ET VENDOR
   ============================================================ */
$start  = trim((string) ($input['start_date'] ?? ''));
$end    = trim((string) ($input['end_date'] ?? ''));
$vendor = strtoupper(trim((string) ($input['vendor'] ?? 'ALL')));

$validDate = static function (string $date): bool {
    $d = DateTime::createFromFormat('Y-m-d', $date);
    return $d !== false && $d->format('Y-m-d') === $date;
};

if (!$validDate($start) || !$validDate($end)) {
    Json::error('Dates invalides. Format YYYY-MM-DD.', 400);
}
if ($start > $end) {
    Json::error('Date début > date fin.', 400);
}
if (!in_array($vendor, ['ALL', 'ERICSSON', 'HUAWEI'], true)) {
    Json::error('Vendor invalide.', 400);
}

/* ============================================================
   2bis. PAYS — routage multi-pays (voir config/countries.php)
   L'accès est restreint aux pays assignés au compte connecté.
   ============================================================ */
$countryCode = strtoupper(trim((string) ($input['country'] ?? '')));
$country = Config::get('countries.' . $countryCode);

if (!is_array($country) || empty($country['enabled'])) {
    Json::error('Pays inconnu ou désactivé.', 400);
}

if (empty($country['packet_loss']['available'])) {
    Json::error('Module Packet Loss indisponible pour ce pays.', 400);
}

$sessionUser = Auth::user() ?? [];
$allowedCountries = array_map('strval', $sessionUser['countries'] ?? []);
if (!Auth::superAdmin() && !in_array($countryCode, $allowedCountries, true)) {
    Json::error('Accès refusé : pays non autorisé pour votre compte.', 403);
}

/* ============================================================
   3. ANALYSE (logique métier partagée avec le cron d'alertes)
   ============================================================ */
try {
    $result = PacketLossAnalyzer::analyze($countryCode, $sites, $start, $end, $vendor, 0.1);
} catch (Throwable $e) {
    error_log('Packet Loss API: ' . $e->getMessage());
    Json::error('Erreur lors de la récupération des données Packet Loss.', 500);
}

Json::ok($result);
