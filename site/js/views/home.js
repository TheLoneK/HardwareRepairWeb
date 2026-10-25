// Repairs home for the selected device type: start a new repair, pick up one that's in progress
// on this device, and choose where completed forms are saved. The device tabs switch types.
import { canPickFolder, chooseFolder, forgetFolder, savedFolder } from '../folder.js';
import { LIMITS, ValidationError, maskTail, modelName, newRepair } from '../model.js';
import { clearEverything, deleteRepair, getTechnician, listRepairs, putRepair, setTechnician, storageWorks } from '../store.js';
import { confirmButton, field, fmtDateTime, fmtDuration, h, lowerFirst, mount, secretInput, statusPill, toast } from '../dom.js';
import { categoryOfChecklist, checklistsInCategory, currentCategory, modelOptions, state } from '../state.js';
import { deviceTabs } from './device-tabs.js';

export async function renderHome(app, { navigate }) {
  const category = currentCategory();
  if (!category) {
    mount(app, h('div', { class: 'empty', text: 'No checklists are installed.' }));
    return;
  }
  const checklists = checklistsInCategory(category.id);
  const byId = new Map(checklists.map((c) => [c.id, c]));
  const tabs = deviceTabs(() => navigate('#/'));

  // ---- New repair ----
  const checklistSel = h('select', {}, checklists.map((c) => h('option', { value: c.id, text: c.title })));
  const modelSel = h('select', { required: true });
  const fillModels = () => modelSel.replaceChildren(...modelOptions(h, byId.get(checklistSel.value), null));
  checklistSel.addEventListener('change', fillModels);
  fillModels();
  const serial = secretInput('serial number', { maxLength: LIMITS.serialMaxLength, placeholder: category.serialHint || 'Serial number', autocapitalize: 'characters' });
  const ticket = secretInput('ticket ref', { maxLength: LIMITS.ticketMaxLength, placeholder: 'Work order / RMA' });
  const tech = h('input', { maxLength: LIMITS.technicianMaxLength, value: getTechnician(), placeholder: 'Your name', autocomplete: 'name' });
  const error = h('p', { class: 'error-text', role: 'alert' });
  const startBtn = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Start repair' });

  const newForm = h(
    'form',
    {
      class: 'card stack',
      autocomplete: 'off',
      on: {
        submit: (e) => {
          e.preventDefault();
          error.textContent = '';
          try {
            const repair = newRepair({
              checklist: byId.get(checklistSel.value),
              deviceModel: modelSel.value,
              serialNumber: serial.input.value,
              ticketRef: ticket.input.value,
              technicianName: tech.value,
            });
            setTechnician(repair.technicianName);
            if (!putRepair(repair)) throw new ValidationError('This browser would not store the repair (storage may be full or blocked).');
            navigate(`#/repairs/${repair.id}`);
          } catch (err) {
            error.textContent = err.message;
          }
        },
      },
    },
    h('div', { class: 'card-head' }, h('h2', { text: `New ${lowerFirst(category.singular)} repair` }), h('span', { class: 'small muted', text: 'The timer starts when you press Start. You can edit the times later.' })),
    h(
      'div',
      { class: 'form-grid' },
      checklists.length > 1 ? field('Checklist', checklistSel) : null,
      field(category.modelLabel, modelSel),
      field('Serial number', serial.wrap, '(optional, hidden)'),
      field('Ticket / job ref', ticket.wrap, '(optional, hidden)'),
      field('Technician', tech, '(optional)'),
      startBtn,
    ),
    error,
  );

  // ---- On this device ----
  const mine = listRepairs().filter((r) => categoryOfChecklist(r.checklistId)?.id === category.id);
  const open = mine.filter((r) => r.status === 'in_progress' || r.savedVersion !== r.version);
  const done = mine.filter((r) => !open.includes(r));
  const clearSaved = done.length
    ? confirmButton(`Remove ${done.length} saved repair${done.length === 1 ? '' : 's'} from this device`, 'Click again to remove', () => {
        for (const r of done) deleteRepair(r.id);
        toast('Removed from this device. The saved forms in your folder are untouched.');
        setTimeout(() => navigate('#/'), 50);
      })
    : null;

  // ---- Save folder ----
  const folderCard = await folderSection(category, () => navigate('#/'));

  mount(
    app,
    h(
      'div',
      { class: 'stack-lg' },
      tabs,
      h('div', { class: 'row-between' }, h('h1', { text: state.categories.length > 1 ? `${category.singular} repairs` : 'Repairs' })),
      storageWorks()
        ? null
        : h('div', { class: 'card notice warn', role: 'alert', text: 'This browser is blocking site storage (private window or strict settings), so a repair is lost if you leave the page. Save the form before closing.' }),
      newForm,
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', { text: 'On this device' }), h('span', { class: 'small muted', text: `${open.length} open` })),
        open.length ? h('div', { class: 'list' }, open.map((r) => repairRow(r, byId))) : h('div', { class: 'empty', text: 'Nothing in progress on this device.' }),
        done.length
          ? h(
              'details',
              { class: 'done-list' },
              h('summary', { text: `Saved and finished (${done.length})` }),
              h('div', { class: 'list' }, done.map((r) => repairRow(r, byId))),
              h('div', { class: 'row' }, clearSaved),
            )
          : null,
      ),
      folderCard,
      h(
        'p',
        { class: 'small muted privacy' },
        'Everything runs in your browser. Repairs are kept on this device until you save the form, and nothing is uploaded. ',
        confirmButton('Clear all data on this device', 'Click again: deletes unsaved repairs too', async () => {
          clearEverything();
          await forgetFolder();
          toast('Cleared everything this site stored in this browser.');
          setTimeout(() => location.reload(), 600);
        }, 'link-btn'),
      ),
    ),
  );
}

