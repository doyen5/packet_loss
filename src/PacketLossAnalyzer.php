<?php
declare(strict_types=1);

namespace Npm;

/**
 * Analyse Packet Loss (Ericsson + Huawei).
 *
 * La requête SQL métier de référence est conservée telle quelle pour les
 * pays "complets" (CI, BJ) ; seuls les dates, les sites et les noms de
 * tables/colonnes par pays sont paramétrés (voir config/countries.php).
 *
 * Deux réglages optionnels par pays permettent de couvrir les cas
 * particuliers sans dupliquer la requête :
 *   - la branche Huawei de l'UNION ALL est omise si le pays n'a pas de
 *     table Huawei (ex. le Togo est Ericsson 3G uniquement) ;
 *   - le calcul du code site est paramétrable (whitelist) : découpe sur '_'
 *     + right(...,5) par défaut, ou nom brut de la station (Togo).
 *
 * Utilisé à la fois par l'API HTTP (api/packet_loss.php) et par le cron
 * d'alertes (api/cron_alerts.php), afin de ne pas dupliquer la logique.
 */
final class PacketLossAnalyzer
{
    /**
     * Expressions de calcul du code site (liste blanche : évite toute
     * injection SQL, la config ne fournit qu'une clé symbolique).
     *
     * @var array<string,string>
     */
    private const SITE_BASE_EXPR = [
        // Découpe "BB_AC002_W" -> "AC002" (comportement historique CI/BJ).
        'segment' => "substring_index(substring_index(rbs,'_',-2),'_',1)",
        // Nom brut de la station, ex. "UAGBETSIKO2" (Togo).
        'full'    => 'rbs',
    ];

    /** @var array<string,string> */
    private const SITE_OUT_EXPR = [
        // 5 derniers caractères (comportement historique CI/BJ).
        'right5' => 'right(rbs, 5)',
        // Nom complet (Togo).
        'full'   => 'rbs',
    ];

