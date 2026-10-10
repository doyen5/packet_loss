<?php
declare(strict_types=1);

namespace Npm\Security;

/**
 * Politique de mot de passe (longueur, composition, mots courants).
 */
final class PasswordPolicy
{
    public const MIN_LENGTH = 8;

    private const COMMON = [
        'password', 'password1', '12345678', '123456789', 'motdepasse',
        'azerty123', 'qwerty123', 'admin123', '11111111', 'letmein12',
        'welcome1', 'packetloss',
    ];

    /** @return string|null message d'erreur, ou null si le mot de passe est valide. */
    public static function validate(string $password): ?string
    {
        if (mb_strlen($password) < self::MIN_LENGTH) {
            return 'Le mot de passe doit contenir au moins ' . self::MIN_LENGTH . ' caractères.';
        }
        if (!preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password)) {
            return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
        }
        if (in_array(mb_strtolower($password), self::COMMON, true)) {
            return 'Ce mot de passe est trop courant.';
        }
        return null;
    }
}
