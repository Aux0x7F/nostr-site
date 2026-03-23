import { projectionCacheKey } from "./runtime-db.js";

export function createSharedRuntimeClient({
  workerUrl = "",
  workerName = "nostr-site-runtime",
  seedSession = null,
  seedProjections = null,
  persistSession = null,
  clearPersistedSession = null,
  hostFactory = null,
  sharedWorkerFactory = null,
  onSessionChanged = null
} = {}) {
  let requestId = 0;
  let subscriptionId = 0;
  let transport = null;
  let destroyed = false;
  let sessionSubscriptionPromise = null;
  let activeSessionFingerprint = "";
  let resubscribePromise = null;
  const projectionCache = new Map();
  const projectionListeners = new Map();
  const pending = new Map();

  function makeWorker() {
    if (typeof sharedWorkerFactory === "function") {
      return sharedWorkerFactory();
    }
    if (typeof SharedWorker === "function" && workerUrl) {
      return new SharedWorker(workerUrl, { name: workerName });
    }
    return null;
  }

  async function seedInitialProjections(activeTransport) {
    const projections = typeof seedProjections === "function"
      ? await seedProjections()
      : Array.isArray(seedProjections)
        ? seedProjections
        : [];
    for (const projection of projections) {
      if (!projection?.channel) continue;
      await activeTransport.request("projection.remember", {
        channel: projection.channel,
        params: projection.params || {},
        value: projection.value ?? null,
        meta: projection.meta || { source: "seed-projection" }
      }).catch(() => null);
    }
  }

  async function ensureTransport() {
    if (destroyed) {
      throw new Error("Runtime client has been destroyed.");
    }
    if (transport) return transport;

    const sharedWorker = makeWorker();
    if (sharedWorker?.port) {
      const port = sharedWorker.port;
      port.start?.();
      port.addEventListener("message", handleWorkerMessage);
      transport = {
        mode: "worker",
        request(action, payload = {}) {
          return new Promise((resolve, reject) => {
            const id = `req-${++requestId}`;
            pending.set(id, { resolve, reject });
            port.postMessage({
              type: "request",
              id,
              action,
              payload
            });
          });
        }
      };
      await transport.request("runtime.seedSession", {
        session: seedSession,
        force: false
      }).catch(() => null);
      await seedInitialProjections(transport);
    } else if (typeof hostFactory === "function") {
      const host = hostFactory();
      transport = {
        mode: "local",
        async request(action, payload = {}) {
          switch (action) {
            case "runtime.seedSession":
              return host.seedSession(payload.session, { force: Boolean(payload.force) });
            case "session.get":
              return host.getSession();
            case "auth.signIn":
              return host.signIn(payload);
            case "auth.signOut":
              return host.signOut(payload);
            case "auth.rotatePassword":
              return host.rotatePassword(payload);
            case "relay.publish":
              return host.publish(payload);
            case "action.call":
              return host.callAction(payload.action, payload.payload || {});
            case "projection.get":
              return host.getProjection(payload.channel, payload.params, payload.options);
            case "projection.refresh":
              return host.refreshProjection(payload.channel, payload.params, payload.options);
            case "projection.remember":
              return host.rememberProjection(payload.channel, payload.params, payload.value, payload.meta);
            case "projection.subscribe": {
              const unsubscribe = await host.subscribeProjection(
                payload.channel,
                payload.params,
                (event) => {
                  handleProjectionUpdate({
                    subscriptionId: payload.subscriptionId,
                    channel: payload.channel,
                    params: payload.params || {},
                    envelope: event.envelope || null,
                    value: event.value,
                    status: event.status,
                    digest: event.digest,
                    updatedAt: event.updatedAt,
                    meta: event.meta || {}
                  });
                },
                payload.options || {}
              );
              projectionListeners.set(payload.subscriptionId, {
                listener: projectionListeners.get(payload.subscriptionId)?.listener || null,
                unsubscribe,
                channel: payload.channel,
                params: payload.params || {},
                options: payload.options || {}
              });
              return { subscriptionId: payload.subscriptionId };
            }
            case "projection.unsubscribe": {
              const entry = projectionListeners.get(payload.subscriptionId);
              entry?.unsubscribe?.();
              projectionListeners.delete(payload.subscriptionId);
              return { subscriptionId: payload.subscriptionId };
            }
            case "doc.open":
              return host.openDocument(payload);
            case "doc.apply":
              return host.applyDocument(payload);
            case "doc.close":
              return host.closeDocument(payload);
            default:
              throw new Error(`Unknown runtime action: ${action}`);
          }
        }
      };
      await transport.request("runtime.seedSession", {
        session: seedSession,
        force: false
      }).catch(() => null);
      await seedInitialProjections(transport);
    } else {
      throw new Error("Shared runtime is unavailable.");
    }

    ensureSessionSubscription();
    return transport;
  }

  function handleWorkerMessage(event) {
    const message = event.data || {};
    if (message.type === "response") {
      const pendingRequest = pending.get(message.id);
      if (!pendingRequest) return;
      pending.delete(message.id);
      if (message.ok === false) {
        const error = new Error(String(message.error?.message || "Runtime request failed."));
        if (message.error?.code) error.code = message.error.code;
        pendingRequest.reject(error);
        return;
      }
      pendingRequest.resolve(message.result);
      return;
    }
    if (message.type === "projection.update") {
      handleProjectionUpdate(message);
    }
  }

  function handleProjectionUpdate(message = {}) {
    const subscription = projectionListeners.get(message.subscriptionId);
    const cacheKey = projectionCacheKey(message.channel, message.params || {});
    const previousEnvelope = projectionCache.get(cacheKey)?.envelope || null;
    const nextEnvelope = normalizeProjectionEnvelope(message.envelope || {
      value: message.value,
      status: message.status,
      digest: message.digest,
      updatedAt: message.updatedAt,
      meta: message.meta || {}
    });
    projectionCache.set(cacheKey, {
      envelope: nextEnvelope,
      value: nextEnvelope.value,
      meta: nextEnvelope.meta || {}
    });
    if (message.channel === "session" && stableSessionChanged(previousEnvelope?.value, nextEnvelope.value)) {
      persistSessionValue(nextEnvelope.value);
    }
    subscription?.listener?.(nextEnvelope, nextEnvelope.meta || {});
  }

  function persistSessionValue(session) {
    if (session?.username && session?.secretKeyHex) {
      void Promise.resolve(persistSession?.(session)).catch(() => null);
    } else {
      void Promise.resolve(clearPersistedSession?.()).catch(() => null);
    }
    onSessionChanged?.(session || null);
    const nextFingerprint = stableSessionFingerprint(session);
    if (nextFingerprint !== activeSessionFingerprint) {
      activeSessionFingerprint = nextFingerprint;
      void resubscribeProjectionScopes().catch(() => null);
    }
  }

  function stableSessionChanged(previousSession, nextSession) {
    const previous = previousSession || null;
    return JSON.stringify(previous || null) !== JSON.stringify(nextSession || null);
  }

  async function ensureSessionSubscription() {
    if (sessionSubscriptionPromise) return sessionSubscriptionPromise;
    sessionSubscriptionPromise = subscribeProjection(
      "session",
      {},
      (envelope) => {
        const previous = projectionCache.get(projectionCacheKey("session", {}))?.envelope?.value || null;
        const nextValue = envelope?.value || null;
        if (stableSessionChanged(previous, nextValue)) {
          persistSessionValue(nextValue);
        }
      },
      {
        emitCurrent: true,
        refresh: true
      }
    ).then((unsubscribe) => unsubscribe);
    return sessionSubscriptionPromise;
  }

  async function resubscribeProjectionScopes() {
    if (resubscribePromise) return resubscribePromise;
    resubscribePromise = (async () => {
      const entries = [...projectionListeners.entries()]
        .filter(([, entry]) => entry?.channel && shouldResubscribeChannel(entry.channel, entry.params));
      for (const [id, entry] of entries) {
        await request("projection.unsubscribe", {
          subscriptionId: id
        }).catch(() => null);
        entry.unsubscribe?.();
        await request("projection.subscribe", {
          subscriptionId: id,
          channel: entry.channel,
          params: entry.params || {},
          options: {
            ...(entry.options || {}),
            emitCurrent: true,
            refresh: true,
            reason: "session-resubscribe"
          }
        }).catch(() => null);
      }
    })().finally(() => {
      resubscribePromise = null;
    });
    return resubscribePromise;
  }

  async function request(action, payload = {}) {
    const activeTransport = await ensureTransport();
    return activeTransport.request(action, payload);
  }

  async function subscribeProjection(channel = "", params = {}, listener = () => {}, options = {}) {
    const id = `sub-${++subscriptionId}`;
    projectionListeners.set(id, {
      channel,
      params,
      listener,
      unsubscribe: null,
      options
    });
    await request("projection.subscribe", {
      subscriptionId: id,
      channel,
      params,
      options
    });
    return () => {
      const entry = projectionListeners.get(id);
      entry?.unsubscribe?.();
      projectionListeners.delete(id);
      void request("projection.unsubscribe", {
        subscriptionId: id
      }).catch(() => null);
    };
  }

  return {
    async seedSession(session, { force = false } = {}) {
      const seeded = await request("runtime.seedSession", {
        session,
        force
      });
      persistSessionValue(seeded || session || null);
      return seeded;
    },
    async getSession() {
      return request("session.get");
    },
    async signIn(payload = {}) {
      const result = await request("auth.signIn", payload);
      persistSessionValue(result?.session || null);
      return result;
    },
    async signOut(payload = {}) {
      const result = await request("auth.signOut", payload);
      persistSessionValue(null);
      return result;
    },
    async rotatePassword(payload = {}) {
      const result = await request("auth.rotatePassword", payload);
      persistSessionValue(result?.session || null);
      return result;
    },
    async publish(payload = {}) {
      return request("relay.publish", payload);
    },
    async callAction(action = "", payload = {}) {
      return request("action.call", {
        action,
        payload
      });
    },
    async getProjection(channel = "", params = {}, options = {}) {
      const envelope = normalizeProjectionEnvelope(await request("projection.get", {
        channel,
        params,
        options
      }));
      projectionCache.set(projectionCacheKey(channel, params), {
        envelope,
        value: envelope.value,
        meta: {
          ...(envelope.meta || {}),
          source: options?.preferFresh ? "fresh" : "cache"
        }
      });
      return envelope;
    },
    async refreshProjection(channel = "", params = {}, options = {}) {
      const envelope = normalizeProjectionEnvelope(await request("projection.refresh", {
        channel,
        params,
        options
      }));
      projectionCache.set(projectionCacheKey(channel, params), {
        envelope,
        value: envelope.value,
        meta: envelope.meta || {}
      });
      return envelope;
    },
    async rememberProjection(channel = "", params = {}, value = null, meta = {}) {
      const envelope = normalizeProjectionEnvelope(await request("projection.remember", {
        channel,
        params,
        value,
        meta
      }));
      projectionCache.set(projectionCacheKey(channel, params), {
        envelope,
        value: envelope.value,
        meta: envelope.meta || meta
      });
      return envelope;
    },
    subscribeProjection,
    getCachedProjection(channel = "", params = {}) {
      return projectionCache.get(projectionCacheKey(channel, params))?.envelope ?? null;
    },
    async openDocument(payload = {}) {
      return normalizeProjectionEnvelope(await request("doc.open", payload));
    },
    async applyDocument(payload = {}) {
      return normalizeProjectionEnvelope(await request("doc.apply", payload));
    },
    async closeDocument(payload = {}) {
      return request("doc.close", payload);
    },
    destroy() {
      destroyed = true;
      for (const { reject } of pending.values()) {
        reject(new Error("Runtime client destroyed."));
      }
      pending.clear();
      projectionListeners.clear();
      projectionCache.clear();
    }
  };
}

