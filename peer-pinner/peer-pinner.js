const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");
const { finalizeEvent, nip98 } = require("nostr-tools");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4858);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const EVENTS_FILE = process.env.EVENTS_FILE || path.join(DATA_DIR, "events.ndjson");
const IDENTITY_FILE = process.env.IDENTITY_FILE || path.join(DATA_DIR, "peer-pinner-identity.json");
const BLOBS_DIR = process.env.BLOBS_DIR || path.join(DATA_DIR, "blobs");
const INFO_NAME = process.env.PINNER_NAME || "Nostr Site Peer Pinner";
const INFO_DESC = process.env.PINNER_DESCRIPTION || "Mirrors + pins tagged relay events for downstream Nostr site consumers";
const PINNER_PUBKEY_OVERRIDE = process.env.PINNER_PUBKEY || "";
const PINNER_ALIAS_OVERRIDE = process.env.PINNER_ALIAS || "";
const MAX_REQ_EVENTS = Number(process.env.MAX_REQ_EVENTS || 5000);
const TAG_FILTER = String(process.env.APP_TAG || "nostr-site-template").trim();
const KINDS_FILTER = parseKinds(process.env.APP_KINDS || "4,34127,34128,34129,34130,34131,34133,34134,34135,34136,34137,34138,34139,34140");
const UPSTREAM_RELAYS = parseRelays(process.env.UPSTREAM_RELAYS || "wss://relay.damus.io,wss://relay.primal.net,wss://nos.lol");
const UPSTREAM_BACKFILL_LIMIT = Number(process.env.UPSTREAM_BACKFILL_LIMIT || 7000);
const UPSTREAM_RECONNECT_MS = Number(process.env.UPSTREAM_RECONNECT_MS || 2500);
const MAX_BLOB_BYTES = Number(process.env.MAX_BLOB_BYTES || 2000000);
const BLOB_CACHE_BASE_URL = String(process.env.BLOB_CACHE_BASE_URL || "https://blossom.band").trim();
const KINDS = {
  snapshot: 34126,
  adminClaim: 34127,
  adminRole: 34128,
  nameClaim: 34130,
  snapshotRequest: 34132,
  blobRequest: 34139,
  blobFulfillment: 34140,
};

if (!Number.isFinite(PORT) || PORT <= 0) {
  throw new Error(`invalid PORT ${process.env.PORT}`);
}
if (!Number.isFinite(MAX_REQ_EVENTS) || MAX_REQ_EVENTS <= 0) {
  throw new Error(`invalid MAX_REQ_EVENTS ${process.env.MAX_REQ_EVENTS}`);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
fs.mkdirSync(BLOBS_DIR, { recursive: true });
if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, "", { encoding: "utf8" });
const pinnerIdentity = loadOrCreatePeerPinnerIdentity(IDENTITY_FILE, PINNER_ALIAS_OVERRIDE);
const PINNER_ALIAS = PINNER_ALIAS_OVERRIDE || pinnerIdentity.alias;
const INFO_PUBKEY = PINNER_PUBKEY_OVERRIDE || pinnerIdentity.pubkey;

const eventsById = new Map();
const ordered = [];
let orderedDirty = false;
let persistWriteOk = 0;
let persistWriteFail = 0;
let lastPersistError = "";
const blobJobs = new Map();

const upstreams = new Map();
const model = {
  admin: { pubkey: "", claimEvent: null },
  admins: new Set(),
  adminClaims: [],
  adminRoleEvents: [],
  nameClaimEvents: [],
  nameOwnerByName: new Map(),
  nameByPubkey: new Map(),
  snapshotEvents: [],
  snapshot: null,
  snapshotRequestsSeen: new Set(),
};

loadEvents();

const server = http.createServer((req, res) => {
  void handleHttp(req, res);
});

