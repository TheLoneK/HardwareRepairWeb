// Static checks on the published site: security defaults and data that must stay valid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkData } from '../scripts/validate-checklists.js';
import { resolveInside } from '../scripts/serve.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const jsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

test('checklists and device types are valid', () => {
  const { problems, lines } = checkData();
  assert.deepEqual(problems, []);
  assert.ok(lines.length >= 2);
});

test('no HTML-injection sinks or eval in site code', () => {
  for (const f of jsFiles(path.join(ROOT, 'js'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const bad of [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function\(/, /setTimeout\(\s*['"`]/]) {
      assert.equal(bad.test(src), false, `${path.relative(ROOT, f)} uses ${bad}`);
    }
  }
});

test('site code only talks to its own origin', () => {
  for (const f of jsFiles(path.join(ROOT, 'js'))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.equal(/fetch\(\s*['"`]https?:/.test(src), false, `${f} fetches another site`);
    assert.equal(/XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(src), false, `${f} opens a network channel`);
  }
});

test('index.html has a strict CSP and loads nothing from elsewhere', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  for (const part of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'", "require-trusted-types-for 'script'"]) {
    assert.ok(csp.includes(part), `CSP missing ${part}`);
  }
  assert.equal(/unsafe-inline|unsafe-eval|\*/.test(csp), false);
  assert.equal(/(src|href)="(https?:)?\/\//.test(html), false, 'no external resources');
  assert.equal(/<script>(?!<\/script>)/.test(html), false, 'no inline script');
  assert.ok(html.indexOf('js/guard.js') < html.indexOf('js/main.js'), 'frame guard runs first');
});

test('local server cannot be walked out of site/', () => {
  const root = path.resolve('/srv/site');
  assert.equal(resolveInside(root, '/index.html'), path.join(root, 'index.html'));
  assert.equal(resolveInside(root, '/../secret'), path.join(root, 'secret'));
  assert.equal(resolveInside(root, '/%2e%2e/%2e%2e/etc/passwd'), path.join(root, 'etc', 'passwd'));
  assert.equal(resolveInside(root, '/..%5c..%5cwin.ini')?.startsWith(root + path.sep) ?? true, true);
  assert.equal(resolveInside(root, '/%00'), null);
  assert.equal(resolveInside(root, '/%E0%A4%A'), null);
});