function shouldResubscribeChannel(channel = "", params = {}) {
  const cleanChannel = String(channel || "").trim();
  const projectionScope = String(params?.__projectionScope || "").trim().toLowerCase();
  return projectionScope !== "global" && !["session", "viewer", "publicState", "document"].includes(cleanChannel);
}

function stableSessionFingerprint(session = null) {
  if (!session || typeof session !== "object") return "";
  return JSON.stringify({
    username: String(session.username || "").trim().toLowerCase(),
    pubkey: String(session.pubkey || "").trim().toLowerCase(),
    secretKeyHex: String(session.secretKeyHex || "").trim().toLowerCase()
  });
}

function normalizeProjectionEnvelope(envelope = null) {
  if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
    return {
      value: envelope.value ?? null,
      status: normalizeProjectionStatus(envelope.status),
      digest: String(envelope.digest || JSON.stringify(envelope.value ?? null)),
      updatedAt: Number(envelope.updatedAt || envelope.meta?.updatedAt || Date.now()),
      meta: {
        ...(envelope.meta && typeof envelope.meta === "object" ? envelope.meta : {}),
        updatedAt: Number(envelope.updatedAt || envelope.meta?.updatedAt || Date.now())
      }
    };
  }
  const updatedAt = Date.now();
  return {
    value: envelope ?? null,
    status: envelope === null || envelope === undefined ? "idle" : "ready",
    digest: JSON.stringify(envelope ?? null),
    updatedAt,
    meta: {
      updatedAt
    }
  };
}

function normalizeProjectionStatus(status = "") {
  const cleanStatus = String(status || "").trim().toLowerCase();
  if (["idle", "loading", "ready", "stale", "degraded", "error"].includes(cleanStatus)) {
    return cleanStatus;
  }
  return "ready";
}

export default createSharedRuntimeClient;
