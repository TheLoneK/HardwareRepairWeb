// Copies checklists and device types from a HardwareRepairTracker checkout, so both sites use the
// same data:  npm run sync-checklists -- ../HardwareRepairTracker
// Then run npm run validate-checklists and commit the changes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dest = path.resolve(here, '..', 'site', 'data');
const src = path.resolve(process.argv[2] || path.join(here, '..', '..', 'HardwareRepairTracker'), 'shared');
if (!fs.existsSync(path.join(src, 'categories.json'))) {
  console.error(`No shared/categories.json under ${path.dirname(src)}. Pass the path to your HardwareRepairTracker folder.`);
  process.exit(1);
}
fs.copyFileSync(path.join(src, 'categories.json'), path.join(dest, 'categories.json'));
const files = fs.readdirSync(path.join(src, 'checklists')).filter((f) => f.endsWith('.json')).sort();
for (const f of files) fs.copyFileSync(path.join(src, 'checklists', f), path.join(dest, 'checklists', f));
fs.writeFileSync(path.join(dest, 'checklists', 'index.json'), JSON.stringify({ checklists: files }, null, 2) + '\n');
console.log(`Copied categories.json and ${files.length} checklist(s): ${files.join(', ')}`);
