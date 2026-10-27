import { page, escapeHtml, csrfField, COLD_LABELS, formatLocal, formatDecimal } from '../../shared/html.js';

export function availableBatchesPage({ batches, coldCapacity, filtered }) {
  const items = batches
    .map((batch) => {
      // Filtre désactivé : le texte signale le lot que l'association ne peut pas réserver.
      const incompatible = coldCapacity.includes(batch.cold_requirement)
        ? ''
        : '<p class="mb-2 font-semibold">Incompatible avec votre capacité de froid</p>';
      return `
      <li class="rounded border border-slate-400 p-4">
        <h2 class="text-lg font-bold">${escapeHtml(batch.nature)}</h2>
        ${incompatible}
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt class="font-semibold">Quantité</dt><dd>${escapeHtml(batch.quantity)} ${escapeHtml(batch.quantity_unit)}</dd>
          <dt class="font-semibold">Poids</dt><dd>${escapeHtml(formatDecimal(batch.weight_kg))} kg</dd>
          <dt class="font-semibold">Date limite</dt><dd>${escapeHtml(batch.date_type)} ${escapeHtml(formatLocal(batch.expiry_date))}</dd>
          <dt class="font-semibold">Créneau de retrait</dt><dd>du ${escapeHtml(formatLocal(batch.pickup_start))} au ${escapeHtml(formatLocal(batch.pickup_end))}</dd>
          <dt class="font-semibold">Froid</dt><dd>${COLD_LABELS[batch.cold_requirement]}</dd>
          <dt class="font-semibold">Commerce</dt><dd>${escapeHtml(batch.organization_name)}<br>${escapeHtml(batch.address)}</dd>
        </dl>
      </li>`;
    })
    .join('');
  const filterNotice = filtered
    ? `<p class="mb-6">Seuls les lots compatibles avec votre <a href="/cold-capacity" class="underline">capacité de froid</a> sont affichés.
      <a href="/available-batches?all=1" class="underline">Afficher tous les lots</a></p>`
    : `<p class="mb-6">Tous les lots sont affichés.
      <a href="/available-batches" class="underline">N’afficher que les lots compatibles avec ma capacité de froid</a></p>`;
  return page({
    title: 'Lots disponibles',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Lots disponibles</h1>
    ${filterNotice}
    ${batches.length === 0 ? '<p>Aucun lot disponible pour l’instant.</p>' : `<ul class="space-y-4">${items}</ul>`}
    <p class="mt-6"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}

export function coldCapacityPage({ session, coldCapacity, saved = false, error = '' }) {
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
    <p class="mt-6"><a href="/available-batches" class="underline">Voir les lots disponibles</a></p>
    <p class="mt-2"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}