async function handleHttp(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const accept = String(req.headers.accept || "");
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.pathname === "/upload" && req.method === "HEAD") {
    res.writeHead(204, { "x-max-blob-bytes": String(MAX_BLOB_BYTES) });
    res.end();
    return;
  }
  if (url.pathname === "/upload" && req.method === "PUT") {
    await handleBlobUpload(req, res, url);
    return;
  }
  if (/^\/[0-9a-f]{64}$/i.test(url.pathname) && (req.method === "GET" || req.method === "HEAD")) {
    handleBlobRead(req, res, url.pathname.slice(1));
    return;
  }
  if (url.pathname === "/healthz") {
    const upstream = [];
    for (const [relay, client] of upstreams.entries()) {
      upstream.push({ relay, connected: Boolean(client.connected) });
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    const eventsBytes = fileSizeSafe(EVENTS_FILE);
    res.end(JSON.stringify({
      ok: true,
      events: eventsById.size,
      upstream,
      relay_identity: {
        alias: PINNER_ALIAS,
        pubkey: INFO_PUBKEY,
      },
      storage: {
        data_dir: DATA_DIR,
        events_file: EVENTS_FILE,
        identity_file: IDENTITY_FILE,
        events_file_bytes: eventsBytes,
        writes_ok: persistWriteOk,
        writes_failed: persistWriteFail,
        last_write_error: lastPersistError,
        blobs_dir: BLOBS_DIR,
        blob_cache_base_url: BLOB_CACHE_BASE_URL,
        max_blob_bytes: MAX_BLOB_BYTES,
        blob_count: countStoredBlobs(),
      },
      logical: resolveLogicalState(),
    }));
    return;
  }
  if (accept.includes("application/nostr+json")) {
    res.writeHead(200, {
      "content-type": "application/nostr+json; charset=utf-8",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify({
      name: INFO_NAME,
      description: INFO_DESC,
      pubkey: INFO_PUBKEY,
      contact: PINNER_ALIAS,
      software: "nostr-site-peer-pinner",
      version: "0.2.0",
      supported_nips: [1, 11, 98],
      limitation: {
        max_limit: MAX_REQ_EVENTS,
      },
    }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("nostr-site peer pinner\n");
}

const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  const subs = new Map();
  ws._cmsSubs = subs;

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(String(buf));
    } catch {
      sendNotice(ws, "invalid json");
      return;
    }
    if (!Array.isArray(msg) || msg.length === 0) {
      sendNotice(ws, "invalid frame");
      return;
    }
    const cmd = String(msg[0] || "");
    if (cmd === "EVENT") {
      const ev = msg[1];
      if (!isEventShape(ev)) {
        wsSend(ws, ["OK", String(ev?.id || ""), false, "invalid event shape"]);
        return;
      }
      if (eventsById.has(ev.id)) {
        wsSend(ws, ["OK", ev.id, true, "duplicate: already stored"]);
        return;
      }
      if (!storeEvent(ev)) {
        wsSend(ws, ["OK", ev.id, false, "persist failed"]);
        return;
      }
      wsSend(ws, ["OK", ev.id, true, "stored"]);
      publishToUpstreams(ev, "");
      broadcastEvent(ev);
      maybeShareSnapshotForRequest(ev, "");
      return;
    }
    if (cmd === "REQ") {
      const subId = String(msg[1] || "");
      if (!subId) {
        sendNotice(ws, "REQ needs sub id");
        return;
      }
      const filtersRaw = msg.slice(2);
      const filters = filtersRaw.length > 0 ? filtersRaw.filter((x) => x && typeof x === "object") : [{}];
      subs.set(subId, filters);
      sendBacklog(ws, subId, filters);
      wsSend(ws, ["EOSE", subId]);
      return;
    }
    if (cmd === "CLOSE") {
      const subId = String(msg[1] || "");
      subs.delete(subId);
      return;
    }
    if (cmd === "CMS_USER_EXISTS") {
      const reqId = String(msg[1] || "");
      const alias = String(msg[2] || "");
      wsSend(ws, ["CMS_USER_EXISTS", reqId, resolveUserExists(alias)]);
      return;
    }
    if (cmd === "CMS_SNAPSHOT_LATEST") {
      const reqId = String(msg[1] || "");
      wsSend(ws, ["CMS_SNAPSHOT_LATEST", reqId, resolveLatestSnapshot()]);
      return;
    }
    if (cmd === "CMS_STATE") {
      const reqId = String(msg[1] || "");
      wsSend(ws, ["CMS_STATE", reqId, resolveLogicalState()]);
      return;
    }
    sendNotice(ws, `unsupported cmd ${cmd}`);
  });

  ws.on("close", () => {
    subs.clear();
  });
});

startUpstreamMirrors();

server.listen(PORT, HOST, () => {
  console.log(`nostr-site peer pinner listening ws://${HOST}:${PORT}`);
  console.log(`events file ${EVENTS_FILE}`);
  console.log(`pinner identity @${PINNER_ALIAS} ${shortKey(INFO_PUBKEY)} (${IDENTITY_FILE})`);
  if (UPSTREAM_RELAYS.length > 0) {
    console.log(`upstream mirrors: ${UPSTREAM_RELAYS.join(", ")}`);
  }
});

