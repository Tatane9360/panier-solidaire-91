import { batchFields, errorSummary } from '../../shared/batch-form-html.js';
import { page, escapeHtml, csrfField, COLD_LABELS, STATUS_LABELS, formatLocal, formatDecimal } from '../../shared/html.js';

function hiddenFields(values) {
  return Object.entries(values)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('\n      ');
}

export function batchFormPage({ session, values, errors }) {
  const summary = errorSummary(errors, 'Le lot n’a pas pu être validé :');
  return page({
    title: summary ? 'Erreur – Déclarer un lot' : 'Déclarer un lot',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Déclarer un lot</h1>
    ${summary}
    <p class="mb-4">Tous les champs sont obligatoires.</p>
    <form method="post" action="/batches/review" class="space-y-4">
      ${csrfField(session)}
      <input type="hidden" name="submission_token" value="${escapeHtml(values.submission_token)}">
      ${batchFields({ values, errors })}
      <button type="submit" class="w-full rounded bg-green-800 px-4 py-3 font-semibold text-white">Valider</button>
    </form>
    <p class="mt-6"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}

// Liste <dl> des informations d'un lot, partagée par le récapitulatif et « mes lots ».
function batchDetails(batch) {
  return `
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt class="font-semibold">Quantité</dt><dd>${escapeHtml(batch.quantity)} ${escapeHtml(batch.quantity_unit)}</dd>
          <dt class="font-semibold">Poids</dt><dd>${escapeHtml(formatDecimal(batch.weight_kg))} kg</dd>
          <dt class="font-semibold">Valeur</dt><dd>${escapeHtml(formatDecimal(batch.value_eur))} €</dd>
          <dt class="font-semibold">Date limite</dt><dd>${escapeHtml(batch.date_type)} ${escapeHtml(formatLocal(batch.expiry_date))}</dd>
          <dt class="font-semibold">Créneau de retrait</dt><dd>du ${escapeHtml(formatLocal(batch.pickup_start))} au ${escapeHtml(formatLocal(batch.pickup_end))}</dd>
          <dt class="font-semibold">Froid</dt><dd>${COLD_LABELS[batch.cold_requirement]}</dd>
        </dl>`;
}

export function batchReviewPage({ session, values }) {
  return page({
    title: 'Vérifier le lot',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Vérifier le lot</h1>
    <section class="mb-6 rounded border border-slate-400 p-4">
      <h2 class="mb-2 text-lg font-bold">${escapeHtml(values.nature)}</h2>
      ${batchDetails(values)}
    </section>
    <form method="post" action="/batches" class="mb-4">
      ${csrfField(session)}
      ${hiddenFields(values)}
      <button type="submit" class="w-full rounded bg-green-800 px-4 py-3 font-semibold text-white">Confirmer la déclaration</button>
    </form>
    <form method="post" action="/batches/review">
      ${csrfField(session)}
      ${hiddenFields(values)}
      <button type="submit" name="edit" value="1" class="w-full rounded border border-slate-700 px-4 py-3">Modifier</button>
    </form>`,
  });
}

export function myBatchesPage({ session, batches, declared, duplicate }) {
  let notice = '';
  if (declared) {
    notice = '<p role="status" class="mb-4 border-l-4 border-green-700 bg-green-50 p-3 text-green-900">Lot déclaré.</p>';
  }
  if (duplicate) {
    notice = `<p role="status" class="mb-4 border-l-4 border-amber-700 bg-amber-50 p-3 text-amber-900">Ce formulaire avait déjà été envoyé : le lot n’a été déclaré qu’une fois. Pour déclarer un autre lot, ouvrez un nouveau formulaire.</p>`;
  }
  const items = batches
    .map((batch) => `
      <li class="rounded border border-slate-400 p-4">
        <h2 class="text-lg font-bold">${escapeHtml(batch.nature)}</h2>
        <p class="mb-2">Statut : <strong>${STATUS_LABELS[batch.status]}</strong></p>
        ${batchDetails(batch)}
        ${batch.collected_at ? `<dl class="mt-1 grid grid-cols-2 gap-x-4"><dt class="font-semibold">Collecté le</dt><dd>${escapeHtml(formatLocal(batch.collected_at))}</dd></dl>` : ''}
        ${batch.reserved_by_name ? `<dl class="mt-1 grid grid-cols-2 gap-x-4"><dt class="font-semibold">Bénévole</dt><dd>${escapeHtml(batch.collected_by_name ?? batch.reserved_by_name)}</dd></dl>` : ''}
      </li>`)
    .join('');
  return page({
    title: 'Mes lots',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Mes lots</h1>
    ${notice}
    <p class="mb-6"><a href="/batches/new" class="inline-block w-full rounded bg-green-800 px-4 py-3 text-center font-semibold text-white">Déclarer un lot</a></p>
    ${batches.length === 0 ? '<p>Aucun lot déclaré pour l’instant.</p>' : `<ul class="space-y-4">${items}</ul>`}
    <p class="mt-6"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}
