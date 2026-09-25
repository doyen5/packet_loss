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
 *   "end_date": "2026-09-16"
 * }
 *
 * La requête métier Ericsson/Huawei est conservée.
 * Seuls les dates et le WHERE Site IN sont paramétrés.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/database.php';

function jsonResponse(array $data, int $status=200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    exit;
}

function validDate(string $date): bool
{
    $d = DateTime::createFromFormat('Y-m-d',$date);
    return $d !== false && $d->format('Y-m-d') === $date;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['success'=>false,'message'=>'Utilisez POST.'],405);
}

$input=json_decode(file_get_contents('php://input') ?: '',true);

if(!is_array($input)){
    jsonResponse(['success'=>false,'message'=>'JSON invalide.'],400);
}

/* ============================================================
   1. RÉCUPÉRATION DE TOUS LES SITES IMPORTÉS
   ============================================================ */
$sites=[];

foreach(($input['sites'] ?? []) as $site){
    if(!is_scalar($site)) continue;
    $site=strtoupper(trim((string)$site));
    if($site!=='') $sites[]=$site;
}

$sites=array_values(array_unique($sites));

if(!$sites){
    jsonResponse(['success'=>false,'message'=>'Aucun site.'],400);
}

/*
 * Cette limite est technique uniquement.
 * Il n'existe PAS de liste de sites autorisés.
 */
if(count($sites)>2000){
    jsonResponse(['success'=>false,'message'=>'Maximum technique : 2000 sites.'],400);
}

/* ============================================================
   2. DATES ET VENDOR
   ============================================================ */
$start=trim((string)($input['start_date'] ?? ''));
$end=trim((string)($input['end_date'] ?? ''));
$vendor=strtoupper(trim((string)($input['vendor'] ?? 'ALL')));

if(!validDate($start)||!validDate($end)){
    jsonResponse(['success'=>false,'message'=>'Dates invalides. Format YYYY-MM-DD.'],400);
}

if($start>$end){
    jsonResponse(['success'=>false,'message'=>'Date début > date fin.'],400);
}

if(!in_array($vendor,['ALL','ERICSSON','HUAWEI'],true)){
    jsonResponse(['success'=>false,'message'=>'Vendor invalide.'],400);
}

/* ============================================================
   3. PLACEHOLDERS POUR TOUS LES SITES
   ============================================================ */
$sitePlaceholders=implode(', ',array_fill(0,count($sites),'?'));

/* ============================================================
   4. REQUÊTE SQL DE RÉFÉRENCE
   ============================================================ */
$sql=<<<SQL
SELECT *
FROM (
    SELECT concat(date, ' ', `hour`) as date,
           rbs,
           right(rbs, 5) as Site,
           packet_loss,
           vendor,
           date as ladate,
           hour
    FROM (
        SELECT date,
               `hour`,
               substring_index(substring_index(rbs,'_',-2),'_',1) as RBS,
               avg(HS_FRAME_DATA_LOST) as packet_loss,
               "Ericsson" as vendor
        FROM (
            SELECT `date`,
                   `hour`,
                   `rbs`,
                   `rnc`,
                   `HS_FRAME_DATA_LOST`,
                   `DCH_FRAME_LOST`
            FROM `packet_loss_3G_ericsson`
            WHERE DATE BETWEEN ? AND ?
        ) as ericsson_part
        GROUP BY date, rbs, `hour`

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
                   adjacent_node.rnc,
                   node_b,
                   RIGHT(node_b, 5) Site,
                   site_name
            FROM prismis.`packet_loss_huaweI_rawdata`
            INNER JOIN prismis.`adjacent_node`
                ON adjnode_id = adj_id
                AND adjacent_node.rnc=packet_loss_huaweI_rawdata.rnc
            WHERE DATE BETWEEN ? AND ?
        ) AS huawei_part
        GROUP BY DATE, node_b, `hour`
    ) as rawadata
) as dsfg
WHERE Site IN ($sitePlaceholders)
SQL;

/*
 * Ordre exact des paramètres :
 * Ericsson date début/fin
 * Huawei date début/fin
 * puis tous les sites.
 */
$params=[$start,$end,$start,$end];
$params=array_merge($params,$sites);

