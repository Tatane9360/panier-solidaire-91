import { page, escapeHtml, csrfField, formatLocal, formatDecimal } from '../../shared/html.js';

const FIELD_CLASS = 'mt-1 w-full rounded border border-slate-500 p-3';

function errorSummary(errors) {
  const items = Object.entries(errors)
    .map(([name, message]) => `<li><a href="#${name}" class="underline">${escapeHtml(message)}</a></li>`)
    .join('');
  if (!items) return '';
  return `<div role="alert" class="mb-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">
      <p class="font-semibold">L’attestation n’a pas pu être produite :</p>
      <ul class="list-disc pl-5">${items}</ul>
    </div>`;
}

function field({ name, label, type, values, errors }) {
  const invalid = errors[name] ? ` aria-invalid="true" aria-describedby="erreur-${name}"` : '';
  return `
      <div>
        <label for="${name}" class="block font-semibold">${label}</label>
        <input id="${name}" name="${name}" type="${type}" required value="${escapeHtml(values[name] ?? '')}"${invalid} class="${FIELD_CLASS}">
        ${errors[name] ? `<p id="erreur-${name}" class="mt-1 font-semibold text-red-800">${escapeHtml(errors[name])}</p>` : ''}
      </div>`;
}

// Formulaire : commerce et période (dates de Paris, bornes incluses).
export function certificateFormPage({ session, stores, values, errors }) {
  const options = stores
    .map((store) => `<option value="${store.id}"${String(store.id) === values.store_id ? ' selected' : ''}>${escapeHtml(store.organization_name)}</option>`)
    .join('');
  return page({
    title: Object.keys(errors).length > 0 ? 'Erreur – Attestation de don' : 'Attestation de don',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Produire une attestation de don</h1>
    ${errorSummary(errors)}
    <form method="post" action="/certificates" class="space-y-4">
      ${csrfField(session)}
      <div>
        <label for="store_id" class="block font-semibold">Commerce</label>
        <select id="store_id" name="store_id" required${errors.store_id ? ' aria-invalid="true" aria-describedby="erreur-store_id"' : ''} class="${FIELD_CLASS}">
          <option value="">Choisir un commerce</option>${options}
        </select>
        ${errors.store_id ? `<p id="erreur-store_id" class="mt-1 font-semibold text-red-800">${escapeHtml(errors.store_id)}</p>` : ''}
      </div>
      ${field({ name: 'period_start', label: 'Début de la période (inclus)', type: 'date', values, errors })}
      ${field({ name: 'period_end', label: 'Fin de la période (incluse)', type: 'date', values, errors })}
      <button type="submit" class="w-full rounded bg-green-800 px-4 py-3 font-semibold text-white">Produire l’attestation</button>
    </form>
    <p class="mt-6"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}

// Avertissement non bloquant : la période chevauche des attestations émises.
export function overlapWarningPage({ session, values, lots }) {
  const items = lots
    .map((lot) => `<li>${escapeHtml(lot.nature)}, collecté le ${escapeHtml(formatLocal(lot.collected_at))} (attestation ${escapeHtml(lot.number)})</li>`)
    .join('');
  const hidden = ['store_id', 'period_start', 'period_end']
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(values[name])}">`)
    .join('');
  return page({
    title: 'Attention – Attestation de don',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Cette période a déjà été attestée</h1>
    <div role="alert" class="mb-4 border-l-4 border-amber-700 bg-amber-50 p-3 text-amber-900">
      <p class="mb-2 font-semibold">Une attestation émise pour ce commerce chevauche cette période. Lots déjà attestés :</p>
      <ul class="list-disc pl-5">${items}</ul>
    </div>
    <form method="post" action="/certificates" class="mb-4">
      ${csrfField(session)}${hidden}
      <button type="submit" name="confirm" value="1" class="w-full rounded bg-green-800 px-4 py-3 font-semibold text-white">Produire quand même l’attestation</button>
    </form>
    <p><a href="/certificates/new" class="underline">Modifier la période</a></p>`,
  });
}

const kg = (value) => `${escapeHtml(formatDecimal(value))} kg`;
const euro = (value) => `${escapeHtml(formatDecimal(value))} €`;

// Page imprimable : poids et valeur arrondis à l'affichage seulement (kg à 1 décimale, € à 2).
export function certificatePage({ certificate, lots, issuer }) {
  const rows = lots
    .map((lot) => `
        <tr class="border-t border-slate-400">
          <td class="p-2">${escapeHtml(lot.nature)}</td>
          <td class="p-2">${escapeHtml(lot.quantity)} ${escapeHtml(lot.quantity_unit)}</td>
          <td class="p-2">${escapeHtml(formatLocal(lot.collected_at))}</td>
          <td class="p-2 text-right">${kg(lot.weight_kg)}</td>
          <td class="p-2 text-right">${euro(lot.value_eur)}</td>
        </tr>`)
    .join('');
  const issuerLines = [issuer.address, issuer.registration].filter(Boolean).map((line) => `<br>${escapeHtml(line)}`).join('');
  return page({
    title: `Attestation de don ${certificate.number}`,
    wide: true,
    content: `
    <h1 class="mb-1 text-2xl font-bold">Attestation de don</h1>
    <p class="mb-6 text-lg">N° ${escapeHtml(certificate.number)}</p>
    <div class="mb-6 grid gap-6 sm:grid-cols-2">
      <section><h2 class="font-bold">Émetteur</h2><p>${escapeHtml(issuer.name)}${issuerLines}</p></section>
      <section><h2 class="font-bold">Donateur</h2><p>${escapeHtml(certificate.store_name)}<br>${escapeHtml(certificate.store_address)}</p></section>
    </div>
    <p class="mb-4">Dons collectés du ${escapeHtml(formatLocal(certificate.period_start))} au ${escapeHtml(formatLocal(certificate.period_end))} (bornes incluses).</p>
    <table class="mb-6 w-full text-left">
      <caption class="sr-only">Lots collectés</caption>
      <thead><tr><th scope="col" class="p-2">Nature</th><th scope="col" class="p-2">Quantité</th><th scope="col" class="p-2">Collecté le</th><th scope="col" class="p-2 text-right">Poids</th><th scope="col" class="p-2 text-right">Valeur</th></tr></thead>
      <tbody>${rows}
      </tbody>
    </table>
    <dl class="mb-6 grid max-w-sm grid-cols-2 gap-1 font-semibold">
      <dt>Poids total</dt><dd class="text-right">${kg(certificate.total_weight_kg)}</dd>
      <dt>Valeur totale</dt><dd class="text-right">${euro(certificate.total_value_eur)}</dd>
    </dl>
    <p class="mb-6">Émise le ${escapeHtml(formatLocal(certificate.issued_at))}.</p>
    <p class="print:hidden"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}