const shutdown = () => {
  for (const client of upstreams.values()) {
    clearTimeout(client.retryTimer);
    try {
      client.ws?.close();
    } catch {
      // ignore
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function handleBlobUpload(req, res, url) {
  try {
    const body = await readRequestBody(req, MAX_BLOB_BYTES);
    if (!body.length) {
      sendJson(res, 400, { error: "Blob body is required." });
      return;
    }
    const authEvent = unpackHttpAuthEvent(req.headers.authorization);
    await nip98.validateEvent(authEvent, absoluteRequestUrl(req, url), req.method, body);

    const sha256 = hashBuffer(body);
    const filePath = blobFile(sha256);
    const metaPath = blobMetaFile(sha256);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, body);
    }

    const nextMeta = {
      sha256,
      size: body.length,
      type: cleanMimeType(req.headers["content-type"]),
      uploaded_by: normPk(authEvent.pubkey),
      uploaded_at: Math.floor(Date.now() / 1000),
      original_name: cleanFileName(req.headers["x-blob-name"]),
      purpose: cleanHeader(req.headers["x-blob-purpose"]),
      visibility: cleanHeader(req.headers["x-blob-visibility"]) || "public"
    };
    fs.writeFileSync(metaPath, JSON.stringify({ ...readBlobMeta(sha256), ...nextMeta }, null, 2), "utf8");

    sendJson(res, 200, {
      sha256,
      size: body.length,
      type: nextMeta.type,
      url: `${url.origin}/${sha256}`
    });
  } catch (error) {
    if (String(error?.message || "").includes("Blob exceeds")) {
      sendJson(res, 413, { error: String(error.message) });
      return;
    }
    sendJson(res, 401, { error: String(error?.message || error || "Blob upload failed.") });
  }
}

function handleBlobRead(req, res, sha256) {
  const filePath = blobFile(sha256);
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: "Blob not found." });
    return;
  }
  const meta = readBlobMeta(sha256);
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "content-type": meta.type || "application/octet-stream",
    "content-length": String(stat.size),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff"
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function setCorsHeaders(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, HEAD, PUT, OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "Authorization, Content-Type, X-Blob-Name, X-Blob-Purpose, X-Blob-Visibility"
  );
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let finished = false;
    req.on("data", (chunk) => {
      if (finished) return;
      total += chunk.length;
      if (Number.isFinite(maxBytes) && maxBytes > 0 && total > maxBytes) {
        finished = true;
        reject(new Error(`Blob exceeds ${Math.round(maxBytes / 1024)} KB.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (finished) return;
      finished = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (finished) return;
      finished = true;
      reject(error);
    });
  });
}

function unpackHttpAuthEvent(header) {
  const token = String(header || "").trim();
  if (!token) throw new Error("Missing Authorization header.");
  const raw = token.replace(/^Nostr\s+/i, "");
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  const event = JSON.parse(decoded);
  if (!event || typeof event !== "object") throw new Error("Invalid auth token.");
  return event;
}

function absoluteRequestUrl(req, url) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || url.host;
  const proto = req.headers["x-forwarded-proto"] || url.protocol.replace(":", "");
  return `${proto}://${host}${url.pathname}`;
}

function blobFile(sha256) {
  return path.join(BLOBS_DIR, sha256);
}

function blobMetaFile(sha256) {
  return path.join(BLOBS_DIR, `${sha256}.json`);
}

function readBlobMeta(sha256) {
  try {
    return JSON.parse(fs.readFileSync(blobMetaFile(sha256), "utf8"));
  } catch {
    return {};
  }
}

function writeBlobMeta(sha256, payload) {
  fs.writeFileSync(blobMetaFile(sha256), JSON.stringify(payload, null, 2), "utf8");
}

function countStoredBlobs() {
  try {
    return fs.readdirSync(BLOBS_DIR).filter((entry) => /^[0-9a-f]{64}$/i.test(entry)).length;
  } catch {
    return 0;
  }
}

function maybeHandleBlobEvent(ev, { allowFulfillment = true } = {}) {
  const refs = extractBlobRefsFromEvent(ev);
  for (const ref of refs) {
    void retainBlobReference(ref, "relay-ref");
  }
  if (allowFulfillment && Number(ev?.kind) === KINDS.blobRequest) {
    void maybeFulfillBlobRequest(ev);
  }
}

function extractBlobRefsFromEvent(ev) {
  const refs = [];
  collectBlobRefs(parseObj(ev?.content), refs, 0);
  for (const tagRef of extractBlobRefsFromTags(ev?.tags || [])) {
    refs.push(tagRef);
  }
  const deduped = new Map();
  for (const ref of refs) {
    const normalized = normalizeBlobRef(ref);
    if (!normalized) continue;
    deduped.set(normalized.sha256, normalized);
  }
  return [...deduped.values()];
}

function collectBlobRefs(value, refs, depth) {
  if (!value || depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) collectBlobRefs(item, refs, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const direct = normalizeBlobRef(value);
  if (direct) refs.push(direct);
  for (const entry of Object.values(value)) {
    collectBlobRefs(entry, refs, depth + 1);
  }
}

function extractBlobRefsFromTags(tags) {
  const refs = [];
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== "blob") continue;
    const ref = normalizeBlobRef({
      sha256: tag[1],
      url: tag[2],
      access: tag[3],
      cipher: tag[4],
      type: tag[5],
      name: tag[6],
      recipient_pubkey: tag[7],
      author_pubkey: tag[8],
    });
    if (ref) refs.push(ref);
  }
  return refs;
}

function normalizeBlobRef(value) {
  if (!value || typeof value !== "object") return null;
  const sha256 = normPk(value.sha256 || "");
  const url = String(value.url || "").trim();
  if (!isHex64(sha256) || !/^https?:\/\//i.test(url)) return null;
  return {
    sha256,
    url,
    access: String(value.access || "public").trim() || "public",
    cipher: String(value.cipher || "none").trim() || "none",
    type: cleanMimeType(value.type || "application/octet-stream"),
    name: cleanFileName(value.name || "blob.bin"),
    size: Number(value.size || 0) || 0,
    author_pubkey: normPk(value.author_pubkey || ""),
    recipient_pubkey: normPk(value.recipient_pubkey || ""),
    uploaded_at: String(value.uploaded_at || "").trim(),
  };
}

async function retainBlobReference(reference, source) {
  const ref = normalizeBlobRef(reference);
  if (!ref) return null;
  const existingJob = blobJobs.get(ref.sha256);
  if (existingJob) return existingJob;
  const job = (async () => {
    try {
      const filePath = blobFile(ref.sha256);
      if (fs.existsSync(filePath)) {
        writeBlobMeta(ref.sha256, {
          ...readBlobMeta(ref.sha256),
          ...ref,
          source_url: ref.url,
          retained_from: source,
          retained_at: Math.floor(Date.now() / 1000),
        });
        return readBlobMeta(ref.sha256);
      }
      const response = await fetch(ref.url, { method: "GET" });
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (hashBuffer(buffer) !== ref.sha256) return null;
      fs.writeFileSync(filePath, buffer);
      writeBlobMeta(ref.sha256, {
        ...readBlobMeta(ref.sha256),
        ...ref,
        size: buffer.length,
        type: cleanMimeType(response.headers.get("content-type") || ref.type),
        source_url: ref.url,
        retained_from: source,
        retained_at: Math.floor(Date.now() / 1000),
      });
      return readBlobMeta(ref.sha256);
    } catch {
      return null;
    } finally {
      blobJobs.delete(ref.sha256);
    }
  })();
  blobJobs.set(ref.sha256, job);
  return job;
}

async function maybeFulfillBlobRequest(ev) {
  const request = parseBlobRequestEvent(ev);
  if (!request) return false;
  if (!isBlobRequestAuthorized(ev.pubkey, request)) return false;
  const filePath = blobFile(request.sha256);
  if (!fs.existsSync(filePath)) {
    await retainBlobReference(request, "request-miss");
  }
  if (!fs.existsSync(filePath)) return false;
  const uploaded = await uploadBlobToCache(filePath, { ...readBlobMeta(request.sha256), ...request });
  if (!uploaded?.url) return false;
  const event = signAppEvent({
    kind: KINDS.blobFulfillment,
    tags: [
      ["d", request.sha256],
      ["x", request.sha256],
      ["r", uploaded.url],
      ["req", String(ev.id || "")],
      ["p", normPk(ev.pubkey)],
      ["blob", request.sha256, uploaded.url, request.access || "public", request.cipher || "none", request.type || "application/octet-stream", request.name || "blob.bin", request.recipient_pubkey || "", request.author_pubkey || ""],
    ],
    content: {
      protocol: `${TAG_FILTER}-blob-fulfillment/v1`,
      request_event_id: String(ev.id || ""),
      requested_by: normPk(ev.pubkey),
      fulfilled_at: new Date().toISOString(),
      blob: {
        ...request,
        url: uploaded.url,
        size: uploaded.size || request.size || 0,
        type: uploaded.type || request.type || "application/octet-stream",
      },
    },
  });
  if (!storeEvent(event)) return false;
  publishToUpstreams(event, "");
  broadcastEvent(event);
  return true;
}

function parseBlobRequestEvent(ev) {
  if (!ev || Number(ev.kind) !== KINDS.blobRequest) return null;
  const payload = parseObj(ev.content) || {};
  return normalizeBlobRef(payload.blob || payload.reference || payload);
}

function isBlobRequestAuthorized(requesterPubkey, reference) {
  const access = String(reference?.access || "public").trim().toLowerCase();
  if (!access || access === "public") return true;
  return model.admins.has(normPk(requesterPubkey));
}

async function uploadBlobToCache(filePath, reference) {
  const ref = normalizeBlobRef(reference);
  if (!ref) return null;
  const baseUrl = ensureTrailingSlash(BLOB_CACHE_BASE_URL);
  const uploadUrl = new URL("upload", baseUrl).toString();
  const body = fs.readFileSync(filePath);
  const token = await nip98.getToken(
    uploadUrl,
    "PUT",
    async (template) => finalizeEvent(template, new Uint8Array(Buffer.from(pinnerIdentity.secret_key_hex, "hex"))),
    true,
    body
  );
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: token,
      "Content-Type": cleanMimeType(ref.type),
      "X-Blob-Name": encodeURIComponent(ref.name || `${ref.sha256}.bin`),
      "X-Blob-Purpose": ref.access === "public" ? "avatar" : "attachment",
      "X-Blob-Visibility": ref.access || "public",
    },
    body,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const fallbackUrl = new URL(ref.sha256, baseUrl).toString();
    const probe = await fetch(fallbackUrl, { method: "HEAD" }).catch(() => null);
    if (!probe?.ok) return null;
    return {
      sha256: ref.sha256,
      url: fallbackUrl,
      size: Number(probe.headers.get("content-length") || ref.size || 0) || 0,
      type: cleanMimeType(probe.headers.get("content-type") || ref.type),
    };
  }
  return {
    sha256: normPk(payload?.sha256 || ref.sha256),
    url: String(payload?.url || new URL(ref.sha256, baseUrl).toString()).trim(),
    size: Number(payload?.size || ref.size || 0) || 0,
    type: cleanMimeType(payload?.type || ref.type),
  };
}

function signAppEvent({ kind, tags = [], content = "" }) {
  return finalizeEvent(
    {
      kind: Number(kind),
      created_at: Math.floor(Date.now() / 1000),
      tags: withAppTag(tags),
      content: typeof content === "string" ? content : JSON.stringify(content),
    },
    new Uint8Array(Buffer.from(pinnerIdentity.secret_key_hex, "hex"))
  );
}

function withAppTag(tags) {
  const next = Array.isArray(tags) ? tags.filter(Array.isArray).map((tag) => [...tag]) : [];
  if (!next.some((tag) => tag[0] === "t" && tag.includes(TAG_FILTER))) {
    next.push(["t", TAG_FILTER]);
  }
  if (!next.some((tag) => tag[0] === "client")) {
    next.push(["client", "nostr-site-peer-pinner"]);
  }
  return next;
}

function ensureTrailingSlash(value) {
  return String(value || "").endsWith("/") ? String(value) : `${String(value || "")}/`;
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function cleanMimeType(value) {
  const input = String(value || "").split(";")[0].trim();
  return input || "application/octet-stream";
}

function cleanFileName(value) {
  try {
    const decoded = decodeURIComponent(String(value || ""));
    return String(decoded)
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 160);
  } catch {
    return "";
  }
}

function cleanHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
}

function startUpstreamMirrors() {
  for (const relay of UPSTREAM_RELAYS) {
    connectUpstream(relay);
  }
}

function connectUpstream(relay) {
  const existing = upstreams.get(relay);
  if (existing?.ws && (existing.ws.readyState === WebSocket.CONNECTING || existing.ws.readyState === WebSocket.OPEN)) return;

  const client = {
    relay,
    ws: null,
    connected: false,
    retryTimer: null,
    subId: `cms-sync-${Math.random().toString(36).slice(2, 10)}`,
  };
  upstreams.set(relay, client);

  const ws = new WebSocket(relay);
  client.ws = ws;

  ws.on("open", () => {
    client.connected = true;
    wsSend(ws, ["REQ", client.subId, buildMirrorFilter()]);
    console.log(`upstream connected ${relay}`);
  });

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(String(buf));
    } catch {
      return;
    }
    if (!Array.isArray(msg) || msg.length === 0) return;
    const cmd = String(msg[0] || "");
    if (cmd === "EVENT") {
      const ev = msg[2];
      if (!isEventShape(ev)) return;
      if (eventsById.has(ev.id)) return;
      if (!storeEvent(ev)) return;
      broadcastEvent(ev);
      maybeShareSnapshotForRequest(ev, relay);
    }
  });

  ws.on("error", () => {
    // handled by close + reconnect
  });

  ws.on("close", () => {
    client.connected = false;
    try {
      wsSend(ws, ["CLOSE", client.subId]);
    } catch {
      // ignore
    }
    scheduleReconnect(relay);
  });
}

