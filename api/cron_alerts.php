<?php
/**
 * Script cron — Vérifie les alertes Packet Loss et envoie les emails.
 *
 * S'exécute UNIQUEMENT en ligne de commande.
 *
 * Installation crontab (toutes les heures) :
 *   0 * * * * /usr/bin/php /chemin/vers/api/cron_alerts.php >> /var/log/pl_alerts.log 2>&1
 *
 * La configuration est lue dans npm_core.alert_settings (une ligne par
 * utilisateur et par pays, voir l'interface du tableau de bord).
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo "Réservé à l'exécution en ligne de commande.\n";
    exit(1);
}

use Npm\Database;
use Npm\Logger;
use Npm\Mailer;
use Npm\PacketLossAnalyzer;

require __DIR__ . '/bootstrap.php';

/**
 * @param list<array<string,mixed>> $alerts
 */
function recordIncidents(\PDO $pdo, string $country, array $alerts, float $threshold, string $start): void
{
    $find = $pdo->prepare(
        "SELECT id FROM incidents
         WHERE country_code = ? AND site = ? AND metric = 'packet_loss_rate' AND status = 'open'
         LIMIT 1"
    );
    $insert = $pdo->prepare(
        "INSERT INTO incidents (country_code, site, metric, value, threshold, status, details, started_at)
         VALUES (?, ?, 'packet_loss_rate', ?, ?, 'open', ?, ?)"
    );
    $update = $pdo->prepare('UPDATE incidents SET value = ?, details = ? WHERE id = ?');

    foreach ($alerts as $a) {
        $details = json_encode([
            'avg'        => $a['avg_packet_loss'] ?? 0,
            'max'        => $a['max_packet_loss'] ?? 0,
            'vendor'     => $a['vendor'] ?? '',
            'nb_mesures' => $a['nb_mesures'] ?? 0,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $find->execute([$country, $a['Site']]);
        $existing = $find->fetchColumn();

        if ($existing) {
            $update->execute([(float) ($a['avg_packet_loss'] ?? 0), $details, (int) $existing]);
        } else {
            $insert->execute([
                $country,
                (string) $a['Site'],
                (float) ($a['avg_packet_loss'] ?? 0),
                $threshold,
                $details,
                $start . ' 00:00:00',
            ]);
        }
    }
}

/**
 * @param list<array<string,mixed>> $alerts
 */
function sendAlertMail(
    string $email,
    string $country,
    array $alerts,
    int $minHours,
    string $start,
    string $end,
    float $threshold
): bool {
    $subject = sprintf('[Packet Loss] %d site(s) en alerte depuis %dh', count($alerts), $minHours);

    $lines = [];
    $lines[] = 'Bonjour,';
    $lines[] = '';
    $lines[] = sprintf('%d site(s) dépassent leur seuil depuis plus de %d heure(s) :', count($alerts), $minHours);
    $lines[] = '';
    $lines[] = str_pad('Site', 12) . str_pad('Moyenne', 12) . str_pad('Pic', 12) . str_pad('Seuil', 10) . 'Vendor';
    $lines[] = str_repeat('-', 62);
    foreach ($alerts as $a) {
        $lines[] = str_pad((string) $a['Site'], 12)
                 . str_pad(number_format((float) $a['avg_packet_loss'], 4) . '%', 12)
                 . str_pad(number_format((float) $a['max_packet_loss'], 4) . '%', 12)
                 . str_pad(number_format($threshold, 2) . '%', 10)
                 . (string) ($a['vendor'] ?? '');
    }
    $lines[] = '';
    $lines[] = "Pays : $country";
    $lines[] = "Période analysée : {$start} → {$end}";
    $lines[] = 'Généré le : ' . date('d/m/Y H:i');
    $lines[] = '';
    $lines[] = '— Packet Loss Intelligence';

    return Mailer::send($email, $subject, implode("\n", $lines));
}

$pdo = Database::core();
$rows = $pdo->query(
    "SELECT * FROM alert_settings WHERE enabled = 1 AND email <> ''"
)->fetchAll();

if (!$rows) {
    echo "[cron] Aucune configuration d'alerte active.\n";
    exit(0);
}

$freqSeconds = ['hourly' => 3600, 'daily' => 86400, 'weekly' => 604800];
$now = time();
$totalAlerts = 0;

$markRun = $pdo->prepare('UPDATE alert_settings SET last_run_at = NOW() WHERE id = ?');
$markTriggered = $pdo->prepare('UPDATE alert_settings SET last_triggered_at = NOW() WHERE id = ?');

foreach ($rows as $row) {
    $id        = (int) $row['id'];
    $country   = (string) $row['country_code'];
    $email     = (string) $row['email'];
    $minHours  = max(1, (int) $row['min_hours']);
    $frequency = (string) $row['frequency'];
    $threshold = (float) ($row['threshold'] ?: 0.1);
    $sites     = json_decode((string) ($row['sites'] ?? '[]'), true) ?: [];

    $interval = $freqSeconds[$frequency] ?? 3600;
    if (!empty($row['last_run_at'])) {
        $elapsed = $now - strtotime((string) $row['last_run_at']);
        if ($elapsed < $interval) {
            echo "[cron] #$id $country : trop tôt ({$elapsed}s < {$interval}s).\n";
            continue;
        }
    }

    if (!$sites) {
        echo "[cron] #$id $country : aucun site configuré.\n";
        $markRun->execute([$id]);
        continue;
    }

    $end   = date('Y-m-d');
    $start = date('Y-m-d', $now - $minHours * 3600);

    try {
        $result = PacketLossAnalyzer::analyze($country, $sites, $start, $end, 'ALL', $threshold);
    } catch (\Throwable $e) {
        Logger::error('[cron] analyse ' . $country . ' : ' . $e->getMessage());
        echo "[cron] #$id $country : erreur d'analyse.\n";
        continue;
    }

    $markRun->execute([$id]);

    $alerts = [];
    foreach (($result['sites'] ?? []) as $s) {
        if ((float) $s['avg_packet_loss'] > $threshold) {
            $alerts[] = $s;
        }
    }

    if (!$alerts) {
        echo "[cron] #$id $country : aucun site en alerte.\n";
        continue;
    }

    recordIncidents($pdo, $country, $alerts, $threshold, $start);

    if (sendAlertMail($email, $country, $alerts, $minHours, $start, $end, $threshold)) {
        echo "[cron] #$id $country : mail envoyé à $email (" . count($alerts) . " site(s)).\n";
    } else {
        echo "[cron] #$id $country : échec envoi mail.\n";
    }

    $markTriggered->execute([$id]);
    $totalAlerts += count($alerts);
}

echo "[cron] Terminé. Sites en alerte : $totalAlerts\n";
exit(0);
