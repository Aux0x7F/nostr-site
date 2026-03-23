export function createDocumentController({
  runtimeClient,
  docId = "",
  kind = "page",
  initialDocument = null
} = {}) {
  const cleanDocId = String(docId || "").trim();
  if (!runtimeClient || typeof runtimeClient !== "object") {
    throw new Error("A runtime client is required.");
  }
  if (!cleanDocId) {
    throw new Error("A document id is required.");
  }

  let destroyed = false;
  let projection = null;
  let localStateProjection = null;
  let unsubscribe = null;
  let unsubscribeLocalState = null;
  const listeners = new Set();
  const localStateListeners = new Set();

  function emit(nextProjection, meta = {}) {
    projection = nextProjection || null;
    for (const listener of listeners) {
      try {
        listener(projection, meta);
      } catch {
        continue;
      }
    }
  }

  async function open({ preferFresh = false } = {}) {
    if (destroyed) throw new Error("Document controller has been destroyed.");
    if (!unsubscribe) {
      unsubscribe = await runtimeClient.subscribeProjection(
        "document",
        { docId: cleanDocId },
        (envelope, meta = {}) => {
          emit(envelope, meta);
        },
        {
          emitCurrent: true,
          refresh: false
        }
      );
    }
    const opened = await runtimeClient.openDocument({
      docId: cleanDocId,
      kind,
      initialDocument
    });
    emit(opened, { source: preferFresh ? "fresh-open" : "open" });
    if (preferFresh && typeof runtimeClient.refreshProjection === "function") {
      const refreshed = await runtimeClient.refreshProjection("document", { docId: cleanDocId }, { reason: "doc-open" });
      if (refreshed) emit(refreshed, { source: "refresh" });
    }
    return projection;
  }

  async function openLocalState({ preferFresh = false, initialState = null } = {}) {
    if (destroyed) throw new Error("Document controller has been destroyed.");
    if (!unsubscribeLocalState) {
      unsubscribeLocalState = await runtimeClient.subscribeProjection(
        "documentLocalState",
        { docId: cleanDocId },
        (envelope, meta = {}) => {
          emitLocalState(envelope, meta);
        },
        {
          emitCurrent: true,
          refresh: false
        }
      );
    }
    const current = await runtimeClient.getProjection("documentLocalState", { docId: cleanDocId }, {
      preferFresh: Boolean(preferFresh),
      reason: "document-local-state-open"
    });
    if ((!current || current.value === null) && initialState !== null) {
      const seeded = await runtimeClient.rememberProjection(
        "documentLocalState",
        { docId: cleanDocId },
        initialState,
        { source: "document-local-seed" }
      );
      emitLocalState(seeded, { source: "seed" });
      return seeded;
    }
    emitLocalState(current, { source: preferFresh ? "fresh-open" : "open" });
    return localStateProjection;
  }

  async function replaceDocument(document) {
    if (destroyed) throw new Error("Document controller has been destroyed.");
    const nextProjection = await runtimeClient.applyDocument({
      docId: cleanDocId,
      document
    });
    emit(nextProjection, { source: "replace-document" });
    return nextProjection;
  }

  async function applyPatch(patch) {
    if (destroyed) throw new Error("Document controller has been destroyed.");
    const nextProjection = await runtimeClient.applyDocument({
      docId: cleanDocId,
      patch
    });
    emit(nextProjection, { source: "patch" });
    return nextProjection;
  }

  async function replaceLocalState(value = null, meta = {}) {
    if (destroyed) throw new Error("Document controller has been destroyed.");
    const nextProjection = await runtimeClient.rememberProjection(
      "documentLocalState",
      { docId: cleanDocId },
      value,
      meta
    );
    emitLocalState(nextProjection, { source: "replace-local-state" });
    return nextProjection;
  }

  async function moveLocalState(fromDocId = "", meta = {}) {
    if (destroyed) throw new Error("Document controller has been destroyed.");
    const cleanFromDocId = String(fromDocId || "").trim();
    if (!cleanFromDocId || cleanFromDocId === cleanDocId) {
      return localStateProjection;
    }
    const current = await runtimeClient.getProjection("documentLocalState", { docId: cleanFromDocId }, {
      preferFresh: false,
      reason: "document-local-state-move"
    });
    if (current?.value === null || typeof current?.value === "undefined") {
      return localStateProjection;
    }
    const nextProjection = await runtimeClient.rememberProjection(
      "documentLocalState",
      { docId: cleanDocId },
      current.value,
      {
        ...meta,
        movedFrom: cleanFromDocId
      }
    );
    await runtimeClient.rememberProjection(
      "documentLocalState",
      { docId: cleanFromDocId },
      null,
      {
        ...meta,
        movedTo: cleanDocId
      }
    );
    emitLocalState(nextProjection, { source: "move-local-state" });
    return nextProjection;
  }

  function getProjection() {
    return projection;
  }

  function getLocalStateProjection() {
    return localStateProjection;
  }

  function subscribe(listener, { emitCurrent = true } = {}) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    if (emitCurrent && projection) {
      listener(projection, { cached: true });
    }
    return () => {
      listeners.delete(listener);
    };
  }

  function emitLocalState(nextProjection, meta = {}) {
    localStateProjection = nextProjection || null;
    for (const listener of localStateListeners) {
      try {
        listener(localStateProjection, meta);
      } catch {
        continue;
      }
    }
  }

  function subscribeLocalState(listener, { emitCurrent = true } = {}) {
    if (typeof listener !== "function") {
      return () => {};
    }
    localStateListeners.add(listener);
    if (emitCurrent && localStateProjection) {
      listener(localStateProjection, { cached: true });
    }
    return () => {
      localStateListeners.delete(listener);
    };
  }

  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    try {
      unsubscribe?.();
      unsubscribeLocalState?.();
    } finally {
      unsubscribe = null;
      unsubscribeLocalState = null;
      listeners.clear();
      localStateListeners.clear();
      await runtimeClient.closeDocument({ docId: cleanDocId }).catch(() => null);
    }
  }

  return {
    applyPatch,
    destroy,
    getProjection,
    getLocalStateProjection,
    moveLocalState,
    open,
    openLocalState,
    replaceDocument,
    replaceLocalState,
    subscribe
    ,
    subscribeLocalState
  };
}

export default createDocumentController;
