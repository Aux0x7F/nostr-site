import { createRoomId, createYjsSync } from "nostr-crdt";

export function createNostrCrdtBridge(config) {
  let tools = null;
  let toolsPromise = null;

  async function ensureTools() {
    if (tools) return tools;
    if (!toolsPromise) {
      toolsPromise = loadTools(config).then((value) => {
        tools = value;
        return value;
      });
    }
    return toolsPromise;
  }

  function namespace() {
    return String(
      config?.nostr?.protocolPrefix ||
        config?.nostr?.clientName ||
        config?.nostr?.appTag ||
        "nostr-site"
    )
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "nostr-site";
  }

  function roomId(documentId) {
    return createRoomId(namespace(), documentId);
  }

  function relayUrls() {
    return dedupe([
      ...(Array.isArray(config?.nostr?.authorityRelays) ? config.nostr.authorityRelays : []),
      ...(Array.isArray(config?.nostr?.relays) ? config.nostr.relays : []),
    ]);
  }

  function timeoutMs() {
    const value = Number(
      config?.nostr?.authorityConnectTimeoutMs ||
        config?.nostr?.connectTimeoutMs ||
        3200
    );
    return Number.isFinite(value) && value > 0 ? value : 3200;
  }

  async function createSigner(secretKeyHex) {
    const eventTools = await ensureTools();
    const secretKey = hexToBytes(eventTools, secretKeyHex);
    const pubkey = eventTools.getPublicKey(secretKey);

    return {
      pubkey,
      async sign(event) {
        return eventTools.finalizeEvent(event, secretKey);
      },
    };
  }

  function createTransport(options = {}) {
    const urls = dedupe(Array.isArray(options.relays) ? options.relays : relayUrls());
    const waitMs = Number(options.timeoutMs || timeoutMs());

    return {
      async query(filters) {
        const eventTools = await ensureTools();
        const pool = new eventTools.SimplePool();
        try {
          const responses = await Promise.allSettled(
            normalizeFilters(filters).map((filter) =>
              pool.querySync(urls, filter, { maxWait: waitMs })
            )
          );
          const events = new Map();
          for (const response of responses) {
            if (response.status !== "fulfilled") continue;
            for (const event of response.value) {
              if (!events.has(event.id)) events.set(event.id, event);
            }
          }
          return [...events.values()];
        } finally {
          pool.close(urls);
        }
      },

      async publish(event) {
        const eventTools = await ensureTools();
        const pool = new eventTools.SimplePool();
        try {
          const results = await Promise.allSettled(pool.publish(urls, event, { maxWait: waitMs }));
          const ok = results.filter((result) => result.status === "fulfilled").length;
          if (!ok) {
            throw new Error("Could not publish CRDT event to any relay.");
          }
          return event;
        } finally {
          pool.close(urls);
        }
      },

      async subscribe(filters, onEvent) {
        const eventTools = await ensureTools();
        const pool = new eventTools.SimplePool();
        const subscriptions = normalizeFilters(filters).map((filter) =>
          pool.subscribe(urls, filter, {
            onevent: (event) => onEvent(event),
            maxWait: waitMs,
          })
        );

        return async () => {
          await Promise.all(subscriptions.map((subscription) => subscription.close("closed")));
          pool.close(urls);
        };
      },
    };
  }

  async function createSync({
    doc,
    documentId,
    secretKeyHex,
    transport = createTransport(),
    acceptEvent,
    onCheckpointRequest,
    kind,
    bufferMs,
  }) {
    const signer = await createSigner(secretKeyHex);
    return createYjsSync({
      doc,
      namespace: namespace(),
      roomId: roomId(documentId),
      transport,
      signer,
      acceptEvent,
      onCheckpointRequest,
      kind,
      bufferMs,
    });
  }

  return {
    ensureEventToolsLoaded: ensureTools,
    createRoomId: roomId,
    createSigner,
    createTransport,
    createSync,
  };
}

async function loadTools(config) {
  const existing = getEventTools();
  if (existing) return existing;

  const paths = {
    bundle: config?.nostr?.toolScriptPaths?.bundle || "./vendor/event-tools.bundle.js",
    shim: config?.nostr?.toolScriptPaths?.shim || "./vendor/event-tools-shim.js",
  };

  await loadScript(paths.bundle);
  await loadScript(paths.shim);

  const tools = getEventTools();
  if (!tools) throw new Error("Event tools failed to initialize.");
  return tools;
}

function getEventTools() {
  return window.EventTools || window[["No", "strTools"].join("")] || null;
}

function normalizeFilters(filters) {
  return (Array.isArray(filters) ? filters : [filters])
    .filter((filter) => filter && typeof filter === "object")
    .map((filter) => normalizeTransportFilter(filter));
}

function normalizeTransportFilter(filter) {
  const next = { ...filter };
  if (next["#d"]) {
    delete next["#n"];
    delete next["#t"];
  }
  return next;
}

function dedupe(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function hexToBytes(eventTools, value) {
  if (typeof eventTools?.hexToBytes === "function") return eventTools.hexToBytes(value);
  if (typeof eventTools?.utils?.hexToBytes === "function") return eventTools.utils.hexToBytes(value);

  const clean = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error("Secret key must be 64 hex characters.");
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    bytes[index / 2] = Number.parseInt(clean.slice(index, index + 2), 16);
  }
  return bytes;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (getEventTools() || src.endsWith("shim.js")) resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}
