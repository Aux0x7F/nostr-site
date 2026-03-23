import {
  createIndexedRuntimeDatabase
} from "./runtime-db.js";

const PUBLIC_EVENTS_META_KEY = "nostr-cms/public-events";
const PUBLIC_STATE_SNAPSHOT_META_KEY = "nostr-cms/public-state-snapshot";

export function createCmsCacheStorage({
  namespace = "nostr-site",
  database = createIndexedRuntimeDatabase({ namespace }),
  legacyStorage = globalThis?.localStorage || null
} = {}) {
  let cachedPublicEvents = [];
  let cachedPublicStateSnapshot = null;
  let hydratePromise = null;

  function publicEventCacheKey() {
    return `${String(namespace || "nostr-site").trim()}.public-event-cache`;
  }

  function publicStateSnapshotKey() {
    return `${String(namespace || "nostr-site").trim()}.public-state-snapshot`;
  }

  async function hydrate() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      const [eventRecord, snapshotRecord] = await Promise.all([
        database.getMeta(PUBLIC_EVENTS_META_KEY).catch(() => null),
        database.getMeta(PUBLIC_STATE_SNAPSHOT_META_KEY).catch(() => null)
      ]);

      if (!cachedPublicEvents.length) {
        cachedPublicEvents = Array.isArray(eventRecord?.events)
          ? cloneRecord(eventRecord.events) || []
          : [];
      }
      if (!cachedPublicStateSnapshot) {
        cachedPublicStateSnapshot = cloneRecord(snapshotRecord?.value);
      }

      if (!cachedPublicEvents.length) {
        const migratedEvents = readLegacyJson(legacyStorage, publicEventCacheKey(), []);
        if (Array.isArray(migratedEvents) && migratedEvents.length) {
          cachedPublicEvents = cloneRecord(migratedEvents) || [];
          void database.setMeta(PUBLIC_EVENTS_META_KEY, {
            events: cloneRecord(cachedPublicEvents),
            updatedAt: Date.now(),
            source: "legacy-migration"
          }).catch(() => null);
          removeLegacyValue(legacyStorage, publicEventCacheKey());
        }
      }

      if (!cachedPublicStateSnapshot) {
        const migratedSnapshot = readLegacyJson(legacyStorage, publicStateSnapshotKey(), null);
        if (migratedSnapshot && typeof migratedSnapshot === "object") {
          cachedPublicStateSnapshot = cloneRecord(migratedSnapshot);
          void database.setMeta(PUBLIC_STATE_SNAPSHOT_META_KEY, {
            value: cloneRecord(cachedPublicStateSnapshot),
            updatedAt: Date.now(),
            source: "legacy-migration"
          }).catch(() => null);
          removeLegacyValue(legacyStorage, publicStateSnapshotKey());
        }
      }
    })().finally(() => {
      hydratePromise = null;
    });
    return hydratePromise;
  }

  function getCachedPublicEvents() {
    return cloneRecord(cachedPublicEvents) || [];
  }

  function getCachedPublicStateSnapshot() {
    return cloneRecord(cachedPublicStateSnapshot);
  }

  function persistCachedPublicEvents(events) {
    cachedPublicEvents = Array.isArray(events) ? cloneRecord(events) || [] : [];
    void database.setMeta(PUBLIC_EVENTS_META_KEY, {
      events: cloneRecord(cachedPublicEvents),
      updatedAt: Date.now()
    }).catch(() => null);
    return getCachedPublicEvents();
  }

  function persistCachedPublicStateSnapshot(publicState) {
    cachedPublicStateSnapshot = publicState && typeof publicState === "object"
      ? cloneRecord(publicState)
      : null;
    if (cachedPublicStateSnapshot) {
      void database.setMeta(PUBLIC_STATE_SNAPSHOT_META_KEY, {
        value: cloneRecord(cachedPublicStateSnapshot),
        updatedAt: Date.now()
      }).catch(() => null);
    } else {
      void database.deleteMeta(PUBLIC_STATE_SNAPSHOT_META_KEY).catch(() => null);
    }
    return getCachedPublicStateSnapshot();
  }

  return {
    hydrate,
    getCachedPublicEvents,
    getCachedPublicStateSnapshot,
    persistCachedPublicEvents,
    persistCachedPublicStateSnapshot
  };
}

function readLegacyJson(storage, key, fallback) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return cloneRecord(fallback);
    return JSON.parse(raw);
  } catch {
    return cloneRecord(fallback);
  }
}

function removeLegacyValue(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    return;
  }
}

function cloneRecord(value) {
  if (value === null || value === undefined) return null;
  return typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export default createCmsCacheStorage;
