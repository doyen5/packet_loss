<?php
/**
 * API — Sauvegarde et lecture des règles d'alerte email.
 *
 * GET  /api/save_alerts.php    → retourne les règles actuelles
 * POST /api/save_alerts.php    → enregistre de nouvelles règles
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$rulesFile = __DIR__ . '/../data/alert_rules.json';

/* Crée le dossier data/ si absent */
$dataDir = dirname($rulesFile);
if(!is_dir($dataDir)){
    @mkdir($dataDir, 0775, true);
}

/* ----- GET : retourne les règles ----- */
if($_SERVER['REQUEST_METHOD'] === 'GET'){
    if(!file_exists($rulesFile)){
        echo json_encode([
            'success' => true,
            'rules'   => [
                'email'     => '',
                'min_hours' => 3,
                'frequency' => 'hourly',
                'sites'     => [],
                'enabled'   => false,
                'updated_at'=> null
            ]
        ]);
        exit;
    }
    $rules = json_decode(file_get_contents($rulesFile), true) ?: [];
    echo json_encode(['success' => true, 'rules' => $rules]);
    exit;
}

/* ----- POST : enregistre ----- */
if($_SERVER['REQUEST_METHOD'] !== 'POST'){
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Méthode non autorisée.']);
    exit;
}

$input = json_decode(file_get_contents('php://input') ?: '', true);
if(!is_array($input)){
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'JSON invalide.']);
    exit;
}

$email     = filter_var($input['email'] ?? '', FILTER_VALIDATE_EMAIL);
$minHours  = max(1, min(72, (int)($input['min_hours'] ?? 3)));
$frequency = in_array($input['frequency'] ?? '', ['hourly','daily','weekly'], true)
    ? $input['frequency'] : 'hourly';
$sites     = [];

foreach(($input['sites'] ?? []) as $s){
    if(!is_scalar($s)) continue;
    $site = strtoupper(trim((string)$s));
    if($site !== '') $sites[] = $site;
}
$sites = array_values(array_unique($sites));

if(!$email){
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Email invalide.']);
    exit;
}

$rules = [
    'email'      => $email,
    'min_hours'  => $minHours,
    'frequency'  => $frequency,
    'sites'      => $sites,
    'enabled'    => true,
    'updated_at' => date('c')
];

/* Écriture atomique */
$tmp = $rulesFile . '.tmp';
file_put_contents($tmp, json_encode($rules, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
rename($tmp, $rulesFile);

echo json_encode(['success' => true, 'rules' => $rules]);