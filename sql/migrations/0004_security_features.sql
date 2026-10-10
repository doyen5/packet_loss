-- =========================================================
--  npm_core - Migration 0004 : sécurité, sessions, supervision
--  Ajoute : RBAC dynamique, sessions révocables, rate-limit,
--  notifications, OTP 2FA, rapports planifiés, workflow incidents.
-- =========================================================

-- ----- Utilisateurs : version de session + 2FA + préférences -----
ALTER TABLE users
    ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN preferences JSON NULL;

-- ----- Incidents : assignation + échéance SLA -----
ALTER TABLE incidents
    ADD COLUMN assigned_to INT UNSIGNED NULL,
    ADD COLUMN sla_due_at DATETIME NULL,
    ADD CONSTRAINT fk_inc_assigned FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL;

-- ----- RBAC dynamique : permissions par rôle -----
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INT UNSIGNED NOT NULL,
    permission VARCHAR(100) NOT NULL,
    PRIMARY KEY (role_id, permission),
    CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- Sessions révocables -----
CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    token CHAR(64) NOT NULL,
    ip VARCHAR(45) NULL,
    user_agent VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_us_token (token),
    KEY idx_us_user (user_id),
    CONSTRAINT fk_us_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- Limiteur de débit (fenêtre fixe) -----
CREATE TABLE IF NOT EXISTS rate_limits (
    rl_key VARCHAR(191) NOT NULL,
    hits INT UNSIGNED NOT NULL DEFAULT 0,
    window_start DATETIME NOT NULL,
    PRIMARY KEY (rl_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- Centre de notifications -----
CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'info',
    title VARCHAR(190) NOT NULL,
    message TEXT NULL,
    link VARCHAR(255) NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_notif_user (user_id, is_read),
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- Codes OTP (2FA par email) -----
CREATE TABLE IF NOT EXISTS otp_codes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(30) NOT NULL DEFAULT 'login',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    consumed_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_otp_user (user_id, purpose),
    CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- Rapports planifiés par email -----
CREATE TABLE IF NOT EXISTS report_schedules (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    country_code CHAR(2) NOT NULL,
    frequency VARCHAR(20) NOT NULL DEFAULT 'weekly',
    recipients VARCHAR(255) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    last_run_at DATETIME NULL,
    last_sent_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_rs_user (user_id),
    CONSTRAINT fk_rs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_rs_country FOREIGN KEY (country_code) REFERENCES countries (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- Commentaires d'incidents -----
CREATE TABLE IF NOT EXISTS incident_comments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    incident_id BIGINT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NULL,
    comment TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ic_incident (incident_id),
    CONSTRAINT fk_ic_incident FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE,
    CONSTRAINT fk_ic_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----- Seed RBAC (aligné sur la matrice historique) -----
INSERT IGNORE INTO role_permissions (role_id, permission)
SELECT r.id, m.permission FROM roles r
JOIN (
    SELECT 'BACK_OFFICE' AS role_name, 'packet_loss.view' AS permission
    UNION ALL SELECT 'BACK_OFFICE', 'packet_loss.export'
    UNION ALL SELECT 'BACK_OFFICE', 'packet_loss.edit'
    UNION ALL SELECT 'BACK_OFFICE', 'sleeping_cells.view'
    UNION ALL SELECT 'BACK_OFFICE', 'sleeping_cells.export'
    UNION ALL SELECT 'BACK_OFFICE', 'kpi_degraded.view'
    UNION ALL SELECT 'BACK_OFFICE', 'kpi_degraded.export'
    UNION ALL SELECT 'BACK_OFFICE', 'rna.view'
    UNION ALL SELECT 'BACK_OFFICE', 'memory.manage'
    UNION ALL SELECT 'BACK_OFFICE', 'alerts.manage'
    UNION ALL SELECT 'DIRIGEANT', 'packet_loss.view'
    UNION ALL SELECT 'DIRIGEANT', 'packet_loss.export'
    UNION ALL SELECT 'DIRIGEANT', 'sleeping_cells.view'
    UNION ALL SELECT 'DIRIGEANT', 'sleeping_cells.export'
    UNION ALL SELECT 'DIRIGEANT', 'kpi_degraded.view'
    UNION ALL SELECT 'DIRIGEANT', 'kpi_degraded.export'
    UNION ALL SELECT 'DIRIGEANT', 'rna.view'
    UNION ALL SELECT 'USER', 'packet_loss.view'
    UNION ALL SELECT 'USER', 'sleeping_cells.view'
    UNION ALL SELECT 'USER', 'kpi_degraded.view'
    UNION ALL SELECT 'USER', 'rna.view'
) m ON m.role_name = r.name;
