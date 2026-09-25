PACKET LOSS DASHBOARD - TEST

STRUCTURE
---------
PACKET_LOSS/
|-- index.html
|-- api/
|   |-- database.php
|   `-- packet_loss.php
|-- assets/
|   |-- css/dashboard.css
|   `-- js/dashboard.js
|-- data/
|   `-- sites_location.json
`-- README.txt

INSTALLATION
------------
1. Copier le dossier PACKET_LOSS dans le répertoire web Apache.
2. Vérifier PHP + PDO MySQL.
3. Ouvrir via HTTP, par exemple :
   http://SERVEUR/PACKET_LOSS/
   Ne pas tester en double-cliquant directement sur index.html.
4. Vérifier les identifiants dans api/database.php.
5. Tester avec quelques sites.

LOCALISATION
------------
Le fichier data/sites_location.json est le référentiel permanent.
L'Excel de localisation n'est PAS demandé à chaque refresh.

Format :
{
  "AC078": {
    "lat": 5.3201,
    "lng": -4.0215,
    "vendor": "Huawei"
  }
}

Une fois votre Excel disponible, ses colonnes Site/Latitude/Longitude
pourront être converties en JSON.

IMPORTANT
---------
- Tous les sites importés sont envoyés à SQL.
- Il n'existe plus de liste statique de sites autorisés.
- Les sites sans données SQL sont comptés mais n'ont pas de carte vide.
- Le seuil est fixe à 0.1%.
- La requête Ericsson/Huawei reste la requête métier de référence.
- Le mot de passe MySQL ne doit jamais être placé dans JavaScript.
- Les bibliothèques Plotly, SheetJS et Leaflet sont actuellement chargées
  par CDN ; pour un réseau sans Internet, il faudra les héberger localement.


LOCALISATION INTÉGRÉE
---------------------
Le fichier data/sites_location.json a été généré à partir de :
- CODE BTS 3G  (priorité pour ce dashboard Packet Loss 3G)
- CODE BTS 4G
- CODE BTS 2G
- RECAP CAPEX_2026

Nombre de sites uniques avec coordonnées : 2250.

Priorité en cas de coordonnées différentes pour un même site :
3G > 4G > 2G > RECAP CAPEX_2026.

Le navigateur charge ce JSON au démarrage. Il n'est donc pas nécessaire
de réimporter l'Excel à chaque actualisation.
