import { empty, validate } from './domain.js';
let opening;
async function open() {
  if (!opening)
    opening = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(
          Error('Este navegador no permite almacenamiento local. Usa Chrome fuera de incógnito.')
        );
        return;
      }
      const r = indexedDB.open('economia-local-v1', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('data');
      r.onerror = () => {
        opening = null;
        reject(r.error);
      };
      r.onblocked = () => reject(Error('Cierra otras pestañas de Economía e inténtalo de nuevo.'));
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          opening = null;
        };
        resolve(r.result);
      };
    });
  return opening;
}
export async function transact(change, { capture = false } = {}) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', change ? 'readwrite' : 'readonly'),
      store = tx.objectStore('data'),
      r = store.get('main');
    let next, cause;
    r.onsuccess = () => {
      try {
        const before = r.result || empty();
        next = change ? validate(change(structuredClone(before))) : before;
        if (change) {
          if (capture) store.put(before, 'beforeRestore');
          store.put(next, 'main');
        }
      } catch (e) {
        cause = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = () =>
      reject(cause || tx.error || Error('No se pudo guardar. Revisa el espacio disponible.'));
    tx.onerror = () => {};
  });
}
export async function readRecovery() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction('data', 'readonly').objectStore('data').get('beforeRestore');
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}
