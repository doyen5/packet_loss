<?php
/**
 * API — Envoie un email de test à l'adresse fournie.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if($_SERVER['REQUEST_METHOD'] !== 'POST'){
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'POST requis.']);
    exit;
}

$input = json_decode(file_get_contents('php://input') ?: '', true);
$email = filter_var($input['email'] ?? '', FILTER_VALIDATE_EMAIL);

if(!$email){
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Email invalide.']);
    exit;
}

$subject = "✅ Test d'alerte Packet Loss Intelligence";
$body    = "Ceci est un email de test.\n\n"
         . "Votre configuration d'alerte est correcte.\n\n"
         . "Vous recevrez désormais des alertes lorsque des sites dépasseront "
         . "leur seuil pendant la durée configurée.\n\n"
         . "— Packet Loss Intelligence";

$headers = "From: alerts@packetloss.local\r\n"
         . "Reply-To: alerts@packetloss.local\r\n"
         . "Content-Type: text/plain; charset=UTF-8";

$ok = @mail($email, $subject, $body, $headers);

echo json_encode([
    'success' => $ok,
    'message' => $ok ? 'Email envoyé.' : 'Échec envoi (vérifier configuration SMTP).'
]);