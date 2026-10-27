import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, LEGACY_LIMITS, ValidationError, cleanLine, cleanNotes, cleanPersonName, cleanSerial, maskTail, newRepair, normalizeRepair, progress } from '../site/js/model.js';

const checklist = {
  id: 'demo',
  version: 3,
  title: 'Demo',
  models: [{ id: 'a1', name: 'A1', primary: true }, { id: 'p1s', name: 'P1S' }],
  sections: [{ id: 's', title: 'S', items: [{ id: 's.one', title: 'One', check: 'c' }, { id: 's.two', title: 'Two', check: 'c', appliesTo: ['p1s'] }] }],
};
const base = () => newRepair({ checklist, deviceModel: 'a1', serialNumber: ' SN123 ', ticketRef: 'WO-1', technicianName: 'Sam', now: '2026-10-24T14:30:00.000Z' });

test('newRepair fills in a valid in-progress repair', () => {
  const r = base();
  assert.match(r.id, /^[0-9a-f-]{36}$/);
  assert.equal(r.serialNumber, 'SN123');
  assert.equal(r.status, 'in_progress');
  assert.equal(r.checklistVersion, 3);
  assert.equal(r.startedAt, '2026-10-24T14:30:00.000Z');
  assert.deepEqual(r.items, []);
});

test('newRepair rejects a model that is not in the checklist', () => {
  assert.throws(() => newRepair({ checklist, deviceModel: 'x9' }), ValidationError);
});

test('notes and issue detail limits match HardwareRepairTracker', () => {
  assert.equal(LIMITS.notesMaxLength, 2000);
  assert.equal(LIMITS.itemDetailMaxLength, 280);
  const r = base();
  assert.throws(() => normalizeRepair({ ...r, notes: 'x'.repeat(2001) }), /2000/);
  assert.throws(() => normalizeRepair({ ...r, items: [{ itemId: 's.one', result: 'issue', detail: 'x'.repeat(281) }] }), /280/);
});

test('short one-line fields are limited to 32 characters', () => {
  const r = base();
  for (const key of ['serialMaxLength', 'ticketMaxLength', 'technicianMaxLength']) assert.equal(LIMITS[key], 32);
  for (const key of ['serialMaxLength', 'ticketMaxLength', 'technicianMaxLength']) assert.ok(LIMITS[key] <= LEGACY_LIMITS[key], 'still fits the tracker');
  assert.equal(normalizeRepair({ ...r, serialNumber: 'X'.repeat(32) }).serialNumber.length, 32);
  assert.throws(() => normalizeRepair({ ...r, serialNumber: 'X'.repeat(33) }), /Serial number must be 32/);
  assert.throws(() => normalizeRepair({ ...r, ticketRef: 'X'.repeat(33) }), /Ticket.*32/);
  assert.throws(() => normalizeRepair({ ...r, technicianName: 'Sam'.repeat(11) }), /Technician name must be 32/);
  assert.throws(() => newRepair({ checklist, deviceModel: 'a1', serialNumber: 'X'.repeat(33) }), /32/);
});

test('repairs saved under the older, longer limits still open', () => {
  const older = { ...base(), serialNumber: 'X'.repeat(50), ticketRef: 'T'.repeat(64), technicianName: 'N'.repeat(60) };
  const r = normalizeRepair(older, { legacy: true });
  assert.equal(r.serialNumber.length, 50);
  assert.throws(() => normalizeRepair(r), /32/, 'but saving an edit asks for the shorter value');
  assert.throws(() => normalizeRepair({ ...older, serialNumber: 'X'.repeat(65) }, { legacy: true }), /64/);
});

test('serial numbers and ticket refs keep only letters, digits and a few separators', () => {
  assert.equal(cleanSerial('SN-123_45/6.7 #8'), 'SN-123_45/6.7 #8');
  assert.equal(cleanSerial('https://evil.example/x?a=<b>'), 'https//evil.example/xab', 'no ":", so never a working link');
  assert.equal(cleanSerial('AB😀🔥CD👨‍👩‍👧'), 'ABCD');
  assert.equal(cleanSerial('AB\u200b\u200b\u2060CD\ufeff'), 'ABCD', 'invisible characters');
  assert.equal(cleanSerial('SN\u202eexe.lmth'), 'SNexe.lmth', 'direction override');
  assert.equal(cleanSerial('A\u0007B\u001bC'), 'ABC', 'control codes');
  assert.equal(cleanSerial('top\n\n\nbottom'), 'top bottom', 'pasted line breaks');
  assert.equal(cleanSerial('A    B'), 'A B');
  assert.equal(cleanSerial('Ünïcødé'), 'ncd');
  assert.equal(normalizeRepair({ ...base(), serialNumber: ' SN\u202e<b>123😀 ' }).serialNumber, 'SNb123');
});

