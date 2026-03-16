export function createNostrCmsClient(config) {
let publicStatePromise = null;
let toolsPromise = null;
let publicStateRepairPeer = null;
const handledPublicStateRepairRequests = new Set();
const publicEventVerificationCache = new Map();
const toolScriptPaths = {
  bundle: config?.nostr?.toolScriptPaths?.bundle || "./vendor/event-tools.bundle.js",
  shim: config?.nostr?.toolScriptPaths?.shim || "./vendor/event-tools-shim.js"
};

function getEventTools() {
  return window.EventTools || window[["No", "strTools"].join("")] || null;
}

function hasNostrTools() {
  return Boolean(getEventTools());
}

function rememberPublicEventVerification(id, valid) {
  if (!id) return valid;
  publicEventVerificationCache.set(id, Boolean(valid));
  if (publicEventVerificationCache.size <= 4096) return valid;
  const values = [...publicEventVerificationCache.entries()];
  publicEventVerificationCache.clear();
  for (const [entryId, entryValid] of values.slice(-2048)) {
    publicEventVerificationCache.set(entryId, entryValid);
  }
  return valid;
}

function isVerifiedPublicEvent(event) {
  const normalized = normalizeCachedPublicEvent(event);
  if (!normalized?.id) return false;
  if (publicEventVerificationCache.has(normalized.id)) {
    return publicEventVerificationCache.get(normalized.id) === true;
  }
  const tools = getEventTools();
  if (!tools) return false;
  const structurallyValid = typeof tools?.validateEvent === "function"
    ? tools.validateEvent(normalized)
    : true;
  if (!structurallyValid) return rememberPublicEventVerification(normalized.id, false);
  const signatureValid = typeof tools?.verifyEvent === "function"
    ? tools.verifyEvent(normalized)
    : true;
  return rememberPublicEventVerification(normalized.id, signatureValid);
}

function ensureEventToolsLoaded() {
  if (getEventTools()) return Promise.resolve(getEventTools());
  if (toolsPromise) return toolsPromise;

  toolsPromise = loadScript(toolScriptPaths.bundle)
    .then(() => loadScript(toolScriptPaths.shim))
    .then(() => {
      const tools = getEventTools();
      if (!tools) throw new Error("Event tools failed to initialize.");
      return tools;
    });

  return toolsPromise;
}

function shortKey(value) {
  const clean = String(value || "").trim();
  if (clean.length < 12) return clean;
  return `${clean.slice(0, 8)}...${clean.slice(-4)}`;
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function protocolName(value) {
  const prefix = String(config?.nostr?.protocolPrefix || config?.nostr?.clientName || config?.nostr?.appTag || "nostr-site")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "nostr-site";
  const suffix = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return suffix ? `${prefix}-${suffix}/v1` : `${prefix}/v1`;
}

function deriveIdentity(secretKeyHex) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const clean = String(secretKeyHex || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error("Secret key must be 64 hex characters.");
  const secretKey = resolveHexToBytes(tools)(clean);
  return {
    secretKey,
    secretKeyHex: clean,
    pubkey: tools.getPublicKey(secretKey)
  };
}

function resolveHexToBytes(tools) {
  if (typeof tools?.hexToBytes === "function") return tools.hexToBytes;
  if (typeof tools?.utils?.hexToBytes === "function") return tools.utils.hexToBytes;
  return hexToBytes;
}

function resolveConfiguredSitePubkey() {
  return normalizePubkey(config?.nostr?.inboxPubkey || "");
}

function resolveSitePubkey(publicState = null) {
  return normalizePubkey(publicState?.siteInfo?.activePubkey || resolveConfiguredSitePubkey());
}

function normalizeRelayList(values, fallback = []) {
  const source = Array.isArray(values) && values.length ? values : fallback;
  return [...new Set(source.map((value) => String(value || "").trim()).filter(Boolean))];
}

function publicRelayList() {
  return normalizeRelayList(config?.nostr?.relays || []);
}

function authorityRelayList() {
  return normalizeRelayList(config?.nostr?.authorityRelays, publicRelayList());
}

function combinedAuthorityRelayList() {
  return normalizeRelayList([...authorityRelayList(), ...publicRelayList()]);
}

function authorityConnectTimeoutMs() {
  const value = Number(config?.nostr?.authorityConnectTimeoutMs || config?.nostr?.connectTimeoutMs || 3200);
  return Number.isFinite(value) && value > 0 ? value : 3200;
}

function isAuthorityKind(kind) {
  return new Set([
    config?.nostr?.kinds?.adminClaim,
    config?.nostr?.kinds?.adminRole,
    config?.nostr?.kinds?.userMod,
    config?.nostr?.kinds?.nameClaim,
    config?.nostr?.kinds?.profile,
    config?.nostr?.kinds?.snapshotRequest,
    config?.nostr?.kinds?.adminKeyRequest,
    config?.nostr?.kinds?.siteKey,
    config?.nostr?.kinds?.adminKeyShare
  ]).has(Number(kind));
}

function publishRelayListForKind(kind) {
  return isAuthorityKind(kind) ? combinedAuthorityRelayList() : publicRelayList();
}

async function generateSecretKeyHex() {
  await ensureEventToolsLoaded();
  let attempt = 0;
  while (attempt < 16) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const secretKeyHex = bytesToHex(bytes);
    try {
      deriveIdentity(secretKeyHex);
      return secretKeyHex;
    } catch {
      attempt += 1;
    }
  }
  throw new Error("Could not generate a valid site key.");
}

async function loadPublicState(force = false) {
  if (!force && publicStatePromise) return publicStatePromise;
  publicStatePromise = fetchPublicState().finally(() => {
    publicStatePromise = null;
  });
  return publicStatePromise;
}

function publicStateNeedsRepair(publicState) {
  if (!publicState || typeof publicState !== "object") return true;
  const syncInfo = publicState.syncInfo && typeof publicState.syncInfo === "object"
    ? publicState.syncInfo
    : {};
  const remoteEventCount = Number(syncInfo.remoteEventCount || 0) || 0;
  const cachedEventCount = Number(syncInfo.cachedEventCount || 0) || 0;
  const rawEventCount = Array.isArray(publicState.rawEvents) ? publicState.rawEvents.length : 0;
  if (!rawEventCount) return true;
  if (!publicState.connected && cachedEventCount > 0) return true;
  if (cachedEventCount > 0 && remoteEventCount === 0) return true;
  return cachedEventCount > remoteEventCount * 2 && remoteEventCount < 24;
}

async function requestPublicStateRepair(secretKeyHex, options = {}) {
  if (!config?.nostr?.kinds?.publicStateRequest) return null;
  const requestId = cleanSlug(options.requestId || `repair-${Date.now()}`) || `repair-${Date.now()}`;
  const reason = String(options.reason || "incomplete-public-state").trim() || "incomplete-public-state";
  const page = cleanSlug(options.page || "") || "";
  const knownEventCount = Number(options.knownEventCount || 0) || 0;
  return publishTaggedJson({
    kind: config.nostr.kinds.publicStateRequest,
    secretKeyHex,
    tags: [
      ["d", requestId],
      ["k", "public-state-repair"],
      ...(page ? [["page", page]] : []),
      ["op", reason]
    ],
    content: {
      protocol: protocolName("public-state-repair"),
      request_id: requestId,
      requested_at: new Date().toISOString(),
      page,
      reason,
      known_event_count: knownEventCount
    }
  });
}

async function startPublicStateRepairPeer(options = {}) {
  if (publicStateRepairPeer) return publicStateRepairPeer;
  if (!config?.nostr?.kinds?.publicStateRequest) return null;
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { SimplePool } = tools;
  const relays = normalizeRelayList(options.relays, publicRelayList());
  if (!relays.length) return null;
  const pool = new SimplePool();
  const since = Math.floor(Date.now() / 1000) - 30;
  const subscription = pool.subscribe(
    relays,
    {
      kinds: [config.nostr.kinds.publicStateRequest],
      "#t": [config.nostr.appTag],
      since
    },
    {
      onevent(event) {
        void maybeRespondToPublicStateRepairRequest(event, relays, options);
      }
    }
  );
  publicStateRepairPeer = {
    relays,
    stop() {
      try {
        subscription?.close?.("closed");
      } finally {
        pool.close(relays);
        publicStateRepairPeer = null;
      }
    }
  };
  return publicStateRepairPeer;
}

function stopPublicStateRepairPeer() {
  publicStateRepairPeer?.stop?.();
}

async function publishTaggedJson({ kind, secretKeyHex, tags = [], content = {} }) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { SimplePool, finalizeEvent } = tools;
  const identity = deriveIdentity(secretKeyHex);
  const relays = publishRelayListForKind(kind);
  if (!relays.length) throw new Error("No relays are configured for this event.");
  const event = finalizeEvent(
    {
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: withAppTag(tags),
      content: JSON.stringify(content)
    },
    identity.secretKey
  );

  const pool = new SimplePool();
  const results = await Promise.allSettled(pool.publish(relays, event));
  pool.close(relays);

  return {
    event,
    ok: results.filter((item) => item.status === "fulfilled").length,
    total: results.length
  };
}

