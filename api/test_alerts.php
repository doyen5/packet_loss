<?php
/**
 * API — Envoie un email de test à l'adresse fournie.
 */
declare(strict_types=1);

use Npm\Auth;
use Npm\Http\Csrf;
use Npm\Http\Json;
use Npm\Mailer;
use Npm\Rbac;

require_once __DIR__ . '/bootstrap.php';

Auth::requireLogin();
Rbac::require(Auth::role(), 'packet_loss.view');

Json::requireMethod('POST');
Csrf::requireValid();

$input = Json::input();
$email = filter_var(trim((string) ($input['email'] ?? '')), FILTER_VALIDATE_EMAIL);

if (!$email) {
    Json::error('Email invalide.', 400);
}

$subject = "✅ Test d'alerte Packet Loss Intelligence";
$body    = "Ceci est un email de test.\n\n"
         . "Votre configuration d'alerte est correcte.\n\n"
         . "Vous recevrez désormais des alertes lorsque des sites dépasseront "
         . "leur seuil pendant la durée configurée.\n\n"
         . "— Packet Loss Intelligence";

$ok = Mailer::send((string) $email, $subject, $body);

if (!$ok) {
    Json::error('Échec envoi (vérifier configuration SMTP).', 502);
}

Json::ok(['message' => 'Email de test envoyé à ' . $email . '.']);
