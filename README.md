# HardwareRepairWeb

Simple public website for troubleshooting and tracking hardware repairs, then saving the completed form for documentation. It's the web side of [HardwareRepairTracker](https://github.com/TheLoneK/HardwareRepairTracker) without accounts or a server: anyone with the link can use it, everything runs in their browser, and nothing is uploaded.

## What it does

- **Device types:** 3D printers (Bambu Lab A series, with notes for P, X and H series) and computers (Windows desktops and laptops). Tabs at the top switch between them.
- **Checklist runner:** sections ordered from the most common faults to deeper diagnostics. Every item has OK / Issue / N/A (tap again to clear), an action and a short detail for issues, tips, and model-specific notes. "Mark unchecked items OK" clears a section quickly. Filter by All / To check / Issues.
- **Timing:** start and finish times with "Now" buttons and a live elapsed clock. Picking an outcome (Fixed, Not fixed, Waiting on parts, No fault found) fills in the finish time.
- **Notes** up to 2,000 characters with a counter; issue details up to 280 (same limits as the tracker).
- **Private fields:** the serial number and ticket / job ref are hidden by default (shown as dots) with an eye button to show them, on the repair screen, in the saved-form viewer and in the saved file itself.
- **Kept on this device:** a repair in progress is kept in the browser it was started in, so a reload or closed tab doesn't lose it. "Clear all data on this device" removes everything the site stored.
- **Save the form to a folder you choose:** in Chrome or Edge on a computer you pick a folder once and forms are written to a subfolder per device type (`<your folder>/3DPrinters/…`, `<your folder>/PC/…`). Saving again after an edit replaces that repair's file. Other browsers download the file instead.
- **View a saved form:** open a saved `.html` form (or a repair `.json`, including the portable exe's `RepairData/*/Repairs/*.json`) to see it read-only and print it. The site only shows forms; collating and stats stay in HardwareRepairTracker.

## The saved form

One self-contained `.html` file per repair, named like `2026-10-24 1430 - A1 - SN ending 0123 (6f1c2a9b).html`. It:

- opens and prints in any browser, with a signature/date line;
- contains no scripts and carries its own strict Content-Security-Policy;
- hides the serial number and ticket ref until "Show serial number and ticket ref" is ticked (pure CSS);
- embeds the repair as JSON in `<script type="application/json" id="repair-data">`:

```json
{
  "format": "hardware-repair-form", "formatVersion": 1, "source": "hardware-repair-web", "savedAt": "…",
  "repair": { "id": "…uuid…", "checklistId": "bambu-a-series", "checklistVersion": 1, "deviceModel": "a1",
              "serialNumber": "…", "ticketRef": "…", "technicianName": "…", "status": "fixed", "notes": "…",
              "startedAt": "…", "finishedAt": "…", "durationSeconds": 2520, "createdAt": "…", "updatedAt": "…",
              "version": 7, "items": [{ "itemId": "intake.blob", "result": "issue", "action": "replaced", "detail": "…" }] },
  "display": { "categoryName": "3D printer", "checklistTitle": "…", "modelName": "A1", "sections": [ … ] }
}
```

`repair` follows HardwareRepairTracker's `/api/sync/upload` contract (plus `technicianName`, as in the portable exe), so the tracker can import these files. `display` holds the labels as they were when saved, so an old form still reads correctly after a checklist changes.

## Layout

```
site/                  Everything that gets published (GitHub Pages serves this folder)
  index.html           CSP, frame guard, app shell
  css/app.css
  js/model.js          Repair rules and limits (pure)
  js/form-file.js      Saved form: HTML, file name, reading it back (pure)
  js/catalog-rules.js  Checklist / device-type validation (pure, same rules as the tracker)
  js/state.js          Loads data/ and tracks the selected device type
  js/store.js          Repairs in progress in this browser (localStorage)
  js/folder.js         Folder picker, saving, download fallback
  js/views/            home, repair, viewer, device tabs
  data/                categories.json + checklists/ (copied from HardwareRepairTracker/shared)
scripts/               serve (local preview), validate-checklists, sync-checklists
test/                  node --test
```

## Run it locally

Needs Node 20 or newer; there is nothing to install.

```bash
npm start                    # http://127.0.0.1:8080
npm test
npm run validate-checklists
```

## Publish it

Pushes to `main` run the tests and deploy `site/` with GitHub Actions (`.github/workflows/pages.yml`). One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is then at `https://thelonek.github.io/HardwareRepairWeb/`.

## Keeping checklists in step with the tracker

Checklists and device types are data copied from HardwareRepairTracker's `shared/` folder:

```bash
npm run sync-checklists -- ../HardwareRepairTracker
npm run validate-checklists
```

A new device type or checklist needs no code change: add it to `site/data/categories.json` / `site/data/checklists/` and list the file in `site/data/checklists/index.json` (the sync script does this).

## Security

See [SECURITY.md](SECURITY.md).
