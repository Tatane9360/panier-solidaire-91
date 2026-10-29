import { page, escapeHtml, csrfField, COLD_LABELS, formatLocal, formatDecimal } from '../../shared/html.js';

const NAME_ERROR = 'Indiquez le prénom du bénévole qui retirera le lot.';

// Formulaire de réservation d'un lot : le prénom du bénévole est obligatoire.
// Prénom manquant : l'erreur est affichée sous le champ et reliée à lui.
function reserveForm(session, batch, nameError) {
  const id = `reserved_by_name-${batch.id}`;
  const error = nameError === batch.id
    ? `<p id="erreur-${id}" class="font-semibold text-red-800">${NAME_ERROR}</p>`
    : '';
  const invalid = error ? ` aria-invalid="true" aria-describedby="erreur-${id}"` : '';
  return `
        <form method="post" action="/batches/${batch.id}/reserve" class="mt-4 space-y-2">
          ${csrfField(session)}
          <label for="${id}" class="block font-semibold">Prénom du bénévole qui retirera le lot</label>
          <input id="${id}" name="reserved_by_name" type="text" required${invalid} class="w-full rounded border border-slate-500 p-3">
          ${error}
          <button type="submit" class="w-full rounded bg-green-800 px-4 py-3 font-semibold text-white">Réserver ce lot</button>
        </form>`;
}

