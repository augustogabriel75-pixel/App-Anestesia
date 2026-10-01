/* =====================================================================
   Store – persistência local offline-first
   - IndexedDB (banco "vetanest", object store "kv") como armazenamento principal;
   - localStorage como fallback quando o IndexedDB não está disponível;
   - "journal" síncrono em localStorage com a ficha em edição: gravado a cada
     alteração, garante que nada se perca se o app for fechado/morto antes de
     a gravação assíncrona do IndexedDB terminar (ex.: durante a cirurgia).
   ===================================================================== */
window.Store = (() => {
  let db = null;
  const LSP = 'vetanest.kv.';

  const lsGet = (k, d) => { try { const v = localStorage.getItem(LSP + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(LSP + k, JSON.stringify(v)); return true; } catch { return false; } };

  function open() {
    return new Promise(res => {
      try {
        if (!('indexedDB' in window)) return res(null);
        const rq = indexedDB.open('vetanest', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
        rq.onblocked = () => res(null);
      } catch { res(null); }
    });
  }

  async function init() { db = await open(); return !!db; }

  function get(key, def) {
    if (!db) return Promise.resolve(lsGet(key, def));
    return new Promise(res => {
      try {
        const rq = db.transaction('kv').objectStore('kv').get(key);
        rq.onsuccess = () => res(rq.result === undefined ? def : rq.result);
        rq.onerror = () => res(lsGet(key, def));
      } catch { res(lsGet(key, def)); }
    });
  }

  function set(key, val) {
    if (!db) return Promise.resolve(lsSet(key, val));
    return new Promise(res => {
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => res(true);
        tx.onerror = tx.onabort = () => res(lsSet(key, val));
      } catch { res(lsSet(key, val)); }
    });
  }

  function del(key) {
    try { localStorage.removeItem(LSP + key); } catch {}
    if (!db) return Promise.resolve(true);
    return new Promise(res => { try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch { res(false); } });
  }

  // Journal síncrono (localStorage) – somente a ficha em edição.
  const JK = 'vetanest.journal';
  const journal = {
    write(userId, ficha) { try { localStorage.setItem(JK, JSON.stringify({ userId, ficha })); } catch {} },
    read() { try { return JSON.parse(localStorage.getItem(JK) || 'null'); } catch { return null; } },
    clear() { try { localStorage.removeItem(JK); } catch {} },
  };

  return { init, get, set, del, journal, usingIDB: () => !!db };
})();