test('names keep letters from any language but no emoji, links or markup', () => {
  assert.equal(cleanPersonName("Zoë O'Brien-Núñez"), "Zoë O'Brien-Núñez");
  assert.equal(cleanPersonName('李小龙'), '李小龙');
  assert.equal(cleanPersonName('Sam 😀🔥'), 'Sam ');
  assert.equal(cleanPersonName('<script>alert(1)</script>'), 'scriptalert1script');
  assert.equal(cleanPersonName('https://evil.example'), 'httpsevil.example');
  const zalgo = 'Z' + '\u0336\u0337\u0338\u0300\u0301\u0302'.repeat(30) + 'algo';
  assert.equal([...cleanPersonName(zalgo)].length, 'Z'.length + 4 + 'algo'.length, 'at most 4 marks per letter');
  assert.equal(normalizeRepair({ ...base(), technicianName: zalgo }).technicianName.length, 9);
});

test('issue detail and notes allow emoji and links as plain text, but nothing invisible', () => {
  assert.equal(cleanLine('fan 😞 see https://wiki.example/fan'), 'fan 😞 see https://wiki.example/fan');
  assert.equal(cleanLine('one\ntwo\tthree'), 'one two three');
  assert.equal(cleanLine('a\u202eb\u200bc'), 'abc');
  assert.equal(cleanNotes('line 1\r\nline 2\ttab'), 'line 1\nline 2\ttab');
  assert.equal(cleanNotes('a\u202eb\u0000c'), 'abc');
  assert.equal(cleanNotes('👨‍👩‍👧'), '👨‍👩‍👧', 'emoji joiners survive');
  assert.equal(cleanNotes('top' + '\n'.repeat(1500) + 'bottom'), 'top\n\n\nbottom', 'at most two blank lines');
  assert.equal(cleanNotes('a\n  \n\t\n \n\nb'), 'a\n\n\nb');
  const r = normalizeRepair({ ...base(), notes: 'x\u202e' + '\n'.repeat(50) + 'y', items: [{ itemId: 's.one', result: 'issue', detail: 'bad\u200bbelt\n' }] });
  assert.equal(r.notes, 'x\n\n\ny');
  assert.equal(r.items[0].detail, 'badbelt');
});

test('normalizeRepair drops unknown fields and rejects bad values', () => {
  const r = normalizeRepair({ ...base(), evil: '<script>', userId: 7 });
  assert.equal('evil' in r, false);
  assert.throws(() => normalizeRepair({ ...base(), status: 'hacked' }), /status/);
  assert.throws(() => normalizeRepair({ ...base(), id: '../../etc' }), /UUID/);
  assert.throws(() => normalizeRepair({ ...base(), checklistId: '<b>' }), /checklist/);
  assert.throws(() => normalizeRepair({ ...base(), items: [{ itemId: 's.one', result: 'meh' }] }), /result/);
  assert.throws(() => normalizeRepair({ ...base(), items: [{ itemId: 's.one', result: 'issue', action: 'explode' }] }), /action/);
  assert.throws(() => normalizeRepair({ ...base(), finishedAt: '2026-10-24T14:00:00Z' }), /before/);
  assert.throws(() => normalizeRepair({ ...base(), items: 'nope' }), /list/);
  assert.throws(() => normalizeRepair('string'), /not a repair/);
});

test('action and detail only stick to issues; duration is computed', () => {
  const r = normalizeRepair({
    ...base(),
    finishedAt: '2026-10-24T15:12:00Z',
    items: [
      { itemId: 's.one', result: 'ok', action: 'replaced', detail: 'ignored' },
      { itemId: 's.two', result: 'issue', action: 'replaced', detail: ' belt ' },
    ],
  });
  assert.deepEqual(r.items[0], { itemId: 's.one', result: 'ok', action: 'none', detail: '' });
  assert.equal(r.items[1].detail, 'belt');
  assert.equal(r.durationSeconds, 42 * 60);
});

test('progress counts only items for the chosen model', () => {
  const results = new Map([['s.one', { result: 'issue' }], ['s.two', { result: 'ok' }]]);
  assert.deepEqual(progress(checklist, 'a1', results), { total: 1, ok: 0, issue: 1, na: 0, done: 1 });
  assert.equal(progress(checklist, 'p1s', results).total, 2);
});

test('maskTail keeps only the last 4 characters', () => {
  assert.equal(maskTail('03919A240100123'), '••••0123');
  assert.equal(maskTail('ABC'), '•••');
  assert.equal(maskTail(''), '');
});
