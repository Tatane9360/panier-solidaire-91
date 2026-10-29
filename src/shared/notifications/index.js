// Seul module qui envoie des e-mails et des notifications push. Un échec est journalisé, jamais propagé.
// E-mail : décision sur une inscription (le demandeur n'a pas encore d'appareil abonné).
// Push : tout le reste, vers les appareils abonnés des comptes concernés.
import nodemailer from 'nodemailer';
import webpush from 'web-push';

// Le service de push répond 404 ou 410 quand un abonnement n'existe plus (appareil désabonné, navigateur réinstallé).
const GONE_STATUSES = new Set([404, 410]);

export function createNotifications({ db, mailTransport, pushTransport, from }) {
  async function send(message) {
    try {
      await mailTransport.send({ from, ...message });
    } catch (error) {
      console.error('Échec de l’envoi d’un e-mail :', error);
    }
  }

  // Envoie la même notification à chaque appareil abonné des comptes donnés.
  // `url` : page ouverte quand on touche la notification.
  async function push(accountIds, { title, body, url }) {
    try {
      const { rows } = await db.query(
        'SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE account_id = ANY ($1)',
        [accountIds],
      );
      const payload = JSON.stringify({ title, body, url });
      // ponytail: envois en série avant la réponse ; file d'attente si le nombre d'appareils grossit.
      for (const subscription of rows) {
        try {
          await pushTransport.send(subscription, payload);
        } catch (error) {
          // Un appareil en échec ne prive pas les suivants.
          if (GONE_STATUSES.has(error.statusCode)) {
            await db.query('DELETE FROM push_subscription WHERE id = $1', [subscription.id]);
          } else {
            console.error('Échec de l’envoi d’une notification push :', error);
          }
        }
      }
    } catch (error) {
      console.error('Échec de l’envoi d’une notification push :', error);
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
  function batchCollected({ storeId, nature, collectedAt }) {
    return push([storeId], {
      title: 'Votre lot a été collecté',
      body: `Votre lot « ${nature} » a été collecté le ${collectedAt}. Merci pour votre don !`,
      url: '/batches',
    });
  }

  // Nouveau lot, envoyé aux associations concernées.
  // Dates déjà formatées en heure de Paris, poids déjà au format français.
  function newBatchAvailable({ associationIds, nature, weightKg, expiryDate, pickupStart, pickupEnd, store }) {
    return push(associationIds, {
      title: 'Nouveau lot disponible',
      body: `${nature}, ${weightKg} kg, chez ${store}. Date limite : ${expiryDate}. `
        + `Retrait du ${pickupStart} au ${pickupEnd}.`,
      url: '/available-batches',
    });
  }

  return { registrationDecided, batchCollected, newBatchAvailable };
}

export function createSmtpTransport({ host, port, user, password }) {
  const transporter = nodemailer.createTransport({
    host,
    port,
    auth: user ? { user, pass: password } : undefined,
  });
  return { send: (message) => transporter.sendMail(message) };
}

// Clés VAPID : identifient le serveur auprès des services de push (Google, Apple, Mozilla…).
// Le contenu est chiffré pour l'appareil : ces services ne peuvent pas le lire.
export function createWebPushTransport({ publicKey, privateKey, subject }) {
  if (!publicKey || !privateKey || !subject) {
    throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY et VAPID_SUBJECT sont obligatoires (voir le README).');
  }
  const options = {
    vapidDetails: { subject, publicKey, privateKey },
    // Une notification de plus d'un jour n'a plus d'intérêt : le service de push l'abandonne.
    TTL: 24 * 60 * 60,
  };
  return {
    send: ({ endpoint, p256dh, auth }, payload) =>
      webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, payload, options),
  };
}

// Utilisés par les tests : on vérifie destinataire et objet (ou appareil et titre) dans `sent`.
// `failing` simule une panne du service.
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

// `gone` : appareils dont le service de push répond 410 (abonnement disparu).
export function createMemoryPushTransport() {
  const sent = [];
  return {
    sent,
    gone: new Set(),
    failing: false,
    async send({ endpoint }, payload) {
      if (this.failing) throw new Error('Service de push indisponible (simulation)');
      if (this.gone.has(endpoint)) throw Object.assign(new Error('Abonnement disparu (simulation)'), { statusCode: 410 });
      sent.push({ endpoint, ...JSON.parse(payload) });
    },
  };
}
