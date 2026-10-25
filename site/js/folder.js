// Saving completed forms to a folder the user picks.
//
// Chrome and Edge (desktop) support the File System Access API: the user picks a folder once,
// the browser remembers it (the handle is kept in IndexedDB, never its contents), and each
// device type gets a subfolder, e.g. <chosen folder>/PC/2026-10-24 1430 - Laptop … .html.
// The browser asks again for permission in a later visit. Other browsers (Firefox, Safari,
// phones) download the file instead, to the folder their download settings choose.

const DB_NAME = 'hrw';
const STORE = 'handles';
const KEY = 'formsFolder';

export const canPickFolder = () => typeof window.showDirectoryPicker === 'function' && window.isSecureContext;

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      let tx;
      let req;
      try {
        tx = db.transaction(STORE, mode);
        req = fn(tx.objectStore(STORE));
      } catch (err) {
        db.close();
        reject(err);
        return;
      }
      tx.oncomplete = () => {
        db.close();
        resolve(req?.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

export async function savedFolder() {
  if (!canPickFolder()) return null;
  try {
    return (await idb('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function forgetFolder() {
  try {
    await idb('readwrite', (s) => s.delete(KEY));
  } catch {
    /* nothing stored */
  }
}

// Must be called from a click (browsers only show the picker for a user gesture).
export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ id: 'repair-forms', mode: 'readwrite', startIn: 'documents' });
  try {
    await idb('readwrite', (s) => s.put(handle, KEY));
  } catch {
    /* works for this visit, just not remembered */
  }
  return handle;
}

async function writable(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

function download(fileName, contents) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Saves one form. `subfolder` is the device type's folder name (validated in categories.json).
// `replaces` is the file name this repair was saved under before, removed if the name changed.
// Returns { where, fileName, downloaded }.
export async function saveForm({ fileName, contents, subfolder, replaces }) {
  if (!canPickFolder()) {
    download(fileName, contents);
    return { where: 'your downloads', fileName, downloaded: true };
  }
  let root = await savedFolder();
  if (!root || !(await writable(root).catch(() => false))) root = await chooseFolder();
  const dir = subfolder ? await root.getDirectoryHandle(subfolder, { create: true }) : root;
  const file = await dir.getFileHandle(fileName, { create: true });
  const out = await file.createWritable();
  await out.write(contents);
  await out.close();
  // Only ever remove an older form of this same repair (same "(id).html" ending).
  const suffix = fileName.slice(fileName.lastIndexOf(' ('));
  if (replaces && replaces !== fileName && replaces.endsWith(suffix) && !/[\\/]/.test(replaces)) {
    await dir.removeEntry(replaces).catch(() => {});
  }
  return { where: [root.name, subfolder].filter(Boolean).join('/'), fileName, downloaded: false };
}
