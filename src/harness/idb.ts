/**
 * Tiny promise wrapper over IndexedDB for the host simulator's persistence.
 * One database, two stores:
 *  - `files`: the session's file bytes, keyed by relative name (the
 *    {@link IndexedDbAdapter} store). Persists writes across page refresh.
 *  - `meta`: harness bookkeeping — the connected-folder `FileSystemDirectoryHandle`
 *    (structured-clone-storable) and the "sample already seeded" flag.
 *
 * Everything degrades gracefully where IndexedDB is absent (node/happy-dom tests):
 * {@link openHarnessDb} rejects and callers fall back to a non-persistent path.
 */

const DB_NAME = "saymore-harness";
const DB_VERSION = 1;
export const FILES_STORE = "files";
export const META_STORE = "meta";

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise: Promise<IDBDatabase> | undefined;

export function openHarnessDb(): Promise<IDBDatabase> {
  if (!idbAvailable()) return Promise.reject(new Error("IndexedDB is not available."));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Run `fn` against a fresh transaction on `store`, resolving when it completes. */
export async function idbTx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (os: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  const db = await openHarnessDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    let result: T | undefined;
    const req = fn(os);
    if (req) req.onsuccess = () => (result = req.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openHarnessDb();
  const tx = db.transaction(store, "readonly");
  return promisifyRequest(tx.objectStore(store).get(key) as IDBRequest<T>);
}

export async function idbGetAllKeys(store: string): Promise<string[]> {
  const db = await openHarnessDb();
  const tx = db.transaction(store, "readonly");
  const keys = await promisifyRequest(tx.objectStore(store).getAllKeys());
  return (keys as IDBValidKey[]).map(String);
}

export async function idbPut(store: string, key: IDBValidKey, value: unknown): Promise<void> {
  await idbTx(store, "readwrite", (os) => os.put(value, key) as IDBRequest<IDBValidKey>);
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  await idbTx(store, "readwrite", (os) => os.delete(key) as IDBRequest<undefined>);
}

export async function idbClear(store: string): Promise<void> {
  await idbTx(store, "readwrite", (os) => os.clear() as IDBRequest<undefined>);
}
