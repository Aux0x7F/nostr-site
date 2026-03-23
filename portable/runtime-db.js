const META_STORE = "meta";
const PROJECTION_STORE = "projections";
const DOCUMENT_STORE = "documents";

export function stableSerializeValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableSerializeValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stableSerializeValue(value[key])])
    );
  }
  return value ?? null;
}

export function stableSerializeKey(value) {
  return JSON.stringify(stableSerializeValue(value));
}

export function projectionCacheKey(channel = "", params = {}) {
  return `${String(channel || "").trim()}:${stableSerializeKey(params || {})}`;
}

export function createMemoryRuntimeDatabase() {
  const meta = new Map();
  const projections = new Map();
  const documents = new Map();

  return {
    async getMeta(key = "") {
      return cloneRecord(meta.get(String(key || "").trim()) ?? null);
    },
    async setMeta(key = "", value = null) {
      meta.set(String(key || "").trim(), cloneRecord(value));
      return cloneRecord(value);
    },
    async deleteMeta(key = "") {
      meta.delete(String(key || "").trim());
    },
    async getProjection(channel = "", params = {}) {
      return cloneRecord(projections.get(projectionCacheKey(channel, params)) ?? null);
    },
    async setProjection(channel = "", params = {}, value = null) {
      projections.set(projectionCacheKey(channel, params), cloneRecord(value));
      return cloneRecord(value);
    },
    async deleteProjection(channel = "", params = {}) {
      projections.delete(projectionCacheKey(channel, params));
    },
    async getDocument(docId = "") {
      return cloneRecord(documents.get(String(docId || "").trim()) ?? null);
    },
    async setDocument(docId = "", value = null) {
      documents.set(String(docId || "").trim(), cloneRecord(value));
      return cloneRecord(value);
    },
    async deleteDocument(docId = "") {
      documents.delete(String(docId || "").trim());
    },
    async listDocuments(prefix = "") {
      const cleanPrefix = String(prefix || "").trim();
      return [...documents.entries()]
        .filter(([key]) => !cleanPrefix || key.startsWith(cleanPrefix))
        .map(([key, value]) => ({
          key,
          value: cloneRecord(value)
        }));
    }
  };
}

export function createIndexedRuntimeDatabase({
  namespace = "nostr-site",
  indexedDbFactory = globalThis.indexedDB
} = {}) {
  if (!indexedDbFactory?.open) {
    return createMemoryRuntimeDatabase();
  }

  const databaseName = `${String(namespace || "nostr-site").trim()}.runtime`;
  let openPromise = null;

  async function getDatabase() {
    if (!openPromise) {
      openPromise = openIndexedDb(indexedDbFactory, databaseName, 1, (database) => {
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE);
        }
        if (!database.objectStoreNames.contains(PROJECTION_STORE)) {
          database.createObjectStore(PROJECTION_STORE);
        }
        if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
          database.createObjectStore(DOCUMENT_STORE);
        }
      });
    }
    return openPromise;
  }

  async function read(storeName, key) {
    const database = await getDatabase();
    return cloneRecord(await requestPromise(database.transaction(storeName, "readonly").objectStore(storeName).get(key)));
  }

  async function write(storeName, key, value) {
    const database = await getDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(cloneRecord(value), key);
    await transactionDone(transaction);
    return cloneRecord(value);
  }

  async function remove(storeName, key) {
    const database = await getDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }

  async function listDocuments(prefix = "") {
    const cleanPrefix = String(prefix || "").trim();
    const database = await getDatabase();
    const transaction = database.transaction(DOCUMENT_STORE, "readonly");
    const store = transaction.objectStore(DOCUMENT_STORE);
    const entries = [];
    await iterateStore(store, (key, value) => {
      if (!cleanPrefix || String(key || "").startsWith(cleanPrefix)) {
        entries.push({
          key: String(key || ""),
          value: cloneRecord(value)
        });
      }
    });
    await transactionDone(transaction);
    return entries;
  }

  return {
    async getMeta(key = "") {
      return read(META_STORE, String(key || "").trim());
    },
    async setMeta(key = "", value = null) {
      return write(META_STORE, String(key || "").trim(), value);
    },
    async deleteMeta(key = "") {
      await remove(META_STORE, String(key || "").trim());
    },
    async getProjection(channel = "", params = {}) {
      return read(PROJECTION_STORE, projectionCacheKey(channel, params));
    },
    async setProjection(channel = "", params = {}, value = null) {
      return write(PROJECTION_STORE, projectionCacheKey(channel, params), value);
    },
    async deleteProjection(channel = "", params = {}) {
      await remove(PROJECTION_STORE, projectionCacheKey(channel, params));
    },
    async getDocument(docId = "") {
      return read(DOCUMENT_STORE, String(docId || "").trim());
    },
    async setDocument(docId = "", value = null) {
      return write(DOCUMENT_STORE, String(docId || "").trim(), value);
    },
    async deleteDocument(docId = "") {
      await remove(DOCUMENT_STORE, String(docId || "").trim());
    },
    listDocuments
  };
}

function cloneRecord(value) {
  if (value === null || value === undefined) return null;
  return structuredCloneSafe(value);
}

function structuredCloneSafe(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function openIndexedDb(indexedDbFactory, name, version, onUpgradeNeeded) {
  return new Promise((resolve, reject) => {
    const request = indexedDbFactory.open(name, version);
    request.onupgradeneeded = () => onUpgradeNeeded(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`Could not open IndexedDB database ${name}.`));
  });
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

function iterateStore(store, onEntry) {
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error || new Error("IndexedDB cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      onEntry(cursor.key, cursor.value);
      cursor.continue();
    };
  });
}

export default {
  createIndexedRuntimeDatabase,
  createMemoryRuntimeDatabase,
  projectionCacheKey,
  stableSerializeKey,
  stableSerializeValue
};