export function availableBatchesPage({ session, batches, coldCapacity, filtered, reserved = false, nameError = null }) {
  const items = batches
    .map((batch) => {
      // Filtre désactivé : le texte signale le lot que l'association ne peut pas réserver,
      // et aucun formulaire n'est proposé.
      const compatible = coldCapacity.includes(batch.cold_requirement);
      const incompatibleNotice = compatible
        ? ''
        : '<p class="mb-2 font-semibold">Incompatible avec votre capacité de froid</p>';
      return `
      <li class="rounded border border-slate-400 p-4">
        <h2 class="text-lg font-bold">${escapeHtml(batch.nature)}</h2>
        ${incompatibleNotice}
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt class="font-semibold">Quantité</dt><dd>${escapeHtml(batch.quantity)} ${escapeHtml(batch.quantity_unit)}</dd>
          <dt class="font-semibold">Poids</dt><dd>${escapeHtml(formatDecimal(batch.weight_kg))} kg</dd>
          <dt class="font-semibold">Date limite</dt><dd>${escapeHtml(batch.date_type)} ${escapeHtml(formatLocal(batch.expiry_date))}</dd>
          <dt class="font-semibold">Créneau de retrait</dt><dd>du ${escapeHtml(formatLocal(batch.pickup_start))} au ${escapeHtml(formatLocal(batch.pickup_end))}</dd>
          <dt class="font-semibold">Froid</dt><dd>${COLD_LABELS[batch.cold_requirement]}</dd>
          <dt class="font-semibold">Commerce</dt><dd>${escapeHtml(batch.organization_name)}<br>${escapeHtml(batch.address)}</dd>
        </dl>
        ${compatible ? reserveForm(session, batch, nameError) : ''}
      </li>`;
    })
    .join('');
  let notice = '';
  if (reserved) {
    notice = '<p role="status" class="mb-4 border-l-4 border-green-700 bg-green-50 p-3 text-green-900">Lot réservé. Le commerce verra le prénom du bénévole.</p>';
  }
  // Résumé annoncé, avec un lien vers le champ en erreur.
  if (nameError) {
    notice = `<p role="alert" class="mb-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">
      <a href="#reserved_by_name-${nameError}" class="underline">${NAME_ERROR}</a></p>`;
  }
  const filterNotice = filtered
    ? `<p class="mb-6">Seuls les lots compatibles avec votre <a href="/cold-capacity" class="underline">capacité de froid</a> sont affichés.
      <a href="/available-batches?all=1" class="underline">Afficher tous les lots</a></p>`
    : `<p class="mb-6">Tous les lots sont affichés.
      <a href="/available-batches" class="underline">N’afficher que les lots compatibles avec ma capacité de froid</a></p>`;
  return page({
    title: nameError ? 'Erreur – Lots disponibles' : 'Lots disponibles',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Lots disponibles</h1>
    ${notice}
    ${filterNotice}
    ${batches.length === 0 ? '<p>Aucun lot disponible pour l’instant.</p>' : `<ul class="space-y-4">${items}</ul>`}
    <p class="mt-6"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}

export function coldCapacityPage({ session, coldCapacity, notifyNewBatches, saved = false, alertsSaved = false, error = '' }) {
  const boxes = Object.entries(COLD_LABELS)
    .map(([level, label]) => {
      const checked = coldCapacity.includes(level) ? ' checked' : '';
      return `
        <div class="py-1">
          <input id="cold_capacity-${level}" name="cold_capacity" type="checkbox" value="${level}"${checked}>
          <label for="cold_capacity-${level}">${label}</label>
        </div>`;
    })
    .join('');
  const notice = saved
    ? '<p role="status" class="mb-4 border-l-4 border-green-700 bg-green-50 p-3 text-green-900">Capacité de froid enregistrée.</p>'
    : alertsSaved
      ? '<p role="status" class="mb-4 border-l-4 border-green-700 bg-green-50 p-3 text-green-900">Préférence d’alerte enregistrée.</p>'
      : '';
  const alert = error
    ? `<p id="erreur-cold_capacity" role="alert" class="mb-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">${escapeHtml(error)}</p>`
    : '';
  return page({
    title: error ? 'Erreur – Capacité de froid' : 'Capacité de froid',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Capacité de froid</h1>
    ${notice}${alert}
    <form method="post" action="/cold-capacity" class="space-y-4">
      ${csrfField(session)}
      <fieldset${error ? ' aria-describedby="erreur-cold_capacity"' : ''}>
        <legend class="font-semibold">Niveaux de température que votre association sait respecter</legend>
        ${boxes}
      </fieldset>
      <p>La modification s’applique à vos prochaines réservations.</p>
      <button type="submit" class="w-full rounded bg-green-800 px-4 py-3 font-semibold text-white">Enregistrer</button>
    </form>
    <h2 class="mb-4 mt-8 text-xl font-bold">Alertes par e-mail</h2>
    <form method="post" action="/new-batch-alerts" class="space-y-4">
      ${csrfField(session)}
      <div>
        <input id="notify_new_batches" name="notify_new_batches" type="checkbox" value="1"${notifyNewBatches ? ' checked' : ''}>
        <label for="notify_new_batches">Recevoir un e-mail à chaque nouveau lot compatible avec ma capacité de froid</label>
      </div>
      <button type="submit" class="w-full rounded bg-green-800 px-4 py-3 font-semibold text-white">Enregistrer la préférence</button>
    </form>
    <p class="mt-6"><a href="/available-batches" class="underline">Voir les lots disponibles</a></p>
    <p class="mt-2"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}

const COLLECTED_NAME_ERROR = 'Indiquez le prénom du bénévole qui a retiré le lot.';

// Formulaire de confirmation de la collecte, prénom prérempli avec celui de la réservation.
// Prénom manquant : l'erreur est affichée sous le champ et reliée à lui.
function confirmPickupForm(session, batch, nameError) {
  const id = `collected_by_name-${batch.id}`;
  const error = nameError === batch.id
    ? `<p id="erreur-${id}" class="font-semibold text-red-800">${COLLECTED_NAME_ERROR}</p>`
    : '';
  const invalid = error ? ` aria-invalid="true" aria-describedby="erreur-${id}"` : '';
  return `
        <form method="post" action="/batches/${batch.id}/confirm-pickup" class="mt-4 space-y-2">
          ${csrfField(session)}
          <label for="${id}" class="block font-semibold">Prénom du bénévole qui a retiré le lot</label>
          <input id="${id}" name="collected_by_name" type="text" required value="${escapeHtml(batch.reserved_by_name)}"${invalid} class="w-full rounded border border-slate-500 p-3">
          ${error}
          <button type="submit" class="w-full rounded bg-green-800 px-4 py-3 font-semibold text-white">Confirmer la collecte<span class="sr-only"> : ${escapeHtml(batch.nature)}</span></button>
        </form>`;
}

export function reservationsPage({ session, batches, cancelled = false, collected = false, nameError = null }) {
  const items = batches
    .map((batch) => `
      <li class="rounded border border-slate-400 p-4">
        <h2 class="text-lg font-bold">${escapeHtml(batch.nature)}</h2>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt class="font-semibold">Quantité</dt><dd>${escapeHtml(batch.quantity)} ${escapeHtml(batch.quantity_unit)}</dd>
          <dt class="font-semibold">Poids</dt><dd>${escapeHtml(formatDecimal(batch.weight_kg))} kg</dd>
          <dt class="font-semibold">Créneau de retrait</dt><dd>du ${escapeHtml(formatLocal(batch.pickup_start))} au ${escapeHtml(formatLocal(batch.pickup_end))}</dd>
          <dt class="font-semibold">Commerce</dt><dd>${escapeHtml(batch.organization_name)}<br>${escapeHtml(batch.address)}</dd>
          <dt class="font-semibold">Bénévole</dt><dd>${escapeHtml(batch.reserved_by_name)}</dd>
        </dl>
        ${batch.cancellable ? `
        <form method="post" action="/batches/${batch.id}/cancel-reservation" class="mt-4">
          ${csrfField(session)}
          <button type="submit" class="w-full rounded border-2 border-red-800 px-4 py-3 font-semibold text-red-800">Annuler la réservation<span class="sr-only"> : ${escapeHtml(batch.nature)}</span></button>
        </form>` : '<p class="mt-4">Créneau de retrait terminé.</p>'}
        ${confirmPickupForm(session, batch, nameError)}
      </li>`)
    .join('');
  let notice = '';
  if (cancelled) {
    notice = '<p role="status" class="mb-4 border-l-4 border-green-700 bg-green-50 p-3 text-green-900">Réservation annulée. Le lot est de nouveau disponible pour les associations.</p>';
  }
  if (collected) {
    notice = '<p role="status" class="mb-4 border-l-4 border-green-700 bg-green-50 p-3 text-green-900">Collecte confirmée. Le commerce en est prévenu par e-mail.</p>';
  }
  // Résumé annoncé, avec un lien vers le champ en erreur.
  if (nameError) {
    notice = `<p role="alert" class="mb-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">
      <a href="#collected_by_name-${nameError}" class="underline">${COLLECTED_NAME_ERROR}</a></p>`;
  }
  return page({
    title: nameError ? 'Erreur – Mes réservations' : 'Mes réservations',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Mes réservations</h1>
    ${notice}
    ${batches.length === 0 ? '<p>Aucune réservation en cours.</p>' : `<ul class="space-y-4">${items}</ul>`}
    <p class="mt-6"><a href="/available-batches" class="underline">Voir les lots disponibles</a></p>
    <p class="mt-2"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}

// Refus : le message annoncé, une aide éventuelle et un lien de retour.
function refusedPage({ title, message, hint = '', backLink }) {
  return page({
    title,
    content: `
    <h1 class="mb-6 text-2xl font-bold">${title}</h1>
    <p role="alert" class="mb-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">${escapeHtml(message)}</p>
    ${hint}
    <p>${backLink}</p>`,
  });
}

// Réservation refusée : le message, et le lien vers la capacité de froid si elle est en cause.
export function reservationRefusedPage({ message, coldCapacityLink = false }) {
  return refusedPage({
    title: 'Réservation impossible',
    message,
    hint: coldCapacityLink
      ? '<p class="mb-4">Si votre association est équipée, <a href="/cold-capacity" class="underline">mettez à jour sa capacité de froid</a>.</p>'
      : '',
    backLink: '<a href="/available-batches" class="underline">Revenir aux lots disponibles</a>',
  });
}

export function cancellationRefusedPage({ message }) {
  return refusedPage({
    title: 'Annulation impossible',
    message,
    backLink: '<a href="/reservations" class="underline">Revenir à mes réservations</a>',
  });
}

export function collectionRefusedPage({ message }) {
  return refusedPage({
    title: 'Confirmation impossible',
    message,
    backLink: '<a href="/reservations" class="underline">Revenir à mes réservations</a>',
  });
}
