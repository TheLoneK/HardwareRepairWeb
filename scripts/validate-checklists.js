// Checks site/data/categories.json, site/data/checklists/index.json and every checklist.
//   npm run validate-checklists
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checklistCategory, normalizeCategories, validateCategories, validateChecklist } from '../site/js/catalog-rules.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'data');

export function checkData(dataDir = DATA) {
  const problems = [];
  const lines = [];
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
  const catData = read('categories.json');
  problems.push(...validateCategories(catData));
  if (problems.length) return { problems, lines };
  const categories = normalizeCategories(catData);
  const index = read('checklists/index.json').checklists || [];
  const onDisk = fs.readdirSync(path.join(dataDir, 'checklists')).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  for (const f of onDisk) if (!index.includes(f)) problems.push(`checklists/${f} is not listed in checklists/index.json, so the site won't load it`);
  for (const f of index) if (!onDisk.includes(f)) problems.push(`checklists/index.json lists ${f}, which doesn't exist`);
  const ids = new Set();
  for (const f of index.filter((x) => onDisk.includes(x))) {
    let c;
    try {
      c = read(`checklists/${f}`);
    } catch (e) {
      problems.push(`${f}: invalid JSON (${e.message})`);
      continue;
    }
    const errs = validateChecklist(c, f);
    problems.push(...errs);
    if (errs.length) continue;
    if (ids.has(c.id)) problems.push(`${f}: duplicate checklist id "${c.id}"`);
    ids.add(c.id);
    const cat = checklistCategory(c, categories);
    if (!categories.some((x) => x.id === cat)) problems.push(`${f}: category "${c.category}" is not in categories.json`);
    const items = c.sections.reduce((n, s) => n + s.items.length, 0);
    lines.push(`OK  ${c.id} v${c.version} (${cat}): ${items} items in ${c.sections.length} sections, ${c.models.length} models`);
  }
  return { problems, lines };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, lines } = checkData();
  for (const l of lines) console.log(l);
  if (problems.length) {
    console.error('Checklist problems:\n  ' + problems.join('\n  '));
    process.exitCode = 1;
  }
}