async function publishEncryptedJson({
  secretKeyHex,
  targetPubkey,
  content,
  kind = config.nostr.kinds.tip,
  tags = []
}) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { SimplePool, finalizeEvent, nip04 } = tools;
  const identity = deriveIdentity(secretKeyHex);
  const relays = publishRelayListForKind(kind);
  if (!relays.length) throw new Error("No relays are configured for this event.");
  const payload = typeof content === "string" ? content : JSON.stringify(content);
  const event = finalizeEvent(
    {
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: withAppTag([["p", targetPubkey], ...tags]),
      content: await nip04.encrypt(identity.secretKey, targetPubkey, payload)
    },
    identity.secretKey
  );

  const pool = new SimplePool();
  const results = await Promise.allSettled(pool.publish(relays, event));
  pool.close(relays);

  return {
    event,
    ok: results.filter((item) => item.status === "fulfilled").length,
    total: results.length
  };
}

async function publishSubmission(secretKeyHex, payload, options = {}) {
  const sitePubkey = normalizePubkey(options.sitePubkey || payload?.site_pubkey || resolveConfiguredSitePubkey());
  if (!sitePubkey) throw new Error("Inbox pubkey is not configured.");
  const submissionId = cleanSlug(payload?.submission_id || payload?.subject || `submission-${Date.now()}`) || `submission-${Date.now()}`;
  const body = {
    protocol: protocolName("submission"),
    submission_id: submissionId,
    updated_at: new Date().toISOString(),
    ...payload,
    site_pubkey: sitePubkey
  };
  return publishEncryptedJson({
    secretKeyHex,
    targetPubkey: sitePubkey,
    tags: [["d", submissionId], ["k", "submission"], ...buildBlobTags(body.attachment)],
    content: body
  });
}

async function publishSubmissionChat(secretKeyHex, { targetPubkey, submissionId, body, role = "participant" }) {
  if (!targetPubkey) throw new Error("Chat target is missing.");
  const cleanId = cleanSlug(submissionId) || `thread-${Date.now()}`;
  return publishEncryptedJson({
    secretKeyHex,
    targetPubkey,
    tags: [["d", cleanId], ["k", "submission-chat"]],
    content: {
      protocol: protocolName("chat"),
      submission_id: cleanId,
      sent_at: new Date().toISOString(),
      role,
      body: String(body || "").trim()
    }
  });
}

async function publishAdminKeyShare(secretKeyHex, targetPubkey, siteSecretKeyHex) {
  const siteIdentity = deriveIdentity(siteSecretKeyHex);
  return publishEncryptedJson({
    secretKeyHex,
    targetPubkey,
    kind: config.nostr.kinds.adminKeyShare,
    tags: [["d", `site-key:${siteIdentity.pubkey}`], ["k", "admin-key-share"], ["site", siteIdentity.pubkey]],
    content: {
      protocol: protocolName("admin-key-share"),
      site_pubkey: siteIdentity.pubkey,
      site_secret_key_hex: siteSecretKeyHex,
      shared_at: new Date().toISOString()
    }
  });
}

async function publishAdminKeyRequest(secretKeyHex, sitePubkey = "") {
  const targetSitePubkey = normalizePubkey(sitePubkey || resolveConfiguredSitePubkey());
  if (!isHex64(targetSitePubkey)) throw new Error("A valid site inbox key is not available.");
  return publishTaggedJson({
    kind: config.nostr.kinds.adminKeyRequest,
    secretKeyHex,
    tags: [["d", `site-key-request:${targetSitePubkey}`], ["site", targetSitePubkey], ["op", "request"]],
    content: {
      protocol: protocolName("admin-key-request"),
      site_pubkey: targetSitePubkey,
      requested_at: new Date().toISOString()
    }
  });
}

async function publishSiteKeyEvent(secretKeyHex, siteSecretKeyHex, options = {}) {
  if (!config.nostr.kinds.siteKey) throw new Error("Site key events are not configured.");
  const siteIdentity = deriveIdentity(siteSecretKeyHex);
  const previousSitePubkey = normalizePubkey(options.previousSitePubkey || "");
  const reason = String(options.reason || "rotation").trim() || "rotation";
  const rotatedAt = String(options.rotatedAt || new Date().toISOString()).trim() || new Date().toISOString();
  return publishTaggedJson({
    kind: config.nostr.kinds.siteKey,
    secretKeyHex,
    tags: [
      ["d", "site-key"],
      ["site", siteIdentity.pubkey],
      ...(previousSitePubkey ? [["prev", previousSitePubkey]] : []),
      ["op", reason]
    ],
    content: {
      protocol: protocolName("site-key"),
      site_pubkey: siteIdentity.pubkey,
      previous_site_pubkey: previousSitePubkey,
      reason,
      rotated_at: rotatedAt
    }
  });
}

async function loadAdminKeyShares(secretKeyHex) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { nip04 } = tools;
  const identity = deriveIdentity(secretKeyHex);
  const events = await queryEvents([
    {
      kinds: [config.nostr.kinds.adminKeyShare],
      "#p": [identity.pubkey],
      "#t": [config.nostr.appTag],
      limit: config.nostr.privateLoadLimit
    }
  ], { relays: combinedAuthorityRelayList(), timeoutMs: authorityConnectTimeoutMs() });
  const shares = new Map();
  for (const event of events.sort(compareEventDesc)) {
    try {
      const payload = parseObject(await nip04.decrypt(identity.secretKey, event.pubkey, event.content));
      if (!payload || payload.protocol !== protocolName("admin-key-share")) continue;
      const siteSecretKeyHex = String(payload.site_secret_key_hex || "").trim().toLowerCase();
      const siteIdentity = deriveIdentity(siteSecretKeyHex);
      if (!isHex64(siteIdentity.pubkey)) continue;
      if (shares.has(siteIdentity.pubkey)) continue;
      shares.set(siteIdentity.pubkey, {
        siteSecretKeyHex,
        sitePubkey: siteIdentity.pubkey,
        senderPubkey: event.pubkey,
        sharedAt: String(payload.shared_at || ""),
        event
      });
    } catch {
      continue;
    }
  }
  return [...shares.values()].sort((left, right) => compareEventDesc(left.event, right.event));
}

async function loadAdminKeyShare(secretKeyHex, sitePubkey = "") {
  const targetSitePubkey = normalizePubkey(sitePubkey || "");
  if (!targetSitePubkey) {
    const shares = await loadAdminKeyShares(secretKeyHex);
    return shares[0] || null;
  }
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { nip04 } = tools;
  const identity = deriveIdentity(secretKeyHex);
  const targetedEvents = await queryEvents([
    {
      kinds: [config.nostr.kinds.adminKeyShare],
      "#p": [identity.pubkey],
      "#d": [`site-key:${targetSitePubkey}`],
      "#t": [config.nostr.appTag],
      limit: 24
    }
  ], {
    relays: combinedAuthorityRelayList(),
    timeoutMs: Math.max(authorityConnectTimeoutMs(), 9000)
  });
  for (const event of targetedEvents.sort(compareEventDesc)) {
    try {
      const payload = parseObject(await nip04.decrypt(identity.secretKey, event.pubkey, event.content));
      if (!payload || payload.protocol !== protocolName("admin-key-share")) continue;
      const siteSecretKeyHex = String(payload.site_secret_key_hex || "").trim().toLowerCase();
      const siteIdentity = deriveIdentity(siteSecretKeyHex);
      if (siteIdentity.pubkey !== targetSitePubkey) continue;
      return {
        siteSecretKeyHex,
        sitePubkey: siteIdentity.pubkey,
        senderPubkey: event.pubkey,
        sharedAt: String(payload.shared_at || ""),
        event
      };
    } catch {
      continue;
    }
  }
  const shares = await loadAdminKeyShares(secretKeyHex);
  return shares.find((share) => share.sitePubkey === targetSitePubkey) || null;
}

async function lookupUsers(query) {
  const raw = String(query || "").trim();
  if (!raw) return [];
  const relays = combinedAuthorityRelayList();
  if (!relays.length) return [];
  const timeoutMs = authorityConnectTimeoutMs();
  const pubkey = normalizePubkey(raw);
  const username = normalizeUsername(raw);
  let events = [];

  if (isHex64(pubkey)) {
    events = await queryEvents(
      [
        {
          kinds: [config.nostr.kinds.nameClaim, config.nostr.kinds.profile],
          authors: [pubkey],
          "#t": [config.nostr.appTag],
          limit: 12
        }
      ],
      { relays, timeoutMs }
    );
  } else if (username) {
    const claimEvents = await queryEvents(
      [
        {
          kinds: [config.nostr.kinds.nameClaim],
          "#u": [username],
          "#t": [config.nostr.appTag],
          limit: 24
        }
      ],
      { relays, timeoutMs }
    );
    const pubkeys = [...new Set(claimEvents.map((event) => normalizePubkey(event.pubkey)).filter(Boolean))];
    const profileEvents = pubkeys.length
      ? await queryEvents(
          [
            {
              kinds: [config.nostr.kinds.profile],
              authors: pubkeys,
              "#t": [config.nostr.appTag],
              limit: Math.max(24, pubkeys.length * 2)
            }
          ],
          { relays, timeoutMs }
        )
      : [];
    events = [...claimEvents, ...profileEvents];
  }

  const matchedPubkeys = new Set(events.map((event) => normalizePubkey(event.pubkey)).filter(Boolean));
  if (!matchedPubkeys.size) return [];
  const state = buildPublicState(events, []);
  return state.users.filter((user) => matchedPubkeys.has(user.pubkey));
}

