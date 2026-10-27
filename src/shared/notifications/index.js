// Seul module qui envoie des e-mails. Un échec est journalisé, jamais propagé.
import nodemailer from 'nodemailer';

export function createNotifications({ transport, from }) {
  async function send(message) {
    try {
      await transport.send({ from, ...message });
    } catch (error) {
      console.error('Échec de l’envoi d’un e-mail :', error);
    }
  }

  return { send };
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
export function createMemoryTransport() {
  const sent = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
