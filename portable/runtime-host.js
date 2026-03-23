import {
  createMemoryRuntimeDatabase,
  projectionCacheKey,
  stableSerializeKey
} from "./runtime-db.js";
import {
  applyStructuredDocumentPatch,
  createStructuredDocument,
  normalizeStructuredDocument
} from "./structured-document.js";
import {
  collectStructuredDocumentCitations,
  extractStructuredDocumentEntityRefs,
  extractStructuredDocumentRelationshipCandidates,
  extractStructuredDocumentSearchText,
  renderStructuredDocumentHtml
} from "./structured-document-exporters.js";

export function createRuntimeHost({
  database = createMemoryRuntimeDatabase(),
  auth = {},
  relay = {},
  actions = {},
  projectionLoaders = {},
  now = () => Date.now()
} = {}) {
  const runtime = {
    signIn: auth.signIn || (async () => ({ session: null })),
    signOut: auth.signOut || (async () => ({ session: null })),
    rotatePassword: auth.rotatePassword || (async () => ({ session: null })),
    publish: relay.publish || (async () => null),
    actions: actions && typeof actions === "object" ? { ...actions } : {},
    ...projectionLoaders
  };

  let currentSession = null;
  const projectionSignatures = new Map();
  const projectionSubscribers = new Map();
  const inFlightRefresh = new Map();
  let readyPromise = null;

  async function ready() {
    if (!readyPromise) {
      readyPromise = hydrateStoredSession();
    }
    await readyPromise;
  }

  async function hydrateStoredSession() {
    const stored = await database.getMeta("session/current").catch(() => null);
    currentSession = normalizeSession(stored?.session);
    await persistBuiltinProjections();
  }

  async function persistBuiltinProjections() {
    await writeProjection("session", {}, currentSession, {
      source: "runtime"
    });
    await writeProjection("viewer", {}, currentSession
      ? {
          username: currentSession.username,
          pubkey: currentSession.pubkey
        }
      : null, {
      source: "runtime"
    });
  }

  async function persistSession(session) {
    currentSession = normalizeSession(session);
    if (currentSession) {
      await database.setMeta("session/current", {
        session: currentSession,
        updatedAt: now()
      });
    } else {
      await database.deleteMeta("session/current");
    }
    await persistBuiltinProjections();
    return currentSession;
  }

  async function writeProjection(channel = "", params = {}, value = null, meta = {}, options = {}) {
    const scopedParams = scopeProjectionParams(channel, params, currentSession);
    const key = projectionCacheKey(channel, scopedParams);
    const previous = await readCachedProjectionRecord(channel, params);
    const record = createProjectionEnvelope(channel, params, value, meta, {
      now,
      previous,
      defaultStatus: options.defaultStatus || "ready"
    });
    const changed = projectionSignatures.get(key) !== projectionSignature(record);
    projectionSignatures.set(key, projectionSignature(record));
    await database.setProjection(channel, scopedParams, record);
    if (changed) {
      emitProjection(channel, params, record);
    }
    return record;
  }

  async function rememberProjection(channel = "", params = {}, value = null, meta = {}) {
    await ready();
    return writeProjection(channel, params, value, meta);
  }

  async function getCachedProjectionRecord(channel = "", params = {}) {
    await ready();
    return readCachedProjectionRecord(channel, params);
  }

  async function readCachedProjectionRecord(channel = "", params = {}) {
    const scopedParams = scopeProjectionParams(channel, params, currentSession);
    const cached = await database.getProjection(channel, scopedParams);
    if (cached) {
      const envelope = normalizeProjectionEnvelope(channel, params, cached, {
        now
      });
      projectionSignatures.set(projectionCacheKey(channel, scopedParams), projectionSignature(envelope));
      return envelope;
    }
    return null;
  }

  async function getProjection(channel = "", params = {}, options = {}) {
    await ready();
    const preferFresh = Boolean(options?.preferFresh);
    const cached = await getCachedProjectionRecord(channel, params);
    if (cached && !preferFresh) {
      void refreshProjection(channel, params, {
        reason: options?.reason || "background-get"
      }).catch(() => null);
      return cached;
    }
    const refreshed = await refreshProjection(channel, params, {
      reason: options?.reason || "get"
    });
    if (refreshed) return refreshed;
    return cached || createProjectionEnvelope(channel, params, null, {
      source: "runtime",
      reason: options?.reason || "get-idle"
    }, {
      now,
      defaultStatus: "idle"
    });
  }

  async function refreshProjection(channel = "", params = {}, { reason = "refresh" } = {}) {
    await ready();
    const scopedParams = scopeProjectionParams(channel, params, currentSession);
    const key = projectionCacheKey(channel, scopedParams);
    if (inFlightRefresh.has(key)) {
      return inFlightRefresh.get(key);
    }
    const refreshPromise = (async () => {
      const cached = await getCachedProjectionRecord(channel, params);
      if (cached) {
        await writeProjection(channel, params, {
          ...cached,
          status: "stale"
        }, {
          ...(cached.meta || {}),
          source: "refresh",
          reason
        });
      } else {
        await writeProjection(channel, params, null, {
          source: "refresh",
          reason
        }, {
          defaultStatus: "loading"
        });
      }
      if (channel === "session") {
        return rememberProjection("session", {}, currentSession, {
          source: "session",
          reason
        });
      }
      if (channel === "viewer") {
        return rememberProjection("viewer", {}, currentSession
          ? {
              username: currentSession.username,
              pubkey: currentSession.pubkey
            }
          : null, {
          source: "viewer",
          reason
        });
      }
      if (channel === "document") {
        return openDocument({
          docId: params.docId,
          kind: params.kind,
          initialDocument: params.initialDocument
        });
      }
      const loader = runtime[String(channel || "").trim()];
      if (typeof loader !== "function") {
        return cached || createProjectionEnvelope(channel, params, null, {
          source: "loader-missing",
          reason
        }, {
          now,
          defaultStatus: "idle"
        });
      }
      try {
        const value = await loader({
          channel,
          params,
          session: currentSession,
          database,
          host: api
        });
        const next = normalizeProjectionEnvelope(channel, params, value, {
          now,
          previous: cached,
          defaultStatus: "ready"
        });
        if (cached && !projectionImproved(next, cached)) {
          return writeProjection(channel, params, {
            ...cached,
            status: next.status === "ready" ? "degraded" : next.status
          }, {
            ...(next.meta || {}),
            source: "loader",
            reason
          });
        }
        return writeProjection(channel, params, next, {
          ...(next.meta || {}),
          source: "loader",
          reason
        });
      } catch (error) {
        if (cached) {
          return writeProjection(channel, params, {
            ...cached,
            status: "error"
          }, {
            ...(cached.meta || {}),
            source: "loader",
            reason,
            error: String(error?.message || error || "Projection refresh failed.")
          });
        }
        return writeProjection(channel, params, null, {
          source: "loader",
          reason,
          error: String(error?.message || error || "Projection refresh failed.")
        }, {
          defaultStatus: "error"
        });
      }
    })()
      .finally(() => {
        inFlightRefresh.delete(key);
      });
    inFlightRefresh.set(key, refreshPromise);
    return refreshPromise;
  }

  async function subscribeProjection(channel = "", params = {}, callback, options = {}) {
    await ready();
    const key = projectionCacheKey(channel, scopeProjectionParams(channel, params, currentSession));
    const subscribers = projectionSubscribers.get(key) || new Set();
    subscribers.add(callback);
    projectionSubscribers.set(key, subscribers);
    if (options?.emitCurrent !== false) {
      const cached = await getCachedProjectionRecord(channel, params);
      if (cached) {
        callback({
          channel,
          params,
          envelope: cached,
          value: cached.value,
          status: cached.status,
          digest: cached.digest,
          updatedAt: cached.updatedAt,
          meta: {
            cached: true,
            ...(cached.meta || {})
          }
        });
      }
    }
    if (options?.refresh !== false) {
      void refreshProjection(channel, params, {
        reason: options?.reason || "subscribe"
      }).catch(() => null);
    }
    return () => {
      const active = projectionSubscribers.get(key);
      if (!active) return;
      active.delete(callback);
      if (!active.size) {
        projectionSubscribers.delete(key);
      }
    };
  }

  function emitProjection(channel = "", params = {}, record = null) {
    const subscribers = projectionSubscribers.get(
      projectionCacheKey(channel, scopeProjectionParams(channel, params, currentSession))
    );
    if (!subscribers?.size || !record) return;
    const payload = {
      channel,
      params,
      envelope: record,
      value: record.value,
      status: record.status,
      digest: record.digest,
      updatedAt: record.updatedAt,
      meta: record.meta || {}
    };
    for (const subscriber of subscribers) {
      try {
        subscriber(payload);
      } catch {
        continue;
      }
    }
  }

  async function seedSession(session = null, { force = false } = {}) {
    await ready();
    const normalized = normalizeSession(session);
    if (!force && currentSession?.secretKeyHex && currentSession?.pubkey) {
      return currentSession;
    }
    await persistSession(normalized);
    return currentSession;
  }

  async function signIn(payload = {}) {
    await ready();
    const result = await runtime.signIn({
      ...payload,
      session: currentSession
    }, {
      session: currentSession,
      database,
      host: api
    });
    await persistSession(result?.session || null);
    return {
      ...result,
      session: currentSession
    };
  }

  async function signOut(payload = {}) {
    await ready();
    const result = await runtime.signOut({
      ...payload,
      session: currentSession
    }, {
      session: currentSession,
      database,
      host: api
    });
    await persistSession(null);
    return result || { session: null };
  }

  async function rotatePassword(payload = {}) {
    await ready();
    const result = await runtime.rotatePassword({
      ...payload,
      session: currentSession
    }, {
      session: currentSession,
      database,
      host: api
    });
    await persistSession(result?.session || null);
    return {
      ...result,
      session: currentSession
    };
  }

  async function publish(payload = {}) {
    await ready();
    return runtime.publish(payload, {
      session: currentSession,
      database,
      host: api
    });
  }

  async function callAction(action = "", payload = {}) {
    await ready();
    const cleanAction = String(action || "").trim();
    const handler = runtime.actions?.[cleanAction];
    if (typeof handler !== "function") {
      throw new Error(`Unknown runtime action: ${cleanAction}`);
    }
    return handler(payload, {
      session: currentSession,
      database,
      host: api
    });
  }

  async function openDocument({
    docId = "",
    kind = "page",
    initialDocument = null
  } = {}) {
    await ready();
    const cleanDocId = String(docId || "").trim();
    if (!cleanDocId) {
      throw new Error("Document id is required.");
    }
    const stored = await database.getDocument(cleanDocId);
    const document = normalizeStructuredDocument(
      stored?.value ||
        initialDocument ||
        createStructuredDocument({
          id: cleanDocId,
          kind
        })
    );
    const projection = buildDocumentProjection(document);
    await database.setDocument(cleanDocId, {
      value: document,
      updatedAt: now()
    });
    return rememberProjection("document", { docId: cleanDocId }, projection, {
      source: "document"
    });
  }

  async function applyDocument({
    docId = "",
    patch = null,
    document = null
  } = {}) {
    await ready();
    const opened = await openDocument({ docId });
    const currentDocument = opened?.value?.document || createStructuredDocument({ id: docId });
    const nextDocument = document
      ? normalizeStructuredDocument(document)
      : applyStructuredDocumentPatch(currentDocument, patch);
    const projection = buildDocumentProjection(nextDocument);
    await database.setDocument(String(docId || "").trim(), {
      value: nextDocument,
      updatedAt: now()
    });
    return rememberProjection("document", { docId: String(docId || "").trim() }, projection, {
      source: "document"
    });
  }

  async function closeDocument() {
    await ready();
    return null;
  }

  const api = {
    applyDocument,
    callAction,
    closeDocument,
    getProjection,
    getProjectionValue: async (channel = "", params = {}, options = {}) =>
      (await getProjection(channel, params, options))?.value ?? null,
    getSession: async () => {
      await ready();
      return currentSession;
    },
    openDocument,
    publish,
    ready,
    refreshProjection,
    rememberProjection,
    seedSession,
    signIn,
    signOut,
    rotatePassword,
    subscribeProjection
  };

  return api;
}

