import { page, escapeHtml, csrfField, formatLocal } from '../../shared/html.js';

// Formulaire de collecte tardive : date réelle de collecte (heure de Paris) et motif, obligatoires.
export function latePickupPage({ session, batch, values, errors }) {
  const messages = Object.entries(errors).map(([name, message]) => `<li><a href="#${name}" class="underline">${escapeHtml(message)}</a></li>`).join('');
  const summary = messages
    ? `<div role="alert" class="mb-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">
      <p class="font-semibold">La collecte n’a pas pu être enregistrée :</p>
      <ul class="list-disc pl-5">${messages}</ul>
    </div>`
    : '';
  const field = ({ name, label, type }) => `
      <div>
        <label for="${name}" class="block font-semibold">${label}</label>
        <input id="${name}" name="${name}" type="${type}" required value="${escapeHtml(values[name] ?? '')}"${errors[name] ? ` aria-invalid="true" aria-describedby="erreur-${name}"` : ''}
          class="mt-1 w-full rounded border border-slate-500 p-3">
        ${errors[name] ? `<p id="erreur-${name}" class="mt-1 font-semibold text-red-800">${escapeHtml(errors[name])}</p>` : ''}
      </div>`;
  return page({
    title: summary ? 'Erreur – Collecte tardive' : 'Collecte tardive',
    content: `
    <h1 class="mb-2 text-2xl font-bold">Enregistrer une collecte tardive</h1>
    <p class="mb-2">Lot « ${escapeHtml(batch.nature)} » de ${escapeHtml(batch.store_name)}, réservé par ${escapeHtml(batch.association_name)}.</p>
    <p class="mb-6">Créneau du ${escapeHtml(formatLocal(batch.pickup_start))} au ${escapeHtml(formatLocal(batch.pickup_end_local))}.</p>
    ${summary}
    <form method="post" action="/monitoring/batches/${batch.id}/late-pickup" class="space-y-4">
      ${csrfField(session)}
      ${field({ name: 'collected_at', label: 'Date et heure réelles de la collecte', type: 'datetime-local' })}
      ${field({ name: 'reason', label: 'Motif', type: 'text' })}
      <button type="submit" class="w-full rounded bg-green-800 px-4 py-3 font-semibold text-white">Enregistrer la collecte</button>
    </form>
    <p class="mt-6"><a href="/monitoring/batches" class="underline">Revenir au suivi des lots</a></p>`,
  });
}
