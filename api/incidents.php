<?php
/**
 * API — Historique des incidents.
 *
 * GET  /api/incidents.php           → liste tous les incidents
 * POST /api/incidents.php           → ajoute un incident
 */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

$file = __DIR__ . '/../data/incidents.json';
$dir = dirname($file);
if(!is_dir($dir)) @mkdir($dir, 0775, true);
if(!file_exists($file)) file_put_contents($file, '[]');

if($_SERVER['REQUEST_METHOD'] === 'GET'){
    echo file_get_contents($file);
    exit;
}

if($_SERVER['REQUEST_METHOD'] === 'POST'){
    $input = json_decode(file_get_contents('php://input') ?: '', true);
    if(!is_array($input)){
        http_response_code(400);
        echo json_encode(['success'=>false, 'message'=>'JSON invalide.']);
        exit;
    }
    $incidents = json_decode(file_get_contents($file), true) ?: [];
    $incidents[] = [
        'id'          => 'inc_' . time(),
        'site'        => strtoupper(trim($input['site'] ?? '')),
        'start'       => $input['start'] ?? date('c'),
        'end'         => $input['end'] ?? null,
        'cause'       => $input['cause'] ?? 'inconnue',
        'actions'     => $input['actions'] ?? '',
        'duration_h'  => $input['duration_h'] ?? 0
    ];
    file_put_contents($file, json_encode($incidents, JSON_PRETTY_PRINT));
    echo json_encode(['success'=>true]);
    exit;
}

http_response_code(405);
echo json_encode(['success'=>false, 'message'=>'Méthode non autorisée.']);