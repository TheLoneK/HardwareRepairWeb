// The repair runner: timing, checklist (OK / Issue / N/A per item), notes, outcome, and saving
// the completed form to a folder. Every change is kept in this browser straight away; button
// presses save immediately, typing saves after a short pause.
import { canPickFolder, saveForm } from '../folder.js';
import { buildDisplay, formDocument, formFileName, renderFormHtml } from '../form-file.js';
import { LIMITS, STATUS_LABELS, actionLabel, durationSeconds, itemsForModel, modelName, normalizeRepair, progress } from '../model.js';
import { deleteRepair, getRepair, putRepair } from '../store.js';
import { charCounter, confirmButton, debounce, field, fmtClock, fmtDateTime, fromLocalInput, h, mount, secretInput, statusPill, toLocalInput, toast } from '../dom.js';
import { categoryOfChecklist, modelOptions, setCategory, state } from '../state.js';

const RESULT_BUTTONS = [
  { r: 'ok', label: '✓ OK', title: 'Checked — not an issue' },
  { r: 'issue', label: '! Issue', title: 'This is a problem on this unit' },
  { r: 'na', label: '– N/A', title: 'Not applicable / could not check' },
];

export function renderRepair(app, id, { navigate }) {
  const initial = getRepair(id);
  if (!initial) {
    mount(app, h('div', { class: 'card stack' }, h('h2', { text: 'Repair not found on this device' }), h('p', { class: 'muted', text: 'Repairs are kept in the browser they were started in. If you saved its form, open it from “View a saved form”.' }), h('a', { class: 'btn', href: '#/', text: 'Back to repairs' })));
    return;
  }
  const checklist = state.checklists.get(initial.checklistId);
  if (!checklist) {
    mount(app, h('div', { class: 'card stack' }, h('h2', { text: 'Checklist not available' }), h('p', { class: 'muted', text: `This repair uses the “${initial.checklistId}” checklist, which this site no longer has.` }), h('a', { class: 'btn', href: '#/', text: 'Back to repairs' })));
    return;
  }
  // The device type decides which actions are offered and how fields are labelled. Opening a
  // repair also switches the device tabs to its type, so "← Repairs" lands back in context.
  const category = categoryOfChecklist(initial.checklistId);
  if (category) setCategory(category.id);
  const actionsFor = (current) => {
    const list = category?.actions ?? [];
    return list.includes(current) ? list : [...list, current]; // keep an older action visible
  };

  let repair = { ...initial };
  const results = new Map(initial.items.map((i) => [i.itemId, { result: i.result, action: i.action, detail: i.detail }]));
  let filter = 'all';

  // ---------- keeping it in this browser ----------
  const saveState = h('div', { class: 'save-state', 'aria-live': 'polite', text: 'Kept on this device' });
  let dirty = false;
  let removed = false;

  function persist({ bump = true } = {}) {
    if (removed) return false;
    dirty = false;
    const now = new Date().toISOString();
    const next = {
      ...repair,
      items: [...results.entries()].map(([itemId, v]) => ({ itemId, ...v })),
      version: bump ? repair.version + 1 : repair.version,
      updatedAt: bump ? now : repair.updatedAt,
      durationSeconds: durationSeconds(repair.startedAt, repair.finishedAt),
    };
    let clean;
    try {
      clean = normalizeRepair(next);
    } catch (err) {
      saveState.textContent = 'Not kept';
      saveState.className = 'save-state err';
      toast(err.message, { error: true });
      return false;
    }
    for (const k of ['savedAt', 'savedVersion', 'savedFile', 'savedTo']) if (repair[k] !== undefined) clean[k] = repair[k];
    repair = clean;
    if (!putRepair(repair)) {
      saveState.textContent = 'Not kept';
      saveState.className = 'save-state err';
      toast('This browser would not store the change. Save the form now so nothing is lost.', { error: true });
      return false;
    }
    saveState.textContent = 'Kept on this device';
    saveState.className = 'save-state';
    refreshDerived();
    return true;
  }
  const persistSoon = debounce(() => persist(), 500);

  function queueFields(fields, { now = false } = {}) {
    Object.assign(repair, fields);
    dirty = true;
    saveState.textContent = 'Editing…';
    now ? persistSoon.flush() : persistSoon();
  }

  function queueItem(itemId, value, { now = true } = {}) {
    if (value) results.set(itemId, { ...value });
    else results.delete(itemId);
    dirty = true;
    saveState.textContent = 'Editing…';
    now ? persistSoon.flush() : persistSoon();
  }

  const beforeUnload = () => {
    if (dirty) persistSoon.flush();
  };
  window.addEventListener('pagehide', beforeUnload);

  // ---------- header ----------
  const model = () => checklist.models.find((m) => m.id === repair.deviceModel);
  const titleEl = h('h1');
  const pillHolder = h('span');
  const modelSel = h('select', { on: { change: () => { queueFields({ deviceModel: modelSel.value }, { now: true }); renderChecklist(); refreshDerived(); } } }, modelOptions(h, checklist, repair.deviceModel));
  const serial = secretInput('serial number', { value: repair.serialNumber, maxLength: LIMITS.serialMaxLength, autocapitalize: 'characters' });
  serial.input.addEventListener('input', () => queueFields({ serialNumber: serial.input.value }));
  const ticket = secretInput('ticket ref', { value: repair.ticketRef, maxLength: LIMITS.ticketMaxLength });
  ticket.input.addEventListener('input', () => queueFields({ ticketRef: ticket.input.value }));
  const tech = h('input', { value: repair.technicianName, maxLength: LIMITS.technicianMaxLength, placeholder: 'Your name', on: { input: () => queueFields({ technicianName: tech.value }) } });

  // ---------- timing ----------
  const startIn = h('input', { type: 'datetime-local', value: toLocalInput(repair.startedAt), on: { change: () => setTime('startedAt', startIn.value) } });
  const finishIn = h('input', { type: 'datetime-local', value: toLocalInput(repair.finishedAt), on: { change: () => setTime('finishedAt', finishIn.value) } });
  const elapsedEl = h('div', { class: 'elapsed', text: '0:00:00' });
  const elapsedLabel = h('div', { class: 'elapsed-label', text: 'Elapsed' });

  function setTime(key, localValue) {
    const iso = fromLocalInput(localValue);
    const next = { ...repair, [key]: iso };
    if (next.startedAt && next.finishedAt && Date.parse(next.finishedAt) < Date.parse(next.startedAt)) {
      toast('Finish time cannot be before the start time.', { error: true });
      startIn.value = toLocalInput(repair.startedAt);
      finishIn.value = toLocalInput(repair.finishedAt);
      return;
    }
    queueFields({ [key]: iso }, { now: true });
    tick();
  }
  function setNow(key) {
    const iso = new Date().toISOString(); // datetime-local has minute precision; keep the exact time
    if (key === 'finishedAt' && repair.startedAt && Date.parse(iso) < Date.parse(repair.startedAt)) return toast('Finish time cannot be before the start time.', { error: true });
    (key === 'startedAt' ? startIn : finishIn).value = toLocalInput(iso);
    queueFields({ [key]: iso }, { now: true });
    tick();
  }
  function tick() {
    if (!repair.startedAt) {
      elapsedEl.textContent = '—';
      elapsedLabel.textContent = 'Not started';
      return;
    }
    const end = repair.finishedAt ? Date.parse(repair.finishedAt) : Date.now();
    elapsedEl.textContent = fmtClock((end - Date.parse(repair.startedAt)) / 1000);
    elapsedLabel.textContent = repair.finishedAt ? 'Total time' : 'Elapsed (running)';
  }
  const timer = setInterval(tick, 1000);

  // ---------- progress ----------
  const progressText = h('div', { class: 'small' });
  const bar = h('div', { class: 'progress-bar', 'aria-hidden': 'true' });

  // ---------- checklist ----------
  const sectionsEl = h('div', { class: 'stack' });
  const itemEls = new Map();
  const sectionEls = [];

  function renderItem(item) {
    const res = results.get(item.id);
    // Notes for other models show inline when the checklist isn't written for this one.
    const isOtherSeries = !model()?.primary;
    const el = h('div', { class: `item${res ? ` r-${res.result}` : ''}`, id: `item-${item.id}`, dataset: { item: item.id } });

    const choiceBtns = RESULT_BUTTONS.map((b) =>
      h('button', {
        type: 'button',
        class: 'choice',
        dataset: { r: b.r },
        title: b.title,
        'aria-pressed': String(res?.result === b.r),
        text: b.label,
        on: {
          click: () => {
            const cur = results.get(item.id);
            if (cur?.result === b.r) queueItem(item.id, null); // tap again to un-check
            else queueItem(item.id, { result: b.r, action: b.r === 'issue' ? cur?.action ?? 'none' : 'none', detail: b.r === 'issue' ? cur?.detail ?? '' : '' });
            rerenderItem(item);
          },
        },
      }),
    );

    let issueDetail = null;
    if (res?.result === 'issue') {
      const actionSel = h(
        'select',
        { 'aria-label': 'Action taken', on: { change: () => queueItem(item.id, { ...results.get(item.id), action: actionSel.value }) } },
        actionsFor(res.action).map((a) => h('option', { value: a, selected: a === res.action, text: actionLabel(category, a) })),
      );
      const detailIn = h('input', {
        value: res.detail,
        maxLength: LIMITS.itemDetailMaxLength,
        placeholder: 'What did you find? (part, error code…)',
        'aria-label': 'Issue detail',
        on: { input: () => queueItem(item.id, { ...results.get(item.id), detail: detailIn.value }, { now: false }) },
      });
      issueDetail = h('div', { class: 'issue-detail' }, actionSel, detailIn);
    }

    const tips = [item.fix && h('p', {}, h('strong', { text: 'Usual fix: ' }), item.fix), !isOtherSeries && item.otherSeries && h('p', {}, h('strong', { text: 'Other models: ' }), item.otherSeries)].filter(Boolean);

    el.append(
      ...[
        h(
          'div',
          {},
          h('div', { class: 'item-title' }, item.title, (item.tags || []).includes('common') ? h('span', { class: 'tag', text: 'Common' }) : null, (item.tags || []).includes('safety') ? h('span', { class: 'tag', text: 'Safety' }) : null),
          h('p', { class: 'item-check', text: item.check }),
          item.signs ? h('p', { class: 'item-signs' }, h('strong', { text: 'Signs: ' }), item.signs) : null,
        ),
        h('div', { class: 'item-choices', role: 'group', 'aria-label': `Result for ${item.title}` }, choiceBtns),
        isOtherSeries && item.otherSeries ? h('p', { class: 'other-series' }, h('strong', { text: `${model()?.name}: ` }), item.otherSeries) : null,
        issueDetail,
        tips.length ? h('details', { class: 'item-tips' }, h('summary', { text: 'Tips' }), h('div', {}, tips)) : null,
      ].filter(Boolean),
    );
    return el;
  }

  function rerenderItem(item) {
    const old = itemEls.get(item.id);
    const fresh = renderItem(item);
    itemEls.set(item.id, fresh);
    old.replaceWith(fresh);
    applyFilter();
  }

  function renderChecklist() {
    itemEls.clear();
    sectionEls.length = 0;
    const firstVisit = results.size === 0;
    sectionsEl.replaceChildren(
      ...checklist.sections
        .map((section, idx) => {
          const items = itemsForModel(section, repair.deviceModel);
          if (!items.length) return null;
          const countEl = h('span', { class: 'section-count' });
          const itemNodes = items.map((it) => {
            const el = renderItem(it);
            itemEls.set(it.id, el);
            return el;
          });
          const markRest = h('button', {
            type: 'button',
            class: 'btn btn-sm',
            text: 'Mark unchecked items OK',
            on: {
              click: () => {
                for (const it of items) {
                  if (!results.has(it.id)) {
                    results.set(it.id, { result: 'ok', action: 'none', detail: '' });
                    rerenderItem(it);
                  }
                }
                persist();
              },
            },
          });
          const details = h(
            'details',
            { class: 'section', open: firstVisit ? idx === 0 : true },
            h('summary', {}, h('span', { class: 'section-title', text: section.title }), countEl),
            section.description ? h('p', { class: 'section-desc', text: section.description }) : null,
            h('div', { class: 'section-tools row' }, markRest),
            itemNodes,
          );
          sectionEls.push({ section, items, countEl });
          return details;
        })
        .filter(Boolean),
    );
    applyFilter();
  }

  function applyFilter() {
    for (const [itemId, el] of itemEls) {
      const r = results.get(itemId)?.result;
      el.hidden = filter === 'todo' ? !!r : filter === 'issues' ? r !== 'issue' : false;
    }
  }

  function refreshDerived() {
    titleEl.textContent = `${modelName(checklist, repair.deviceModel)} repair`;
    pillHolder.replaceChildren(statusPill(repair.status));
    const counts = progress(checklist, repair.deviceModel, results);
    progressText.textContent = `${counts.done} of ${counts.total} checked · ${counts.issue} issue${counts.issue === 1 ? '' : 's'}`;
    bar.replaceChildren(
      ...['ok', 'issue', 'na']
        .filter((k) => counts[k])
        .map((k) => {
          const s = h('span', { class: `p-${k}` });
          s.style.width = `${(counts[k] / counts.total) * 100}%`;
          return s;
        }),
    );
    for (const { items, countEl } of sectionEls) {
      const checked = items.filter((it) => results.has(it.id)).length;
      const issues = items.filter((it) => results.get(it.id)?.result === 'issue').length;
      countEl.textContent = `${checked}/${items.length}${issues ? ` · ${issues} issue${issues === 1 ? '' : 's'}` : ''}`;
      countEl.className = 'section-count' + (issues ? ' has-issue' : '');
    }
    for (const b of outcomeBtns) b.setAttribute('aria-pressed', String(repair.status === b.dataset.status));
    reopenBtn.hidden = repair.status === 'in_progress';
    savedNote.textContent =
      repair.savedVersion === repair.version
        ? `Form saved ${fmtDateTime(repair.savedAt)}${repair.savedTo ? ` to ${repair.savedTo}` : ''}.`
        : repair.savedAt
          ? `Changed since the form was saved ${fmtDateTime(repair.savedAt)}. Save again to update it.`
          : repair.status === 'in_progress'
            ? 'Pick an outcome when you’re done, then save the form. You can save it at any time.'
            : 'Not saved yet.';
    savedNote.className = 'small ' + (repair.savedVersion === repair.version ? 'ok-text' : 'muted');
  }

  const filterSeg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Show' },
    [
      ['all', 'All'],
      ['todo', 'To check'],
      ['issues', 'Issues'],
    ].map(([v, label]) =>
      h('button', {
        type: 'button',
        'aria-pressed': String(v === filter),
        text: label,
        on: {
          click: (e) => {
            filter = v;
            for (const b of filterSeg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
            applyFilter();
          },
        },
      }),
    ),
  );

  // ---------- notes ----------
  const notes = h('textarea', {
    maxLength: LIMITS.notesMaxLength,
    placeholder: category?.notesHint || 'Anything else: what the customer reported, error codes, parts used, what to watch next time…',
    on: { input: () => queueFields({ notes: notes.value }) },
  });
  notes.value = repair.notes;

  // ---------- outcome ----------
  const outcomeBtns = Object.entries(STATUS_LABELS)
    .filter(([s]) => s !== 'in_progress')
    .map(([s, label]) =>
      h('button', {
        type: 'button',
        class: 'outcome',
        dataset: { status: s },
        text: label,
        on: {
          click: () => {
            const fields = { status: s };
            if (!repair.finishedAt) {
              fields.finishedAt = new Date().toISOString();
              finishIn.value = toLocalInput(fields.finishedAt);
            }
            queueFields(fields, { now: true });
            tick();
            toast(`Marked ${label.toLowerCase()}.`);
          },
        },
      }),
    );
  const reopenBtn = h('button', {
    type: 'button',
    class: 'btn btn-sm',
    text: 'Reopen (back to in progress)',
    on: {
      click: () => {
        queueFields({ status: 'in_progress', finishedAt: null }, { now: true });
        finishIn.value = '';
        tick();
      },
    },
  });

  // ---------- save the form ----------
  const savedNote = h('p', { class: 'small muted', 'aria-live': 'polite' });
  const saveBtn = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: canPickFolder() ? 'Save form to folder' : 'Download form',
    on: { click: () => saveFormNow() },
  });

  async function saveFormNow() {
    if (dirty) persistSoon.flush();
    if (!persist({ bump: false })) return;
    saveBtn.disabled = true;
    try {
      const display = buildDisplay(repair, checklist, category);
      const doc = formDocument({ repair: normalizeRepair(repair), display });
      const fileName = formFileName(repair, display);
      const res = await saveForm({ fileName, contents: renderFormHtml(doc), subfolder: category?.folder, replaces: repair.savedFile });
      Object.assign(repair, { savedAt: doc.savedAt, savedVersion: repair.version, savedTo: res.downloaded ? 'your downloads' : res.where });
      if (!res.downloaded) repair.savedFile = fileName;
      persist({ bump: false });
      toast(res.downloaded ? `Downloaded “${fileName}”.` : `Saved to ${res.where}/${fileName}`);
    } catch (err) {
      if (err?.name === 'AbortError') toast('Not saved: no folder was chosen.', { error: true });
      else if (err?.name === 'NotAllowedError') toast('Not saved: the browser wasn’t allowed to write to that folder.', { error: true });
      else toast(`Not saved: ${err.message}`, { error: true });
    } finally {
      saveBtn.disabled = false;
    }
  }

  const deleteBtn = confirmButton('Remove from this device', 'Click again to remove', () => {
    removed = true; // a pending autosave must not bring it back
    dirty = false;
    deleteRepair(repair.id);
    toast(repair.savedAt ? 'Removed from this device. The saved form is untouched.' : 'Repair removed.');
    navigate('#/');
  });

  // ---------- layout ----------
  const safety = checklist.safety?.length
    ? h('details', { class: 'card safety', open: results.size === 0 }, h('summary', {}, h('strong', { text: 'Safety before you start' })), h('ul', {}, checklist.safety.map((s) => h('li', { text: s }))))
    : null;

  mount(
    app,
    h(
      'div',
      { class: 'stack-lg' },
      h(
        'div',
        { class: 'repair-head' },
        h(
          'div',
          { class: 'stack' },
          h('div', { class: 'row' }, h('a', { href: '#/', class: 'small muted', text: '← Repairs' })),
          h('div', { class: 'row' }, titleEl, pillHolder),
          h('p', { class: 'small muted', text: `${category && state.categories.length > 1 ? `${category.singular} · ` : ''}${checklist.title} · v${repair.checklistVersion} · created ${fmtDateTime(repair.createdAt)}` }),
        ),
        h('div', { class: 'stack' }, saveState),
      ),
      h('section', { class: 'card' }, h('div', { class: 'form-grid' }, field(category?.modelLabel ?? 'Model', modelSel), field('Serial number', serial.wrap), field('Ticket / job ref', ticket.wrap), field('Technician', tech))),
      h(
        'section',
        { class: 'card stack' },
        h('h2', { text: 'Time' }),
        h(
          'div',
          { class: 'timer-grid' },
          field('Started', h('div', { class: 'time-input' }, startIn, h('button', { type: 'button', class: 'btn btn-sm', text: 'Now', on: { click: () => setNow('startedAt') } }))),
          field('Finished', h('div', { class: 'time-input' }, finishIn, h('button', { type: 'button', class: 'btn btn-sm', text: 'Now', on: { click: () => setNow('finishedAt') } }))),
          h('div', {}, elapsedLabel, elapsedEl),
        ),
      ),
      safety,
      h('div', { class: 'sticky-tools' }, h('div', { class: 'row-between' }, h('div', { class: 'progress grow' }, progressText, bar), filterSeg)),
      h('div', { class: 'legend', 'aria-hidden': 'true' }, h('span', {}, h('i', { class: 'p-ok' }), 'OK'), h('span', {}, h('i', { class: 'p-issue' }), 'Issue'), h('span', {}, h('i', { class: 'p-na' }), 'N/A')),
      sectionsEl,
      h('section', { class: 'card stack' }, h('div', { class: 'card-head' }, h('h2', { text: 'Notes' }), charCounter(notes, LIMITS.notesMaxLength)), notes),
      h(
        'section',
        { class: 'card stack' },
        h('div', { class: 'card-head' }, h('h2', { text: 'Outcome' }), h('div', { class: 'row' }, reopenBtn)),
        h('p', { class: 'small muted', text: 'Picking an outcome sets the finish time to now if it is empty.' }),
        h('div', { class: 'outcomes' }, outcomeBtns),
      ),
      h(
        'section',
        { class: 'card stack save-card' },
        h('div', { class: 'card-head' }, h('h2', { text: 'Completed form' }), saveBtn),
        savedNote,
        h('p', { class: 'small muted', text: 'The form is one .html file: it opens and prints in any browser, keeps the serial number and ticket ref hidden until you choose to show them, and can be opened again here or imported into the Repair Tracker.' }),
      ),
      h('div', { class: 'row' }, deleteBtn),
    ),
  );
  renderChecklist();
  refreshDerived();
  tick();

  state.cleanup = () => {
    clearInterval(timer);
    window.removeEventListener('pagehide', beforeUnload);
    if (dirty) persistSoon.flush();
  };
}
