import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDisplay, cleanName, escapeHtml, formDocument, formFileName, readFormText, renderFormHtml, MAX_FORM_BYTES } from '../site/js/form-file.js';
import { newRepair, normalizeRepair } from '../site/js/model.js';

const checklist = {
  id: 'demo',
  version: 1,
  title: 'Demo checklist',
  models: [{ id: 'a1', name: 'A1', primary: true }],
  sections: [{ id: 's', title: 'Motion', items: [{ id: 's.belt', title: 'Belt <tension>', check: 'c' }, { id: 's.rail', title: 'Rail', check: 'c' }] }],
};
const category = { singular: '3D printer', folder: '3DPrinters', modelLabel: 'Model', actionLabels: {} };
const evil = '</script><script>alert(1)</script><img src=x onerror=alert(2)>';

function sample(overrides = {}) {
  const r = newRepair({ checklist, deviceModel: 'a1', serialNumber: '03919A240100123', ticketRef: 'WO-5521', technicianName: 'Sam', now: '2026-10-24T14:30:00.000Z' });
  return normalizeRepair({
    ...r,
    status: 'fixed',
    finishedAt: '2026-10-24T15:00:00.000Z',
    notes: `Customer said ${evil}`,
    items: [{ itemId: 's.belt', result: 'issue', action: 'replaced', detail: evil }],
    ...overrides,
  });
}

test('escapeHtml escapes every HTML-significant character', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('saved form contains no executable markup from user text', () => {
  const repair = sample();
  const html = renderFormHtml(formDocument({ repair, display: buildDisplay(repair, checklist, category) }));
  assert.equal(html.includes('<script>alert'), false);
  assert.equal(html.includes('<img'), false);
  assert.equal((html.match(/<script/g) || []).length, 1, 'only the JSON data block');
  assert.match(html, /<script type="application\/json" id="repair-data">/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.match(html, /Belt &lt;tension&gt;/);
});

test('serial and ticket are masked by default in the saved form', () => {
  const repair = sample();
  const html = renderFormHtml(formDocument({ repair, display: buildDisplay(repair, checklist, category) }));
  assert.match(html, /<span class="masked">••••0123<\/span><span class="real">03919A240100123<\/span>/);
  assert.match(html, /<span class="masked">••••5521<\/span>/);
  assert.match(html, /\.secret \.real\{display:none\}/);
  assert.equal(/<title>[^<]*0391/.test(html), false, 'serial not in the title');
});

test('a saved form reads back to the same repair', () => {
  const repair = sample();
  const doc = formDocument({ repair, display: buildDisplay(repair, checklist, category), savedAt: '2026-10-24T15:01:00.000Z' });
  const back = readFormText(renderFormHtml(doc));
  assert.deepEqual(back.repair, repair);
  assert.equal(back.display.modelName, 'A1');
  assert.equal(back.display.sections[0].items[0].title, 'Belt <tension>');
  assert.equal(back.savedAt, '2026-10-24T15:01:00.000Z');
  assert.deepEqual(readFormText(JSON.stringify(doc)).repair, repair, 'also as .json');
});

test('a bare repair JSON (portable exe / tracker export) opens without labels', () => {
  const repair = sample();
  const back = readFormText(JSON.stringify({ ...repair, userId: 3, technicianName: 'Sam' }));
  assert.equal(back.display, null);
  assert.equal(back.repair.technicianName, 'Sam');
});

test('readFormText rejects junk, tampered data and oversized files', () => {
  assert.throws(() => readFormText('<html><body>hi</body></html>'), /no repair data/);
  assert.throws(() => readFormText('{not json'), /damaged/);
  assert.throws(() => readFormText('x'.repeat(MAX_FORM_BYTES + 1)), /too large/);
  const repair = sample();
  const doc = formDocument({ repair, display: buildDisplay(repair, checklist, category) });
  assert.throws(() => readFormText(JSON.stringify({ ...doc, repair: { ...repair, status: 'pwned' } })), /status/);
  assert.throws(() => readFormText(JSON.stringify({ ...doc, formatVersion: 99 })), /newer version/);
  const huge = readFormText(JSON.stringify({ ...doc, display: { ...doc.display, modelName: 'x'.repeat(5000), sections: 'nope' } }));
  assert.equal(huge.display.modelName.length, 100);
  assert.deepEqual(huge.display.sections, []);
});

test('file names are safe on Windows and only show the end of the serial', () => {
  const repair = sample({ deviceModel: 'a1' });
  const name = formFileName(repair, { modelName: 'A1 <mini>: "x"/y' });
  assert.match(name, /^\d{4}-\d{2}-\d{2} \d{4} - A1 -mini- -x-y - SN ending 0123 \([0-9a-f]{8}\)\.html$/);
  assert.equal(name.includes('03919A24'), false);
  assert.equal(name.includes('WO-5521'), false);
  assert.equal(cleanName('..\\..\\evil.html'), '-..-evil.html');
  assert.equal(cleanName(' . CON . '), 'CON');
});

test('labels and fields from an opened file lose invisible and direction-flipping characters', () => {
  const repair = sample();
  const doc = formDocument({ repair, display: buildDisplay(repair, checklist, category) });
  doc.display.modelName = 'A1\u202eexe.lmth';
  doc.display.sections[0].title = 'Mo\u200btion\nNext';
  doc.repair.serialNumber = 'SN\u202e0123';
  const back = readFormText(renderFormHtml(doc));
  assert.equal(back.display.modelName, 'A1exe.lmth');
  assert.equal(back.display.sections[0].title, 'Motion Next');
  assert.equal(back.repair.serialNumber, 'SN0123');
});

test('forms saved under the older, longer limits still open in the viewer', () => {
  const repair = sample();
  const doc = formDocument({ repair, display: buildDisplay(repair, checklist, category) });
  doc.repair.serialNumber = 'X'.repeat(64);
  doc.repair.technicianName = 'N'.repeat(60);
  const back = readFormText(renderFormHtml(doc));
  assert.equal(back.repair.serialNumber.length, 64);
  assert.equal(back.repair.technicianName.length, 60);
});

test('file names stay plain ASCII whatever the serial holds', () => {
  const repair = normalizeRepair({ ...sample(), serialNumber: 'AB12\u202e😀🔥lmth.exe' });
  const name = formFileName(repair, buildDisplay(repair, checklist, category));
  assert.match(name, /^[\x20-\x7e]+$/);
});