function scheduleReconnect(relay) {
  const client = upstreams.get(relay);
  if (!client) return;
  clearTimeout(client.retryTimer);
  client.retryTimer = setTimeout(() => {
    connectUpstream(relay);
  }, UPSTREAM_RECONNECT_MS);
}

function buildMirrorFilter() {
  const filter = {
    "#t": [TAG_FILTER],
    kinds: KINDS_FILTER,
    limit: Math.max(1, Math.min(MAX_REQ_EVENTS, UPSTREAM_BACKFILL_LIMIT)),
  };
  return filter;
}

function loadEvents() {
  const raw = fs.readFileSync(EVENTS_FILE, "utf8");
  if (!raw) return;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t);
      if (!isEventShape(ev)) continue;
      if (eventsById.has(ev.id)) continue;
      eventsById.set(ev.id, ev);
      ordered.push(ev);
      ingestDerivedEvent(ev);
    } catch {
      // Ignore malformed line.
    }
  }
  orderedDirty = true;
  ensureOrderedAsc();
  recomputeDerived();
  for (const ev of ordered) {
    maybeHandleBlobEvent(ev, { allowFulfillment: false });
  }
  console.log(`loaded ${ordered.length} events from ${EVENTS_FILE}`);
}

function ensureOrderedAsc() {
  if (!orderedDirty) return;
  ordered.sort(compareEventAsc);
  orderedDirty = false;
}

