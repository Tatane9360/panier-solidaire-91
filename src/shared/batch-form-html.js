import { escapeHtml, COLD_LABELS } from './html.js';

// Champs du formulaire d'un lot, partagés par la déclaration et la correction.
export const DATE_TYPE_LABELS = { DLC: 'DLC (date limite de consommation)', DDM: 'DDM (date de durabilité minimale)' };

// Ordre et libellés des champs du formulaire, repris dans le résumé des erreurs.
export const LABELS = {
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

export function errorSummary(errors, title) {
  const messages = Object.keys(LABELS)
    .filter((name) => errors[name])
    .map((name) => `<li><a href="#${name}" class="underline">${LABELS[name]} : ${escapeHtml(errors[name])}</a></li>`)
    .join('');
  if (!messages) return '';
  return `<div role="alert" class="mb-4 border-l-4 border-red-700 bg-red-50 p-3 text-red-900">
      <p class="font-semibold">${title}</p>
      <ul class="list-disc pl-5">${messages}</ul>
    </div>`;
}

export function batchFields({ values, errors }) {
  const field = (name, options) => inputField({ name, values, errors, ...options });
  return `${field('nature', { hint: 'Par exemple : fruits et légumes, pain, plats cuisinés.' })}
      ${field('quantity', { inputmode: 'numeric' })}
      ${field('quantity_unit', { hint: 'Par exemple : cagettes, portions, palette.' })}
      ${field('weight_kg', { inputmode: 'decimal' })}
      ${field('value_eur', { inputmode: 'decimal' })}
      ${field('expiry_date', { type: 'date' })}
      ${radioField({ name: 'date_type', options: DATE_TYPE_LABELS, values, errors })}
      ${field('pickup_start', { type: 'datetime-local' })}
      ${field('pickup_end', { type: 'datetime-local' })}
      ${radioField({ name: 'cold_requirement', options: COLD_LABELS, values, errors })}`;
}
