<?php
declare(strict_types=1);

namespace Npm\Security;

use Npm\Database;
use Npm\Mailer;

/**
 * Codes OTP à usage unique (2FA par email).
 *
 * Le code n'est jamais stocké en clair : seul son hash est conservé.
 */
final class Otp
{
    public const TTL_SECONDS = 300;   // 5 minutes
    public const MAX_ATTEMPTS = 5;

    /** Génère, stocke et envoie un code. Retourne le code en clair. */
    public static function issue(int $userId, string $email, string $purpose = 'login'): string
    {
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expiresAt = date('Y-m-d H:i:s', time() + self::TTL_SECONDS);

        Database::core()->prepare(
            'INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at) VALUES (?, ?, ?, ?)'
        )->execute([$userId, password_hash($code, PASSWORD_DEFAULT), $purpose, $expiresAt]);

        $minutes = (int) (self::TTL_SECONDS / 60);
        Mailer::send(
            $email,
            '[Packet Loss] Votre code de vérification',
            "Bonjour,\n\nVotre code de vérification est : {$code}\n"
            . "Il expire dans {$minutes} minutes.\n\n"
            . "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n\n"
            . "— Packet Loss Intelligence"
        );

        return $code;
    }

    /** @return array{ok:bool, reason?:string} */
    public static function verify(int $userId, string $code, string $purpose = 'login'): array
    {
        $pdo = Database::core();
        $stmt = $pdo->prepare(
            'SELECT id, code_hash, attempts, expires_at FROM otp_codes
             WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL
             ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute([$userId, $purpose]);
        $row = $stmt->fetch();

        if ($row === false) {
            return ['ok' => false, 'reason' => 'no_code'];
        }
        if (strtotime((string) $row['expires_at']) < time()) {
            return ['ok' => false, 'reason' => 'expired'];
        }
        if ((int) $row['attempts'] >= self::MAX_ATTEMPTS) {
            return ['ok' => false, 'reason' => 'too_many'];
        }

        $pdo->prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?')->execute([(int) $row['id']]);

        if (!password_verify($code, (string) $row['code_hash'])) {
            return ['ok' => false, 'reason' => 'invalid'];
        }

        $pdo->prepare('UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?')->execute([(int) $row['id']]);
        return ['ok' => true];
    }

    /** Supprime les codes expirés ou consommés. */
    public static function purge(int $days = 7): int
    {
        $cutoff = date('Y-m-d H:i:s', time() - $days * 86400);
        $stmt = Database::core()->prepare('DELETE FROM otp_codes WHERE created_at < ?');
        $stmt->execute([$cutoff]);
        return $stmt->rowCount();
    }
}