function compareEventAsc(a, b) {
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function storeEvent(ev) {
  if (eventsById.has(ev.id)) return false;
  if (!persistEvent(ev)) return false;
  eventsById.set(ev.id, ev);
  if (ordered.length > 0 && compareEventAsc(ordered[ordered.length - 1], ev) > 0) {
    orderedDirty = true;
  }
  ordered.push(ev);
  ingestDerivedEvent(ev);
  recomputeDerived();
  maybeHandleBlobEvent(ev, { allowFulfillment: true });
  return true;
}

function persistEvent(ev) {
  try {
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(ev)}\n`, { encoding: "utf8" });
    persistWriteOk += 1;
    return true;
  } catch (err) {
    persistWriteFail += 1;
    lastPersistError = String(err?.message || err || "unknown error");
    console.error(`persist failed (${EVENTS_FILE}): ${lastPersistError}`);
    return false;
  }
}

function publishToUpstreams(ev, skipRelay) {
  for (const [relay, client] of upstreams.entries()) {
    if (skipRelay && relay === skipRelay) continue;
    const ws = client.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) continue;
    wsSend(ws, ["EVENT", ev]);
  }
}

function sendBacklog(ws, subId, filters) {
  ensureOrderedAsc();
  const seen = new Set();
  const merged = [];
  for (const filter of filters) {
    const limitRaw = Number(filter.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(0, Math.min(MAX_REQ_EVENTS, Math.floor(limitRaw))) : MAX_REQ_EVENTS;
    if (limit <= 0) continue;
    let count = 0;
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const ev = ordered[i];
      if (!matchesFilter(ev, filter)) continue;
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        merged.push(ev);
      }
      count += 1;
      if (count >= limit) break;
    }
  }
  merged.sort((a, b) => (b.created_at !== a.created_at ? b.created_at - a.created_at : String(b.id).localeCompare(String(a.id))));
  for (const ev of merged) wsSend(ws, ["EVENT", subId, ev]);
}

function broadcastEvent(ev) {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const subs = client._cmsSubs;
    if (!subs || !(subs instanceof Map)) continue;
    for (const [subId, filters] of subs.entries()) {
      if (matchesAnyFilter(ev, filters)) {
        wsSend(client, ["EVENT", subId, ev]);
      }
    }
  }
}

function matchesAnyFilter(ev, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return true;
  return filters.some((f) => matchesFilter(ev, f));
}

function matchesFilter(ev, filter) {
  if (!filter || typeof filter !== "object") return true;
  if (Array.isArray(filter.ids) && filter.ids.length > 0) {
    const ok = filter.ids.some((x) => String(ev.id || "").startsWith(String(x || "")));
    if (!ok) return false;
  }
  if (Array.isArray(filter.authors) && filter.authors.length > 0) {
    const ok = filter.authors.some((x) => String(ev.pubkey || "").startsWith(String(x || "")));
    if (!ok) return false;
  }
  if (Array.isArray(filter.kinds) && filter.kinds.length > 0) {
    const kinds = new Set(filter.kinds.map((x) => Number(x)));
    if (!kinds.has(Number(ev.kind))) return false;
  }
  if (Number.isFinite(Number(filter.since)) && Number(ev.created_at) < Number(filter.since)) return false;
  if (Number.isFinite(Number(filter.until)) && Number(ev.created_at) > Number(filter.until)) return false;

  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith("#")) continue;
    const tagName = key.slice(1);
    if (!Array.isArray(values) || values.length === 0) continue;
    const valueSet = new Set(values.map((v) => String(v)));
    let tagMatch = false;
    for (const tag of ev.tags || []) {
      if (!Array.isArray(tag) || String(tag[0] || "") !== tagName) continue;
      for (let i = 1; i < tag.length; i += 1) {
        if (valueSet.has(String(tag[i]))) {
          tagMatch = true;
          break;
        }
      }
      if (tagMatch) break;
    }
    if (!tagMatch) return false;
  }
  return true;
}

function isEventShape(ev) {
  if (!ev || typeof ev !== "object") return false;
  if (!isStr(ev.id) || !isStr(ev.pubkey) || !isStr(ev.sig) || !isStr(ev.content)) return false;
  if (!Number.isFinite(Number(ev.kind)) || !Number.isFinite(Number(ev.created_at))) return false;
  if (!Array.isArray(ev.tags)) return false;
  return true;
}

function isStr(v) {
  return typeof v === "string";
}

function wsSend(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function sendNotice(ws, msg) {
  wsSend(ws, ["NOTICE", String(msg || "")]);
}

function ingestDerivedEvent(ev) {
  if (!ev || typeof ev !== "object") return;
  const kind = Number(ev.kind);
  if (kind === KINDS.adminClaim) {
    const p = parseObj(ev.content);
    if (!p) return;
    const pk = normPk(p.admin_pubkey || firstTag(ev, "admin"));
    if (!isHex64(pk) || pk !== normPk(ev.pubkey)) return;
    model.adminClaims.push({
      ev,
      pubkey: pk,
      claimed_at: unixOr(p.claimed_at || firstTag(ev, "version"), ev.created_at),
    });
    return;
  }
  if (kind === KINDS.adminRole) {
    const p = parseObj(ev.content);
    if (!p) return;
    const action = p.action === "grant" ? "grant" : p.action === "revoke" ? "revoke" : "";
    const target = normPk(p.target_pubkey || firstTag(ev, "p"));
    if (!action || !isHex64(target)) return;
    model.adminRoleEvents.push({
      ev,
      pubkey: normPk(ev.pubkey),
      target_pubkey: target,
      action,
      created_at: ev.created_at,
      id: ev.id,
    });
    return;
  }
  if (kind === KINDS.nameClaim) {
    const p = parseObj(ev.content);
    if (!p) return;
    const name = normName(p.name || firstTag(ev, "name"));
    if (!name) return;
    model.nameClaimEvents.push({
      ev,
      pubkey: normPk(ev.pubkey),
      name,
      created_at: ev.created_at,
      id: ev.id,
    });
    return;
  }
  if (kind === KINDS.snapshot) {
    const p = parseObj(ev.content);
    if (!p || !Array.isArray(p.entries)) return;
    model.snapshotEvents.push({
      ev,
      version_ts: unixOr(p.version_ts || firstTag(ev, "version"), ev.created_at),
      admin_pubkey: normPk(p.admin_pubkey || ""),
    });
  }
}

function recomputeDerived() {
  recomputeAdmin();
  recomputeNameClaims();
  recomputeSnapshotChoice();
}

function recomputeAdmin() {
  recomputeAdminRoot();
  recomputeAdminRoles();
}

function recomputeAdminRoot() {
  const sorted = [...model.adminClaims].sort((a, b) => {
    if (a.claimed_at !== b.claimed_at) return a.claimed_at - b.claimed_at;
    if (a.ev.created_at !== b.ev.created_at) return a.ev.created_at - b.ev.created_at;
    return String(a.ev.id || "").localeCompare(String(b.ev.id || ""));
  });
  if (sorted.length > 0) {
    model.admin = { pubkey: sorted[0].pubkey, claimEvent: sorted[0].ev };
  } else {
    model.admin = { pubkey: "", claimEvent: null };
  }
}

function recomputeAdminRoles() {
  const next = new Set();
  if (isHex64(model.admin.pubkey)) next.add(model.admin.pubkey);

  const sorted = [...model.adminRoleEvents].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at - b.created_at;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  for (const role of sorted) {
    if (!next.has(role.pubkey)) continue;
    if (role.action === "grant") {
      next.add(role.target_pubkey);
    } else if (role.action === "revoke" && role.target_pubkey !== model.admin.pubkey) {
      next.delete(role.target_pubkey);
    }
  }
  model.admins = next;
}

function recomputeNameClaims() {
  const byName = new Map();
  const sorted = [...model.nameClaimEvents].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at - b.created_at;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  for (const claim of sorted) {
    if (!byName.has(claim.name)) {
      byName.set(claim.name, {
        name: claim.name,
        pubkey: claim.pubkey,
        created_at: claim.created_at,
        id: claim.id,
      });
    }
  }

  const byPubInfo = new Map();
  for (const claim of sorted) {
    const owner = byName.get(claim.name);
    if (!owner || owner.pubkey !== claim.pubkey) continue;
    const cur = byPubInfo.get(claim.pubkey);
    if (!cur || claim.created_at > cur.created_at || (claim.created_at === cur.created_at && claim.id > cur.id)) {
      byPubInfo.set(claim.pubkey, {
        name: claim.name,
        created_at: claim.created_at,
        id: claim.id,
      });
    }
  }
  const byPub = new Map();
  for (const [pubkey, info] of byPubInfo.entries()) {
    byPub.set(pubkey, info.name);
  }
  model.nameOwnerByName = byName;
  model.nameByPubkey = byPub;
}

function recomputeSnapshotChoice() {
  let win = null;
  if (!isHex64(model.admin.pubkey)) {
    model.snapshot = null;
    return;
  }
  for (const s of model.snapshotEvents) {
    const signer = normPk(s.ev.pubkey);
    if (!model.admins.has(signer)) continue;
    if (s.admin_pubkey && s.admin_pubkey !== model.admin.pubkey) continue;
    if (!win) {
      win = s;
      continue;
    }
    if (s.version_ts > win.version_ts) {
      win = s;
      continue;
    }
    if (s.version_ts === win.version_ts) {
      if (s.ev.created_at > win.ev.created_at) {
        win = s;
        continue;
      }
      if (s.ev.created_at === win.ev.created_at && String(s.ev.id || "") > String(win.ev.id || "")) {
        win = s;
      }
    }
  }
  model.snapshot = win || null;
}

function maybeShareSnapshotForRequest(ev, originRelay) {
  if (!ev || Number(ev.kind) !== KINDS.snapshotRequest) return false;
  const p = parseObj(ev.content);
  if (!p) return false;
  const req = cleanRequestId(p.request_id || firstTag(ev, "req"));
  if (!req || model.snapshotRequestsSeen.has(req)) return false;
  model.snapshotRequestsSeen.add(req);
  if (!model.snapshot?.ev) return false;
  publishToUpstreams(model.snapshot.ev, String(originRelay || ""));
  broadcastEvent(model.snapshot.ev);
  return true;
}

function resolveUserExists(aliasInput) {
  const alias = normName(aliasInput);
  if (!alias) {
    return { alias: "", exists: false, owner_pubkey: "", owner_alias: "", claimed_at: 0, event_id: "" };
  }
  let owner = model.nameOwnerByName.get(alias) || null;
  let resolvedAlias = alias;
  if (!owner) {
    const lower = alias.toLowerCase();
    for (const [name, info] of model.nameOwnerByName.entries()) {
      if (name.toLowerCase() === lower) {
        owner = info;
        resolvedAlias = name;
        break;
      }
    }
  }
  if (!owner) {
    return { alias: resolvedAlias, exists: false, owner_pubkey: "", owner_alias: "", claimed_at: 0, event_id: "" };
  }
  return {
    alias: resolvedAlias,
    exists: true,
    owner_pubkey: owner.pubkey,
    owner_alias: model.nameByPubkey.get(owner.pubkey) || resolvedAlias,
    claimed_at: owner.created_at,
    event_id: owner.id,
  };
}

function resolveLatestSnapshot() {
  const snap = model.snapshot;
  if (!snap?.ev) {
    return { exists: false, event_id: "", version_ts: 0, admin_pubkey: "", created_at: 0, snapshot_event: null };
  }
  return {
    exists: true,
    event_id: String(snap.ev.id || ""),
    version_ts: unixOr(snap.version_ts, 0),
    admin_pubkey: normPk(snap.admin_pubkey || model.admin.pubkey || ""),
    created_at: unixOr(snap.ev.created_at, 0),
    snapshot_event: snap.ev,
  };
}

function resolveLogicalState() {
  return {
    root_admin: normPk(model.admin.pubkey || ""),
    admins: [...model.admins.values()],
    aliases: model.nameOwnerByName.size,
    snapshots: model.snapshotEvents.length,
    latest_snapshot_event_id: model.snapshot?.ev?.id || "",
    latest_snapshot_version_ts: model.snapshot?.version_ts || 0,
  };
}

function firstTag(ev, key) {
  const hit = ev?.tags?.find((t) => Array.isArray(t) && t[0] === key);
  return hit ? String(hit[1] || "") : "";
}

function parseObj(text) {
  if (typeof text !== "string") return null;
  try {
    const x = JSON.parse(text);
    return x && typeof x === "object" ? x : null;
  } catch {
    return null;
  }
}

function unixOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fb;
}

function normPk(v) {
  return String(v || "").trim().toLowerCase();
}

function normName(v) {
  return String(v || "").trim().replace(/^@+/, "").slice(0, 32);
}

function cleanRequestId(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "")
    .slice(0, 80);
}

function loadOrCreatePeerPinnerIdentity(identityFile, aliasOverride) {
  const file = String(identityFile || "").trim();
  if (!file) throw new Error("identity file path required");

  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const secret_key_hex = String(raw.secret_key_hex || "").toLowerCase();
      if (isHex64(secret_key_hex)) {
        const pubkey = derivePubkey(secret_key_hex);
        if (isHex64(pubkey)) {
          const alias = cleanAlias(String(aliasOverride || raw.alias || ""));
          return {
            alias: alias || aliasFromPubkey(pubkey),
            pubkey,
            secret_key_hex,
          };
        }
      }
    } catch {
      // Fall through to regenerate.
    }
  }

  const secret_key_hex = generateSecretKeyHex();
  const pubkey = derivePubkey(secret_key_hex);
  const alias = cleanAlias(String(aliasOverride || aliasFromPubkey(pubkey)));
  const out = {
    protocol: "nostr-site-peer-pinner-identity/v1",
    created_at: Math.floor(Date.now() / 1000),
    alias,
    pubkey,
    secret_key_hex,
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Non-posix filesystems may ignore mode.
  }
  return out;
}

function derivePubkey(secretKeyHex) {
  const sk = Buffer.from(secretKeyHex, "hex");
  const ecdh = crypto.createECDH("secp256k1");
  ecdh.setPrivateKey(sk);
  const uncompressed = ecdh.getPublicKey(null, "uncompressed");
  return Buffer.from(uncompressed).subarray(1, 33).toString("hex");
}

function generateSecretKeyHex() {
  const secpOrder = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
  while (true) {
    const bytes = crypto.randomBytes(32);
    const val = BigInt(`0x${bytes.toString("hex")}`);
    if (val > 0n && val < secpOrder) {
      return bytes.toString("hex");
    }
  }
}

function cleanAlias(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function aliasFromPubkey(pubkey) {
  const a = [
    "amber", "atlas", "brisk", "cedar", "clear", "cobalt", "copper", "crisp",
    "delta", "ember", "fable", "fierce", "flint", "glint", "gold", "granite",
    "harbor", "hollow", "ion", "iron", "juniper", "kindle", "lattice", "lunar",
    "marble", "mesa", "mint", "moss", "nova", "onyx", "opal", "orbit",
    "pine", "plume", "pulse", "quartz", "rally", "ridge", "river", "rust",
    "sage", "scarlet", "signal", "silver", "slate", "solar", "sparrow", "spruce",
    "stone", "swift", "timber", "topaz", "trail", "union", "velvet", "vivid",
    "wave", "west", "whistle", "wild", "winter", "zenith", "zephyr", "zinc",
  ];
  const b = [
    "anchor", "arrow", "beacon", "blaze", "branch", "bridge", "brook", "canyon",
    "castle", "circle", "cloud", "comet", "crow", "dawn", "drift", "echo",
    "elm", "falcon", "field", "flare", "forest", "forge", "glacier", "grove",
    "harvest", "horizon", "isle", "junction", "lake", "lantern", "meadow", "meridian",
    "mountain", "north", "oak", "ocean", "path", "peak", "prairie", "ray",
    "reef", "resin", "road", "rook", "shore", "sierra", "sky", "spring",
    "star", "summit", "thunder", "tide", "torch", "tower", "valley", "vista",
    "voyage", "water", "willow", "wind", "wolf", "yard", "yonder", "zen",
  ];
  const c = [
    "alliance", "anthem", "arc", "banner", "beat", "bridge", "cadence", "call",
    "chorus", "collective", "current", "drum", "echo", "flame", "flow", "frame",
    "fuse", "gather", "groove", "harbor", "harmony", "hinge", "hymn", "line",
    "link", "march", "marker", "matrix", "movement", "north", "orbit", "origin",
    "pattern", "peak", "phase", "pulse", "rally", "record", "relay", "rhythm",
    "rise", "route", "signal", "spark", "spectrum", "spirit", "stone", "stream",
    "stride", "thread", "tide", "tone", "track", "union", "vector", "verse",
    "vibe", "voice", "wave", "waypoint", "wing", "witness", "yard", "zero",
  ];
  const hash = crypto.createHash("sha256").update(Buffer.from(pubkey, "hex")).digest();
  const p1 = a[hash[0] % a.length];
  const p2 = b[hash[13] % b.length];
  const p3 = c[hash[27] % c.length];
  return `${p1}-${p2}-${p3}`;
}

function isHex64(v) {
  return typeof v === "string" && /^[0-9a-f]{64}$/i.test(v);
}

function shortKey(pk) {
  const x = String(pk || "");
  if (x.length < 12) return x;
  return `${x.slice(0, 8)}..${x.slice(-6)}`;
}

function parseRelays(raw) {
  const out = [];
  const seen = new Set();
  for (const part of String(raw || "").split(",")) {
    const x = String(part || "").trim();
    if (!x || seen.has(x)) continue;
    if (!(x.startsWith("wss://") || x.startsWith("ws://"))) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function parseKinds(raw) {
  const out = [];
  const seen = new Set();
  for (const part of String(raw || "").split(",")) {
    const n = Number(String(part || "").trim());
    if (!Number.isFinite(n)) continue;
    const v = Math.floor(n);
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.length > 0 ? out : [34123, 34124, 34125, 34126, 34127, 34128, 34129, 34130, 34131, 34132];
}

function fileSizeSafe(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}
