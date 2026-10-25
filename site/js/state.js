// Shared client state: the checklists and device types (loaded once from data/), and which
// device type is selected. Checklists are static files on the same site; nothing else is fetched.
import { checklistCategory, normalizeCategories, validateCategories, validateChecklist } from './catalog-rules.js';

export const state = {
  categories: [], // device types that have at least one checklist (data/categories.json)
  checklists: new Map(), // id -> checklist definition
  category: null, // selected device type id
  cleanup: null, // called when leaving a view (timers, pending writes)
};

const CATEGORY_KEY = 'hrw.category';

async function getJson(path) {
  const res = await fetch(path, { credentials: 'same-origin', cache: 'no-cache', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status}).`);
  return res.json();
}

export async function loadCatalog() {
  const [catData, index] = await Promise.all([getJson('data/categories.json'), getJson('data/checklists/index.json')]);
  const catErrors = validateCategories(catData);
  if (catErrors.length) throw new Error(catErrors.join('\n'));
  const categories = normalizeCategories(catData);
  const files = (index.checklists || []).filter((f) => /^[a-z0-9][a-z0-9.-]*\.json$/.test(f));
  const lists = await Promise.all(files.map((f) => getJson(`data/checklists/${f}`).then((c) => ({ f, c }))));
  for (const { f, c } of lists) {
    const problems = validateChecklist(c, f);
    if (problems.length) {
      console.warn(problems.join('\n')); // a broken checklist is skipped, not fatal
      continue;
    }
    c.category = checklistCategory(c, categories);
    state.checklists.set(c.id, c);
  }
  state.categories = categories.filter((cat) => [...state.checklists.values()].some((c) => c.category === cat.id));
  let saved = null;
  try {
    saved = localStorage.getItem(CATEGORY_KEY);
  } catch {
    /* storage blocked */
  }
  state.category = state.categories.some((c) => c.id === saved) ? saved : state.categories[0]?.id ?? null;
}

export function currentCategory() {
  return state.categories.find((c) => c.id === state.category) ?? state.categories[0] ?? null;
}

export function setCategory(id) {
  if (!state.categories.some((c) => c.id === id)) return;
  state.category = id;
  try {
    localStorage.setItem(CATEGORY_KEY, id);
  } catch {
    /* the choice just isn't remembered */
  }
}

export function categoryById(id) {
  return state.categories.find((c) => c.id === id) ?? null;
}

// Device type of a checklist (unknown checklists count under the first type).
export function categoryOfChecklist(checklistId) {
  const id = state.checklists.get(checklistId)?.category;
  return state.categories.find((c) => c.id === id) ?? state.categories[0] ?? null;
}

export function checklistsInCategory(categoryId) {
  return [...state.checklists.values()].filter((c) => c.category === categoryId);
}

// Model <select> options: the checklist's primary models first, the rest grouped after them.
export function modelOptions(h, checklist, selected) {
  const primary = checklist.models.filter((m) => m.primary);
  const others = checklist.models.filter((m) => !m.primary);
  return [
    h('optgroup', { label: 'Checklist written for' }, primary.map((m) => h('option', { value: m.id, selected: m.id === selected, text: m.name }))),
    others.length ? h('optgroup', { label: 'Other models (notes shown where they differ)' }, others.map((m) => h('option', { value: m.id, selected: m.id === selected, text: m.name }))) : null,
  ].filter(Boolean);
}
