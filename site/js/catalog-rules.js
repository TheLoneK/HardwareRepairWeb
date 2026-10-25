// Checks for data/categories.json and data/checklists/*.json. Same rules as HardwareRepairTracker,
// so a checklist copied between the two repos is valid in both. Pure: data in, list of problems out.
import { ACTIONS } from './model.js';

const ID_RE = /^[a-z0-9][a-z0-9.-]*$/;
const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/; // used as a folder name on disk, keep it Windows-safe

export function validateChecklist(c, file = 'checklist') {
  const errors = [];
  const err = (msg) => errors.push(`${file}: ${msg}`);
  if (!c || typeof c !== 'object') return [`${file}: not an object`];
  if (!ID_RE.test(c.id || '')) err('id must be lowercase letters, numbers, dots or dashes');
  if (!Number.isInteger(c.version) || c.version < 1) err('version must be a positive integer');
  if (!c.title) err('title is required');
  if (c.category !== undefined && !ID_RE.test(c.category || '')) err('category must be a category id from categories.json');
  if (!Array.isArray(c.models) || !c.models.length) err('models must be a non-empty array');
  const modelIds = new Set();
  for (const m of c.models || []) {
    if (!ID_RE.test(m.id || '')) err(`model id "${m.id}" is invalid`);
    if (modelIds.has(m.id)) err(`duplicate model id "${m.id}"`);
    modelIds.add(m.id);
    if (!m.name) err(`model "${m.id}" needs a name`);
  }
  if (!Array.isArray(c.sections) || !c.sections.length) err('sections must be a non-empty array');
  const sectionIds = new Set();
  const itemIds = new Set();
  for (const s of c.sections || []) {
    if (!ID_RE.test(s.id || '')) err(`section id "${s.id}" is invalid`);
    if (sectionIds.has(s.id)) err(`duplicate section id "${s.id}"`);
    sectionIds.add(s.id);
    if (!s.title) err(`section "${s.id}" needs a title`);
    if (!Array.isArray(s.items) || !s.items.length) err(`section "${s.id}" needs items`);
    for (const it of s.items || []) {
      if (!ID_RE.test(it.id || '')) err(`item id "${it.id}" is invalid`);
      if (itemIds.has(it.id)) err(`duplicate item id "${it.id}" (item ids must be unique across the checklist)`);
      itemIds.add(it.id);
      if (!it.title) err(`item "${it.id}" needs a title`);
      if (!it.check) err(`item "${it.id}" needs a "check" description`);
      for (const mid of it.appliesTo || []) if (!modelIds.has(mid)) err(`item "${it.id}" appliesTo unknown model "${mid}"`);
    }
  }
  for (const ref of c.references || []) {
    if (!/^https:\/\//.test(ref?.url || '')) err(`reference "${ref?.title}" must be an https:// link`);
  }
  return errors;
}

export function validateCategories(data, file = 'categories.json') {
  const errors = [];
  const err = (msg) => errors.push(`${file}: ${msg}`);
  const list = data?.categories;
  if (!Array.isArray(list) || !list.length) return [`${file}: "categories" must be a non-empty array`];
  const ids = new Set();
  const folders = new Set();
  for (const c of list) {
    if (!c || typeof c !== 'object') {
      err('each category must be an object');
      continue;
    }
    if (!ID_RE.test(c.id || '')) err(`category id "${c.id}" must be lowercase letters, numbers, dots or dashes`);
    if (ids.has(c.id)) err(`duplicate category id "${c.id}"`);
    ids.add(c.id);
    if (!c.name) err(`category "${c.id}" needs a name`);
    if (!FOLDER_RE.test(c.folder || '')) err(`category "${c.id}" needs a folder name (letters, numbers, spaces, - or _)`);
    const key = String(c.folder || '').toLowerCase();
    if (folders.has(key)) err(`duplicate folder "${c.folder}"`);
    folders.add(key);
    if (c.actions !== undefined) {
      if (!Array.isArray(c.actions) || !c.actions.length) err(`category "${c.id}" actions must be a non-empty array`);
      for (const a of c.actions || []) if (!ACTIONS.includes(a)) err(`category "${c.id}" has unknown action "${a}"`);
    }
    for (const [a, label] of Object.entries(c.actionLabels || {})) {
      if (!ACTIONS.includes(a)) err(`category "${c.id}" labels unknown action "${a}"`);
      if (typeof label !== 'string' || !label) err(`category "${c.id}" label for "${a}" must be text`);
    }
  }
  return errors;
}

export function normalizeCategories(data) {
  return data.categories.map((c) => ({
    id: c.id,
    name: c.name,
    singular: c.singular || c.name,
    folder: c.folder,
    icon: c.icon || '',
    modelLabel: c.modelLabel || 'Model',
    serialHint: c.serialHint || '',
    notesHint: c.notesHint || '',
    actions: c.actions ? [...c.actions] : [...ACTIONS],
    actionLabels: { ...(c.actionLabels || {}) },
  }));
}

// A checklist without a "category" belongs to the first one.
export const checklistCategory = (checklist, categories) => checklist.category ?? categories[0]?.id ?? null;
