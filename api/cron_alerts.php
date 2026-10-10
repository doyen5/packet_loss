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
use Npm\Repositories\SessionRepository;
use Npm\Security\Otp;
use Npm\Security\RateLimiter;

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

/** Purge des données de rétention (tentatives, audit, jetons, OTP). */
function purgeRetention(\PDO $pdo): void
{
    $queries = [
        'DELETE FROM login_attempts WHERE attempted_at < (NOW() - INTERVAL 90 DAY)',
        'DELETE FROM audit_log WHERE created_at < (NOW() - INTERVAL 365 DAY)',
    ];
    foreach ($queries as $sql) {
        try {
            $rows = $pdo->exec($sql);
            echo "[cron] purge : $rows ligne(s) supprimée(s).\n";
        } catch (\Throwable $e) {
            // table ou colonne absente : on ignore.
        }
    }
    try { RateLimiter::purge(); } catch (\Throwable $e) {}
    try { SessionRepository::purge(60); } catch (\Throwable $e) {}
    try { Otp::purge(7); } catch (\Throwable $e) {}
}

/** Traite les rapports planifiés par email (report_schedules). */
function processReports(\PDO $pdo): void
{
    $rows = $pdo->query("SELECT * FROM report_schedules WHERE enabled = 1 AND recipients <> ''")->fetchAll();
    if (!$rows) {
        return;
    }

    $freqSeconds = ['daily' => 86400, 'weekly' => 604800, 'monthly' => 2592000];
    $now = time();
    $markRun = $pdo->prepare('UPDATE report_schedules SET last_run_at = NOW() WHERE id = ?');
    $markSent = $pdo->prepare('UPDATE report_schedules SET last_sent_at = NOW() WHERE id = ?');
    $topStmt = $pdo->prepare(
        "SELECT site, COUNT(*) AS nb FROM incidents
         WHERE country_code = ? AND status <> 'resolved'
         GROUP BY site ORDER BY nb DESC LIMIT 20"
    );
    $openStmt = $pdo->prepare("SELECT COUNT(*) FROM incidents WHERE country_code = ? AND status = 'open'");

    foreach ($rows as $row) {
        $id = (int) $row['id'];
        $interval = $freqSeconds[(string) $row['frequency']] ?? 604800;
        if (!empty($row['last_run_at'])) {
            $elapsed = $now - strtotime((string) $row['last_run_at']);
            if ($elapsed < $interval) {
                continue;
            }
        }
        $markRun->execute([$id]);

        $country = (string) $row['country_code'];
        $topStmt->execute([$country]);
        $top = $topStmt->fetchAll();
        $openStmt->execute([$country]);
        $open = (int) $openStmt->fetchColumn();

        $lines = [];
        $lines[] = 'Bonjour,';
        $lines[] = '';
        $lines[] = "Rapport Packet Loss — $country (" . (string) $row['frequency'] . ')';
        $lines[] = "Incidents ouverts : $open";
        $lines[] = '';
        if ($top) {
            $lines[] = 'Sites les plus impactés (non résolus) :';
            foreach ($top as $t) {
                $lines[] = sprintf(' - %s : %d', (string) $t['site'], (int) $t['nb']);
            }
        } else {
            $lines[] = 'Aucun incident non résolu.';
        }
        $lines[] = '';
        $lines[] = 'Généré le : ' . date('d/m/Y H:i');
        $lines[] = '— Packet Loss Intelligence';
        $body = implode("\n", $lines);

        $recipients = array_filter(array_map('trim', explode(',', (string) $row['recipients'])));
        $sent = 0;
        foreach ($recipients as $r) {
            if ($r !== '' && Mailer::send($r, sprintf('[Packet Loss] Rapport %s', $country), $body)) {
                $sent++;
            }
        }
        if ($sent > 0) {
            $markSent->execute([$id]);
        }
        echo "[cron] rapport #$id $country : $sent/" . count($recipients) . " destinataire(s).\n";
    }
}

$pdo = Database::core();
purgeRetention($pdo);
processReports($pdo);
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
