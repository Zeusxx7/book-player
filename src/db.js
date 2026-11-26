const DB_NAME = 'lectio-audiobooks';
const DB_VERSION = 1;

let dbPromise = null;
let activeDb = null;

function dispatchDbEvent(name) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(name));
  }
}

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      dbPromise = null;
      reject(new Error('IndexedDB is unavailable in this browser context.'));
      return;
    }

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      dbPromise = null;
      reject(err);
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('books')) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('by_lastPlayedAt', 'lastPlayedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('tracks')) {
        const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
        tracks.createIndex('by_bookId', 'bookId', { unique: false });
      }

      if (!db.objectStoreNames.contains('audioBlobs')) {
        const audioBlobs = db.createObjectStore('audioBlobs', { keyPath: 'trackId' });
        audioBlobs.createIndex('by_bookId', 'bookId', { unique: false });
      }

      if (!db.objectStoreNames.contains('bookmarks')) {
        const bookmarks = db.createObjectStore('bookmarks', { keyPath: 'id' });
        bookmarks.createIndex('by_bookId', 'bookId', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onblocked = () => {
      dbPromise = null;
      dispatchDbEvent('lectio:db-blocked');
      reject(new Error('Database upgrade is blocked by another open tab.'));
    };

    request.onsuccess = () => {
      const db = request.result;
      activeDb = db;
      db.onversionchange = () => {
        db.close();
        if (activeDb === db) activeDb = null;
        dbPromise = null;
        dispatchDbEvent('lectio:db-versionchange');
      };
      db.onclose = () => {
        if (activeDb === db) activeDb = null;
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('Failed to open IndexedDB.'));
    };
  });

  return dbPromise;
}

export function closeDB() {
  if (activeDb) {
    try {
      activeDb.close();
    } catch {
      // Ignore close errors
    }
    activeDb = null;
  }
  dbPromise = null;
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export async function getAllBooks() {
  const db = await openDB();
  const tx = db.transaction('books', 'readonly');
  const all = await reqToPromise(tx.objectStore('books').getAll());
  return all.sort((a, b) => (b.lastPlayedAt || b.createdAt || 0) - (a.lastPlayedAt || a.createdAt || 0));
}

export async function getBook(id) {
  const db = await openDB();
  const tx = db.transaction('books', 'readonly');
  return reqToPromise(tx.objectStore('books').get(id));
}

export async function putBook(book) {
  const db = await openDB();
  const tx = db.transaction('books', 'readwrite');
  tx.objectStore('books').put(book);
  await txDone(tx);
  return book;
}

export async function updateBook(id, patch) {
  const db = await openDB();
  const tx = db.transaction('books', 'readwrite');
  const store = tx.objectStore('books');
  const existing = await reqToPromise(store.get(id));
  if (!existing) return null;
  const updated = { ...existing, ...patch, updatedAt: Date.now() };
  store.put(updated);
  await txDone(tx);
  return updated;
}

export async function deleteBook(id) {
  const db = await openDB();
  const tx = db.transaction(['books', 'tracks', 'audioBlobs', 'bookmarks'], 'readwrite');

  tx.objectStore('books').delete(id);

  for (const storeName of ['tracks', 'audioBlobs', 'bookmarks']) {
    const store = tx.objectStore(storeName);
    const index = store.index('by_bookId');
    const keys = await reqToPromise(index.getAllKeys(id));
    for (const key of keys) {
      store.delete(key);
    }
  }

  await txDone(tx);
}

export async function getTracksForBook(bookId) {
  const db = await openDB();
  const tx = db.transaction('tracks', 'readonly');
  const index = tx.objectStore('tracks').index('by_bookId');
  const tracks = await reqToPromise(index.getAll(bookId));
  return tracks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function putTracksWithBlobs(tracks, blobs) {
  const db = await openDB();
  // Batch writes in chunks of 10 tracks to keep IndexedDB responsive for large textbooks
  const CHUNK_SIZE = 10;
  for (let i = 0; i < tracks.length; i += CHUNK_SIZE) {
    const trackSlice = tracks.slice(i, i + CHUNK_SIZE);
    const blobSlice = blobs.slice(i, i + CHUNK_SIZE);
    const tx = db.transaction(['tracks', 'audioBlobs'], 'readwrite');
    const trackStore = tx.objectStore('tracks');
    const blobStore = tx.objectStore('audioBlobs');

    for (const track of trackSlice) {
      trackStore.put(track);
    }
    for (const entry of blobSlice) {
      blobStore.put(entry);
    }
    await txDone(tx);
  }
}

export async function updateTrack(id, patch) {
  const db = await openDB();
  const tx = db.transaction('tracks', 'readwrite');
  const store = tx.objectStore('tracks');
  const existing = await reqToPromise(store.get(id));
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  store.put(updated);
  await txDone(tx);
  return updated;
}

export async function deleteTrack(id) {
  const db = await openDB();
  const tx = db.transaction(['tracks', 'audioBlobs'], 'readwrite');
  tx.objectStore('tracks').delete(id);
  tx.objectStore('audioBlobs').delete(id);
  await txDone(tx);
}

export async function getAudioBlob(trackId) {
  const db = await openDB();
  const tx = db.transaction('audioBlobs', 'readonly');
  const record = await reqToPromise(tx.objectStore('audioBlobs').get(trackId));
  return record?.blob || null;
}

export async function getBookmarksForBook(bookId) {
  const db = await openDB();
  const tx = db.transaction('bookmarks', 'readonly');
  const index = tx.objectStore('bookmarks').index('by_bookId');
  return reqToPromise(index.getAll(bookId));
}

export async function getAllBookmarks() {
  const db = await openDB();
  const tx = db.transaction('bookmarks', 'readonly');
  return reqToPromise(tx.objectStore('bookmarks').getAll());
}

export async function putBookmark(bookmark) {
  const db = await openDB();
  const tx = db.transaction('bookmarks', 'readwrite');
  tx.objectStore('bookmarks').put(bookmark);
  await txDone(tx);
  return bookmark;
}

export async function deleteBookmark(id) {
  const db = await openDB();
  const tx = db.transaction('bookmarks', 'readwrite');
  tx.objectStore('bookmarks').delete(id);
  await txDone(tx);
}

export async function getSetting(key, defaultValue = undefined) {
  const db = await openDB();
  const tx = db.transaction('settings', 'readonly');
  const row = await reqToPromise(tx.objectStore('settings').get(key));
  return row ? row.value : defaultValue;
}

export async function setSetting(key, value) {
  const db = await openDB();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value });
  await txDone(tx);
  return value;
}

export async function getAllSettings() {
  const db = await openDB();
  const tx = db.transaction('settings', 'readonly');
  const rows = await reqToPromise(tx.objectStore('settings').getAll());
  const out = {};
  for (const row of rows) {
    out[row.key] = row.value;
  }
  return out;
}

export async function getStorageEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null;
  }
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

export async function isStoragePersisted() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) {
    return null;
  }
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

export async function requestPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return null;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
