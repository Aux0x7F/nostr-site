export function createBlobStoreApi(config, deps) {
  const {
    ensureEventToolsLoaded,
    getEventTools,
    deriveIdentity,
    loadPublicState,
    publishTaggedJson
  } = deps;

  async function uploadPublicBlob(secretKeyHex, file, options = {}) {
    return uploadBlob(secretKeyHex, file, {
      ...options,
      visibility: "public",
      encryptToPubkey: ""
    });
  }

  async function uploadEncryptedBlob(secretKeyHex, targetPubkey, file, options = {}) {
    if (!String(targetPubkey || "").trim()) {
      throw new Error("Encrypted blob uploads require a target pubkey.");
    }
    return uploadBlob(secretKeyHex, file, {
      ...options,
      visibility: "encrypted",
      encryptToPubkey: String(targetPubkey || "").trim()
    });
  }

  async function decryptUploadedBlob(secretKeyHex, authorPubkey, reference) {
    const target = typeof reference === "string" ? { url: reference } : reference || {};
    const url = resolveBlobUrl(target.url);
    const tools = await ensureEventToolsLoaded();
    const { nip04 } = tools;
    if (!nip04?.decrypt) throw new Error("Blob decryption support unavailable.");
    const identity = deriveIdentity(secretKeyHex);
    const response = await fetchWithRefresh(secretKeyHex, target, { method: "GET" });
    const ciphertext = await response.text();
    const decrypted = await nip04.decrypt(identity.secretKey, String(authorPubkey || "").trim(), ciphertext);
    const payload = JSON.parse(decrypted);
    const bytes = base64ToBytes(payload.data_base64 || "");
    const type = String(payload.type || target.type || "application/octet-stream").trim() || "application/octet-stream";
    const name = String(payload.name || target.name || "attachment.bin").trim() || "attachment.bin";
    return {
      ...target,
      name,
      type,
      size: Number(payload.size || bytes.length) || bytes.length,
      bytes,
      blob: new Blob([bytes], { type })
    };
  }

  async function ensureBlobAvailable(secretKeyHex, reference, options = {}) {
    const target = normalizeReference(reference);
    const response = await fetchWithRefresh(secretKeyHex, target, {
      method: "HEAD",
      timeoutMs: options.timeoutMs,
      note: options.note || "cache-refresh"
    });
    return {
      ...target,
      url: resolveBlobUrl(target.url),
      status: response.status
    };
  }

  async function publishBlobRequest(secretKeyHex, reference, options = {}) {
    if (!publishTaggedJson) throw new Error("Blob request publishing is unavailable.");
    const target = normalizeReference(reference);
    if (!secretKeyHex) throw new Error("Signed blob requests require a session.");
    const requestedAt = new Date().toISOString();
    return publishTaggedJson({
      kind: config.nostr.kinds.blobRequest,
      secretKeyHex,
      tags: [
        ["d", target.sha256],
        ["x", target.sha256],
        ["r", target.url],
        ["blob", target.sha256, target.url, target.access || "public", target.cipher || "none"]
      ],
      content: {
        protocol: protocolName(config, "blob-request"),
        request_id: `${target.sha256}:${Date.now()}`,
        requested_at: requestedAt,
        note: String(options.note || "cache-refresh").trim(),
        blob: target
      }
    });
  }

  async function waitForBlobFulfillment(reference, options = {}) {
    if (!loadPublicState) return null;
    const target = normalizeReference(reference);
    const timeoutMs = Number(options.timeoutMs || config?.blobs?.requestTimeoutMs || 8000);
    const pollMs = Number(config?.blobs?.requestPollMs || 900);
    const deadline = Date.now() + Math.max(1000, timeoutMs);
    while (Date.now() < deadline) {
      const publicState = await loadPublicState(true).catch(() => null);
      const hit =
        publicState?.blobFulfillments?.get(target.sha256) ||
        publicState?.blobFulfillments?.get(target.url?.toLowerCase?.() || "");
      if (hit) return hit;
      await delay(pollMs);
    }
    return null;
  }

  async function uploadBlob(secretKeyHex, file, options = {}) {
    const blob = normalizeBlobInput(file);
    const fileName = cleanFileName(options.fileName || blob.name || "upload.bin");
    const originalType = String(options.type || blob.type || "application/octet-stream").trim() || "application/octet-stream";
    const baseUrl = resolveBlobBaseUrl();
    const tools = await ensureEventToolsLoaded();
    const { finalizeEvent, nip04, nip98 } = tools;
    if (!finalizeEvent || !nip98?.getToken) {
      throw new Error("Blob upload auth helpers are unavailable.");
    }

    const identity = deriveIdentity(secretKeyHex);
    let bodyBytes = new Uint8Array(await blob.arrayBuffer());
    let uploadType = originalType;

    if (options.encryptToPubkey) {
      if (!nip04?.encrypt) throw new Error("Blob encryption support unavailable.");
      const encryptedPayload = await nip04.encrypt(
        identity.secretKey,
        String(options.encryptToPubkey || "").trim(),
        JSON.stringify({
          name: fileName,
          type: originalType,
          size: blob.size,
          data_base64: bytesToBase64(bodyBytes)
        })
      );
      bodyBytes = new TextEncoder().encode(encryptedPayload);
      uploadType = "application/x-nostr-encrypted-blob";
    }

    const maxBytes = Number(config?.blobs?.maxUploadBytes || 0);
    if (Number.isFinite(maxBytes) && maxBytes > 0 && bodyBytes.byteLength > maxBytes) {
      throw new Error(`Blob exceeds ${Math.round(maxBytes / 1024)} KB.`);
    }

    const uploadUrl = new URL("upload", ensureTrailingSlash(baseUrl)).toString();
    const authToken = await nip98.getToken(
      uploadUrl,
      "PUT",
      async (template) => finalizeEvent(template, identity.secretKey),
      true,
      bodyBytes
    );

    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: authToken,
        "Content-Type": uploadType,
        "X-Blob-Name": encodeURIComponent(fileName),
        "X-Blob-Purpose": cleanHeader(options.purpose || ""),
        "X-Blob-Visibility": cleanHeader(options.visibility || "public")
      },
      body: bodyBytes
    });

    const payload = await parseUploadResponse(response);
    const blobUrl = resolveBlobUrl(payload.url);

    return {
      sha256: String(payload.sha256 || "").trim().toLowerCase(),
      url: blobUrl,
      name: fileName,
      type: originalType,
      size: Number(blob.size) || 0,
      access: options.encryptToPubkey ? "encrypted" : "public",
      cipher: options.encryptToPubkey ? "nip04-json-base64" : "none",
      author_pubkey: identity.pubkey,
      recipient_pubkey: options.encryptToPubkey || "",
      purpose: String(options.purpose || "").trim(),
      uploaded_at: new Date().toISOString()
    };
  }

  function resolveBlobBaseUrl() {
    const configured = String(config?.blobs?.baseUrl || "").trim();
    if (configured) return configured;
    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
    }
    throw new Error("Blob uploads are not configured for this site.");
  }

  return {
    uploadPublicBlob,
    uploadEncryptedBlob,
    decryptUploadedBlob,
    ensureBlobAvailable,
    publishBlobRequest,
    waitForBlobFulfillment
  };

  async function fetchWithRefresh(secretKeyHex, reference, options = {}) {
    const target = normalizeReference(reference);
    const response = await fetch(resolveBlobUrl(target.url), { method: options.method || "GET" });
    if (response.ok) return response;
    if (!shouldRequestRefresh(response.status)) {
      throw new Error(`Blob download failed with ${response.status}.`);
    }
    if (!secretKeyHex) {
      throw new Error("Blob is not currently available from cache.");
    }
    await publishBlobRequest(secretKeyHex, target, { note: options.note || "cache-refresh" });
    const fulfillment = await waitForBlobFulfillment(target, options);
    if (!fulfillment) {
      throw new Error("Blob cache refresh timed out.");
    }
    const retry = await fetch(resolveBlobUrl(fulfillment.url || target.url), { method: options.method || "GET" });
    if (!retry.ok) {
      throw new Error(`Blob download failed with ${retry.status}.`);
    }
    return retry;
  }
}