    /**
     * Exécute l'analyse et renvoie le payload (sans les clés 'success').
     *
     * @param list<string> $sites
     * @return array<string,mixed>
     */
    public static function analyze(
        string $countryCode,
        array $sites,
        string $start,
        string $end,
        string $vendor = 'ALL',
        float $threshold = 0.1
    ): array {
        $country = Config::get('countries.' . strtoupper($countryCode));
        if (!is_array($country) || empty($country['packet_loss']['available'])) {
            throw new \RuntimeException('Module Packet Loss indisponible pour ce pays.');
        }

        $plCfg = $country['packet_loss'];

        // Noms de tables/colonnes nettoyés (lettres, chiffres et _ uniquement).
        $ericssonTable   = preg_replace('/[^A-Za-z0-9_]/', '', (string) ($plCfg['ericsson_table'] ?? 'packet_loss_3G_ericsson'));
        $huaweiTable     = preg_replace('/[^A-Za-z0-9_]/', '', (string) ($plCfg['huawei_raw_table'] ?? ''));
        $adjacentTable   = preg_replace('/[^A-Za-z0-9_]/', '', (string) ($plCfg['adjacent_table'] ?? ''));
        $adjacentSiteCol = preg_replace('/[^A-Za-z0-9_]/', '', (string) ($plCfg['adjacent_site_col'] ?? 'site_name'));

        // Le pays a-t-il des données Huawei ? Sinon on omet la branche UNION.
        $hasHuawei = $huaweiTable !== '' && $adjacentTable !== '';

        // Expressions site retenues depuis la whitelist (défauts = CI/BJ).
        $baseExpr = self::SITE_BASE_EXPR[(string) ($plCfg['site_base_expr'] ?? 'segment')] ?? self::SITE_BASE_EXPR['segment'];
        $outExpr  = self::SITE_OUT_EXPR[(string) ($plCfg['site_out_expr'] ?? 'right5')] ?? self::SITE_OUT_EXPR['right5'];

        $sitePlaceholders = implode(', ', array_fill(0, count($sites), '?'));

        // Branche Huawei conditionnelle (Ericsson seul si table absente).
        $huaweiBranch = '';
        if ($hasHuawei) {
            $huaweiBranch = <<<SQL

        UNION ALL

        SELECT DATE,
               `hour`,
               node_b,
               AVG(`packet_loss_rate`) AS avg_packet_loss,
               "Huawei" as vendor
        FROM (
            SELECT `date`,
                   `hour`,
                   `adj_id`,
                   `packet_loss_rate`,
                   ad.rnc,
                   node_b,
                   RIGHT(node_b, 5) Site,
                   ad.`{$adjacentSiteCol}` AS adjacent_site
            FROM `{$huaweiTable}` hw
            INNER JOIN `{$adjacentTable}` ad
                ON adjnode_id = adj_id
                AND ad.rnc = hw.rnc
            WHERE DATE BETWEEN ? AND ?
        ) AS huawei_part
        GROUP BY DATE, node_b, `hour`
SQL;
        }

        /* ============================================================
           REQUÊTE SQL DE RÉFÉRENCE
           Les deux expressions site ({$baseExpr} / {$outExpr}) valent par
           défaut le calcul historique, pour ne rien changer à CI/BJ.
           ============================================================ */
        $sql = <<<SQL
SELECT *
FROM (
    SELECT concat(date, ' ', `hour`) as date,
           rbs,
           {$outExpr} as Site,
           packet_loss,
           vendor,
           date as ladate,
           hour
    FROM (
        SELECT date,
               `hour`,
               {$baseExpr} as RBS,
               avg(HS_FRAME_DATA_LOST) as packet_loss,
               "Ericsson" as vendor
        FROM (
            SELECT `date`,
                   `hour`,
                   `rbs`,
                   `rnc`,
                   `HS_FRAME_DATA_LOST`,
                   `DCH_FRAME_LOST`
            FROM `{$ericssonTable}`
            WHERE DATE BETWEEN ? AND ?
        ) as ericsson_part
        GROUP BY date, rbs, `hour`
{$huaweiBranch}
    ) as rawadata
) as dsfg
WHERE Site IN ($sitePlaceholders)
SQL;

        /*
         * Ordre exact des paramètres :
         * Ericsson date début/fin, puis (si présente) Huawei début/fin,
         * puis tous les sites.
         */
        $params = [$start, $end];
        if ($hasHuawei) {
            $params[] = $start;
            $params[] = $end;
        }
        $params = array_merge($params, $sites);

        if ($vendor !== 'ALL') {
            $sql .= ' AND UPPER(vendor) = ?';
            $params[] = $vendor;
        }

        // La connexion peut pointer vers un autre serveur (ex. TG -> base CI).
        $pdo = Database::country($countryCode);
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        /* ============================================================
           NORMALISATION
           ============================================================ */
        $cleanRows = [];
        foreach ($rows as $r) {
            $site = strtoupper(trim((string) ($r['Site'] ?? '')));
            if ($site === '') {
                continue;
            }
            $cleanRows[] = [
                'date'        => (string) ($r['date'] ?? ''),
                'rbs'         => (string) ($r['rbs'] ?? ''),
                'Site'        => $site,
                'packet_loss' => (float) ($r['packet_loss'] ?? 0),
                'vendor'      => (string) ($r['vendor'] ?? ''),
                'ladate'      => (string) ($r['ladate'] ?? ''),
                'hour'        => $r['hour'] ?? '',
            ];
        }

        /* ============================================================
           STATISTIQUES PAR SITE
           ============================================================ */
        $bySite = [];
        foreach ($cleanRows as $row) {
            $bySite[$row['Site']][] = $row;
        }

        $siteStats = [];
        foreach ($bySite as $site => $siteRows) {
            $values = array_map(static fn ($r) => (float) $r['packet_loss'], $siteRows);
            $n = count($values);
            if (!$n) {
                continue;
            }

            $avg = array_sum($values) / $n;
            $max = max($values);
            $min = min($values);
            $above = count(array_filter($values, static fn ($v) => $v > $threshold));

            $siteStats[] = [
                'Site'                 => $site,
                'vendor'               => (string) ($siteRows[0]['vendor'] ?? ''),
                'avg_packet_loss'      => round($avg, 6),
                'min_packet_loss'      => round($min, 6),
                'max_packet_loss'      => round($max, 6),
                'nb_mesures'           => $n,
                'above_threshold'      => $above,
                'above_threshold_pct'  => round($above / $n * 100, 2),
                'status'               => $avg > $threshold ? 'IMPACTE' : 'NORMAL',
            ];
        }

        usort($siteStats, static fn ($a, $b) => $b['avg_packet_loss'] <=> $a['avg_packet_loss']);

        /* ============================================================
           KPI GLOBAUX
           ============================================================ */
        $values = array_map(static fn ($r) => (float) $r['packet_loss'], $cleanRows);
        $totalRows = count($values);
        $avgGlobal = $totalRows ? array_sum($values) / $totalRows : 0;
        $maxGlobal = $totalRows ? max($values) : 0;

        $impacted = count(array_filter(
            $siteStats,
            static fn ($s) => (float) $s['avg_packet_loss'] > $threshold
        ));

        $withData = array_keys($bySite);
        $withoutData = array_values(array_diff($sites, $withData));

        return [
            'country'                   => strtoupper($countryCode),
            'threshold'                 => $threshold,
            'mode'                      => 'TARGETED',
            'start_date'                => $start,
            'end_date'                  => $end,
            'vendor'                    => $vendor,

            'requested_sites'           => $sites,
            'requested_sites_count'     => count($sites),

            'analyzed_sites_count'      => count($siteStats),
            'sites_without_data_count'  => count($withoutData),
            'sites_without_data'        => $withoutData,

            'summary' => [
                'impacted_sites'  => $impacted,
                'max_packet_loss' => round($maxGlobal, 6),
                'avg_packet_loss' => round($avgGlobal, 6),
                'total_rows'      => $totalRows,
            ],

            'sites'       => $siteStats,
            'worst_sites' => array_slice($siteStats, 0, 10),
            'rows'        => $cleanRows,
        ];
    }
}
