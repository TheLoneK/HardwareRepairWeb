import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, ValidationError, maskTail, newRepair, normalizeRepair, progress } from '../site/js/model.js';

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

test('limits match HardwareRepairTracker', () => {
  assert.equal(LIMITS.notesMaxLength, 2000);
  assert.equal(LIMITS.itemDetailMaxLength, 280);
  const r = base();
  assert.throws(() => normalizeRepair({ ...r, notes: 'x'.repeat(2001) }), /2000/);
  assert.throws(() => normalizeRepair({ ...r, serialNumber: 'x'.repeat(65) }), /64/);
  assert.throws(() => normalizeRepair({ ...r, items: [{ itemId: 's.one', result: 'issue', detail: 'x'.repeat(281) }] }), /280/);
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