if($vendor!=='ALL'){
    $sql.=' AND UPPER(vendor) = ?';
    $params[]=$vendor;
}

/* ============================================================
   5. EXÉCUTION
   ============================================================ */
try{
    $pdo=getPDO();
    $stmt=$pdo->prepare($sql);
    $stmt->execute($params);
    $rows=$stmt->fetchAll();
}catch(Throwable $e){
    error_log('Packet Loss API: '.$e->getMessage());
    jsonResponse([
        'success'=>false,
        'message'=>'Erreur lors de la récupération des données Packet Loss.'
    ],500);
}

/* ============================================================
   6. NORMALISATION
   ============================================================ */
$cleanRows=[];

foreach($rows as $r){
    $site=strtoupper(trim((string)($r['Site'] ?? '')));
    if($site==='') continue;

    $cleanRows[]=[
        'date'=>(string)($r['date'] ?? ''),
        'rbs'=>(string)($r['rbs'] ?? ''),
        'Site'=>$site,
        'packet_loss'=>(float)($r['packet_loss'] ?? 0),
        'vendor'=>(string)($r['vendor'] ?? ''),
        'ladate'=>(string)($r['ladate'] ?? ''),
        'hour'=>$r['hour'] ?? ''
    ];
}

/* ============================================================
   7. STATISTIQUES PAR SITE
   ============================================================ */
$bySite=[];

foreach($cleanRows as $row){
    $bySite[$row['Site']][]=$row;
}

$siteStats=[];

foreach($bySite as $site=>$siteRows){
    $values=array_map(fn($r)=>(float)$r['packet_loss'],$siteRows);
    $n=count($values);
    if(!$n) continue;

    $avg=array_sum($values)/$n;
    $max=max($values);
    $min=min($values);
    $above=count(array_filter($values,fn($v)=>$v>0.1));

    $siteStats[]=[
        'Site'=>$site,
        'vendor'=>(string)($siteRows[0]['vendor'] ?? ''),
        'avg_packet_loss'=>round($avg,6),
        'min_packet_loss'=>round($min,6),
        'max_packet_loss'=>round($max,6),
        'nb_mesures'=>$n,
        'above_threshold'=>$above,
        'above_threshold_pct'=>round($above/$n*100,2),
        'status'=>$avg>0.1?'IMPACTE':'NORMAL'
    ];
}

usort($siteStats,fn($a,$b)=>$b['avg_packet_loss']<=>$a['avg_packet_loss']);

/* ============================================================
   8. KPI GLOBAUX
   ============================================================ */
$values=array_map(fn($r)=>(float)$r['packet_loss'],$cleanRows);
$totalRows=count($values);
$avgGlobal=$totalRows?array_sum($values)/$totalRows:0;
$maxGlobal=$totalRows?max($values):0;

$impacted=count(array_filter(
    $siteStats,
    fn($s)=>(float)$s['avg_packet_loss']>0.1
));

$withData=array_keys($bySite);
$withoutData=array_values(array_diff($sites,$withData));

/*
 * Les sites sans données sont comptés, mais ne sont pas inclus
 * dans "sites" : aucun graphique vide n'est généré.
 */
jsonResponse([
    'success'=>true,
    'threshold'=>0.1,
    'mode'=>'TARGETED',
    'start_date'=>$start,
    'end_date'=>$end,
    'vendor'=>$vendor,

    'requested_sites'=>$sites,
    'requested_sites_count'=>count($sites),

    'analyzed_sites_count'=>count($siteStats),
    'sites_without_data_count'=>count($withoutData),
    'sites_without_data'=>$withoutData,

    'summary'=>[
        'impacted_sites'=>$impacted,
        'max_packet_loss'=>round($maxGlobal,6),
        'avg_packet_loss'=>round($avgGlobal,6),
        'total_rows'=>$totalRows
    ],

    /* Tous les sites ayant au moins une donnée. */
    'sites'=>$siteStats,

    /* Top 10 uniquement pour le tableau Worst. */
    'worst_sites'=>array_slice($siteStats,0,10),

    /* Toutes les mesures nécessaires aux graphiques. */
    'rows'=>$cleanRows
]);
