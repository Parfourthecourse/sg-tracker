// Local-first storage on the phone: IndexedDB with a tiny promise wrapper.
// Rounds are stored as whole documents { id, ..., holes, conditions, shots, dirty }.

const DB_NAME = 'sg-tracker';
const DB_VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rounds')) db.createObjectStore('rounds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('courses')) db.createObjectStore('courses', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : r);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const store = {
  async getRound(id) { return tx('rounds', 'readonly', (s) => s.get(id)); },
  async allRounds() {
    const rows = await tx('rounds', 'readonly', (s) => s.getAll());
    return rows.sort((a, b) => (b.played_on + b.created_at).localeCompare(a.played_on + a.created_at));
  },
  async putRound(r) { return tx('rounds', 'readwrite', (s) => s.put(r)); },
  async deleteRound(id) { return tx('rounds', 'readwrite', (s) => s.delete(id)); },
  async allCourses() { return tx('courses', 'readonly', (s) => s.getAll()); },
  async putCourse(c) { return tx('courses', 'readwrite', (s) => s.put(c)); },
  async get(key) { return tx('kv', 'readonly', (s) => s.get(key)); },
  async set(key, value) { return tx('kv', 'readwrite', (s) => s.put(value, key)); },
  async clearAll() {
    for (const name of ['rounds', 'courses', 'kv']) await tx(name, 'readwrite', (s) => s.clear());
  },
};

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));
