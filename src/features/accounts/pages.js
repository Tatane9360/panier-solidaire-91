import { page, escapeHtml, csrfField } from '../../shared/html.js';

export function loginPage({ session, error = '', email = '' }) {
  const errorBlock = error
    ? `<p id="erreur-connexion" role="alert" class="mb-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">${escapeHtml(error)}</p>`
    : '';
  const describedBy = error ? ' aria-describedby="erreur-connexion"' : '';
  return page({
    title: 'Connexion',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Connexion</h1>
    ${errorBlock}
    <form method="post" action="/login" class="space-y-4">
      ${csrfField(session)}
      <div>
        <label for="email" class="block font-semibold">Adresse e-mail</label>
        <input id="email" name="email" type="email" autocomplete="email" required value="${escapeHtml(email)}"${describedBy}
          class="mt-1 w-full rounded border border-slate-500 p-2">
      </div>
      <div>
        <label for="password" class="block font-semibold">Mot de passe</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required${describedBy}
          class="mt-1 w-full rounded border border-slate-500 p-2">
      </div>
      <button type="submit" class="rounded bg-green-800 px-4 py-2 font-semibold text-white">Se connecter</button>
    </form>
    <p class="mt-6"><a href="/register" class="underline">Pas encore de compte ? S’inscrire</a></p>`,
  });
}

export function homePage({ session }) {
  return page({
    title: 'Accueil',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Accueil</h1>
    <p class="mb-6">Connecté en tant que ${escapeHtml(session.account.organization_name)}.</p>
    ${session.account.role === 'COORDINATOR' ? '<p class="mb-6"><a href="/registrations" class="underline">Inscriptions en attente</a></p>' : ''}
    ${session.account.role === 'STORE' ? `
    <p class="mb-4"><a href="/batches/new" class="inline-block w-full rounded bg-green-800 px-4 py-3 text-center font-semibold text-white">Déclarer un lot</a></p>
    <p class="mb-6"><a href="/batches" class="underline">Mes lots</a></p>` : ''}
    ${session.account.role === 'ASSOCIATION' ? `
    <p class="mb-4"><a href="/available-batches" class="inline-block w-full rounded bg-green-800 px-4 py-3 text-center font-semibold text-white">Lots disponibles</a></p>
    <p class="mb-2"><a href="/reservations" class="underline">Mes réservations</a></p>
    <p class="mb-6"><a href="/cold-capacity" class="underline">Capacité de froid</a></p>` : ''}
    <form method="post" action="/logout">
      ${csrfField(session)}
      <button type="submit" class="rounded border border-slate-700 px-4 py-2">Se déconnecter</button>
    </form>`,
  });
}

const ROLE_LABELS = { STORE: 'Commerce', ASSOCIATION: 'Association' };

export function registerPage({ session, error = '', values = {} }) {
  const errorBlock = error
    ? `<p id="erreur-inscription" role="alert" class="mb-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">${escapeHtml(error)}</p>`
    : '';
  const describedBy = error ? ' aria-describedby="erreur-inscription"' : '';
  const value = (name) => escapeHtml(values[name] ?? '');
  const roleOptions = Object.entries(ROLE_LABELS)
    .map(([role, label]) => {
      const checked = values.role === role ? ' checked' : '';
      return `
        <div>
          <input id="role-${role}" name="role" type="radio" value="${role}" required${checked}${describedBy}>
          <label for="role-${role}">${label}</label>
        </div>`;
    })
    .join('');
  return page({
    title: 'Inscription',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Inscription</h1>
    ${errorBlock}
    <form method="post" action="/register" class="space-y-4">
      ${csrfField(session)}
      <div>
        <label for="organization_name" class="block font-semibold">Nom de la structure</label>
        <input id="organization_name" name="organization_name" type="text" autocomplete="organization" required value="${value('organization_name')}"${describedBy}
          class="mt-1 w-full rounded border border-slate-500 p-2">
      </div>
      <fieldset>
        <legend class="font-semibold">Type de structure</legend>
        ${roleOptions}
      </fieldset>
      <div>
        <label for="address" class="block font-semibold">Adresse</label>
        <input id="address" name="address" type="text" autocomplete="street-address" required value="${value('address')}"${describedBy}
          class="mt-1 w-full rounded border border-slate-500 p-2">
      </div>
      <div>
        <label for="email" class="block font-semibold">Adresse e-mail</label>
        <input id="email" name="email" type="email" autocomplete="email" required value="${value('email')}"${describedBy}
          class="mt-1 w-full rounded border border-slate-500 p-2">
      </div>
      <div>
        <label for="password" class="block font-semibold">Mot de passe</label>
        <input id="password" name="password" type="password" autocomplete="new-password" required${describedBy}
          class="mt-1 w-full rounded border border-slate-500 p-2">
      </div>
      <button type="submit" class="rounded bg-green-800 px-4 py-2 font-semibold text-white">S’inscrire</button>
    </form>
    <p class="mt-6"><a href="/login" class="underline">Déjà inscrit ? Se connecter</a></p>`,
  });
}

export function registeredPage() {
  return page({
    title: 'Inscription enregistrée',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Inscription enregistrée</h1>
    <p>Votre inscription est en attente de validation par la Coordination. Vous recevrez un e-mail dès qu’elle aura été examinée.</p>`,
  });
}

export function registrationsPage({ session, accounts }) {
  const items = accounts
    .map((account) => `
      <li class="rounded border border-slate-400 p-4">
        <h2 class="text-lg font-bold">${escapeHtml(account.organization_name)}</h2>
        <dl class="mb-4">
          <dt class="font-semibold">Type</dt><dd>${ROLE_LABELS[account.role]}</dd>
          <dt class="font-semibold">Adresse</dt><dd>${escapeHtml(account.address)}</dd>
          <dt class="font-semibold">Adresse e-mail</dt><dd>${escapeHtml(account.email)}</dd>
        </dl>
        <form method="post" action="/registrations/${account.id}/approve" class="mb-4">
          ${csrfField(session)}
          <button type="submit" class="rounded bg-green-800 px-4 py-2 font-semibold text-white">Valider l’inscription</button>
        </form>
        <form method="post" action="/registrations/${account.id}/refuse" class="space-y-2">
          ${csrfField(session)}
          <label for="refusal_reason-${account.id}" class="block font-semibold">Motif du refus (facultatif)</label>
          <textarea id="refusal_reason-${account.id}" name="refusal_reason" rows="2"
            class="w-full rounded border border-slate-500 p-2"></textarea>
          <button type="submit" class="rounded border border-red-800 px-4 py-2 font-semibold text-red-900">Refuser l’inscription</button>
        </form>
      </li>`)
    .join('');
  return page({
    title: 'Inscriptions en attente',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Inscriptions en attente</h1>
    ${accounts.length === 0 ? '<p>Aucune inscription en attente.</p>' : `<ul class="space-y-4">${items}</ul>`}
    <p class="mt-6"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}

export function alreadyLoggedInPage({ session }) {
  return page({
    title: 'Inscription',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Inscription</h1>
    <p class="mb-6">Vous êtes connecté en tant que ${escapeHtml(session.account.organization_name)}. Pour inscrire une autre structure, déconnectez-vous d’abord.</p>
    <form method="post" action="/logout" class="mb-6">
      ${csrfField(session)}
      <button type="submit" class="rounded border border-slate-700 px-4 py-2">Se déconnecter</button>
    </form>
    <p><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}
