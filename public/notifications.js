// Encadré « Notifications » de l'accueil (voir notificationsBox dans src/features/accounts/pages.js).
// Abonne ou désabonne cet appareil, et prévient le serveur. Compatible Safari 15 : sans support du push,
// l'encadré reste masqué, sauf sur iPhone hors écran d'accueil, où il explique comment installer l'application.
const box = document.getElementById('notifications');
const statusMessage = box.querySelector('[data-status]');
const csrfToken = document.querySelector('input[name="_csrf"]').value;

const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function show(state, message = '') {
  box.hidden = false;
  for (const block of box.querySelectorAll('[data-state]')) block.hidden = block.dataset.state !== state;
  statusMessage.textContent = message;
}

async function post(path, fields) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, _csrf: csrfToken }),
  });
  if (!response.ok) throw new Error(`Réponse ${response.status} du serveur`);
}

function saveSubscription(subscription) {
  const { endpoint, keys } = subscription.toJSON();
  return post('/push-subscriptions', { endpoint, p256dh: keys.p256dh, auth: keys.auth });
}

// Clé publique VAPID : base64url → octets, format attendu par pushManager.subscribe.
function decodeKey(base64Url) {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function subscribe() {
  try {
    // Demandée directement au clic : Safari refuse la demande d'autorisation sans geste de l'utilisateur.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return show('denied');
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeKey(box.dataset.vapidPublicKey),
    });
    await saveSubscription(subscription);
    show('on', 'Notifications activées.');
  } catch (error) {
    console.error(error);
    show('error');
  }
}

async function unsubscribe() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await post('/push-subscriptions/delete', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    show('off', 'Notifications désactivées.');
  } catch (error) {
    console.error(error);
    show('error');
  }
}

async function start() {
  if (!pushSupported) {
    if (isIos && !navigator.standalone) show('install');
    return;
  }
  box.querySelector('[data-action="subscribe"]').addEventListener('click', subscribe);
  box.querySelector('[data-action="unsubscribe"]').addEventListener('click', unsubscribe);
  if (Notification.permission === 'denied') return show('denied');
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return show('off');
    // Renvoyé à chaque visite : un appareil abonné passe au compte qui s'y connecte.
    await saveSubscription(subscription);
    show('on');
  } catch (error) {
    console.error(error);
    show('error');
  }
}

start();