async function folderSection(category, refresh) {
  if (!canPickFolder()) {
    return h(
      'section',
      { class: 'card stack' },
      h('h2', { text: 'Where forms are saved' }),
      h('p', { class: 'small', text: 'This browser can’t write to a folder you pick, so “Save form” downloads the file. Your browser saves it to its download folder, or asks where if “Ask where to save each file” is turned on in its settings.' }),
      h('p', { class: 'small muted', text: 'To pick a folder instead, use Chrome or Edge on a computer.' }),
    );
  }
  const dir = await savedFolder();
  const chooseBtn = h('button', {
    type: 'button',
    class: 'btn btn-sm',
    text: dir ? 'Change folder' : 'Choose folder',
    on: {
      click: async () => {
        try {
          const picked = await chooseFolder();
          toast(`Forms will be saved in ${picked.name}.`);
          refresh();
        } catch (err) {
          if (err?.name !== 'AbortError') toast(err.message || 'Could not use that folder.', { error: true });
        }
      },
    },
  });
  return h(
    'section',
    { class: 'card stack' },
    h('div', { class: 'card-head' }, h('h2', { text: 'Where forms are saved' }), chooseBtn),
    dir
      ? h('p', { class: 'small' }, 'Completed forms go in ', h('strong', { class: 'mono', text: `${dir.name}/${category.folder}/` }), '. Each device type gets its own subfolder. The browser may ask you to allow access again on a later visit.')
      : h('p', { class: 'small', text: `No folder chosen yet. You’ll be asked the first time you save a form; ${lowerFirst(category.singular)} forms go in a “${category.folder}” subfolder of it.` }),
  );
}

function repairRow(r, byId) {
  const c = byId.get(r.checklistId);
  const ident = [r.serialNumber && `SN ${maskTail(r.serialNumber)}`, r.ticketRef && `#${maskTail(r.ticketRef)}`].filter(Boolean).join(' · ');
  const saved = r.savedVersion === r.version ? 'Form saved' : r.savedAt ? 'Changed since last save' : 'Not saved yet';
  return h(
    'a',
    { class: 'list-row', href: `#/repairs/${r.id}` },
    h('div', {}, h('div', { class: 'title', text: modelName(c, r.deviceModel) }), h('div', { class: 'meta mono', text: ident || 'No serial / ticket' })),
    h(
      'div',
      { class: 'col-2' },
      h('div', { class: 'small', text: fmtDateTime(r.startedAt) }),
      h('div', { class: 'meta', text: `${issueCount(r)} · ${fmtDuration(r.durationSeconds)} · ${saved}` }),
    ),
    statusPill(r.status),
  );
}

function issueCount(r) {
  const n = r.items.filter((i) => i.result === 'issue').length;
  return `${n} issue${n === 1 ? '' : 's'}`;
}
