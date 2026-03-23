import {
  createIndexedRuntimeDatabase
} from "./runtime-db.js";

const SESSION_META_KEY = "session/current";
const GUEST_SESSION_META_KEY = "session/guest";

export function createPersistentSessionStore({
  namespace = "nostr-site",
  database = createIndexedRuntimeDatabase({ namespace }),
  legacyStorage = globalThis?.localStorage || null
} = {}) {
  let sessionCache = readLegacySession(legacyStorage, sessionStorageKey());
  let guestSessionCache = readLegacyGuestSession(legacyStorage, guestStorageKey());
  let hydratePromise = null;

  function sessionStorageKey() {
    return `${String(namespace || "nostr-site").trim()}.session`;
  }

  function guestStorageKey() {
    return `${String(namespace || "nostr-site").trim()}.guest`;
  }

  async function hydrate() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      const [storedSessionRecord, storedGuestRecord] = await Promise.all([
        database.getMeta(SESSION_META_KEY).catch(() => null),
        database.getMeta(GUEST_SESSION_META_KEY).catch(() => null)
      ]);

      if (!sessionCache) {
        sessionCache = normalizeStoredSession(storedSessionRecord?.session);
      } else if (storedSessionRecord?.session) {
        sessionCache = normalizeStoredSession(storedSessionRecord?.session);
      }
      if (!guestSessionCache) {
        guestSessionCache = normalizeStoredGuestSession(storedGuestRecord?.session);
      } else if (storedGuestRecord?.session) {
        guestSessionCache = normalizeStoredGuestSession(storedGuestRecord?.session);
      }

      if (!sessionCache) {
        const migratedSession = readLegacySession(legacyStorage, sessionStorageKey());
        if (migratedSession) {
          sessionCache = migratedSession;
          void database.setMeta(SESSION_META_KEY, {
            session: cloneRecord(migratedSession),
            updatedAt: Date.now(),
            source: "legacy-migration"
          }).catch(() => null);
          removeLegacyValue(legacyStorage, sessionStorageKey());
        }
      }

      if (!guestSessionCache) {
        const migratedGuest = readLegacyGuestSession(legacyStorage, guestStorageKey());
        if (migratedGuest) {
          guestSessionCache = migratedGuest;
          void database.setMeta(GUEST_SESSION_META_KEY, {
            session: cloneRecord(migratedGuest),
            updatedAt: Date.now(),
            source: "legacy-migration"
          }).catch(() => null);
          removeLegacyValue(legacyStorage, guestStorageKey());
        }
      }

      syncLegacyValue(legacyStorage, sessionStorageKey(), sessionCache);
      syncLegacyValue(legacyStorage, guestStorageKey(), guestSessionCache);
    })().finally(() => {
      hydratePromise = null;
    });
    return hydratePromise;
  }

  function getStoredSession() {
    return cloneRecord(sessionCache);
  }

  function saveSession(session) {
    sessionCache = normalizeStoredSession(session);
    syncLegacyValue(legacyStorage, sessionStorageKey(), sessionCache);
    if (sessionCache) {
      void database.setMeta(SESSION_META_KEY, {
        session: cloneRecord(sessionCache),
        updatedAt: Date.now()
      }).catch(() => null);
    } else {
      void database.deleteMeta(SESSION_META_KEY).catch(() => null);
    }
    return getStoredSession();
  }

  function clearSession() {
    sessionCache = null;
    removeLegacyValue(legacyStorage, sessionStorageKey());
    void database.deleteMeta(SESSION_META_KEY).catch(() => null);
  }

  function getStoredGuestSession() {
    return cloneRecord(guestSessionCache);
  }

  function saveGuestSession(session) {
    guestSessionCache = normalizeStoredGuestSession(session);
    syncLegacyValue(legacyStorage, guestStorageKey(), guestSessionCache);
    if (guestSessionCache) {
      void database.setMeta(GUEST_SESSION_META_KEY, {
        session: cloneRecord(guestSessionCache),
        updatedAt: Date.now()
      }).catch(() => null);
    } else {
      void database.deleteMeta(GUEST_SESSION_META_KEY).catch(() => null);
    }
    return getStoredGuestSession();
  }

  function clearGuestSession() {
    guestSessionCache = null;
    removeLegacyValue(legacyStorage, guestStorageKey());
    void database.deleteMeta(GUEST_SESSION_META_KEY).catch(() => null);
  }

  return {
    hydrate,
    getStoredSession,
    saveSession,
    clearSession,
    getStoredGuestSession,
    saveGuestSession,
    clearGuestSession
  };
}

function normalizeStoredSession(session) {
  if (!session || typeof session !== "object") return null;
  const username = String(session.username || "").trim().toLowerCase();
  const secretKeyHex = String(session.secretKeyHex || "").trim().toLowerCase();
  const pubkey = String(session.pubkey || "").trim().toLowerCase();
  if (!username || !secretKeyHex) return null;
  return {
    username,
    secretKeyHex,
    pubkey
  };
}

function normalizeStoredGuestSession(session) {
  if (!session || typeof session !== "object") return null;
  const secretKeyHex = String(session.secretKeyHex || "").trim().toLowerCase();
  const pubkey = String(session.pubkey || "").trim().toLowerCase();
  const guestId = String(session.guestId || "").trim();
  const createdAt = String(session.createdAt || "").trim();
  if (!secretKeyHex) return null;
  return {
    kind: "guest",
    guestId,
    secretKeyHex,
    pubkey,
    createdAt
  };
}

function readLegacySession(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return null;
    return normalizeStoredSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readLegacyGuestSession(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return null;
    return normalizeStoredGuestSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function removeLegacyValue(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    return;
  }
}

function syncLegacyValue(storage, key, value) {
  try {
    if (!value) {
      storage?.removeItem?.(key);
      return;
    }
    storage?.setItem?.(key, JSON.stringify(value));
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

export default createPersistentSessionStore;
