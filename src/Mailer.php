<?php
declare(strict_types=1);

namespace Npm;

/**
 * Envoi d'emails.
 *
 * Le pilote est défini par app.mail.driver (MAIL_DRIVER dans .env) :
 *  - 'log'  : l'email est écrit dans logs/mail.log (développement).
 *  - autre  : tentative d'envoi via mail() et journalisation du résultat.
 */
final class Mailer
{
    public static function send(string $to, string $subject, string $body): bool
    {
        $driver = (string) Config::get('app.mail.driver', 'log');
        $from   = (string) Config::get('app.mail.from', 'alerts@packetloss.local');

        if ($driver === 'log') {
            Logger::log('mail', 'LOG -> ' . $to . ' | ' . $subject, [
                'from' => $from,
                'body' => $body,
            ]);
            return true;
        }

        $headers = 'From: ' . $from . "\r\n"
            . 'Reply-To: ' . $from . "\r\n"
            . 'Content-Type: text/plain; charset=UTF-8';

        $ok = @mail($to, $subject, $body, $headers);
        Logger::log('mail', ($ok ? 'SENT' : 'FAILED') . ' -> ' . $to . ' | ' . $subject);

        return $ok;
    }
}
