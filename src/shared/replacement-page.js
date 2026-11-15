import { page, escapeHtml, csrfField, formatLocal } from './html.js';

// Avertissement « annule et remplace » : la Coordination confirme en renvoyant la même saisie avec confirm=1.
export function replacementPage({ session, action, fields, certificates }) {
  const items = certificates
    .map((certificate) => `<li>${escapeHtml(certificate.number)} (du ${escapeHtml(formatLocal(certificate.period_start))} au ${escapeHtml(formatLocal(certificate.period_end))})</li>`)
    .join('');
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('');
  return page({
    title: 'Attention – Attestations de don',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Des attestations de don vont être remplacées</h1>
    <div role="alert" class="mb-4 border-l-4 border-amber-700 bg-amber-50 p-3 text-amber-900">
      <p class="mb-2 font-semibold">Cette opération change la liste, le poids ou la valeur des lots de ces attestations émises :</p>
      <ul class="list-disc pl-5">${items}</ul>
      <p class="mt-2">Chacune sera marquée « remplacée » et une nouvelle attestation sera émise pour la même période. L’ancienne reste consultable.</p>
    </div>
    <form method="post" action="${escapeHtml(action)}" class="mb-4">
      ${csrfField(session)}${hidden}
      <button type="submit" name="confirm" value="1" class="w-full rounded bg-green-800 px-4 py-3 font-semibold text-white">Confirmer : annule et remplace</button>
    </form>
    <p><a href="/monitoring/batches" class="underline">Abandonner</a></p>`,
  });
}
