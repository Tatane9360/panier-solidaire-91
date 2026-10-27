// Toute donnée affichée passe par escapeHtml.
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function csrfField(session) {
  return `<input type="hidden" name="_csrf" value="${escapeHtml(session.csrfToken)}">`;
}

// Page d'erreur (401, 403) : un titre et un message, avec un lien vers la connexion.
export function errorPage(message) {
  return page({
    title: message,
    content: `
    <h1 class="mb-6 text-2xl font-bold">${escapeHtml(message)}</h1>
    <p><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}

// Gabarit commun. `title` est du texte, `content` du HTML déjà échappé.
export function page({ title, content }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} – Panier Solidaire 91</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body class="bg-white text-slate-900">
  <a href="#contenu" class="sr-only focus:not-sr-only">Aller au contenu</a>
  <header class="border-b border-slate-300 px-4 py-3">
    <p class="font-bold">Panier Solidaire 91</p>
  </header>
  <main id="contenu" class="mx-auto max-w-2xl px-4 py-6">
${content}
  </main>
</body>
</html>`;
}
