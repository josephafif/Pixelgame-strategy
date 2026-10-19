// Saved worlds in the browser (IndexedDB: saves are too large for
// localStorage), with a localStorage fallback for small ones.

const DB = 'annals';
const STORE = 'saves';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no IndexedDB'));
      return;
    }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    const req = fn(st);
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function saveLocal(text) {
  try {
    await tx('readwrite', (st) => st.put(text, KEY));
  } catch {
    try {
      window.localStorage.setItem('annals-save', text);
    } catch {
      throw new Error('There is no room to save in this browser.');
    }
  }
}

export async function loadLocal() {
  try {
    const v = await tx('readonly', (st) => st.get(KEY));
    if (v) return v;
  } catch {
    // fall through
  }
  try {
    return window.localStorage.getItem('annals-save');
  } catch {
    return null;
  }
}

export async function hasLocal() {
  try {
    const v = await tx('readonly', (st) => st.count(KEY));
    if (v) return true;
  } catch {
    // fall through
  }
  try {
    return !!window.localStorage.getItem('annals-save');
  } catch {
    return false;
  }
}
