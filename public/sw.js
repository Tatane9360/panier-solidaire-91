// Service worker : reçoit les notifications push et ouvre la bonne page quand on en touche une.
// Il ne met aucune page en cache (jamais de page de données hors ligne).

// Safari exige qu'un push affiche toujours une notification.
self.addEventListener('push', (event) => {
  const { title, body, url } = event.data.json();
  event.waitUntil(self.registration.showNotification(title, { body, lang: 'fr', data: { url } }));
});

// `url` est un chemin de l'application, par exemple /available-batches.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
