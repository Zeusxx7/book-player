export function installBrowserMocks() {
  const databases = new Map();

  function makeReq() {
    return {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null,
    };
  }

  function createDatabaseState(name) {
    return {
      name,
      version: 0,
      stores: new Map(),
      connections: new Set(),
    };
  }

  class MockObjectStore {
    constructor(storeDef, tx) {
      this._def = storeDef;
      this._tx = tx;
    }

    createIndex(name, keyPath) {
      this._def.indexes.set(name, { name, keyPath });
      return { name, keyPath };
    }

    index(name) {
      const idxDef = this._def.indexes.get(name);
      if (!idxDef) throw new Error(`Index ${name} not found`);
      const store = this;
      return {
        getAll(query) {
          const req = makeReq();
          queueMicrotask(() => {
            const out = [];
            for (const val of store._def.rows.values()) {
              if (query === undefined || val[idxDef.keyPath] === query) {
                out.push(val);
              }
            }
            req.result = out;
            req.onsuccess?.({ target: req });
          });
          return req;
        },
        getAllKeys(query) {
          const req = makeReq();
          queueMicrotask(() => {
            const out = [];
            for (const [k, val] of store._def.rows.entries()) {
              if (query === undefined || val[idxDef.keyPath] === query) {
                out.push(k);
              }
            }
            req.result = out;
            req.onsuccess?.({ target: req });
          });
          return req;
        },
      };
    }

    put(value) {
      const req = makeReq();
      const key = value[this._def.keyPath];
      this._def.rows.set(key, value);
      queueMicrotask(() => {
        req.result = key;
        req.onsuccess?.({ target: req });
      });
      return req;
    }

    get(key) {
      const req = makeReq();
      queueMicrotask(() => {
        req.result = this._def.rows.get(key);
        req.onsuccess?.({ target: req });
      });
      return req;
    }

    getAll() {
      const req = makeReq();
      queueMicrotask(() => {
        req.result = Array.from(this._def.rows.values());
        req.onsuccess?.({ target: req });
      });
      return req;
    }

    delete(key) {
      const req = makeReq();
      this._def.rows.delete(key);
      queueMicrotask(() => {
        req.result = undefined;
        req.onsuccess?.({ target: req });
      });
      return req;
    }
  }

  class MockTransaction {
    constructor(dbState) {
      this._dbState = dbState;
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
      this.error = null;
      setTimeout(() => {
        this.oncomplete?.();
      }, 0);
    }

    objectStore(name) {
      const def = this._dbState.stores.get(name);
      if (!def) throw new Error(`ObjectStore ${name} not found`);
      return new MockObjectStore(def, this);
    }
  }

  class MockDBConnection {
    constructor(dbState) {
      this._state = dbState;
      this.onversionchange = null;
      this.onclose = null;
      this.closed = false;
      this.objectStoreNames = {
        contains: (name) => this._state.stores.has(name),
      };
    }

    createObjectStore(name, { keyPath }) {
      const def = { name, keyPath, rows: new Map(), indexes: new Map() };
      this._state.stores.set(name, def);
      return new MockObjectStore(def, null);
    }

    transaction() {
      return new MockTransaction(this._state);
    }

    close() {
      this.closed = true;
      this._state.connections.delete(this);
      this.onclose?.();
    }
  }

  const fakeIndexedDB = {
    open(name, version = 1) {
      const req = makeReq();
      queueMicrotask(() => {
        let dbState = databases.get(name);
        if (!dbState) {
          dbState = createDatabaseState(name);
          databases.set(name, dbState);
        }

        if (version > dbState.version && dbState.connections.size > 0) {
          for (const existingConn of Array.from(dbState.connections)) {
            existingConn.onversionchange?.({ oldVersion: dbState.version, newVersion: version });
          }
        }

        const conn = new MockDBConnection(dbState);
        dbState.connections.add(conn);
        req.result = conn;

        if (version > dbState.version) {
          dbState.version = version;
          req.onupgradeneeded?.({ target: req });
        }

        req.onsuccess?.({ target: req });
      });
      return req;
    },
    _reset() {
      databases.clear();
    },
    _triggerVersionChange(name, newVersion = 2) {
      const dbState = databases.get(name);
      if (!dbState) return;
      for (const conn of Array.from(dbState.connections)) {
        conn.onversionchange?.({ oldVersion: dbState.version, newVersion });
      }
    },
  };

  class FakeAudio extends EventTarget {
    constructor() {
      super();
      this.preload = 'metadata';
      this._src = '';
      this.currentTime = 0;
      this.duration = 120;
      this.playbackRate = 1;
      this.defaultPlaybackRate = 1;
      this.preservesPitch = true;
      this.volume = 1;
      this.muted = false;
      this.paused = true;
      this.error = null;
      FakeAudio.instances.push(this);
    }

    get src() {
      return this._src;
    }

    set src(val) {
      this._src = val;
    }

    removeAttribute(attr) {
      if (attr === 'src') this._src = '';
    }

    load() {
      queueMicrotask(() => {
        if (this._src) {
          this.dispatchEvent(new Event('loadedmetadata'));
        }
      });
    }

    async play() {
      this.paused = false;
      this.dispatchEvent(new Event('play'));
    }

    pause() {
      if (!this.paused) {
        this.paused = true;
        this.dispatchEvent(new Event('pause'));
      }
    }

    _emitTimeUpdate(t) {
      this.currentTime = t;
      this.dispatchEvent(new Event('timeupdate'));
    }

    _emitEnded() {
      this.paused = true;
      this.dispatchEvent(new Event('ended'));
    }
  }
  FakeAudio.instances = [];

  const createdUrls = new Set();
  const revokedUrls = new Set();
  let urlSeq = 0;

  globalThis.indexedDB = fakeIndexedDB;
  globalThis.Audio = FakeAudio;
  globalThis.MediaMetadata = class MediaMetadata {
    constructor(init) {
      Object.assign(this, init);
    }
  };
  const mediaSessionStub = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: () => {},
    setPositionState: () => {},
  };
  Object.defineProperty(globalThis.navigator, 'mediaSession', {
    value: mediaSessionStub,
    configurable: true,
  });

  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => {
    const u = `blob:mock-${++urlSeq}`;
    createdUrls.add(u);
    return u;
  };
  URL.revokeObjectURL = (u) => {
    revokedUrls.add(u);
  };

  return {
    fakeIndexedDB,
    FakeAudio,
    createdUrls,
    revokedUrls,
    restore() {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    },
  };
}
