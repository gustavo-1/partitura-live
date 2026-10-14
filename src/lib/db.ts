/** IndexedDB mínimo (músicas importadas podem ser grandes demais para o localStorage). */
const DB_NAME = 'partitura-live';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const idb = {
  get: <T>(store: string, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  all: <T>(store: string) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  put: <T>(store: string, value: T) => tx<IDBValidKey>(store, 'readwrite', (s) => s.put(value)),
  del: (store: string, key: string) => tx<undefined>(store, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>),
};
