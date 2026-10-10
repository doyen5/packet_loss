-- =========================================================
--  npm_core - Migration 0002 : données de référence
--  Rôles (RBAC) et pays. Idempotent (INSERT ... ON DUPLICATE).
-- =========================================================

INSERT INTO roles (name, description) VALUES
    ('SUPER_ADMIN', 'Administrateur - accès total'),
    ('BACK_OFFICE', 'Back-office - édition, mémoire, alertes'),
    ('DIRIGEANT',   'Dirigeant - consultation et export'),
    ('USER',        'Utilisateur - consultation')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO countries (code, name, flag, enabled) VALUES
    ('CI', 'Côte d''Ivoire', '🇨🇮', 1),
    ('BJ', 'Bénin', '🇧🇯', 1),
    ('TG', 'Togo', '🇹🇬', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), flag = VALUES(flag), enabled = VALUES(enabled);
