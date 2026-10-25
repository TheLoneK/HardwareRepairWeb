// Repairs in progress, kept in this browser only (localStorage) until the form is saved to a
// folder. Nothing here is ever sent anywhere. Every record is re-validated when read back.
import { LIMITS, normalizeRepair } from './model.js';

const REPAIRS_KEY = 'hrw.repairs.v1';
const TECH_KEY = 'hrw.technician';

function readAll() {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(REPAIRS_KEY) || '{}');
  } catch {
    return {};
  }
  const out = {};
  for (const [id, r] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    try {
      const clean = normalizeRepair(r);
      // Local-only bookkeeping: when and where the form was last saved.
      if (typeof r.savedAt === 'string') clean.savedAt = r.savedAt;
      if (typeof r.savedVersion === 'number') clean.savedVersion = r.savedVersion;
      if (typeof r.savedFile === 'string') clean.savedFile = r.savedFile.slice(0, 200);
      if (typeof r.savedTo === 'string') clean.savedTo = r.savedTo.slice(0, 300);
      out[clean.id] = clean;
    } catch {
      console.warn(`Skipping a damaged repair in this browser's storage (${id}).`);
    }
  }
  return out;
}

function writeAll(all) {
  try {
    localStorage.setItem(REPAIRS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false; // storage full or blocked (private window)
  }
}

export function storageWorks() {
  try {
    localStorage.setItem('hrw.probe', '1');
    localStorage.removeItem('hrw.probe');
    return true;
  } catch {
    return false;
  }
}

export function listRepairs() {
  return Object.values(readAll()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function getRepair(id) {
  return readAll()[String(id).toLowerCase()] ?? null;
}

// Returns false when the browser refused to store it.
export function putRepair(repair) {
  const all = readAll();
  all[repair.id] = repair;
  return writeAll(all);
}

export function deleteRepair(id) {
  const all = readAll();
  delete all[id];
  return writeAll(all);
}

export function getTechnician() {
  try {
    return (localStorage.getItem(TECH_KEY) || '').slice(0, LIMITS.technicianMaxLength);
  } catch {
    return '';
  }
}

export function setTechnician(name) {
  try {
    if (name) localStorage.setItem(TECH_KEY, name.slice(0, LIMITS.technicianMaxLength));
    else localStorage.removeItem(TECH_KEY);
  } catch {
    /* not remembered */
  }
}

// "Clear this device": every repair and setting this site stored in the browser.
export function clearEverything() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('hrw.')) localStorage.removeItem(k);
  } catch {
    /* nothing stored */
  }
}
