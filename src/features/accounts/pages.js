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
    </form>`,
  });
}

export function homePage({ session }) {
  return page({
    title: 'Accueil',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Accueil</h1>
    <p class="mb-6">Connecté en tant que ${escapeHtml(session.account.organization_name)}.</p>
    <form method="post" action="/logout">
      ${csrfField(session)}
      <button type="submit" class="rounded border border-slate-700 px-4 py-2">Se déconnecter</button>
    </form>`,
  });
}
