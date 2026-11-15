export function readConfig(env) {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL,
    sessionDurationMinutes: Number(env.SESSION_DURATION_MINUTES ?? 30),
    pageSize: Number(env.PAGE_SIZE ?? 50),
    // Identité de l'émetteur des attestations de don (le dépôt est public : valeurs dans .env).
    issuer: {
      name: env.ISSUER_NAME ?? 'Panier Solidaire 91',
      address: env.ISSUER_ADDRESS,
      registration: env.ISSUER_REGISTRATION,
    },
    secureCookies: env.NODE_ENV === 'production',
    mailFrom: env.MAIL_FROM,
    smtp: {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? 587),
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
    },
    vapid: {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT,
    },
  };
}
