<?php
/**
 * Script cron — Vérifie les alertes et envoie les emails.
 *
 * Installation crontab (toutes les heures) :
 *   0 * * * * /usr/bin/php /chemin/vers/api/cron_alerts.php >> /var/log/pl_alerts.log 2>&1
 */
declare(strict_types=1);

require_once __DIR__ . '/../api/packet_loss.php';

$rulesFile = __DIR__ . '/../data/alert_rules.json';
if(!file_exists($rulesFile)){
    echo "[cron] Pas de fichier de règles, rien à faire.\n";
    exit(0);
}
$rules = json_decode(file_get_contents($rulesFile), true) ?: [];

if(empty($rules['enabled']) || empty($rules['email'])){
    echo "[cron] Alertes désactivées.\n";
    exit(0);
}

/* Fréquence : vérifie si c'est le bon moment */
$now = new DateTime();
$freq = $rules['frequency'] ?? 'hourly';
$shouldRun = true;

$lastRunFile = __DIR__ . '/../data/.last_alert_run';
$lastRun = file_exists($lastRunFile) ? (int)file_get_contents($lastRunFile) : 0;
$elapsed = time() - $lastRun;

if($freq === 'daily' && $elapsed < 86400){
    echo "[cron] Trop tôt (fréquence journalière).\n";
    exit(0);
}
if($freq === 'weekly' && $elapsed < 604800){
    echo "[cron] Trop tôt (fréquence hebdomadaire).\n";
    exit(0);
}

/* Récupère la liste des sites à surveiller */
$sitesToWatch = $rules['sites'] ?: [];

/* Si aucun site explicite, on scanne tous les sites connus via une requête */
/* Ici on suppose que les sites à surveiller sont explicitement listés.
   Pour une surveillance globale, il faudrait une table des sites. */
if(!$sitesToWatch){
    echo "[cron] Aucun site configuré pour la surveillance.\n";
    exit(0);
}

/* Période : les N dernières heures */
$minHours = (int)($rules['min_hours'] ?? 3);
$endDate   = date('Y-m-d');
$startDate = date('Y-m-d', strtotime("-{$minHours} hours"));

/* Appel interne à l'API Packet Loss */
$_SERVER['REQUEST_METHOD'] = 'POST';
$payload = json_encode([
    'sites'      => $sitesToWatch,
    'vendor'     => 'ALL',
    'start_date' => $startDate,
    'end_date'   => $endDate
]);

/* On duplique l'appel en local plutôt que de faire un HTTP */
$input = json_decode($payload, true);

/* Simple simulation : on va requêter directement avec getPDO() */
/* On va utiliser un mini-wrapper pour récupérer les données */
function runAnalysisInternal(array $input): array {
    /* Reprise simplifiée de la logique de packet_loss.php */
    /* Pour éviter de dupliquer, on peut faire un curl interne */
    $url = 'http://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . dirname($_SERVER['PHP_SELF']) . '/packet_loss.php';
    /* En CLI, HTTP_HOST n'existe pas → fallback */
    $url = 'http://localhost/api/packet_loss.php';

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($input),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60
    ]);
    $resp = curl_exec($ch);
    curl_close($ch);
    return json_decode($resp ?: '{}', true) ?: [];
}

$result = runAnalysisInternal($input);
if(empty($result['success'])){
    echo "[cron] Erreur analyse : " . ($result['message'] ?? '?') . "\n";
    exit(1);
}

/* Filtre les sites qui dépassent leur seuil */
$defaultThreshold = 0.1;
$thresholds = $rules['thresholds'] ?? [];
$alertSites = [];

foreach(($result['sites'] ?? []) as $site){
    $code = strtoupper($site['Site']);
    $thr = $thresholds[$code] ?? $defaultThreshold;
    if((float)$site['avg_packet_loss'] > $thr){
        $alertSites[] = [
            'site'     => $code,
            'avg'      => $site['avg_packet_loss'],
            'max'      => $site['max_packet_loss'],
            'vendor'   => $site['vendor'],
            'threshold'=> $thr
        ];
    }
}

if(!$alertSites){
    echo "[cron] Aucun site en alerte.\n";
    file_put_contents($lastRunFile, time());
    exit(0);
}

/* Compose le mail */
$subject = sprintf(
    "[Packet Loss] %d site(s) en alerte depuis %dh",
    count($alertSites), $minHours
);

$lines = [];
$lines[] = "Bonjour,";
$lines[] = "";
$lines[] = sprintf("%d site(s) dépassent leur seuil depuis plus de %d heure(s) :", count($alertSites), $minHours);
$lines[] = "";
$lines[] = str_pad("Site", 10) . str_pad("Moyenne", 12) . str_pad("Pic", 12) . str_pad("Seuil", 10) . "Vendor";
$lines[] = str_repeat("-", 60);
foreach($alertSites as $s){
    $lines[] = str_pad($s['site'], 10)
             . str_pad(number_format($s['avg'], 4) . '%', 12)
             . str_pad(number_format($s['max'], 4) . '%', 12)
             . str_pad(number_format($s['threshold'], 2) . '%', 10)
             . $s['vendor'];
}
$lines[] = "";
$lines[] = "Période analysée : {$startDate} → {$endDate}";
$lines[] = "Généré le : " . date('d/m/Y H:i');
$lines[] = "";
$lines[] = "— Packet Loss Intelligence";

$body = implode("\n", $lines);
$headers = "From: alerts@packetloss.local\r\n"
         . "Reply-To: alerts@packetloss.local\r\n"
         . "Content-Type: text/plain; charset=UTF-8";

$ok = @mail($rules['email'], $subject, $body, $headers);
echo $ok
    ? "[cron] Mail envoyé à {$rules['email']} ({$subject}).\n"
    : "[cron] Échec envoi mail.\n";

file_put_contents($lastRunFile, time());