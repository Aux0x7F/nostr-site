import * as Y from "yjs";
import { createNostrCrdtBridge } from "./crdt-transport.js";

const LOCAL_ORIGIN = Symbol("nostr-site-structured-unit-local");

export function createStructuredUnitOverlayApi(config) {
  const bridge = createNostrCrdtBridge(config);

  async function connectUnit({
    documentId,
    secretKeyHex,
    getTrustedPubkeys = () => [],
    canPublish = () => false,
    onRemoteContent = () => {},
    onStatus = () => {},
    onCheckpointRequest,
    kind = config?.nostr?.kinds?.collabDocument,
    bufferMs = 180,
  }) {
    const cleanDocumentId = normalizeDocumentId(documentId);
    if (!cleanDocumentId) throw new Error("Document id is required.");
    if (!secretKeyHex) throw new Error("A signer secret key is required.");

    const doc = new Y.Doc();
    const content = doc.getMap("content");
    let destroyed = false;
    let sync = null;

    const emitStatus = (state, message) => {
      onStatus({
        documentId: cleanDocumentId,
        state,
        message: String(message || "").trim(),
      });
    };

    const emitRemoteContent = (origin = null) => {
      const serialized = cloneContent(serializeContent(content));
      onRemoteContent(serialized, {
        documentId: cleanDocumentId,
        hasLiveContent: Object.keys(serialized).length > 0,
        origin,
      });
    };

    const handleContent = (event) => {
      if (destroyed) return;
      if (event?.transaction?.origin === LOCAL_ORIGIN) return;
      emitRemoteContent(event?.transaction?.origin || null);
    };

    content.observe(handleContent);

    try {
      emitStatus("connecting", "Looking up live updates...");
      sync = await bridge.createSync({
        doc,
        documentId: cleanDocumentId,
        secretKeyHex,
        kind,
        bufferMs,
        acceptEvent: async (_event, decoded) => isTrustedSigner(decoded?.pubkey, getTrustedPubkeys),
        onCheckpointRequest,
      });
      await sync.initialize();
      const hasLiveContent = Object.keys(serializeContent(content)).length > 0;
      emitRemoteContent("initial");
      emitStatus(
        "connected",
        hasLiveContent ? "Live updates connected." : "No newer live updates found."
      );
    } catch (error) {
      content.unobserve(handleContent);
      doc.destroy();
      emitStatus("error", String(error?.message || error || "Could not connect live updates."));
      throw error;
    }

    return {
      documentId: cleanDocumentId,
      roomId: bridge.createRoomId(cleanDocumentId),
      hasLiveContent() {
        return Object.keys(serializeContent(content)).length > 0;
      },
      getContent() {
        return cloneContent(serializeContent(content));
      },
      async setContent(nextContent) {
        if (!(await canPublishNow(canPublish))) {
          throw new Error("This signer cannot publish live updates.");
        }
        const incoming = normalizeContent(nextContent);
        const current = serializeContent(content);
        if (contentMatches(current, incoming)) return false;
        doc.transact(() => {
          replaceContentMap(content, incoming);
        }, LOCAL_ORIGIN);
        return true;
      },
      async setField(key, value) {
        const cleanKey = String(key || "").trim();
        if (!cleanKey) return false;
        if (!(await canPublishNow(canPublish))) {
          throw new Error("This signer cannot publish live updates.");
        }
        const currentValue = deserializeValue(content.get(cleanKey));
        const nextValue = cloneValue(value);
        if (contentMatches(currentValue, nextValue)) return false;
        doc.transact(() => {
          if (typeof nextValue === "undefined") {
            content.delete(cleanKey);
            return;
          }
          content.set(cleanKey, serializeValue(nextValue));
        }, LOCAL_ORIGIN);
        return true;
      },
      async flush() {
        return sync?.flush?.() || null;
      },
      async requestCheckpoint(meta = {}) {
        return sync?.requestCheckpoint?.(meta) || null;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        content.unobserve(handleContent);
        sync?.destroy?.();
        doc.destroy();
        emitStatus("closed", "Live updates disconnected.");
      },
    };
  }

  return {
    ensureEventToolsLoaded: bridge.ensureEventToolsLoaded,
    createRoomId(documentId) {
      return bridge.createRoomId(normalizeDocumentId(documentId));
    },
    connectUnit,
  };
}

function normalizeDocumentId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function serializeContent(content) {
  return Object.fromEntries(
    [...content.entries()]
      .map(([key, value]) => [String(key || "").trim(), deserializeValue(value)])
      .filter(([key, value]) => key && typeof value !== "undefined")
  );
}

function normalizeContent(content) {
  return Object.fromEntries(
    Object.entries(content && typeof content === "object" ? content : {})
      .map(([key, value]) => [String(key || "").trim(), cloneValue(value)])
      .filter(([key, value]) => key && typeof value !== "undefined")
  );
}

function replaceContentMap(map, nextContent) {
  const incoming = normalizeContent(nextContent);
  for (const key of [...map.keys()]) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) {
      map.delete(key);
    }
  }
  for (const [key, value] of Object.entries(incoming)) {
    map.set(key, serializeValue(value));
  }
}

function serializeValue(value) {
  return JSON.stringify(cloneValue(value));
}

function deserializeValue(value) {
  if (typeof value !== "string") return undefined;
  try {
    return cloneValue(JSON.parse(value));
  } catch {
    return value;
  }
}

async function isTrustedSigner(pubkey, getTrustedPubkeys) {
  const trusted = await Promise.resolve(
    typeof getTrustedPubkeys === "function" ? getTrustedPubkeys() : getTrustedPubkeys
  );
  const allowed = new Set(
    Array.isArray(trusted) ? trusted.map((value) => String(value || "").trim()) : []
  );
  return allowed.has(String(pubkey || "").trim());
}

async function canPublishNow(canPublish) {
  return Boolean(await Promise.resolve(typeof canPublish === "function" ? canPublish() : canPublish));
}

function cloneContent(content) {
  return JSON.parse(JSON.stringify(content || {}));
}

function cloneValue(value) {
  if (typeof value === "undefined") return undefined;
  return JSON.parse(JSON.stringify(value));
}

function contentMatches(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
