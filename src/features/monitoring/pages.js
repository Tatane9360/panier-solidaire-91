import { page, escapeHtml, STATUS_LABELS, formatLocal } from '../../shared/html.js';
import { FILTER_NAMES } from './filters.js';

function accountSelect({ name, label, accounts, selected }) {
  const options = accounts
    .map((account) => `<option value="${account.id}"${String(account.id) === selected ? ' selected' : ''}>${escapeHtml(account.organization_name)}</option>`)
    .join('');
  return `
      <div>
        <label for="${name}" class="block font-semibold">${label}</label>
        <select id="${name}" name="${name}" class="mt-1 rounded border border-slate-500 p-2">
          <option value="">Tous</option>${options}
        </select>
      </div>`;
}

function filterForm({ filters, stores, associations }) {
  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}"${value === filters.status ? ' selected' : ''}>${label}</option>`)
    .join('');
  return `
    <form method="get" action="/monitoring/batches" class="mb-6 flex flex-wrap items-end gap-4">
      ${accountSelect({ name: 'store', label: 'Commerce', accounts: stores, selected: filters.store })}
      ${accountSelect({ name: 'association', label: 'Association', accounts: associations, selected: filters.association })}
      <div>
        <label for="status" class="block font-semibold">Statut</label>
        <select id="status" name="status" class="mt-1 rounded border border-slate-500 p-2">
          <option value="">Tous</option>${statusOptions}
        </select>
      </div>
      <div>
        <label for="from" class="block font-semibold">Déclaré à partir du</label>
        <input id="from" name="from" type="date" value="${escapeHtml(filters.from ?? '')}" class="mt-1 rounded border border-slate-500 p-2">
      </div>
      <div>
        <label for="to" class="block font-semibold">Déclaré jusqu’au</label>
        <input id="to" name="to" type="date" value="${escapeHtml(filters.to ?? '')}" class="mt-1 rounded border border-slate-500 p-2">
      </div>
      <button type="submit" class="rounded bg-green-800 px-4 py-2 font-semibold text-white">Filtrer</button>
    </form>`;
}

// Dates clés d'un lot : seules celles qui existent sont affichées.
function keyDates(batch) {
  const dates = [
    ['Déclaré le', batch.created_at],
    ['Réservé le', batch.reserved_at],
    ['Collecté le', batch.collected_at],
    ['Expiré le', batch.expired_at],
  ];
  const lines = dates.filter(([, value]) => value).map(([label, value]) => `<li>${label} ${escapeHtml(formatLocal(value))}</li>`);
  lines.push(`<li>Créneau du ${escapeHtml(formatLocal(batch.pickup_start))} au ${escapeHtml(formatLocal(batch.pickup_end))}</li>`);
  return `<ul>${lines.join('')}</ul>`;
}

// Liens Précédent / Suivant : les filtres sont repris dans l'adresse.
function pagination({ filters, pageNumber, pageCount }) {
  const link = (number, label) => {
    const params = new URLSearchParams();
    for (const name of FILTER_NAMES) {
      if (filters[name] !== null) params.set(name, filters[name]);
    }
    params.set('page', number);
    return `<a href="/monitoring/batches?${escapeHtml(params.toString())}" class="underline">${label}</a>`;
  };
  return `
    <nav aria-label="Pagination" class="mt-4 flex gap-4">
      ${pageNumber > 1 ? link(pageNumber - 1, 'Page précédente') : ''}
      <span>Page ${pageNumber} sur ${pageCount}</span>
      ${pageNumber < pageCount ? link(pageNumber + 1, 'Page suivante') : ''}
    </nav>`;
}

export function monitoringPage({ batches, filters, stores, associations, total, pageNumber, pageCount }) {
  const rows = batches
    .map((batch) => `
        <tr class="border-t border-slate-300 align-top">
          <td class="p-2">${escapeHtml(batch.nature)}</td>
          <td class="p-2">${STATUS_LABELS[batch.status]}</td>
          <td class="p-2">${escapeHtml(batch.store_name)}</td>
          <td class="p-2">${batch.association_name ? escapeHtml(batch.association_name) : '—'}</td>
          <td class="p-2">${keyDates(batch)}</td>
        </tr>`)
    .join('');
  const table = batches.length === 0
    ? '<p>Aucun lot ne correspond à ces filtres.</p>'
    : `
    <table class="w-full text-left">
      <caption class="mb-2 text-left font-semibold">${total} lot${total > 1 ? 's' : ''}</caption>
      <thead>
        <tr><th scope="col" class="p-2">Nature</th><th scope="col" class="p-2">Statut</th><th scope="col" class="p-2">Commerce</th><th scope="col" class="p-2">Association</th><th scope="col" class="p-2">Dates clés</th></tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>`;
  return page({
    title: 'Suivi des lots',
    wide: true,
    content: `
    <h1 class="mb-6 text-2xl font-bold">Suivi des lots</h1>
    ${filterForm({ filters, stores, associations })}
    ${table}
    ${pagination({ filters, pageNumber, pageCount })}
    <p class="mt-6"><a href="/" class="underline">Revenir à l’accueil</a></p>`,
  });
}
