<?php
declare(strict_types=1);

/**
 * Descripteurs des pays : métadonnées SANS identifiants.
 * Les identifiants des bases métier sont dans .env / config/database.php.
 *
 * Le schéma des tables Packet Loss diffère d'un pays à l'autre :
 *  - CI : packet_loss_3G_ericsson / packet_loss_huaweI_rawdata / adjacent_node(site_name)
 *  - BJ : packet_loss_3g_ericsson / packet_loss_huawei_rawdata / adjacent_node(SITE)
 *  - TG : packet_loss_3G_ericsson_togo (données hébergées dans la base CI)
 *
 * Clés optionnelles :
 *  - connection     : au niveau du pays ; clé de connexion à utiliser si
 *                     différente du pays lui-même (ex. TG lit la base CI).
 *                     Défaut : countries.<CODE>.
 *  - packet_loss.huawei_raw_table / adjacent_* : laisser null/vide si le pays
 *                     n'a pas de données Huawei (branche Huawei de l'UNION omise).
 *  - packet_loss.site_base_expr : 'segment' (défaut) ou 'full' (rbs brut).
 *  - packet_loss.site_out_expr  : 'right5' (défaut) ou 'full' (rbs complet).
 */
return [
    'CI' => [
        'code'    => 'CI',
        'name'    => "Côte d'Ivoire",
        'flag'    => '🇨🇮',
        'enabled' => true,
        'modules' => ['packet_loss'],
        'packet_loss' => [
            'available'         => true,
            'ericsson_table'    => 'packet_loss_3G_ericsson',
            'huawei_raw_table'  => 'packet_loss_huaweI_rawdata',
            'adjacent_table'    => 'adjacent_node',
            'adjacent_site_col' => 'site_name',
        ],
    ],

    'BJ' => [
        'code'    => 'BJ',
        'name'    => 'Bénin',
        'flag'    => '🇧🇯',
        'enabled' => true,
        'modules' => ['packet_loss'],
        'packet_loss' => [
            'available'         => true,
            'ericsson_table'    => 'packet_loss_3g_ericsson',
            'huawei_raw_table'  => 'packet_loss_huawei_rawdata',
            'adjacent_table'    => 'adjacent_node',
            'adjacent_site_col' => 'SITE',
        ],
    ],

    'TG' => [
        'code'    => 'TG',
        'name'    => 'Togo',
        'flag'    => '🇹🇬',
        'enabled' => true,
        'modules' => ['packet_loss'],
        /* Les tables Togo sont hébergées dans la base CI (prismis). */
        'connection' => 'countries.CI',
        'packet_loss' => [
            'available'         => true,
            'ericsson_table'    => 'packet_loss_3G_ericsson_togo',
            /* Pas de table Huawei pour le Togo : branche Huawei omise. */
            'huawei_raw_table'  => null,
            'adjacent_table'    => null,
            'adjacent_site_col' => null,
            /* Le "Site" Togo est le nom brut de la station (rbs), ex. UAGBETSIKO2. */
            'site_base_expr'    => 'full',
            'site_out_expr'     => 'full',
        ],
    ],
];
