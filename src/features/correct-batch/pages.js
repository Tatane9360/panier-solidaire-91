import { batchFields, errorSummary } from '../../shared/batch-form-html.js';
import { page, escapeHtml, csrfField, STATUS_LABELS } from '../../shared/html.js';

const BUTTON = 'w-full rounded px-4 py-3 font-semibold';

// Un seul écran : correction des champs (DECLARED, RESERVED) et annulation (DECLARED, RESERVED, COLLECTED).
export function editBatchPage({ session, batch, values, errors, correctable, cancellable, cancelError }) {
  const summary = errorSummary(errors, 'La correction n’a pas pu être enregistrée :');
  const correction = correctable
    ? `
    <form method="post" action="/monitoring/batches/${batch.id}/edit" class="mb-8 space-y-4">
      <h2 class="text-xl font-bold">Corriger les champs</h2>
      ${csrfField(session)}
      ${batchFields({ values, errors })}
      <div>
        <label for="reason" class="block font-semibold">Motif (facultatif)</label>
        <input id="reason" name="reason" type="text" value="${escapeHtml(values.reason ?? '')}" class="mt-1 w-full rounded border border-slate-500 p-3">
      </div>
      <button type="submit" class="${BUTTON} bg-green-800 text-white">Enregistrer la correction</button>
    </form>`
    : '';
  const cancellation = cancellable
    ? `
    <form method="post" action="/monitoring/batches/${batch.id}/cancel" class="space-y-4">
      <h2 class="text-xl font-bold">Annuler le lot</h2>
      ${cancelError ? `<p id="erreur-cancel-reason" role="alert" class="font-semibold text-red-800">${escapeHtml(cancelError)}</p>` : ''}
      ${csrfField(session)}
      <div>
        <label for="cancel-reason" class="block font-semibold">Motif (obligatoire)</label>
        <input id="cancel-reason" name="reason" type="text" required${cancelError ? ' aria-invalid="true" aria-describedby="erreur-cancel-reason"' : ''} class="mt-1 w-full rounded border border-slate-500 p-3">
      </div>
      <button type="submit" class="${BUTTON} bg-red-800 text-white">Annuler le lot</button>
    </form>`
    : '';
  const frozen = correctable || cancellable
    ? ''
    : `<p>Un lot « ${STATUS_LABELS[batch.status].toLowerCase()} » ne peut plus être modifié ni annulé.</p>`;
  return page({
    title: summary || cancelError ? 'Erreur – Corriger un lot' : 'Corriger un lot',
    content: `
    <h1 class="mb-2 text-2xl font-bold">Corriger un lot</h1>
    <p class="mb-6">Statut : <strong>${STATUS_LABELS[batch.status]}</strong></p>
    ${summary}
    ${frozen}${correction}${cancellation}
    <p class="mt-6"><a href="/monitoring/batches" class="underline">Revenir au suivi des lots</a></p>`,
  });
}
