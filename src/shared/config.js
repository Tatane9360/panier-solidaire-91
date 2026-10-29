export function readConfig(env) {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL,
    sessionDurationMinutes: Number(env.SESSION_DURATION_MINUTES ?? 30),
    pageSize: Number(env.PAGE_SIZE ?? 50),
    secureCookies: env.NODE_ENV === 'production',
    mailFrom: env.MAIL_FROM,
    // Adresse publique de l'application, pour les liens des e-mails.
    appUrl: env.APP_URL ?? `http://localhost:${env.PORT ?? 3000}`,
    smtp: {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? 587),
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
    },
  };
}
