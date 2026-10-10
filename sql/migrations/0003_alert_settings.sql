-- =========================================================
--  npm_core - Schéma applicatif central
--  Migration 0003 : configuration des alertes par utilisateur/pays
--
--  La table alert_rules (0001) modélise des règles fines site par site.
--  Cette table stocke la configuration agrégée utilisée par l'interface
--  du tableau de bord (un email destinataire, une liste de sites, une
--  durée minimale et une fréquence) : une ligne par (utilisateur, pays).
-- =========================================================

CREATE TABLE IF NOT EXISTS alert_settings (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    country_code CHAR(2) NOT NULL,
    email VARCHAR(190) NOT NULL,
    min_hours INT UNSIGNED NOT NULL DEFAULT 3,
    frequency VARCHAR(20) NOT NULL DEFAULT 'hourly',
    sites JSON NULL,
    threshold DECIMAL(10,4) NOT NULL DEFAULT 0.1000,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    last_run_at DATETIME NULL,
    last_triggered_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_as_user_country (user_id, country_code),
    KEY idx_as_country (country_code),
    CONSTRAINT fk_as_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_as_country FOREIGN KEY (country_code) REFERENCES countries (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
