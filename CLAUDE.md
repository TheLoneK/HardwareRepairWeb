# CLAUDE.md

Public, login-free version of HardwareRepairTracker's web UI, published from `site/` to GitHub Pages. Runs entirely in the browser: repairs in progress live in localStorage, completed forms are saved as self-contained `.html` files to a folder the user picks (File System Access API) or downloaded. It shows saved forms but does no data management; stats/collation stay in TheLoneK/HardwareRepairTracker, which can import the forms.

## Fundamentals (same as the tracker)

- **Functional:** rules, formatting and the form file are pure (`model.js`, `form-file.js`, `catalog-rules.js`). Side effects stay at the edges: `store.js` (localStorage), `folder.js` (files), view render functions (DOM).
- **Modular:** one concern per file, one file per view.
- **Zero dependencies, no build step.** Vanilla ES modules in `site/`, Node built-ins for scripts and tests.
- **Checklists are data** copied from the tracker's `shared/` (`npm run sync-checklists`). Item ids are permanent. Every checklist file must be listed in `site/data/checklists/index.json`.
- **Repair shape = tracker's `/api/sync/upload` contract** plus `technicianName`. Limits and text rules match the tracker (notes 2000, issue detail 280, serial/ticket/technician 32; its rules are in `web/public/js/text-rules.js` and `portable/text.go`), so change both repos together. Reading what was already saved (`normalizeRepair(r, { legacy: true })` in `store.js` and `readFormText`) accepts the older limits. If the tracker's rules change, change `site/js/model.js` too.
- **Saved form format** is versioned (`FORM_FORMAT_VERSION` in `form-file.js`); bump it for incompatible changes and keep reading older versions.

## Security defaults (keep them)

- Build DOM with `h()` / `textContent`. Never `innerHTML` (CSP enforces Trusted Types; `test/site.test.js` checks).
- CSP in `site/index.html`: `'self'` only, no inline script/style, no third parties. Don't add CDNs, analytics or fonts.
- `js/guard.js` loads first and hides the page when framed.
- Anything read from a file or localStorage goes through `normalizeRepair` / `normalizeDisplay` before use. The viewer never renders a file's HTML.
- Every text box goes through `guardInput` (dom.js) with its `clean*` rule from `model.js`; `normalizeRepair` applies the same rules, so typed, stored and opened text is cleaned the same way.
- Serial number and ticket ref stay masked by default everywhere (`secretInput`, `secretText`, CSS toggle in the saved file) and out of file names except the serial's last 4.

## Commands

```bash
npm start                    # http://127.0.0.1:8080
npm test                     # node --test
npm run validate-checklists
```

Any behavior change needs a test in `test/`. User-facing text is plain language.
