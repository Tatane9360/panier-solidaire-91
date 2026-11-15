import { STATUS_LABELS } from '../../shared/html.js';

// Ordre des paramètres SQL $1 à $5 de la requête de suivi.
export const FILTER_NAMES = ['store', 'association', 'status', 'from', 'to'];

const isValid = {
  store: (text) => /^\d{1,9}$/.test(text),
  association: (text) => /^\d{1,9}$/.test(text),
  status: (text) => Object.hasOwn(STATUS_LABELS, text),
  from: (text) => /^\d{4}-\d{2}-\d{2}$/.test(text),
  to: (text) => /^\d{4}-\d{2}-\d{2}$/.test(text),
};

// Lit les filtres et la page de l'adresse. Un filtre absent vaut null.
// Une valeur invalide fait renvoyer null à la fonction : la route répond 400.
export function readFilters(query) {
  const filters = {};
  for (const name of FILTER_NAMES) {
    const text = String(query[name] ?? '').trim();
    if (text !== '' && !isValid[name](text)) return null;
    filters[name] = text === '' ? null : text;
  }
  const pageText = String(query.page ?? '').trim();
  if (pageText !== '' && !/^[1-9]\d{0,8}$/.test(pageText)) return null;
  filters.page = pageText === '' ? 1 : Number(pageText);
  return filters;
}
