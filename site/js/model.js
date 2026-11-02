// Repair records: limits, labels, creation and validation. Pure functions only (no DOM, no
// storage), so the same rules run in the browser and in the Node tests.
//
// A repair has the same shape as HardwareRepairTracker's /api/sync/upload contract, plus
// technicianName (there are no accounts here), so saved forms can be imported there later.

// Same limits and text rules as HardwareRepairTracker (web/public/js/text-rules.js and
// portable/text.go there); change them together. Short one-line fields are 32.
export const LIMITS = Object.freeze({
  notesMaxLength: 2000,
  itemDetailMaxLength: 280,
  serialMaxLength: 32,
  ticketMaxLength: 32,
  technicianMaxLength: 32,
  maxItems: 1000,
});

// What older saves were allowed. Repairs already kept in this browser and forms saved before the
// limits were tightened still open; editing one asks for the shorter value.
export const LEGACY_LIMITS = Object.freeze({
  ...LIMITS,
  serialMaxLength: 64,
  ticketMaxLength: 64,
  technicianMaxLength: 60,
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

// ---- cleaning typed or pasted text ----
//
// These run on every keystroke/paste in the page and again whenever a repair is validated
// (including repairs read from a file), so the same text comes out either way. They never trim
// the ends (that would stop someone typing a space between words); `text()` trims when storing.

// Control codes, invisible "format" characters (zero-width spaces, byte-order marks, word
// joiners), direction overrides that make "SN\u202eexe.lmth" display as "SNhtml.exe", stray surrogate
// halves, private-use characters and Unicode line/paragraph separators.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;
// Same, but keeps line breaks and tabs, plus the zero-width joiners that some languages and
// emoji sequences (family and profession emoji) need.
const INVISIBLE_IN_NOTES = /(?![\n\t\u200c\u200d])[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;
// "Zalgo" text: dozens of accent marks stacked on one letter, which smears over nearby lines.
// Real writing needs at most a few per letter.
const MARK_PILEUP = /(\p{M}{4})\p{M}+/gu;
const MAX_BLANK_LINES = 2;

const base = (value) => String(value ?? '').normalize('NFC').replace(MARK_PILEUP, '$1');
// One line: pasted line breaks and tabs become a space, invisible characters go, and runs of
// spaces collapse to one.
const oneLine = (value) =>
  value
    .replace(/[\r\n\t\v\f\u0085\u2028\u2029]+/g, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ');

// Serial numbers and ticket refs: plain letters and digits with a few separators. No emoji,
// accents, links (no ":"), or HTML ("<", ">").
export const cleanSerial = (value) => oneLine(base(value)).replace(/[^A-Za-z0-9 .\-_/#]/g, '').replace(/ {2,}/g, ' ');
export const cleanTicket = cleanSerial;
// Names: letters from any language, digits, spaces and the punctuation names use.
export const cleanPersonName = (value) => oneLine(base(value)).replace(/[^\p{L}\p{M}\p{N} '’.,\-]/gu, '').replace(/ {2,}/g, ' ');
// One-line free text (issue detail): anything readable, including emoji, on one line.
export const cleanLine = (value) => oneLine(base(value));
// Notes: anything readable, with line breaks, but no more than two blank lines in a row.
export const cleanNotes = (value) =>
  base(value)
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE_IN_NOTES, '')
    .replace(new RegExp(`\\n(?:[ \\t]*\\n){${MAX_BLANK_LINES + 1},}`, 'g'), '\n'.repeat(MAX_BLANK_LINES + 1));

// Labels read from a saved file (checklist titles, model names) are shown, never edited.
export const cleanLabel = (value) => oneLine(base(value));

// ---- field rules ----

export function text(value, max, label, clean = cleanLine) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const v = clean(value).trim();
  if (v.length > max) fail(`${label} must be ${max} characters or fewer (got ${v.length}).`);
  return v;
}

export function notesValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail('Notes must be text.');
  const v = cleanNotes(value).replace(/\s+$/, ''); // keep line breaks, drop trailing whitespace
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
    detail: isIssue ? text(raw.detail, LIMITS.itemDetailMaxLength, 'Item detail', cleanLine) : '',
  };
}

// Validates a whole repair (from this browser's storage or from an opened file) and returns a
// clean copy with only known fields. Throws ValidationError with a plain-language message.
// `legacy: true` is for reading what was already saved: it accepts the longer limits older
// versions allowed. Anything being typed or saved now uses LIMITS.
export function normalizeRepair(raw, { legacy = false } = {}) {
  const max = legacy ? LEGACY_LIMITS : LIMITS;
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
    serialNumber: text(raw.serialNumber, max.serialMaxLength, 'Serial number', cleanSerial),
    ticketRef: text(raw.ticketRef, max.ticketMaxLength, 'Ticket / job reference', cleanTicket),
    technicianName: text(raw.technicianName, max.technicianMaxLength, 'Technician name', cleanPersonName),
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
