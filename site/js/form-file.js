// Completed repair forms: one self-contained .html file per repair that
//   - opens and prints in any browser (no scripts at all, its own strict CSP),
//   - hides the serial number and ticket ref until "Show private fields" is ticked (CSS only),
//   - carries the repair as JSON in <script type="application/json"> so HardwareRepairTracker
//     (or this site's viewer) can read it back without trusting the page's HTML.
// Pure functions only: data in, string or object out.
import { LIMITS, STATUS_LABELS, ValidationError, actionLabel, itemsForModel, maskTail, modelName, normalizeRepair } from './model.js';

export const FORM_FORMAT = 'hardware-repair-form';
export const FORM_FORMAT_VERSION = 1;
export const MAX_FORM_BYTES = 1024 * 1024; // forms are a few KB; refuse anything silly
const DATA_OPEN = '<script type="application/json" id="repair-data">';
const DATA_CLOSE = '</script>';

const fail = (msg) => {
  throw new ValidationError(msg);
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// JSON that can't end the <script> block or open an HTML comment, whatever the text contains.
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ---- file names ----

const UNSAFE_NAME = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;

export function cleanName(s) {
  return String(s).replace(UNSAFE_NAME, '-').split(/\s+/).filter(Boolean).join(' ').replace(/^[. ]+|[. ]+$/g, '');
}

function localStamp(iso) {
  if (!iso) return 'undated';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// "2026-10-24 1430 - A1 - SN ending 0123 (6f1c2a9b).html". Only the serial's last 4 characters go
// in the name, so a folder listing doesn't expose it; the ticket ref stays out for the same reason.
// Plain ASCII on purpose: browsers rename downloads that contain characters like "…" or "•".
export function formFileName(repair, display) {
  const parts = [localStamp(repair.startedAt), display.modelName || repair.deviceModel];
  if (repair.serialNumber) {
    const tail = maskTail(repair.serialNumber).replace(/•+/, '');
    parts.push(tail ? `SN ending ${tail}` : 'SN hidden');
  }
  let name = cleanName(parts.join(' - '));
  if ([...name].length > 100) name = [...name].slice(0, 100).join('').trim();
  return `${name || 'Repair'} (${repair.id.slice(0, 8)}).html`;
}

// ---- what the form shows ----

// Labels captured at save time, so a form still reads correctly after the checklist changes.
export function buildDisplay(repair, checklist, category) {
  const actions = {};
  for (const it of repair.items) if (it.result === 'issue') actions[it.action] = actionLabel(category, it.action);
  if (!checklist) {
    return {
      categoryName: category?.singular ?? '',
      categoryFolder: category?.folder ?? '',
      modelLabel: category?.modelLabel ?? 'Model',
      checklistTitle: repair.checklistId,
      modelName: repair.deviceModel,
      actionLabels: actions,
      sections: [{ title: 'Checklist', items: repair.items.map((it) => ({ id: it.itemId, title: it.itemId })) }],
    };
  }
  return {
    categoryName: category?.singular ?? '',
    categoryFolder: category?.folder ?? '',
    modelLabel: category?.modelLabel ?? 'Model',
    checklistTitle: checklist.title,
    modelName: modelName(checklist, repair.deviceModel),
    actionLabels: actions,
    sections: checklist.sections
      .map((s) => ({ title: s.title, items: itemsForModel(s, repair.deviceModel).map((it) => ({ id: it.id, title: it.title })) }))
      .filter((s) => s.items.length),
  };
}

const short = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

// Display data from a file is untrusted: keep only strings of sane length in the expected shape.
export function normalizeDisplay(raw) {
  if (!raw || typeof raw !== 'object') fail('The form is missing its checklist labels.');
  const sections = Array.isArray(raw.sections) ? raw.sections.slice(0, 100) : [];
  const actionLabels = {};
  for (const [k, v] of Object.entries(raw.actionLabels && typeof raw.actionLabels === 'object' ? raw.actionLabels : {}).slice(0, 50)) {
    actionLabels[short(k, 40)] = short(v, 100);
  }
  return {
    categoryName: short(raw.categoryName, 60),
    categoryFolder: short(raw.categoryFolder, 60),
    modelLabel: short(raw.modelLabel, 40) || 'Model',
    checklistTitle: short(raw.checklistTitle),
    modelName: short(raw.modelName, 100),
    actionLabels,
    sections: sections.map((s) => ({
      title: short(s?.title),
      items: (Array.isArray(s?.items) ? s.items.slice(0, LIMITS.maxItems) : []).map((it) => ({ id: short(it?.id, 100), title: short(it?.title) })),
    })),
  };
}

// Everything a form renderer needs, in display order. Used by the saved file and the viewer.
export function formModel({ repair, display }) {
  const results = new Map(repair.items.map((i) => [i.itemId, i]));
  const sections = [];
  const issues = [];
  let total = 0;
  let checked = 0;
  for (const s of display.sections) {
    const rows = s.items.map((it) => {
      total += 1;
      const res = results.get(it.id);
      if (!res) return { title: it.title, result: 'Not checked', cls: 'none' };
      checked += 1;
      if (res.result === 'issue') {
        const row = { section: s.title, title: it.title, result: '! Issue', cls: 'issue', action: display.actionLabels[res.action] ?? actionLabel(null, res.action), detail: res.detail };
        issues.push(row);
        return row;
      }
      return res.result === 'ok' ? { title: it.title, result: '✓ OK', cls: 'ok' } : { title: it.title, result: '– N/A', cls: 'na' };
    });
    sections.push({ title: s.title, rows });
  }
  return { sections, issues, total, checked, status: STATUS_LABELS[repair.status] ?? repair.status };
}

export function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function humanDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

// ---- the saved file ----

export function formDocument({ repair, display, savedAt = new Date().toISOString() }) {
  return { format: FORM_FORMAT, formatVersion: FORM_FORMAT_VERSION, source: 'hardware-repair-web', savedAt, repair, display };
}

const secretHtml = (value) =>
  value ? `<span class="secret"><span class="masked">${escapeHtml(maskTail(value))}</span><span class="real">${escapeHtml(value)}</span></span>` : '—';

export function renderFormHtml(doc) {
  const { repair, display } = doc;
  const m = formModel(doc);
  const e = escapeHtml;
  const sub = [display.categoryName, display.checklistTitle, `checklist v${repair.checklistVersion}`].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>Repair form — ${e(display.modelName)} — ${e(fmtWhen(repair.startedAt))}</title>
<style>
  body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1b1a17;background:#fff;max-width:860px;margin:24px auto;padding:0 16px}
  h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px;border-bottom:2px solid #1b1a17;padding-bottom:4px}
  .sub{color:#666;margin:0 0 16px}
  table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666}
  .meta td:first-child{width:160px;color:#666}
  .ok{color:#157a3b;font-weight:600}.issue{color:#b42318;font-weight:700}.na{color:#5f6368}.none{color:#999}
  .status{display:inline-block;padding:2px 10px;border-radius:999px;background:#eee;font-weight:600}
  .notes{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ddd;border-radius:6px;padding:10px;min-height:40px}
  .sec td{background:#f4f3ef;font-weight:700}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px}.sign div{border-top:1px solid #1b1a17;padding-top:4px;color:#666}
  footer{margin-top:24px;color:#999;font-size:12px}
  .reveal{display:flex;gap:8px;align-items:center;margin:0 0 12px;color:#444;cursor:pointer;width:fit-content}
  .secret{font-family:ui-monospace,Menlo,Consolas,monospace}
  .secret .real{display:none}
  #show-private:checked ~ main .secret .real{display:inline}
  #show-private:checked ~ main .secret .masked{display:none}
  #show-private{position:absolute;opacity:0;pointer-events:none}
  #show-private:focus-visible ~ main .reveal{outline:2px solid #2a78d6;outline-offset:2px}
  .reveal .box{width:16px;height:16px;border:1.5px solid #666;border-radius:3px;display:inline-block}
  #show-private:checked ~ main .reveal .box{background:#1b1a17;border-color:#1b1a17}
  @media print{body{margin:0}.reveal{display:none}}
</style></head><body>
<input type="checkbox" id="show-private">
<main>
<h1>Repair form — ${e(display.modelName)}</h1>
<p class="sub">${e(sub)}</p>
<label class="reveal" for="show-private"><span class="box"></span>Show serial number and ticket ref</label>
<table class="meta">
<tr><td>Technician</td><td>${repair.technicianName ? e(repair.technicianName) : '—'}</td></tr>
<tr><td>${e(display.modelLabel)}</td><td>${e(display.modelName)}</td></tr>
<tr><td>Serial number</td><td>${secretHtml(repair.serialNumber)}</td></tr>
<tr><td>Ticket / job ref</td><td>${secretHtml(repair.ticketRef)}</td></tr>
<tr><td>Outcome</td><td><span class="status">${e(m.status)}</span></td></tr>
<tr><td>Started</td><td>${e(fmtWhen(repair.startedAt))}</td></tr>
<tr><td>Finished</td><td>${e(fmtWhen(repair.finishedAt))}</td></tr>
<tr><td>Total time</td><td>${e(humanDuration(repair.durationSeconds))}</td></tr>
<tr><td>Checked</td><td>${m.checked} of ${m.total} items · ${m.issues.length} issue(s)</td></tr>
</table>

<h2>Issues found</h2>
${
  m.issues.length
    ? `<table><tr><th>Section</th><th>Item</th><th>Action taken</th><th>Detail</th></tr>
${m.issues.map((r) => `<tr><td>${e(r.section)}</td><td class="issue">${e(r.title)}</td><td>${e(r.action)}</td><td>${e(r.detail)}</td></tr>`).join('\n')}
</table>`
    : '<p>No issues marked.</p>'
}

<h2>Notes</h2>
<div class="notes">${repair.notes ? e(repair.notes) : '—'}</div>

<h2>Full checklist</h2>
<table><tr><th>Item</th><th>Result</th></tr>
${m.sections.map((s) => `<tr class="sec"><td colspan="2">${e(s.title)}</td></tr>\n${s.rows.map((r) => `<tr><td>${e(r.title)}</td><td class="${r.cls}">${e(r.result)}</td></tr>`).join('\n')}`).join('\n')}
</table>

<div class="sign"><div>Technician signature</div><div>Date</div></div>
<footer>Repair ID ${e(repair.id)} · saved ${e(fmtWhen(doc.savedAt))} · Hardware Repair Web</footer>
</main>
${DATA_OPEN}${jsonForScript(doc)}${DATA_CLOSE}
</body></html>
`;
}

// ---- reading a form back ----

// Accepts a saved .html form, a .json form document, or a bare repair .json (for example one
// from the portable exe's RepairData/<type>/Repairs folder). Never renders the file's HTML: only
// the embedded JSON is read, then validated field by field.
// Returns { repair, display | null, savedAt | null }.
export function readFormText(textContent) {
  if (typeof textContent !== 'string') fail('Could not read that file.');
  if (textContent.length > MAX_FORM_BYTES) fail('That file is too large to be a repair form.');
  const trimmed = textContent.replace(/^﻿/, '').trim();
  let data;
  if (trimmed.startsWith('{')) {
    data = parseJson(trimmed);
  } else {
    const start = trimmed.indexOf(DATA_OPEN);
    if (start < 0) fail('This file has no repair data in it. Open a form saved by this site.');
    const from = start + DATA_OPEN.length;
    const end = trimmed.indexOf(DATA_CLOSE, from);
    if (end < 0) fail('The repair data in this file is cut off.');
    data = parseJson(trimmed.slice(from, end));
  }
  if (data && data.format === FORM_FORMAT) {
    if (data.formatVersion !== FORM_FORMAT_VERSION) fail('This form was saved by a newer version of the site. Reload the page and try again.');
    return { repair: normalizeRepair(data.repair), display: normalizeDisplay(data.display), savedAt: safeIso(data.savedAt) };
  }
  return { repair: normalizeRepair(data), display: null, savedAt: null };
}

function parseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return fail('The repair data in this file is damaged (not valid JSON).');
  }
}

function safeIso(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null;
}
