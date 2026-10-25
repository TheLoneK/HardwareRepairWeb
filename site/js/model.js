// Repair records: limits, labels, creation and validation. Pure functions only (no DOM, no
// storage), so the same rules run in the browser and in the Node tests.
//
// A repair has the same shape as HardwareRepairTracker's /api/sync/upload contract, plus
// technicianName (there are no accounts here), so saved forms can be imported there later.

export const LIMITS = Object.freeze({
  notesMaxLength: 2000,
  itemDetailMaxLength: 280,
  serialMaxLength: 64,
  ticketMaxLength: 64,
  technicianMaxLength: 60,
  maxItems: 1000,
});

export const STATUSES = ['in_progress', 'fixed', 'not_fixed', 'waiting_parts', 'no_fault_found'];
export const RESULTS = ['ok', 'issue', 'na'];
// Every action any device type can use; each category in data/categories.json picks a subset.
export const ACTIONS = ['none', 'cleaned', 'adjusted', 'reseated', 'lubricated', 'repaired', 'replaced', 'part_ordered', 'firmware', 'software'];

export const STATUS_LABELS = {
  in_progress: 'In progress',
  fixed: 'Fixed',
  not_fixed: 'Not fixed',
  waiting_parts: 'Waiting on parts',
  no_fault_found: 'No fault found',
};

export const ACTION_LABELS = {
  none: 'No action yet',
  cleaned: 'Cleaned',
  adjusted: 'Adjusted / tensioned',
  reseated: 'Reseated connector',
  lubricated: 'Lubricated',
  repaired: 'Repaired',
  replaced: 'Replaced part',
  part_ordered: 'Part ordered',
  firmware: 'Firmware / settings',
  software: 'Software / drivers / OS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[a-z0-9][a-z0-9.-]{0,99}$/;

export class ValidationError extends Error {}
const fail = (msg) => {
  throw new ValidationError(msg);
};

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// A device type can reword an action ("BIOS / firmware / settings" for computers).
export function actionLabel(category, action) {
  return category?.actionLabels?.[action] ?? ACTION_LABELS[action] ?? action;
}

// ---- field rules ----

export function text(value, max, label) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const v = value.trim();
  if (v.length > max) fail(`${label} must be ${max} characters or fewer (got ${v.length}).`);
  return v;
}

export function notesValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail('Notes must be text.');
  const v = value.replace(/\s+$/, ''); // keep line breaks, drop trailing whitespace
  if (v.length > LIMITS.notesMaxLength) fail(`Notes are limited to ${LIMITS.notesMaxLength} characters (got ${v.length}).`);
  return v;
}

export function isoOrNull(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail(`${label} is not a valid date/time.`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) fail(`${label} is not a valid date/time.`);
  return new Date(ms).toISOString();
}

export function durationSeconds(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null;
  const secs = Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000);
  return secs < 0 ? null : secs;
}

export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') fail('Each checklist item must be an object.');
  if (typeof raw.itemId !== 'string' || !ID_RE.test(raw.itemId)) fail('A checklist item has an invalid id.');
  if (!RESULTS.includes(raw.result)) fail('Item result must be ok, issue or na.');
  const action = raw.action ?? 'none';
  if (!ACTIONS.includes(action)) fail('Unknown action.');
  const isIssue = raw.result === 'issue';
  return {
    itemId: raw.itemId,
    result: raw.result,
    action: isIssue ? action : 'none',
    detail: isIssue ? text(raw.detail, LIMITS.itemDetailMaxLength, 'Item detail') : '',
  };
}

// Validates a whole repair (from this browser's storage or from an opened file) and returns a
// clean copy with only known fields. Throws ValidationError with a plain-language message.
export function normalizeRepair(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('This is not a repair record.');
  if (typeof raw.id !== 'string' || !UUID_RE.test(raw.id)) fail('Repair id must be a UUID.');
  if (typeof raw.checklistId !== 'string' || !ID_RE.test(raw.checklistId)) fail('Unknown checklist.');
  if (typeof raw.deviceModel !== 'string' || !ID_RE.test(raw.deviceModel)) fail('Unknown device model.');
  const status = raw.status ?? 'in_progress';
  if (!STATUSES.includes(status)) fail('Unknown status.');
  const startedAt = isoOrNull(raw.startedAt, 'Start time');
  const finishedAt = isoOrNull(raw.finishedAt, 'Finish time');
  if (startedAt && finishedAt && Date.parse(finishedAt) < Date.parse(startedAt)) fail('Finish time is before the start time.');
  const items = raw.items ?? [];
  if (!Array.isArray(items)) fail('Checklist items must be a list.');
  if (items.length > LIMITS.maxItems) fail('Too many checklist items.');
  const seen = new Map();
  for (const it of items) seen.set(it?.itemId, normalizeItem(it)); // last one wins
  const version = Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1;
  const checklistVersion = Number.isInteger(raw.checklistVersion) && raw.checklistVersion > 0 ? raw.checklistVersion : 1;
  return {
    id: raw.id.toLowerCase(),
    checklistId: raw.checklistId,
    checklistVersion,
    deviceModel: raw.deviceModel,
    serialNumber: text(raw.serialNumber, LIMITS.serialMaxLength, 'Serial number'),
    ticketRef: text(raw.ticketRef, LIMITS.ticketMaxLength, 'Ticket / job reference'),
    technicianName: text(raw.technicianName, LIMITS.technicianMaxLength, 'Technician name'),
    status,
    notes: notesValue(raw.notes),
    startedAt,
    finishedAt,
    durationSeconds: durationSeconds(startedAt, finishedAt),
    createdAt: isoOrNull(raw.createdAt, 'Created time') ?? startedAt ?? new Date(0).toISOString(),
    updatedAt: isoOrNull(raw.updatedAt, 'Updated time') ?? startedAt ?? new Date(0).toISOString(),
    version,
    items: [...seen.values()],
  };
}

export function newRepair({ checklist, deviceModel, serialNumber, ticketRef, technicianName, now = new Date().toISOString(), id = uuid() }) {
  if (!checklist.models.some((m) => m.id === deviceModel)) fail('Pick a device model from the list.');
  return normalizeRepair({
    id,
    checklistId: checklist.id,
    checklistVersion: checklist.version,
    deviceModel,
    serialNumber,
    ticketRef,
    technicianName,
    status: 'in_progress',
    notes: '',
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    items: [],
  });
}

// ---- checklist helpers ----

export function itemsForModel(section, modelId) {
  return section.items.filter((it) => !it.appliesTo || it.appliesTo.includes(modelId));
}

export function modelName(checklist, modelId) {
  return checklist?.models.find((m) => m.id === modelId)?.name ?? modelId;
}

// Counts for the progress bar and the form header.
export function progress(checklist, modelId, results) {
  const counts = { total: 0, ok: 0, issue: 0, na: 0, done: 0 };
  for (const section of checklist.sections) {
    for (const it of itemsForModel(section, modelId)) {
      counts.total += 1;
      const r = results.get(it.id)?.result;
      if (r) {
        counts[r] += 1;
        counts.done += 1;
      }
    }
  }
  return counts;
}

// Shows only the last few characters: "03919A240100123" -> "••••0123". Short values are fully hidden.
export function maskTail(value, keep = 4) {
  if (!value) return '';
  const chars = [...value];
  if (chars.length <= keep + 2) return '•'.repeat(Math.min(chars.length, 8));
  return '••••' + chars.slice(-keep).join('');
}
