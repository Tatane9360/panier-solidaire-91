import { page, escapeHtml, csrfField } from '../../shared/html.js';

const DATE_TYPE_LABELS = { DLC: 'DLC (date limite de consommation)', DDM: 'DDM (date de durabilité minimale)' };
const COLD_LABELS = { AMBIENT: 'Ambiant', CHILLED: 'Frais', FROZEN: 'Surgelé' };
const STATUS_LABELS = {
  DECLARED: 'Déclaré',
  RESERVED: 'Réservé',
  COLLECTED: 'Collecté',
  CANCELLED: 'Annulé',
  EXPIRED: 'Expiré',
};

// Ordre et libellés des champs du formulaire, repris dans le résumé des erreurs.
const LABELS = {
  nature: 'Nature des denrées',
  quantity: 'Quantité',
  quantity_unit: 'Unité de quantité',
  weight_kg: 'Poids (kg)',
  value_eur: 'Valeur (€)',
  expiry_date: 'Date limite',
  date_type: 'Type de date limite',
  pickup_start: 'Début du créneau de retrait',
  pickup_end: 'Fin du créneau de retrait',
  cold_requirement: 'Contrainte de froid',
};

// "2026-11-03T14:00" → "03/11/2026 14:00" ; "2026-11-05" → "05/11/2026".
function formatLocal(value) {
  const [date, time] = value.split('T');
  const day = date.split('-').reverse().join('/');
  return time ? `${day} ${time}` : day;
}

const formatDecimal = (value) => String(value).replace('.', ',');

// Chaque erreur est reliée à son champ (aria-describedby) et annoncée dans le résumé (role="alert").
function errorAttributes(errors, name) {
  return errors[name] ? ` aria-invalid="true" aria-describedby="erreur-${name}"` : '';
}

function errorMessage(errors, name) {
  return errors[name]
    ? `<p id="erreur-${name}" class="mt-1 font-semibold text-red-800">${escapeHtml(errors[name])}</p>`
    : '';
}

function inputField({ name, values, errors, type = 'text', inputmode = '', hint = '' }) {
  const mode = inputmode ? ` inputmode="${inputmode}"` : '';
  const hintBlock = hint ? `<p id="aide-${name}" class="text-sm text-slate-700">${hint}</p>` : '';
  // Le lecteur d'écran annonce l'aide puis l'erreur avec le champ.
  const describedBy = [hint && `aide-${name}`, errors[name] && `erreur-${name}`].filter(Boolean).join(' ');
  const invalid = errors[name] ? ' aria-invalid="true"' : '';
  const described = describedBy ? ` aria-describedby="${describedBy}"` : '';
  return `
      <div>
        <label for="${name}" class="block font-semibold">${LABELS[name]}</label>
        ${hintBlock}
        <input id="${name}" name="${name}" type="${type}"${mode} required value="${escapeHtml(values[name] ?? '')}"${invalid}${described}
          class="mt-1 w-full rounded border border-slate-500 p-3">
        ${errorMessage(errors, name)}
      </div>`;
}

function radioField({ name, options, values, errors }) {
  const radios = Object.entries(options)
    .map(([value, label]) => {
      const checked = values[name] === value ? ' checked' : '';
      return `
        <div class="py-1">
          <input id="${name}-${value}" name="${name}" type="radio" value="${value}" required${checked}${errorAttributes(errors, name)}>
          <label for="${name}-${value}">${label}</label>
        </div>`;
    })
    .join('');
  return `
      <fieldset id="${name}">
        <legend class="font-semibold">${LABELS[name]}</legend>
        ${radios}
        ${errorMessage(errors, name)}
      </fieldset>`;
}

function hiddenFields(values) {
  return Object.entries(values)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('\n      ');
}

export function batchFormPage({ session, values, errors }) {
  const messages = Object.keys(LABELS)
    .filter((name) => errors[name])
    .map((name) => `<li><a href="#${name}" class="underline">${LABELS[name]} : ${escapeHtml(errors[name])}</a></li>`)
    .join('');
  const summary = messages
    ? `<div role="alert" class="mb-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">
      <p class="font-semibold">Le lot n’a pas pu être validé :</p>
      <ul class="list-disc pl-5">${messages}</ul>
    </div>`
    : '';
  const field = (name, options) => inputField({ name, values, errors, ...options });
  return page({
    title: messages ? 'Erreur – Déclarer un lot' : 'Déclarer un lot',
    content: `
    <h1 class="mb-6 text-2xl font-bold">Déclarer un lot</h1>
    ${summary}
    <p class="mb-4">Tous les champs sont obligatoires.</p>
    <form method="post" action="/batches/review" class="space-y-4">
      ${csrfField(session)}
      <input type="hidden" name="submission_token" value="${escapeHtml(values.submission_token)}">
      ${field('nature', { hint: 'Par exemple : fruits et légumes, pain, plats cuisinés.' })}
      ${field('quantity', { inputmode: 'numeric' })}
      ${field('quantity_unit', { hint: 'Par exemple : cagettes, portions, palette.' })}
      ${field('weight_kg', { inputmode: 'decimal' })}
      ${field('value_eur', { inputmode: 'decimal' })}
      ${field('expiry_date', { type: 'date' })}
      ${radioField({ name: 'date_type', options: DATE_TYPE_LABELS, values, errors })}
      ${field('pickup_start', { type: 'datetime-local' })}
      ${field('pickup_end', { type: 'datetime-local' })}
      ${radioField({ name: 'cold_requirement', options: COLD_LABELS, values, errors })}
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