function projectionSignature(record = null) {
  if (!record) return "";
  return `${String(record.status || "idle")}:${String(record.digest || "")}`;
}

function normalizeProjectionStatus(status = "", fallback = "ready") {
  const cleanStatus = String(status || "").trim().toLowerCase();
  if (["idle", "loading", "ready", "stale", "degraded", "error"].includes(cleanStatus)) {
    return cleanStatus;
  }
  return fallback;
}

function createProjectionEnvelope(channel = "", params = {}, value = null, meta = {}, {
  now = () => Date.now(),
  previous = null,
  defaultStatus = "ready"
} = {}) {
  const normalized = normalizeProjectionEnvelope(channel, params, value, {
    now,
    previous,
    defaultStatus
  });
  normalized.meta = {
    ...(normalized.meta || {}),
    ...(meta && typeof meta === "object" ? meta : {})
  };
  if (!normalized.meta.updatedAt) {
    normalized.meta.updatedAt = normalized.updatedAt;
  }
  return normalized;
}

function normalizeProjectionEnvelope(channel = "", params = {}, value = null, {
  now = () => Date.now(),
  previous = null,
  defaultStatus = "ready"
} = {}) {
  const cleanChannel = String(channel || "").trim();
  const cleanParams = params && typeof params === "object" ? { ...params } : {};
  const currentTime = Number(now?.() || Date.now()) || Date.now();
  const previousEnvelope = value && typeof value === "object" && !Array.isArray(value)
    ? null
    : previous;

  if (isProjectionEnvelope(value)) {
    const status = normalizeProjectionStatus(value.status, defaultStatus);
    return {
      channel: cleanChannel,
      params: cleanParams,
      value: value.value ?? null,
      status,
      digest: String(value.digest || stableSerializeKey(value.value)),
      updatedAt: Number(value.updatedAt || value.meta?.updatedAt || currentTime),
      meta: {
        ...(value.meta && typeof value.meta === "object" ? value.meta : {}),
        updatedAt: Number(value.updatedAt || value.meta?.updatedAt || currentTime)
      }
    };
  }

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ("channel" in value || "params" in value || "meta" in value || "value" in value)
  ) {
    const rawValue = "value" in value ? value.value : null;
    const updatedAt = Number(value.updatedAt || value.meta?.updatedAt || currentTime);
    return {
      channel: cleanChannel,
      params: cleanParams,
      value: rawValue ?? null,
      status: normalizeProjectionStatus(value.status, defaultStatus),
      digest: String(value.digest || stableSerializeKey(rawValue)),
      updatedAt,
      meta: {
        ...(value.meta && typeof value.meta === "object" ? value.meta : {}),
        updatedAt
      }
    };
  }

  const nextValue = value ?? null;
  return {
    channel: cleanChannel,
    params: cleanParams,
    value: nextValue,
    status: normalizeProjectionStatus(previousEnvelope?.status, defaultStatus),
    digest: stableSerializeKey(nextValue),
    updatedAt: currentTime,
    meta: {
      updatedAt: currentTime
    }
  };
}

