// Read-only connection to Dulcería, scoped to the current browser origin.
export function readDulceria() {
  return new Promise((resolve, reject) => {
    let absent = false;
    const request = indexedDB.open('dulceria-local-v1');
    request.onupgradeneeded = () => {
      absent = true;
      request.transaction.abort();
    };
    request.onerror = () =>
      absent
        ? resolve({ found: false, withdrawals: [] })
        : reject(request.error || Error('No se pudo leer Dulcería.'));
    request.onblocked = () =>
      reject(Error('Cierra otras pestañas de Dulcería y vuelve a intentar.'));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('data')) {
        db.close();
        reject(Error('La base de Dulcería no tiene el formato esperado.'));
        return;
      }
      const tx = db.transaction('data', 'readonly'),
        r = tx.objectStore('data').get('main');
      let result;
      r.onsuccess = () => {
        const data = r.result;
        if (data && data.schema !== 1) {
          tx.abort();
          return;
        }
        result = { found: !!data, withdrawals: data?.finance?.withdrawals || [] };
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result || { found: false, withdrawals: [] });
      };
      tx.onabort = () => {
        db.close();
        reject(Error('No se pudo leer una versión compatible de Dulcería.'));
      };
      tx.onerror = () => {};
    };
  });
}
