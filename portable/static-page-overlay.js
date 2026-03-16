import * as Y from "yjs";
import { createNostrCrdtBridge } from "./crdt-transport.js";

const LOCAL_ORIGIN = Symbol("nostr-site-static-page-local");

export function createStaticPageOverlayApi(config) {
  const bridge = createNostrCrdtBridge(config);

  async function connectPage({
    pageId,
    secretKeyHex,
    getTrustedPubkeys = () => [],
    canPublish = () => false,
    onRemoteContent = () => {},
    onStatus = () => {},
    onCheckpointRequest,
    kind = config?.nostr?.kinds?.collabDocument,
    bufferMs = 180,
  }) {
    const cleanPageId = normalizePageId(pageId);
    if (!cleanPageId) throw new Error("Page id is required.");
    if (!secretKeyHex) throw new Error("A signer secret key is required.");

    const doc = new Y.Doc();
    const content = doc.getMap("content");
    let destroyed = false;
    let sync = null;

    const emitStatus = (state, message) => {
      onStatus({
        pageId: cleanPageId,
        state,
        message: String(message || "").trim(),
      });
    };

    const emitRemoteContent = (origin = null) => {
      const serialized = cloneContent(serializeContent(content));
      onRemoteContent(serialized, {
        pageId: cleanPageId,
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
      emitStatus("connecting", "Looking up live page updates...");
      sync = await bridge.createSync({
        doc,
        documentId: documentId(cleanPageId),
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
        hasLiveContent ? "Live page updates connected." : "No newer live page updates found."
      );
    } catch (error) {
      content.unobserve(handleContent);
      doc.destroy();
      emitStatus("error", String(error?.message || error || "Could not connect live page updates."));
      throw error;
    }

    return {
      pageId: cleanPageId,
      documentId: documentId(cleanPageId),
      roomId: bridge.createRoomId(documentId(cleanPageId)),
      hasLiveContent() {
        return Object.keys(serializeContent(content)).length > 0;
      },
      getContent() {
        return cloneContent(serializeContent(content));
      },
      async setContent(nextContent) {
        if (!(await canPublishNow(canPublish))) {
          throw new Error("This signer cannot publish live page updates.");
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
          throw new Error("This signer cannot publish live page updates.");
        }
        const nextValue = String(value ?? "");
        if (String(content.get(cleanKey) || "") === nextValue) return false;
        doc.transact(() => {
          if (nextValue) {
            content.set(cleanKey, nextValue);
          } else {
            content.delete(cleanKey);
          }
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
        emitStatus("closed", "Live page updates disconnected.");
      },
    };
  }

  return {
    ensureEventToolsLoaded: bridge.ensureEventToolsLoaded,
    createRoomId(pageId) {
      return bridge.createRoomId(documentId(pageId));
    },
    connectPage,
  };
}

function documentId(pageId) {
  return `page:${normalizePageId(pageId)}`;
}

function normalizePageId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function serializeContent(content) {
  const entries = [...content.entries()]
    .map(([key, value]) => [String(key || "").trim(), String(value || "")])
    .filter(([key, value]) => key && value.length);
  return Object.fromEntries(entries);
}

function normalizeContent(content) {
  return Object.fromEntries(
    Object.entries(content && typeof content === "object" ? content : {})
      .map(([key, value]) => [String(key || "").trim(), String(value ?? "")])
      .filter(([key]) => key)
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
    if (value) {
      map.set(key, value);
    } else {
      map.delete(key);
    }
  }
}

async function isTrustedSigner(pubkey, getTrustedPubkeys) {
  const trusted = await Promise.resolve(typeof getTrustedPubkeys === "function" ? getTrustedPubkeys() : getTrustedPubkeys);
  const allowed = new Set(Array.isArray(trusted) ? trusted.map((value) => String(value || "").trim()) : []);
  return allowed.has(String(pubkey || "").trim());
}

async function canPublishNow(canPublish) {
  return Boolean(await Promise.resolve(typeof canPublish === "function" ? canPublish() : canPublish));
}

function cloneContent(content) {
  return JSON.parse(JSON.stringify(content || {}));
}

function contentMatches(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}