export default createBlobStoreApi;

function normalizeBlobInput(file) {
  if (file instanceof Blob) return file;
  throw new Error("Select a file to upload.");
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveBlobUrl(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("Blob URL is missing.");
  if (/^https?:\/\//i.test(input)) return input;
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL(input.replace(/^\.\//, ""), `${window.location.origin}/`).toString();
  }
  return input;
}

function normalizeReference(reference) {
  const target = reference && typeof reference === "object" ? reference : { url: reference };
  const sha256 = String(target.sha256 || "").trim().toLowerCase();
  const url = resolveBlobUrl(target.url);
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Blob reference is missing a valid sha256.");
  }
  return {
    sha256,
    url,
    access: String(target.access || "public").trim() || "public",
    cipher: String(target.cipher || "none").trim() || "none",
    type: String(target.type || "application/octet-stream").trim() || "application/octet-stream",
    name: cleanFileName(target.name || "blob.bin"),
    size: Number(target.size || 0) || 0,
    author_pubkey: String(target.author_pubkey || "").trim().toLowerCase(),
    recipient_pubkey: String(target.recipient_pubkey || "").trim().toLowerCase(),
    uploaded_at: String(target.uploaded_at || "").trim()
  };
}

async function parseUploadResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(String(payload?.error || payload?.message || `Blob upload failed with ${response.status}.`));
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Blob upload did not return valid JSON.");
  }
  return payload;
}

function cleanFileName(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 160);
  return normalized || "upload.bin";
}

function cleanHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
}

function shouldRequestRefresh(status) {
  return Number(status) === 404 || Number(status) === 410;
}

function protocolName(config, suffix) {
  const prefix = String(config?.nostr?.protocolPrefix || config?.nostr?.clientName || config?.nostr?.appTag || "nostr-site")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "nostr-site";
  const cleanSuffix = String(suffix || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleanSuffix ? `${prefix}-${cleanSuffix}/v1` : `${prefix}/v1`;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(50, Number(ms) || 0));
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
