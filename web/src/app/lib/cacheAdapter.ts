type CacheRecord<T> = {
  value: T;
  timestamp: number;
  signature?: string;
};

type CacheBucket = 'questions' | 'weakness' | 'stats' | 'learning-state';

const DB_NAME = 'aiweb-cache-db';
const DB_VERSION = 1;
const STORE_NAME = 'cache_entries';

const memoryPersistentCache = new Map<string, CacheRecord<unknown>>();

function isClient() {
  return typeof window !== 'undefined';
}

function toStorageKey(bucket: CacheBucket, key: string) {
  return `${bucket}:${key}`;
}

async function openCacheDb() {
  if (!isClient() || !window.indexedDB) return null;
  return new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export const persistentCacheAdapter = {
  async get<T>(bucket: CacheBucket, key: string): Promise<CacheRecord<T> | null> {
    const cacheKey = toStorageKey(bucket, key);
    const memory = memoryPersistentCache.get(cacheKey);
    if (memory) return memory as CacheRecord<T>;
    const db = await openCacheDb();
    if (!db) return null;
    return new Promise<CacheRecord<T> | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(cacheKey);
        request.onsuccess = () => {
          const row = request.result as { id: string; entry: CacheRecord<T> } | undefined;
          if (!row?.entry) {
            resolve(null);
            return;
          }
          memoryPersistentCache.set(cacheKey, row.entry as CacheRecord<unknown>);
          resolve(row.entry);
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  },
  async set<T>(bucket: CacheBucket, key: string, entry: CacheRecord<T>): Promise<void> {
    const cacheKey = toStorageKey(bucket, key);
    memoryPersistentCache.set(cacheKey, entry as CacheRecord<unknown>);
    const db = await openCacheDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ id: cacheKey, entry });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },
  async remove(bucket: CacheBucket, key: string): Promise<void> {
    const cacheKey = toStorageKey(bucket, key);
    memoryPersistentCache.delete(cacheKey);
    const db = await openCacheDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(cacheKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },
  clearMemory() {
    memoryPersistentCache.clear();
  },
};
