# Security

This is a public, static site on GitHub Pages with no accounts and no server. The design goal is that repair data never leaves the user's device unless they save a file themselves.

| Concern | How it's handled |
| --- | --- |
| Data leaving the device | No backend, no analytics, no third-party scripts, fonts or images. The CSP's `connect-src 'self'` limits requests to this site's own checklist files. |
| Script injection (XSS) | All user text goes into the page with `textContent`, never `innerHTML`. The CSP allows scripts from this site only (no inline scripts, no `eval`) and enforces **Trusted Types** (`require-trusted-types-for 'script'`), so HTML-injection sinks throw in Chromium browsers. A test fails the build if `innerHTML`, `insertAdjacentHTML`, `document.write` or `eval` appear in `site/js`. |
| Headers Pages can't send | The CSP and `no-referrer` policy are `<meta>` tags. `frame-ancestors` can't be set that way, so `js/guard.js` keeps the page hidden unless it is the top window (stops clickjacking of "Save form" / "Clear all data"). |
| Saved forms | Every value is HTML-escaped; the embedded JSON escapes `<`, `>` and `&` so it can't close its `<script type="application/json">` block. The file has its own CSP (`default-src 'none'`), so it runs no scripts even if opened from a shared drive. |
| Opening a form in the viewer | The file's HTML is never rendered. Only the embedded JSON is read, capped at 1 MB, then validated field by field (ids, statuses, results, actions, dates, lengths) and drawn with text nodes. Labels in the file are length-capped strings. |
| Private fields | Serial number and ticket ref are masked by default (CSS text-security, falling back to a password-type box) and excluded from password managers and autocomplete. Lists show only the last 4 characters; file names include only the serial's last 4 and never the ticket ref. |
| Repairs kept in the browser | Stored in `localStorage` on that device only, re-validated when read, and removable per repair or all at once ("Clear all data on this device"). On a shared computer, save the form and remove the repair when done. |
| Writing to the user's folder | Uses the browser's File System Access permission prompt; the site can only write inside the folder the user picked, in a per-device-type subfolder whose name comes from `categories.json` (validated to letters, numbers, spaces, `-` and `_`). It only ever deletes an older copy of the same repair's form (matching `(<id>).html`). |
| Checklist links | Only `https://` references are accepted by the checklist validator. |

Masking is protection against someone looking over a shoulder or at a screen share; anyone who has the saved file can read its contents (the serial is in the embedded data so the tracker can import it). Treat saved forms like any other work document.

Found a problem? Open a private security advisory on the repository rather than a public issue.
