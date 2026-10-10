<?php
declare(strict_types=1);

namespace Npm;

use DateTime;

/**
 * Validateurs réutilisables pour les entrées utilisateur.
 */
final class Validator
{
    public static function email(?string $value): bool
    {
        return is_string($value) && filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
    }

    public static function dateYmd(?string $value): bool
    {
        if (!is_string($value)) {
            return false;
        }
        $date = DateTime::createFromFormat('Y-m-d', $value);
        return $date !== false && $date->format('Y-m-d') === $value;
    }

    public static function length(string $value, int $min, int $max): bool
    {
        $length = mb_strlen($value);
        return $length >= $min && $length <= $max;
    }

    public static function phone(?string $value): bool
    {
        return is_string($value) && (bool) preg_match('/^\+?[0-9 ().\-]{6,20}$/', $value);
    }

    public static function intRange(mixed $value, int $min, int $max): bool
    {
        if (!is_numeric($value)) {
            return false;
        }
        $int = (int) $value;
        return $int >= $min && $int <= $max;
    }

    /** Vérifie qu'une valeur fait partie d'une liste blanche. */
    public static function inList(mixed $value, array $allowed): bool
    {
        return in_array($value, $allowed, true);
    }
}
