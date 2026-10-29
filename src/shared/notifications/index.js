// Seul module qui envoie des e-mails. Un échec est journalisé, jamais propagé.
import nodemailer from 'nodemailer';

export function createNotifications({ transport, from, appUrl }) {
  async function send(message) {
    try {
      await transport.send({ from, ...message });
    } catch (error) {
      console.error('Échec de l’envoi d’un e-mail :', error);
    }
  }

  // Décision de la Coordination sur une inscription, envoyée au demandeur.
  function registrationDecided({ email, approved, refusalReason }) {
    const decision = approved
      ? 'Votre inscription a été validée. Vous pouvez dès maintenant vous connecter.'
      : 'Votre inscription a été refusée.';
    const reason = !approved && refusalReason ? `\nMotif : ${refusalReason}` : '';
    return send({
      to: email,
      subject: 'Votre inscription au Panier Solidaire 91',
      text: `Bonjour,\n\n${decision}${reason}\n\nLa Coordination du Panier Solidaire 91`,
    });
  }

  // Collecte confirmée, envoyée au commerce. `collectedAt` : date déjà formatée en heure de Paris.
  function batchCollected({ email, nature, collectedAt }) {
    return send({
      to: email,
      subject: 'Votre lot a été collecté',
      text: `Bonjour,\n\nVotre lot « ${nature} » a été collecté le ${collectedAt}.\nMerci pour votre don !\n\nLa Coordination du Panier Solidaire 91`,
    });
  }

  // Nouveau lot, un e-mail par association pour ne pas révéler les adresses des autres.
  // Dates déjà formatées en heure de Paris, poids déjà au format français.
  async function newBatchAvailable({ emails, nature, weightKg, expiryDate, pickupStart, pickupEnd, store }) {
    const text = `Bonjour,

Un nouveau lot est disponible :
`
      + `- Nature : ${nature}
- Poids : ${weightKg} kg
- Date limite : ${expiryDate}
`
      + `- Créneau de retrait : ${pickupStart} – ${pickupEnd}
- Commerce : ${store}

`
      + `Pour le réserver : ${appUrl}/available-batches

`
      + `Vous pouvez désactiver ces alertes depuis la page « Capacité de froid » de votre compte.

`
      + `La Coordination du Panier Solidaire 91`;
    // ponytail: envois en série avant la réponse ; file d'attente si le nombre d'associations grossit.
    for (const email of emails) {
      await send({ to: email, subject: 'Nouveau lot disponible', text });
    }
  }

  return { send, registrationDecided, batchCollected, newBatchAvailable };
}

export function createSmtpTransport({ host, port, user, password }) {
  const transporter = nodemailer.createTransport({
    host,
    port,
    auth: user ? { user, pass: password } : undefined,
  });
  return { send: (message) => transporter.sendMail(message) };
}

// Utilisé par les tests : on vérifie destinataire et objet dans `sent`.
// `failing` simule une panne du service d'e-mail.
export function createMemoryTransport() {
  const sent = [];
  return {
    sent,
    failing: false,
    async send(message) {
      if (this.failing) throw new Error('Service d’e-mail indisponible (simulation)');
      sent.push(message);
    },
  };
}