function isProjectionEnvelope(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "value" in value &&
      ("status" in value || "digest" in value || "updatedAt" in value)
  );
}

function projectionImproved(next = null, previous = null) {
  if (!next) return false;
  if (!previous) return next.value !== null || next.status !== "idle";
  if (next.digest !== previous.digest) return true;
  if (next.value !== null && previous.value === null) return true;
  if (next.status === "ready" && previous.status !== "ready") return true;
  return false;
}

function scopeProjectionParams(channel = "", params = {}, session = null) {
  const cleanChannel = String(channel || "").trim();
  const cleanParams = params && typeof params === "object" ? { ...params } : {};
  const projectionScope = String(cleanParams.__projectionScope || "").trim().toLowerCase();
  if ("__projectionScope" in cleanParams) {
    delete cleanParams.__projectionScope;
  }
  if (
    cleanChannel === "session" ||
    cleanChannel === "viewer" ||
    cleanChannel === "publicState" ||
    cleanChannel === "document" ||
    projectionScope === "global"
  ) {
    return cleanParams;
  }
  return {
    ...cleanParams,
    __sessionScope: String(session?.pubkey || "anonymous").trim().toLowerCase()
  };
}

function normalizeSession(session = null) {
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

function buildDocumentProjection(document) {
  const normalized = normalizeStructuredDocument(document);
  return {
    document: normalized,
    html: renderStructuredDocumentHtml(normalized),
    searchText: extractStructuredDocumentSearchText(normalized),
    entityRefs: extractStructuredDocumentEntityRefs(normalized),
    relationshipCandidates: extractStructuredDocumentRelationshipCandidates(normalized),
    citations: collectStructuredDocumentCitations(normalized)
  };
}

export default createRuntimeHost;