async function loadUserSubmissions(secretKeyHex) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { nip04 } = tools;
  const identity = deriveIdentity(secretKeyHex);
  const events = await queryEvents([
    {
      kinds: [config.nostr.kinds.tip],
      authors: [identity.pubkey],
      "#t": [config.nostr.appTag],
      limit: config.nostr.privateLoadLimit
    }
  ]);
  const submissions = [];
  for (const event of events.sort(compareEventDesc)) {
    try {
      const recipientPubkey = normalizePubkey(firstTag(event, "p"));
      if (!isHex64(recipientPubkey)) continue;
      const payload = parseObject(await nip04.decrypt(identity.secretKey, recipientPubkey, event.content));
      if (!payload || payload.protocol !== protocolName("submission")) continue;
      submissions.push({
        id: cleanSlug(payload.submission_id || firstTag(event, "d")) || event.id,
        author: event.pubkey,
        recipient_pubkey: recipientPubkey,
        payload: {
          ...payload,
          site_pubkey: normalizePubkey(payload?.site_pubkey || recipientPubkey)
        },
        event
      });
    } catch {
      continue;
    }
  }
  return groupSubmissions(submissions);
}

async function loadInboxSubmissions(secretKeyInput) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { nip04 } = tools;
  const siteShares = normalizeSiteKeyShares(secretKeyInput);
  const targetPubkeys = siteShares.map((share) => share.sitePubkey);
  if (!targetPubkeys.length) return [];
  const siteShareByPubkey = new Map(siteShares.map((share) => [share.sitePubkey, share]));
  const events = await queryEvents([
    {
      kinds: [config.nostr.kinds.tip],
      "#p": targetPubkeys,
      "#t": [config.nostr.appTag],
      limit: config.nostr.privateLoadLimit
    }
  ]);
  const submissions = [];
  for (const event of events.sort(compareEventDesc)) {
    const recipientPubkey = normalizePubkey(firstTag(event, "p"));
    const siteShare = siteShareByPubkey.get(recipientPubkey);
    if (!siteShare) continue;
    try {
      const payload = parseObject(await nip04.decrypt(siteShare.secretKey, event.pubkey, event.content));
      if (!payload || payload.protocol !== protocolName("submission")) continue;
      submissions.push({
        id: cleanSlug(payload.submission_id || firstTag(event, "d")) || event.id,
        author: event.pubkey,
        recipient_pubkey: recipientPubkey,
        payload: {
          ...payload,
          site_pubkey: normalizePubkey(payload?.site_pubkey || recipientPubkey)
        },
        event
      });
    } catch {
      submissions.push({
        id: firstTag(event, "d") || event.id,
        author: event.pubkey,
        recipient_pubkey: recipientPubkey,
        payload: null,
        event,
        error: "Could not decrypt this submission."
      });
    }
  }
  return groupSubmissions(submissions);
}

async function loadSubmissionThread(secretKeyInput, submissionId, counterpartPubkeys) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { nip04 } = tools;
  const identities = normalizeThreadIdentities(secretKeyInput);
  const cleanId = cleanSlug(submissionId);
  const selfPubkeys = identities.map((identity) => identity.pubkey);
  const peers = normalizePubkeyList(counterpartPubkeys);
  if (!cleanId || !selfPubkeys.length || !peers.length) return [];
  const filters = [
    {
      kinds: [config.nostr.kinds.tip],
      authors: selfPubkeys,
      "#p": peers,
      "#t": [config.nostr.appTag],
      limit: config.nostr.privateLoadLimit
    },
    {
      kinds: [config.nostr.kinds.tip],
      authors: peers,
      "#p": selfPubkeys,
      "#t": [config.nostr.appTag],
      limit: config.nostr.privateLoadLimit
    }
  ];
  const events = await queryEvents(filters);
  const messages = [];
  for (const event of events.sort(compareEventAsc)) {
    const authorPubkey = normalizePubkey(event.pubkey);
    const recipientPubkey = normalizePubkey(firstTag(event, "p"));
    const selfIdentity = identities.find((identity) =>
      identity.pubkey === authorPubkey || identity.pubkey === recipientPubkey
    );
    const peer = selfIdentity?.pubkey === authorPubkey ? recipientPubkey : authorPubkey;
    if (!selfIdentity || !isHex64(peer)) continue;
    try {
      const payload = parseObject(await nip04.decrypt(selfIdentity.secretKey, peer, event.content));
      const payloadSubmissionId = cleanSlug(payload?.submission_id || firstTag(event, "d"));
      if (!payload || payload.protocol !== protocolName("chat") || payloadSubmissionId !== cleanId) continue;
      messages.push({
        id: event.id,
        author: event.pubkey,
        recipient_pubkey: recipientPubkey,
        payload,
        event
      });
    } catch {
      continue;
    }
  }
  return messages;
}

async function fetchPublicState() {
  const seedEntities = await loadSeedEntities();
  const tools = getEventTools();
  if (!tools) return emptyPublicState("Nostr tools unavailable.", seedEntities);
  const cachedEvents = loadCachedPublicEvents();

  try {
    const visitSince = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30;
    const publicLimit = Number(config.nostr.publicLoadLimit || 400);
    const privateLimit = Number(config.nostr.privateLoadLimit || 200);
    const authorityFilters = [
      {
        kinds: [
          config.nostr.kinds.adminClaim,
          config.nostr.kinds.adminRole,
          config.nostr.kinds.userMod,
          config.nostr.kinds.snapshotRequest,
          config.nostr.kinds.adminKeyRequest,
          config.nostr.kinds.siteKey
        ],
        "#t": [config.nostr.appTag],
        limit: Math.max(80, Math.ceil(publicLimit / 2))
      },
      {
        kinds: [
          config.nostr.kinds.nameClaim,
          config.nostr.kinds.profile
        ],
        "#t": [config.nostr.appTag],
        limit: Math.max(200, publicLimit)
      },
      {
        kinds: [config.nostr.kinds.adminKeyShare],
        "#t": [config.nostr.appTag],
        limit: Math.max(120, Math.ceil(publicLimit / 2))
      }
    ];
    const contentFilters = [
      {
        kinds: [
          config.nostr.kinds.snapshot,
          config.nostr.kinds.entity,
          config.nostr.kinds.draft,
          config.nostr.kinds.comment,
          config.nostr.kinds.commentMod,
          config.nostr.kinds.submissionStatus,
          config.nostr.kinds.blobRequest,
          config.nostr.kinds.blobFulfillment
        ],
        "#t": [config.nostr.appTag],
        limit: publicLimit
      },
      {
        kinds: [config.nostr.kinds.commentVote],
        "#t": [config.nostr.appTag],
        limit: Math.max(800, publicLimit * 2)
      },
      {
        kinds: [config.nostr.kinds.visitPulse],
        "#t": [config.nostr.appTag],
        since: visitSince,
        limit: Math.max(800, publicLimit * 4)
      }
    ];
    contentFilters.push({
      kinds: [config.nostr.kinds.tip],
      "#t": [config.nostr.appTag],
      "#k": ["submission"],
      limit: privateLimit
    });
    const [authorityEvents, contentEvents] = await Promise.all([
      queryEvents(authorityFilters, {
        relays: combinedAuthorityRelayList(),
        timeoutMs: authorityConnectTimeoutMs()
      }),
      queryEvents(contentFilters, {
        relays: publicRelayList(),
        timeoutMs: Number(config.nostr.connectTimeoutMs || 3200)
      })
    ]);
    const remoteEvents = [...authorityEvents, ...contentEvents];
    const mergedEvents = mergeCachedEvents(remoteEvents, cachedEvents);
    persistCachedPublicEvents(mergedEvents);
    const publicState = buildPublicState(mergedEvents, seedEntities);
    return withPublicStateSyncInfo(publicState, {
      connected: remoteEvents.length > 0,
      error: remoteEvents.length ? "" : cachedEvents.length ? "Live relay data incomplete. Showing cached public state." : "",
      remoteEventCount: remoteEvents.length,
      cachedEventCount: cachedEvents.length,
      mergedEventCount: mergedEvents.length
    });
  } catch (error) {
    if (cachedEvents.length) {
      const publicState = buildPublicState(cachedEvents, seedEntities);
      return withPublicStateSyncInfo(publicState, {
        connected: false,
        error: String(error?.message || error || "Relay timeout."),
        remoteEventCount: 0,
        cachedEventCount: cachedEvents.length,
        mergedEventCount: cachedEvents.length
      });
    }
    return emptyPublicState(String(error?.message || error || "Relay timeout."), seedEntities);
  }
}

