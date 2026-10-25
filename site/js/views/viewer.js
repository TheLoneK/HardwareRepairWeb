// "View a saved form": open a completed form (.html saved by this site, or a repair .json) and
// show it read-only. The file never runs and its HTML is never rendered: only the embedded
// repair data is read, validated field by field, and drawn here with text nodes.
import { MAX_FORM_BYTES, buildDisplay, formModel, humanDuration, readFormText } from '../form-file.js';
import { h, mount, secretText, statusPill, fmtDateTime } from '../dom.js';
import { categoryOfChecklist, state } from '../state.js';

export function renderViewer(app) {
  const error = h('p', { class: 'error-text', role: 'alert' });
  const out = h('div', { class: 'stack-lg' });
  const input = h('input', { type: 'file', accept: '.html,.htm,.json,text/html,application/json', class: 'visually-hidden', id: 'form-file' });
  const drop = h(
    'label',
    { class: 'drop', for: 'form-file' },
    h('strong', { text: 'Choose a saved form' }),
    h('span', { class: 'small muted', text: 'or drop it here · .html forms from this site, or a repair .json' }),
  );

  async function open(file) {
    error.textContent = '';
    out.replaceChildren();
    if (!file) return;
    try {
      if (file.size > MAX_FORM_BYTES) throw new Error('That file is too large to be a repair form.');
      if (!/\.(html?|json)$/i.test(file.name)) throw new Error('Pick an .html or .json file.');
      const data = readFormText(await file.text());
      out.replaceChildren(formView(data, file.name));
      out.querySelector('h2')?.focus();
    } catch (err) {
      error.textContent = `Couldn’t open “${file.name}”: ${err.message}`;
    }
  }

  input.addEventListener('change', () => open(input.files[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    open(e.dataTransfer.files[0]);
  });

  mount(
    app,
    h(
      'div',
      { class: 'stack-lg' },
      h('div', { class: 'stack no-print' }, h('h1', { text: 'View a saved form' }), h('p', { class: 'muted', text: 'Opens a completed form read-only. The file stays on your computer; nothing is uploaded.' }), input, drop, error),
      out,
    ),
  );
}

function formView({ repair, display, savedAt }, fileName) {
  const checklist = state.checklists.get(repair.checklistId);
  const category = categoryOfChecklist(repair.checklistId);
  // Bare repair .json files carry no labels; take them from this site's copy of the checklist.
  const shown = display ?? buildDisplay(repair, checklist ?? null, checklist ? category : null);
  const m = formModel({ repair, display: shown });
  const sub = [shown.categoryName, shown.checklistTitle, `checklist v${repair.checklistVersion}`].filter(Boolean).join(' · ');

  const metaRow = (label, value) => h('tr', {}, h('th', { scope: 'row', text: label }), h('td', {}, value));
  return h(
    'article',
    { class: 'card stack form-view' },
    h(
      'div',
      { class: 'card-head' },
      h('div', { class: 'stack' }, h('h2', { tabindex: '-1', text: `Repair form — ${shown.modelName}` }), h('p', { class: 'small muted', text: sub })),
      h('button', { type: 'button', class: 'btn btn-sm no-print', text: 'Print', on: { click: () => window.print() } }),
    ),
    h(
      'table',
      { class: 'data meta-table' },
      h(
        'tbody',
        {},
        metaRow('Technician', repair.technicianName || '—'),
        metaRow(shown.modelLabel, shown.modelName),
        metaRow('Serial number', secretText('serial number', repair.serialNumber)),
        metaRow('Ticket / job ref', secretText('ticket ref', repair.ticketRef)),
        metaRow('Outcome', statusPill(repair.status)),
        metaRow('Started', fmtDateTime(repair.startedAt)),
        metaRow('Finished', fmtDateTime(repair.finishedAt)),
        metaRow('Total time', humanDuration(repair.durationSeconds)),
        metaRow('Checked', `${m.checked} of ${m.total} items · ${m.issues.length} issue${m.issues.length === 1 ? '' : 's'}`),
      ),
    ),
    h('h3', { text: 'Issues found' }),
    m.issues.length
      ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'data' },
            h('thead', {}, h('tr', {}, ['Section', 'Item', 'Action taken', 'Detail'].map((t) => h('th', { text: t })))),
            h('tbody', {}, m.issues.map((r) => h('tr', {}, h('td', { text: r.section }), h('td', { class: 'r-issue', text: r.title }), h('td', { text: r.action }), h('td', { text: r.detail })))),
          ),
        )
      : h('p', { class: 'muted', text: 'No issues marked.' }),
    h('h3', { text: 'Notes' }),
    h('div', { class: 'notes-view', text: repair.notes || '—' }),
    h('h3', { text: 'Full checklist' }),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Item' }), h('th', { text: 'Result' }))),
        m.sections.map((s) =>
          h('tbody', {}, h('tr', { class: 'sec-row' }, h('td', { colspan: '2', text: s.title })), s.rows.map((r) => h('tr', {}, h('td', { text: r.title }), h('td', { class: `r-${r.cls}`, text: r.result })))),
        ),
      ),
    ),
    h('p', { class: 'small muted', text: `${fileName} · Repair ID ${repair.id}${savedAt ? ` · saved ${fmtDateTime(savedAt)}` : ''}${display || checklist ? '' : ' · checklist labels not available, showing item ids'}` }),
  );
}
