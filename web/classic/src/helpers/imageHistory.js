/*
Copyright (C) 2025 QuantumNous

AI 画室生成历史的 IndexedDB 持久化封装。
- 库名：quantum-image-studio
- 表名：history（keyPath: id, 索引：userId, ts）
- 单用户上限：DEFAULT_LIMIT 条，超出按 ts 升序 FIFO 淘汰
- 浏览器不支持 IndexedDB / 隐私模式时所有方法静默 no-op
*/

const DB_NAME = 'quantum-image-studio';
const DB_VERSION = 1;
const STORE = 'history';
export const DEFAULT_LIMIT = 100;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  if (typeof indexedDB === 'undefined') {
    _dbPromise = Promise.reject(new Error('indexedDB unavailable'));
    return _dbPromise;
  }
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('ts', 'ts', { unique: false });
        store.createIndex('userId_ts', ['userId', 'ts'], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode = 'readonly') {
  return openDB().then((db) => {
    const t = db.transaction(STORE, mode);
    return { store: t.objectStore(STORE), tx: t };
  });
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uidOf(userId) {
  return userId == null ? 0 : Number(userId);
}

export async function loadHistory(userId, limit = DEFAULT_LIMIT) {
  try {
    const { store } = await tx('readonly');
    const idx = store.index('userId_ts');
    const range = IDBKeyRange.bound([uidOf(userId), -Infinity], [uidOf(userId), Infinity]);
    const items = [];
    return await new Promise((resolve) => {
      const cursorReq = idx.openCursor(range, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || items.length >= limit) {
          resolve(items);
          return;
        }
        items.push(cursor.value);
        cursor.continue();
      };
      cursorReq.onerror = () => resolve(items);
    });
  } catch (e) {
    return [];
  }
}

export async function saveItems(userId, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  try {
    const { store, tx: t } = await tx('readwrite');
    items.forEach((it) => {
      store.put({ ...it, userId: uidOf(userId) });
    });
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    await trimHistory(userId);
  } catch (e) {}
}

export async function updateCost(userId, batchId, cost) {
  try {
    const { store, tx: t } = await tx('readwrite');
    const idx = store.index('userId_ts');
    const range = IDBKeyRange.bound([uidOf(userId), -Infinity], [uidOf(userId), Infinity]);
    await new Promise((resolve) => {
      const cursorReq = idx.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        if (cursor.value.batchId === batchId) {
          cursor.update({ ...cursor.value, cost });
        }
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
    });
    await new Promise((resolve) => {
      t.oncomplete = resolve;
      t.onerror = resolve;
      t.onabort = resolve;
    });
  } catch (e) {}
}

export async function deleteItem(userId, id) {
  try {
    const { store, tx: t } = await tx('readwrite');
    store.delete(id);
    await new Promise((resolve) => {
      t.oncomplete = resolve;
      t.onerror = resolve;
    });
  } catch (e) {}
}

export async function clearHistory(userId) {
  try {
    const { store, tx: t } = await tx('readwrite');
    const idx = store.index('userId');
    const range = IDBKeyRange.only(uidOf(userId));
    await new Promise((resolve) => {
      const cursorReq = idx.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
    });
    await new Promise((resolve) => {
      t.oncomplete = resolve;
      t.onerror = resolve;
    });
  } catch (e) {}
}

async function trimHistory(userId, limit = DEFAULT_LIMIT) {
  try {
    const { store, tx: t } = await tx('readwrite');
    const idx = store.index('userId_ts');
    const range = IDBKeyRange.bound([uidOf(userId), -Infinity], [uidOf(userId), Infinity]);
    const allKeys = [];
    await new Promise((resolve) => {
      const cursorReq = idx.openCursor(range, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        allKeys.push(cursor.primaryKey);
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
    });
    if (allKeys.length > limit) {
      allKeys.slice(limit).forEach((k) => store.delete(k));
    }
    await new Promise((resolve) => {
      t.oncomplete = resolve;
      t.onerror = resolve;
    });
  } catch (e) {}
}