function buildPublicState(events, seedEntities = []) {
  const claims = [];
  const roles = [];
  const userModEvents = [];
  const commentModEvents = [];
  const commentVoteEvents = [];
  const submissionStatusEvents = [];
  const snapshotEvents = [];
  const snapshotRequestEvents = [];
  const adminKeyRequestEvents = [];
  const siteKeyEvents = [];
  const adminKeyShareEvents = new Map();
  const nameClaims = new Map();
  const profiles = new Map();
  const entities = new Map();
  const draftEventsBySlug = new Map();
  const comments = new Map();
  const blobRequests = new Map();
  const blobFulfillments = new Map();
  const submissionCounters = new Map();
  const visitEvents = [];
  const seenPubkeys = new Set();

  for (const event of events) {
    seenPubkeys.add(normalizePubkey(event.pubkey));
    const kind = Number(event.kind);

    if (kind === config.nostr.kinds.tip && firstTag(event, "k") === "submission") {
      const submissionId = cleanSlug(firstTag(event, "d")) || event.id;
      const author = normalizePubkey(event.pubkey);
      const key = `${author}:${submissionId}`;
      if (!submissionCounters.has(key)) {
        submissionCounters.set(key, {
          author,
          submissionId,
          created_at: toUnix(event.created_at),
          id: event.id
        });
      }
      continue;
    }

    if (kind === config.nostr.kinds.adminClaim) {
      const payload = parseObject(event.content);
      const pubkey = normalizePubkey(payload?.admin_pubkey || firstTag(event, "admin") || event.pubkey);
      if (isHex64(pubkey)) {
        claims.push({
          event,
          pubkey,
          claimed_at: toUnix(payload?.claimed_at || firstTag(event, "version") || event.created_at)
        });
      }
      continue;
    }

    if (kind === config.nostr.kinds.adminRole) {
      const payload = parseObject(event.content);
      const action = payload?.action === "grant" ? "grant" : payload?.action === "revoke" ? "revoke" : "";
      const targetPubkey = normalizePubkey(payload?.target_pubkey || firstTag(event, "p"));
      if (action && isHex64(targetPubkey)) {
        roles.push({
          event,
          pubkey: normalizePubkey(event.pubkey),
          target_pubkey: targetPubkey,
          action,
          created_at: toUnix(event.created_at),
          id: event.id
        });
      }
      continue;
    }

    if (kind === config.nostr.kinds.snapshot) {
      const payload = parseObject(event.content);
      if (!payload || !Array.isArray(payload.entries)) continue;
      snapshotEvents.push({
        event,
        id: event.id,
        pubkey: normalizePubkey(event.pubkey),
        version_ts: toUnix(payload?.version_ts || firstTag(event, "version") || event.created_at),
        generated_at: String(payload?.generated_at || "").trim(),
        requested_by: normalizePubkey(payload?.requested_by || firstTag(event, "p")),
        admin_pubkey: normalizePubkey(payload?.admin_pubkey || ""),
        entries: payload.entries,
        counts: payload?.counts && typeof payload.counts === "object" ? payload.counts : {},
        git: payload?.git && typeof payload.git === "object" ? payload.git : null,
        status: String(payload?.status || "ready").trim() || "ready"
      });
      continue;
    }

    if (kind === config.nostr.kinds.userMod) {
      const payload = parseObject(event.content);
      const action = String(payload?.action || payload?.op || firstTag(event, "op") || "").trim();
      const targetPubkey = normalizePubkey(payload?.target_pubkey || firstTag(event, "p"));
      if (isHex64(targetPubkey) && action) {
        userModEvents.push({
          pubkey: normalizePubkey(event.pubkey),
          target_pubkey: targetPubkey,
          action,
          created_at: toUnix(event.created_at),
          id: event.id
        });
      }
      continue;
    }

    if (kind === config.nostr.kinds.nameClaim) {
      const payload = parseObject(event.content);
      const next = {
        pubkey: normalizePubkey(event.pubkey),
        username: normalizeUsername(payload?.username || payload?.username_normalized || firstTag(event, "u")),
        created_at: toUnix(event.created_at),
        id: event.id,
        _event: event
      };
      if (next.username) mergeLatest(nameClaims, next.pubkey, next);
      continue;
    }

    if (kind === config.nostr.kinds.profile) {
      const payload = parseObject(event.content);
      const next = {
        pubkey: normalizePubkey(event.pubkey),
        username: normalizeUsername(payload?.username || ""),
        display_name: String(payload?.display_name || payload?.displayName || "").trim(),
        avatar_url: String(payload?.avatar_url || payload?.avatarUrl || "").trim(),
        avatar_blob: normalizeBlobReference(payload?.avatar_blob || payload?.avatarBlob || null),
        bio: String(payload?.bio || "").trim(),
        social_links: Array.isArray(payload?.social_links)
          ? payload.social_links.map((item) => String(item || "").trim()).filter(Boolean)
          : [],
        created_at: toUnix(event.created_at),
        id: event.id,
        _event: event
      };
      mergeLatest(profiles, next.pubkey, next);
      continue;
    }

    if (kind === config.nostr.kinds.snapshotRequest) {
      const payload = parseObject(event.content);
      snapshotRequestEvents.push({
        event,
        id: event.id,
        pubkey: normalizePubkey(event.pubkey),
        request_id: String(payload?.request_id || firstTag(event, "req") || firstTag(event, "d") || event.id).trim(),
        op: String(payload?.op || firstTag(event, "op") || "latest").trim() || "latest",
        requested_at: String(payload?.requested_at || "").trim(),
        created_at: toUnix(event.created_at)
      });
      continue;
    }

    if (kind === config.nostr.kinds.adminKeyRequest) {
      const payload = parseObject(event.content);
      const sitePubkey = normalizePubkey(payload?.site_pubkey || firstTag(event, "site") || "");
      if (!isHex64(sitePubkey)) continue;
      adminKeyRequestEvents.push({
        event,
        id: event.id,
        requester_pubkey: normalizePubkey(event.pubkey),
        site_pubkey: sitePubkey,
        requested_at: String(payload?.requested_at || "").trim(),
        created_at: toUnix(event.created_at)
      });
      continue;
    }

    if (kind === config.nostr.kinds.siteKey) {
      const payload = parseObject(event.content);
      const sitePubkey = normalizePubkey(payload?.site_pubkey || firstTag(event, "site") || "");
      if (!isHex64(sitePubkey)) continue;
      siteKeyEvents.push({
        event,
        pubkey: normalizePubkey(event.pubkey),
        site_pubkey: sitePubkey,
        previous_site_pubkey: normalizePubkey(payload?.previous_site_pubkey || firstTag(event, "prev") || ""),
        reason: String(payload?.reason || firstTag(event, "op") || "rotation").trim() || "rotation",
        rotated_at: String(payload?.rotated_at || "").trim(),
        created_at: toUnix(event.created_at),
        id: event.id
      });
      continue;
    }

    if (kind === config.nostr.kinds.adminKeyShare) {
      const recipientPubkey = normalizePubkey(firstTag(event, "p"));
      const sitePubkey = normalizePubkey(firstTag(event, "site"));
      if (!isHex64(recipientPubkey) || !isHex64(sitePubkey)) continue;
      mergeLatest(adminKeyShareEvents, `${recipientPubkey}:${sitePubkey}`, {
        event,
        id: event.id,
        recipient_pubkey: recipientPubkey,
        site_pubkey: sitePubkey,
        shared_by: normalizePubkey(event.pubkey),
        created_at: toUnix(event.created_at)
      });
      continue;
    }

    if (kind === config.nostr.kinds.entity) {
      const payload = parseObject(event.content);
      const slug = cleanSlug(payload?.slug || firstTag(event, "d"));
      if (!slug) continue;
      const next = {
        slug,
        author: normalizePubkey(event.pubkey),
        name: String(payload?.name || slug).trim(),
        location: String(payload?.location || "Undisclosed location").trim(),
        type: String(payload?.type || "entity").trim(),
        lat: parseMaybeNumber(payload?.lat),
        lng: parseMaybeNumber(payload?.lng),
        notes: String(payload?.notes || "").trim(),
        aliases: Array.isArray(payload?.aliases)
          ? payload.aliases.map((item) => String(item || "").trim()).filter(Boolean)
          : [],
        status: String(payload?.status || "").trim(),
        created_at: toUnix(event.created_at),
        id: event.id,
        _event: event
      };
      mergeLatest(entities, slug, next);
      continue;
    }

    if (kind === config.nostr.kinds.draft) {
      const payload = parseObject(event.content);
      const slug = cleanSlug(payload?.slug || firstTag(event, "d"));
      if (!slug) continue;
      const contentType = String(payload?.content_type || payload?.contentType || "post").trim().toLowerCase() || "post";
      const next = {
        slug,
        author: normalizePubkey(event.pubkey),
        title: String(payload?.title || slug).trim(),
        summary: String(payload?.summary || "").trim(),
        location: String(payload?.location || "Undisclosed location").trim(),
        status: String(payload?.status || "draft").trim(),
        tags: Array.isArray(payload?.tags) ? payload.tags : [],
        markdown: String(payload?.markdown || "").trim(),
        featured: Boolean(payload?.featured),
        date: String(payload?.date || new Date(toUnix(event.created_at) * 1000).toISOString().slice(0, 10)),
        entity_refs: Array.isArray(payload?.entity_refs) ? payload.entity_refs : [],
        content_type: contentType,
        page_id: cleanSlug(payload?.page_id || payload?.pageId || ""),
        page_path: String(payload?.page_path || payload?.pagePath || "").trim(),
        page_content: payload?.page_content && typeof payload.page_content === "object"
          ? payload.page_content
          : payload?.pageContent && typeof payload.pageContent === "object"
            ? payload.pageContent
            : null,
        created_at: toUnix(event.created_at),
        id: event.id,
        _event: event
      };
      const revisions = draftEventsBySlug.get(slug) || [];
      revisions.push(next);
      draftEventsBySlug.set(slug, revisions);
      continue;
    }

    if (kind === config.nostr.kinds.comment) {
      const payload = parseObject(event.content);
      const commentId = firstTag(event, "d") || event.id;
      const postSlug = cleanSlug(payload?.post_slug || firstTag(event, "a"));
      if (!postSlug) continue;
      const parentId = String(payload?.parent_id || firstTag(event, "parent") || firstTag(event, "e") || "").trim();
      const rootId = String(payload?.root_id || firstTag(event, "root") || "").trim();
      const next = {
        id: commentId,
        post_slug: postSlug,
        author: normalizePubkey(event.pubkey),
        markdown: String(payload?.markdown || payload?.body || "").trim(),
        parent_id: parentId,
        root_id: rootId || (parentId ? parentId : ""),
        created_at: toUnix(event.created_at),
        id_event: event.id,
        _event: event
      };
      mergeLatest(comments, commentId, next);
      continue;
    }

    if (kind === config.nostr.kinds.commentVote) {
      const payload = parseObject(event.content);
      const targetId = String(payload?.target_id || firstTag(event, "e") || "").trim();
      const rawValue = payload?.value ?? firstTag(event, "value") ?? firstTag(event, "v");
      const op = String(payload?.op || firstTag(event, "op") || "").trim().toLowerCase();
      let value = Number(rawValue);
      if (!Number.isFinite(value)) {
        value = op === "up" || op === "upvote"
          ? 1
          : op === "down" || op === "downvote"
            ? -1
            : op === "clear" || op === "remove" || op === "none"
              ? 0
              : Number.NaN;
      }
      if (!targetId || !Number.isFinite(value)) continue;
      commentVoteEvents.push({
        pubkey: normalizePubkey(event.pubkey),
        target_id: targetId,
        value: Math.max(-1, Math.min(1, Math.trunc(value))),
        created_at: toUnix(event.created_at),
        id: event.id
      });
      continue;
    }

    if (kind === config.nostr.kinds.blobRequest) {
      const next = buildBlobEventState(event, "request");
      if (next) mergeLatest(blobRequests, blobReferenceKey(next), next);
      continue;
    }

    if (kind === config.nostr.kinds.blobFulfillment) {
      const next = buildBlobEventState(event, "fulfillment");
      if (next) mergeLatest(blobFulfillments, blobReferenceKey(next), next);
      continue;
    }

    if (kind === config.nostr.kinds.visitPulse) {
      const payload = parseObject(event.content);
      const pubkey = normalizePubkey(event.pubkey);
      if (!pubkey) continue;
      visitEvents.push({
        id: event.id,
        pubkey,
        page: cleanSlug(payload?.page || firstTag(event, "k")),
        day: String(payload?.day || "").trim(),
        created_at: toUnix(event.created_at)
      });
      continue;
    }

    if (kind === config.nostr.kinds.commentMod) {
      const payload = parseObject(event.content);
      const targetId = String(payload?.target_id || firstTag(event, "e") || "").trim();
      const action = String(payload?.action || firstTag(event, "op") || "").trim();
      if (targetId && action) {
        commentModEvents.push({
          pubkey: normalizePubkey(event.pubkey),
          target_id: targetId,
          action,
          note: String(payload?.note || "").trim(),
          created_at: toUnix(event.created_at),
          id: event.id
        });
      }
      continue;
    }

    if (kind === config.nostr.kinds.submissionStatus) {
      const payload = parseObject(event.content);
      const submissionId = cleanSlug(payload?.submission_id || firstTag(event, "d"));
      if (!submissionId) continue;
      submissionStatusEvents.push({
        submission_id: submissionId,
        author_pubkey: normalizePubkey(payload?.author_pubkey || firstTag(event, "p")),
        status: String(payload?.status || "received").trim(),
        note: String(payload?.note || "").trim(),
        pubkey: normalizePubkey(event.pubkey),
        created_at: toUnix(event.created_at),
        id: event.id
      });
    }
  }

  const adminState = computeAdminState(claims, roles);
  const admins = new Set(adminState.admins);
  const siteInfo = computeSiteInfo(siteKeyEvents, admins);
  const moderation = computeLatestModeration(userModEvents, admins);
  const commentModeration = computeCommentModeration(commentModEvents, admins);
  const commentVotes = computeCommentVotes(commentVoteEvents);
  const submissionStatuses = computeSubmissionStatuses(submissionStatusEvents, admins);
  const pendingAdminKeyRequests = computePendingAdminKeyRequests(
    adminKeyRequestEvents,
    adminKeyShareEvents,
    admins,
    siteInfo.activePubkey
  );
  const draftHistoryBySlug = new Map();
  const draftList = [...draftEventsBySlug.entries()]
    .map(([slug, revisions]) => {
      const ordered = revisions.slice().sort(compareEventDesc);
      draftHistoryBySlug.set(slug, ordered);
      return {
        ...ordered[0],
        revisions: ordered,
        revisionCount: ordered.length
      };
    })
    .sort((left, right) => compareEventDesc(left._event, right._event));

  const mergedEntities = new Map();
  for (const entity of Array.isArray(seedEntities) ? seedEntities : []) {
    if (entity?.slug) mergedEntities.set(entity.slug, entity);
  }
  for (const entity of entities.values()) {
    mergedEntities.set(entity.slug, entity);
  }

  const entityList = [...mergedEntities.values()]
    .map((entity) => ({
      ...entity,
      status: entity.status || (admins.has(entity.author) ? "approved" : "pending")
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const allComments = [...comments.values()]
    .map((comment) => {
      const mod = commentModeration.get(comment.id) || null;
      const votes = commentVotes.get(comment.id) || emptyCommentVoteSummary();
      return {
        ...comment,
        visibility: mod?.action === "hide" ? "hidden" : "visible",
        moderation: mod,
        score: votes.score,
        upvoteCount: votes.upvoteCount,
        downvoteCount: votes.downvoteCount
      };
    })
    .sort(compareEventAsc);
  const visibleComments = allComments.filter((comment) => comment.visibility !== "hidden");
  const hiddenComments = allComments.filter((comment) => comment.visibility === "hidden");
  const commentsByPost = groupBy(visibleComments, "post_slug");
  const commentsByAuthor = groupBy(visibleComments, "author");

  const submissionCountByAuthor = new Map();
  for (const entry of submissionCounters.values()) {
    submissionCountByAuthor.set(
      entry.author,
      (submissionCountByAuthor.get(entry.author) || 0) + 1
    );
  }
  const visitMetrics = computeVisitMetrics(visitEvents);
  const latestSnapshot = computeLatestSnapshot(snapshotEvents);

  const allPubkeys = new Set([
    ...seenPubkeys,
    ...nameClaims.keys(),
    ...profiles.keys(),
    ...submissionCountByAuthor.keys(),
    ...allComments.map((comment) => comment.author),
    ...commentsByAuthor.keys(),
    ...admins
  ]);

  const users = [...allPubkeys.values()]
    .filter(Boolean)
    .map((pubkey) => {
      const claim = nameClaims.get(pubkey);
      const profile = profiles.get(pubkey);
      const mod = moderation.get(pubkey) || null;
      const username = claim?.username || profile?.username || "";
      const displayName = profile?.display_name || username || shortKey(pubkey);
      return {
        pubkey,
        username,
        displayName,
        avatarUrl: profile?.avatar_url || "",
        avatarBlob: profile?.avatar_blob || null,
        bio: profile?.bio || "",
        socialLinks: Array.isArray(profile?.social_links) ? profile.social_links : [],
        isAdmin: admins.has(pubkey),
        moderation: mod,
        submissionCount: submissionCountByAuthor.get(pubkey) || 0,
        commentCount: (commentsByAuthor.get(pubkey) || []).length
      };
    })
    .sort((left, right) => {
      if (left.isAdmin !== right.isAdmin) return left.isAdmin ? -1 : 1;
      return left.displayName.localeCompare(right.displayName);
    });

  return {
    connected: true,
    error: "",
    rootAdminPubkey: adminState.rootAdminPubkey,
    admins: adminState.admins,
    siteInfo,
    moderation,
    users,
    entities: entityList,
    approvedEntities: entityList.filter((entity) => entity.status === "approved"),
    drafts: draftList,
    draftHistoryBySlug,
    pendingAdminKeyRequests,
    adminKeyShareMetadata: [...adminKeyShareEvents.values()].sort((left, right) => compareEventDesc(left.event, right.event)),
    allComments,
    comments: visibleComments,
    hiddenComments,
    commentsByPost,
    commentsByAuthor,
    commentModeration,
    commentVotes,
    blobRequests,
    blobFulfillments,
    submissionStatuses,
    submissionCountByAuthor,
    snapshotInfo: latestSnapshot,
    snapshotRequests: snapshotRequestEvents.sort((left, right) => compareEventDesc(left.event, right.event)),
    visits: visitMetrics.events,
    metrics: {
      userCount: users.length,
      adminCount: adminState.admins.length,
      submissionCount: submissionCounters.size,
      commentCount: visibleComments.length,
      hiddenCommentCount: hiddenComments.length,
      entityCount: entityList.length,
      approvedEntityCount: entityList.filter((entity) => entity.status === "approved").length,
      snapshotCount: snapshotEvents.length,
      visitorCount24h: visitMetrics.visitorCount24h,
      visitorCount7d: visitMetrics.visitorCount7d,
      visitEventCount7d: visitMetrics.visitEventCount7d
    },
    rawEvents: events.sort(compareEventDesc)
  };
}

function computeAdminState(claims, roles) {
  const sortedClaims = [...claims].sort((left, right) => {
    if (left.claimed_at !== right.claimed_at) return left.claimed_at - right.claimed_at;
    if (left.event.created_at !== right.event.created_at) return left.event.created_at - right.event.created_at;
    return String(left.event.id || "").localeCompare(String(right.event.id || ""));
  });

  const rootAdminPubkey =
    normalizePubkey(config.nostr.rootAdminPubkey) ||
    normalizePubkey(sortedClaims[0]?.pubkey || "");
  const admins = new Set(rootAdminPubkey ? [rootAdminPubkey] : []);
  const sortedRoles = [...roles].sort((left, right) => {
    if (left.created_at !== right.created_at) return left.created_at - right.created_at;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });

  for (const role of sortedRoles) {
    if (!admins.has(role.pubkey)) continue;
    if (role.action === "grant") admins.add(role.target_pubkey);
    if (role.action === "revoke" && role.target_pubkey !== rootAdminPubkey) admins.delete(role.target_pubkey);
  }

  return {
    rootAdminPubkey,
    admins: [...admins.values()].sort()
  };
}

function computeSiteInfo(events, admins) {
  const fallbackPubkey = resolveConfiguredSitePubkey();
  const sorted = [...events].sort((left, right) => {
    if (left.created_at !== right.created_at) return left.created_at - right.created_at;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
  const history = [];
  let activePubkey = fallbackPubkey;
  for (const event of sorted) {
    if (!admins.has(event.pubkey)) continue;
    history.push(event);
    activePubkey = event.site_pubkey;
  }
  return {
    activePubkey: normalizePubkey(activePubkey || fallbackPubkey),
    fallbackPubkey,
    latestEvent: history[history.length - 1] || null,
    events: history.slice().reverse()
  };
}

function computeLatestModeration(events, admins) {
  const map = new Map();
  const sorted = [...events].sort((left, right) => {
    if (left.created_at !== right.created_at) return left.created_at - right.created_at;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
  for (const event of sorted) {
    if (!admins.has(event.pubkey)) continue;
    map.set(event.target_pubkey, {
      action: event.action,
      created_at: event.created_at,
      by: event.pubkey
    });
  }
  return map;
}

function computeCommentModeration(events, admins) {
  const moderation = new Map();
  const sorted = [...events].sort((left, right) => {
    if (left.created_at !== right.created_at) return left.created_at - right.created_at;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
  for (const event of sorted) {
    if (!admins.has(event.pubkey)) continue;
    moderation.set(event.target_id, {
      action: event.action === "restore" ? "restore" : "hide",
      note: String(event.note || "").trim(),
      updated_at: event.created_at,
      by: event.pubkey
    });
  }
  return moderation;
}

function computeCommentVotes(events) {
  const latestByVoter = new Map();
  const sorted = [...events].sort((left, right) => {
    if (left.created_at !== right.created_at) return left.created_at - right.created_at;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
  for (const event of sorted) {
    const voterPubkey = normalizePubkey(event.pubkey);
    if (!voterPubkey || !event.target_id) continue;
    latestByVoter.set(`${event.target_id}:${voterPubkey}`, {
      ...event,
      pubkey: voterPubkey
    });
  }

  const votes = new Map();
  for (const event of latestByVoter.values()) {
    const summary = votes.get(event.target_id) || emptyCommentVoteSummary();
    if (event.value > 0) {
      summary.score += 1;
      summary.upvoteCount += 1;
      summary.byPubkey.set(event.pubkey, 1);
    } else if (event.value < 0) {
      summary.score -= 1;
      summary.downvoteCount += 1;
      summary.byPubkey.set(event.pubkey, -1);
    }
    summary.updated_at = Math.max(summary.updated_at, Number(event.created_at || 0) || 0);
    votes.set(event.target_id, summary);
  }
  return votes;
}

function emptyCommentVoteSummary() {
  return {
    score: 0,
    upvoteCount: 0,
    downvoteCount: 0,
    updated_at: 0,
    byPubkey: new Map()
  };
}

function computeSubmissionStatuses(events, admins) {
  const map = new Map();
  const sorted = [...events].sort((left, right) => {
    if (left.created_at !== right.created_at) return left.created_at - right.created_at;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
  for (const event of sorted) {
    if (!admins.has(event.pubkey)) continue;
    map.set(event.submission_id, {
      submission_id: event.submission_id,
      author_pubkey: event.author_pubkey,
      status: event.status,
      note: event.note,
      updated_at: event.created_at,
      by: event.pubkey
    });
  }
  return map;
}

function computePendingAdminKeyRequests(requests, shareMetadata, admins, activeSitePubkey) {
  const targetSitePubkey = normalizePubkey(activeSitePubkey || "");
  const sorted = [...requests].sort((left, right) => compareEventDesc(left.event, right.event));
  return sorted.filter((request) => {
    if (!admins.has(request.requester_pubkey)) return false;
    if (targetSitePubkey && request.site_pubkey !== targetSitePubkey) return false;
    const lastShare = shareMetadata.get(`${request.requester_pubkey}:${request.site_pubkey}`) || null;
    return !lastShare || lastShare.created_at < request.created_at;
  });
}

function computeVisitMetrics(events) {
  const sorted = [...events].sort(compareEventAsc);
  const now = Math.floor(Date.now() / 1000);
  const since24h = now - 60 * 60 * 24;
  const since7d = now - 60 * 60 * 24 * 7;
  const unique24h = new Set();
  const unique7d = new Set();
  let visitEventCount7d = 0;
  for (const event of sorted) {
    if (event.created_at >= since24h) unique24h.add(event.pubkey);
    if (event.created_at >= since7d) {
      unique7d.add(event.pubkey);
      visitEventCount7d += 1;
    }
  }
  return {
    events: sorted,
    visitorCount24h: unique24h.size,
    visitorCount7d: unique7d.size,
    visitEventCount7d
  };
}

function computeLatestSnapshot(events) {
  const sorted = [...events].sort((left, right) => {
    if (left.version_ts !== right.version_ts) return right.version_ts - left.version_ts;
    return compareEventDesc(left.event, right.event);
  });
  return sorted[0] || null;
}

function groupSubmissions(items) {
  const grouped = new Map();
  for (const item of items) {
    const current = grouped.get(item.id);
    if (!current) {
      grouped.set(item.id, {
        id: item.id,
        author: item.author,
        latest: item,
        revisions: [item]
      });
      continue;
    }
    current.revisions.push(item);
    if (compareEventDesc(item.event, current.latest.event) < 0) current.latest = item;
  }
  return [...grouped.values()].sort((left, right) => compareEventDesc(left.latest.event, right.latest.event));
}

function emptyPublicState(error, seedEntities = []) {
  const entities = [...new Map((Array.isArray(seedEntities) ? seedEntities : []).map((entity) => [entity.slug, entity])).values()];
  const approvedEntities = entities.filter((entity) => entity.status === "approved");
  return {
    connected: false,
    error: String(error || ""),
    rootAdminPubkey: normalizePubkey(config.nostr.rootAdminPubkey),
    admins: normalizePubkey(config.nostr.rootAdminPubkey) ? [normalizePubkey(config.nostr.rootAdminPubkey)] : [],
    siteInfo: {
      activePubkey: resolveConfiguredSitePubkey(),
      fallbackPubkey: resolveConfiguredSitePubkey(),
      latestEvent: null,
      events: []
    },
    moderation: new Map(),
    users: [],
    entities,
    approvedEntities,
    drafts: [],
    draftHistoryBySlug: new Map(),
    pendingAdminKeyRequests: [],
    adminKeyShareMetadata: [],
    allComments: [],
    comments: [],
    hiddenComments: [],
    commentsByPost: new Map(),
    commentsByAuthor: new Map(),
    commentModeration: new Map(),
    commentVotes: new Map(),
    blobRequests: new Map(),
    blobFulfillments: new Map(),
    submissionStatuses: new Map(),
    submissionCountByAuthor: new Map(),
    snapshotInfo: null,
    snapshotRequests: [],
    visits: [],
    metrics: {
      userCount: 0,
      adminCount: 0,
      submissionCount: 0,
      commentCount: 0,
      hiddenCommentCount: 0,
      entityCount: entities.length,
      approvedEntityCount: approvedEntities.length,
      snapshotCount: 0,
      visitorCount24h: 0,
      visitorCount7d: 0,
      visitEventCount7d: 0
    },
    rawEvents: [],
    syncInfo: {
      remoteEventCount: 0,
      cachedEventCount: 0,
      mergedEventCount: 0,
      usedCachedEvents: false
    }
  };
}

function withPublicStateSyncInfo(publicState, info = {}) {
  const remoteEventCount = Number(info.remoteEventCount || 0) || 0;
  const cachedEventCount = Number(info.cachedEventCount || 0) || 0;
  const mergedEventCount = Number(info.mergedEventCount || publicState?.rawEvents?.length || 0) || 0;
  return {
    ...publicState,
    connected: Boolean(info.connected),
    error: String(info.error || publicState?.error || "").trim(),
    syncInfo: {
      remoteEventCount,
      cachedEventCount,
      mergedEventCount,
      usedCachedEvents: mergedEventCount > remoteEventCount && cachedEventCount > 0
    }
  };
}

function loadCachedPublicEvents() {
  try {
    const raw = window.localStorage.getItem(publicEventCacheKey());
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeCachedPublicEvent)
      .filter((event) => isVerifiedPublicEvent(event))
      .sort(compareEventDesc);
  } catch {
    return [];
  }
}

function persistCachedPublicEvents(events) {
  try {
    const normalized = mergeCachedEvents(events, []);
    window.localStorage.setItem(publicEventCacheKey(), JSON.stringify(normalized.slice(0, publicEventCacheLimit())));
  } catch {
    return;
  }
}

function mergeCachedEvents(primary, secondary) {
  const merged = new Map();
  for (const event of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const normalized = normalizeCachedPublicEvent(event);
    if (!normalized || !normalized.id || !isVerifiedPublicEvent(normalized)) continue;
    if (!merged.has(normalized.id)) merged.set(normalized.id, normalized);
  }
  return [...merged.values()].sort(compareEventDesc).slice(0, publicEventCacheLimit());
}

function normalizeCachedPublicEvent(event) {
  if (!event || typeof event !== "object") return null;
  const id = String(event.id || "").trim();
  const pubkey = normalizePubkey(event.pubkey);
  const sig = String(event.sig || "").trim();
  const kind = Number(event.kind);
  const createdAt = Number(event.created_at || 0);
  if (!id || !pubkey || !sig || !Number.isFinite(kind) || !Number.isFinite(createdAt)) return null;
  return {
    id,
    pubkey,
    sig,
    kind,
    created_at: Math.floor(createdAt),
    content: String(event.content || ""),
    tags: Array.isArray(event.tags)
      ? event.tags.filter(Array.isArray).map((tag) => tag.map((value) => String(value || "")))
      : []
  };
}

function publicEventCacheKey() {
  return `${String(config?.nostr?.storageNamespace || "nostr-site").trim()}.public-event-cache`;
}

function publicEventCacheLimit() {
  const value = Number(config?.nostr?.publicEventCacheLimit || 800);
  return Number.isFinite(value) && value >= 100 ? Math.floor(value) : 800;
}

function publicRepairRepublishLimit() {
  const value = Number(config?.nostr?.publicRepairRepublishLimit || 180);
  return Number.isFinite(value) && value >= 20 ? Math.floor(value) : 180;
}

async function maybeRespondToPublicStateRepairRequest(event, relays, options = {}) {
  if (!isVerifiedPublicEvent(event)) return;
  const decoded = parseObject(event?.content);
  const requestId = cleanSlug(decoded?.request_id || firstTag(event, "d"));
  if (!requestId || handledPublicStateRepairRequests.has(requestId)) return;
  if (Number(event?.created_at || 0) < Math.floor(Date.now() / 1000) - 120) return;
  if (!decoded || decoded.protocol !== protocolName("public-state-repair")) return;
  const cachedEvents = typeof options.getCachedEvents === "function"
    ? (await Promise.resolve(options.getCachedEvents())).map(normalizeCachedPublicEvent).filter(Boolean)
    : loadCachedPublicEvents();
  if (!cachedEvents.length) return;
  const knownEventCount = Number(decoded?.known_event_count || 0) || 0;
  if (cachedEvents.length <= knownEventCount) return;
  handledPublicStateRepairRequests.add(requestId);
  trimHandledRepairRequestSet();
  await wait(Math.floor(250 + Math.random() * 900));
  await rebroadcastCachedPublicEvents(relays, cachedEvents, options);
}

async function rebroadcastCachedPublicEvents(relays, cachedEvents, options = {}) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { SimplePool } = tools;
  const pool = new SimplePool();
  const limit = Number(options.limit || publicRepairRepublishLimit());
  const events = selectRepairEvents(cachedEvents, limit);
  try {
    for (const event of events) {
      await Promise.allSettled(pool.publish(relays, event));
    }
  } finally {
    pool.close(relays);
  }
}

function selectRepairEvents(events, limit) {
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : publicRepairRepublishLimit();
  return [...(Array.isArray(events) ? events : [])]
    .map(normalizeCachedPublicEvent)
    .filter((event) => isVerifiedPublicEvent(event))
    .sort((left, right) => {
      const priorityDelta = repairEventPriority(right) - repairEventPriority(left);
      if (priorityDelta !== 0) return priorityDelta;
      return compareEventDesc(left, right);
    })
    .slice(0, max);
}

function repairEventPriority(event) {
  const kind = Number(event?.kind);
  if (kind === config?.nostr?.kinds?.siteKey) return 6;
  if (kind === config?.nostr?.kinds?.adminClaim || kind === config?.nostr?.kinds?.adminRole) return 5;
  if (kind === config?.nostr?.kinds?.nameClaim || kind === config?.nostr?.kinds?.profile) return 4;
  if (kind === config?.nostr?.kinds?.entity || kind === config?.nostr?.kinds?.draft) return 3;
  if (kind === config?.nostr?.kinds?.comment || kind === config?.nostr?.kinds?.commentMod) return 2;
  return 1;
}

function trimHandledRepairRequestSet() {
  if (handledPublicStateRepairRequests.size < 256) return;
  const values = [...handledPublicStateRepairRequests.values()];
  handledPublicStateRepairRequests.clear();
  for (const value of values.slice(-128)) handledPublicStateRepairRequests.add(value);
}

async function loadSeedEntities() {
  const path = String(config?.content?.seedEntitiesPath || "").trim();
  if (!path) return [];
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    const entities = Array.isArray(payload?.entities) ? payload.entities : Array.isArray(payload) ? payload : [];
    return entities.map(normalizeSeedEntity).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeSeedEntity(payload) {
  const slug = cleanSlug(payload?.slug || payload?.name || "");
  if (!slug) return null;
  return {
    slug,
    author: "",
    name: String(payload?.name || slug).trim(),
    location: String(payload?.location || "Undisclosed location").trim(),
    type: String(payload?.type || "entity").trim(),
    lat: parseMaybeNumber(payload?.lat),
    lng: parseMaybeNumber(payload?.lng),
    notes: String(payload?.notes || "").trim(),
    aliases: Array.isArray(payload?.aliases)
      ? payload.aliases.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    status: String(payload?.status || "approved").trim() || "approved",
    created_at: 0,
    id: `seed:${slug}`,
    _event: null
  };
}

async function queryEvents(filters, options = {}) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { SimplePool } = tools;
  const relays = normalizeRelayList(options.relays, publicRelayList());
  if (!relays.length) return [];
  const timeoutMs = Number(options.timeoutMs || config.nostr.connectTimeoutMs || 3200);
  const pool = new SimplePool();
  try {
    const normalized = expandQueryFilters(
      (Array.isArray(filters) ? filters : [filters]).filter((filter) => filter && typeof filter === "object")
    );
    const results = await Promise.allSettled(
      normalized.map((filter) =>
        withTimeout(pool.querySync(relays, filter, {}), timeoutMs)
      )
    );
    const merged = new Map();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const event of result.value) {
        if (!isVerifiedPublicEvent(event)) continue;
        if (!merged.has(event.id)) merged.set(event.id, event);
      }
    }
    return [...merged.values()];
  } finally {
    pool.close(relays);
  }
}

function expandQueryFilters(filters) {
  const chunkSize = normalizeFilterChunkSize(config?.nostr?.filterChunkSize);
  const expanded = [];
  const seen = new Set();
  for (const filter of filters) {
    const chunks = splitFilterArrays(filter, chunkSize);
    for (const chunk of chunks) {
      const key = stableFilterKey(chunk);
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push(chunk);
    }
  }
  return expanded;
}

function splitFilterArrays(filter, chunkSize) {
  let pending = [cloneFilter(filter)];
  for (const [key, value] of Object.entries(filter || {})) {
    if (!Array.isArray(value) || value.length <= chunkSize) continue;
    const parts = chunkArray(value, chunkSize);
    pending = pending.flatMap((entry) =>
      parts.map((part) => ({
        ...entry,
        [key]: part
      }))
    );
  }
  return pending;
}

function cloneFilter(filter) {
  return Object.fromEntries(
    Object.entries(filter || {}).map(([key, value]) => [key, Array.isArray(value) ? value.slice() : value])
  );
}

function stableFilterKey(filter) {
  return JSON.stringify(
    Object.entries(filter || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, Array.isArray(value) ? value.slice() : value])
  );
}

function chunkArray(values, chunkSize) {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function normalizeFilterChunkSize(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 2 ? Math.floor(number) : 12;
}

function withAppTag(tags) {
  const next = Array.isArray(tags) ? tags.filter(Array.isArray) : [];
  if (!next.some((tag) => tag[0] === "t" && tag.includes(config.nostr.appTag))) {
    next.push(["t", config.nostr.appTag]);
  }
  if (!next.some((tag) => tag[0] === "client")) {
    next.push(["client", config.nostr.clientName]);
  }
  return next;
}

function mergeLatest(map, key, next) {
  const current = map.get(key);
  if (!current || compareEventDesc(next._event, current._event) < 0) {
    map.set(key, next);
  }
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const bucketKey = String(item[key] || "").trim();
    if (!bucketKey) continue;
    const bucket = map.get(bucketKey) || [];
    bucket.push(item);
    map.set(bucketKey, bucket);
  }
  return map;
}

function buildBlobTags(reference) {
  const normalized = normalizeBlobReference(reference);
  if (!normalized) return [];
  const tags = [
    ["x", normalized.sha256],
    ["r", normalized.url],
    [
      "blob",
      normalized.sha256,
      normalized.url,
      normalized.access || "public",
      normalized.cipher || "none",
      normalized.type || "application/octet-stream",
      normalized.name || "blob.bin",
      normalized.recipient_pubkey || "",
      normalized.author_pubkey || ""
    ]
  ];
  return tags;
}

function buildBlobEventState(event, mode) {
  const payload = parseObject(event.content);
  const reference = normalizeBlobReference(payload?.blob || payload?.reference || payload || null, event);
  if (!reference) return null;
  return {
    ...reference,
    mode,
    pubkey: normalizePubkey(event.pubkey),
    created_at: toUnix(event.created_at),
    id: event.id,
    note: String(payload?.note || payload?.reason || "").trim(),
    request_id: String(payload?.request_id || firstTag(event, "req") || "").trim(),
    _event: event
  };
}

function normalizeBlobReference(value, event = null) {
  const input = value && typeof value === "object" ? value : {};
  const fallback = event && typeof event === "object" ? extractBlobReferenceFromTags(event.tags || []) : null;
  const sha256 = String(input.sha256 || fallback?.sha256 || firstTag(event || {}, "x") || "").trim().toLowerCase();
  const url = String(input.url || fallback?.url || firstTag(event || {}, "r") || "").trim();
  if (!isHex64(sha256) || !/^https?:\/\//i.test(url)) return null;
  return {
    sha256,
    url,
    access: String(input.access || fallback?.access || "public").trim() || "public",
    cipher: String(input.cipher || fallback?.cipher || "none").trim() || "none",
    type: String(input.type || fallback?.type || "application/octet-stream").trim() || "application/octet-stream",
    name: String(input.name || fallback?.name || "blob.bin").trim() || "blob.bin",
    size: Number(input.size || fallback?.size || 0) || 0,
    author_pubkey: normalizePubkey(input.author_pubkey || fallback?.author_pubkey || ""),
    recipient_pubkey: normalizePubkey(input.recipient_pubkey || fallback?.recipient_pubkey || ""),
    uploaded_at: String(input.uploaded_at || fallback?.uploaded_at || "").trim()
  };
}

function extractBlobReferenceFromTags(tags) {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== "blob") continue;
    return {
      sha256: String(tag[1] || "").trim().toLowerCase(),
      url: String(tag[2] || "").trim(),
      access: String(tag[3] || "").trim(),
      cipher: String(tag[4] || "").trim(),
      type: String(tag[5] || "").trim(),
      name: String(tag[6] || "").trim(),
      recipient_pubkey: normalizePubkey(tag[7] || ""),
      author_pubkey: normalizePubkey(tag[8] || "")
    };
  }
  return null;
}

function blobReferenceKey(reference) {
  if (!reference || typeof reference !== "object") return "";
  return String(reference.sha256 || reference.url || "").trim().toLowerCase();
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePubkey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePubkeyList(values) {
  const source = Array.isArray(values) ? values : [values];
  return [...new Set(source.map((value) => normalizePubkey(value)).filter(isHex64))];
}

function normalizeSiteKeyShares(input) {
  const source = Array.isArray(input) ? input : [input];
  const shares = [];
  const seen = new Set();
  for (const item of source) {
    const secretKeyHex = String(
      typeof item === "string"
        ? item
        : item?.siteSecretKeyHex || item?.secretKeyHex || item?.site_secret_key_hex || ""
    ).trim().toLowerCase();
    if (!isHex64(secretKeyHex)) continue;
    try {
      const identity = deriveIdentity(secretKeyHex);
      if (seen.has(identity.pubkey)) continue;
      seen.add(identity.pubkey);
      shares.push({
        siteSecretKeyHex: secretKeyHex,
        sitePubkey: identity.pubkey,
        secretKey: identity.secretKey
      });
    } catch {
      continue;
    }
  }
  return shares;
}

function normalizeThreadIdentities(input) {
  return normalizeSiteKeyShares(input).map((share) => ({
    secretKeyHex: share.siteSecretKeyHex,
    secretKey: share.secretKey,
    pubkey: share.sitePubkey
  }));
}

function firstTag(event, key) {
  const hit = (event.tags || []).find((tag) => Array.isArray(tag) && tag[0] === key);
  return hit ? String(hit[1] || "") : "";
}

function isHex64(value) {
  return /^[0-9a-f]{64}$/.test(String(value || ""));
}

function parseMaybeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toUnix(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function compareEventDesc(left, right) {
  if (left.created_at !== right.created_at) return right.created_at - left.created_at;
  return String(right.id || "").localeCompare(String(left.id || ""));
}

function compareEventAsc(left, right) {
  if (left.created_at !== right.created_at) return left.created_at - right.created_at;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Relay connection timed out.")), timeoutMs);
    })
  ]);
}

function wait(timeoutMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(timeoutMs) || 0));
  });
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

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const clean = String(hex || "").trim().toLowerCase();
  if (clean.length % 2 !== 0) throw new Error("Hex string must have an even length.");
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    const value = Number.parseInt(clean.slice(index, index + 2), 16);
    if (!Number.isFinite(value)) throw new Error("Invalid hex byte.");
    bytes[index / 2] = value;
  }
  return bytes;
}

  return {
    getEventTools,
    hasNostrTools,
    ensureEventToolsLoaded,
    shortKey,
    normalizeUsername,
    cleanSlug,
    deriveIdentity,
    generateSecretKeyHex,
    resolveSitePubkey,
    loadPublicState,
    publicStateNeedsRepair,
    requestPublicStateRepair,
    startPublicStateRepairPeer,
    stopPublicStateRepairPeer,
    publishTaggedJson,
    publishEncryptedJson,
    publishSubmission,
    publishSubmissionChat,
    publishAdminKeyShare,
    publishAdminKeyRequest,
    publishSiteKeyEvent,
    loadAdminKeyShares,
    loadAdminKeyShare,
    lookupUsers,
    loadUserSubmissions,
    loadInboxSubmissions,
    loadSubmissionThread
  };
}

export default createNostrCmsClient;
