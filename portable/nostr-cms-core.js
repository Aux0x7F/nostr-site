export function createNostrCmsClient(config) {
let publicStatePromise = null;
let toolsPromise = null;
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
  const secretKey = tools.hexToBytes(clean);
  return {
    secretKey,
    secretKeyHex: clean,
    pubkey: tools.getPublicKey(secretKey)
  };
}

async function loadPublicState(force = false) {
  if (!force && publicStatePromise) return publicStatePromise;
  publicStatePromise = fetchPublicState();
  return publicStatePromise;
}

async function publishTaggedJson({ kind, secretKeyHex, tags = [], content = {} }) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { SimplePool, finalizeEvent } = tools;
  const identity = deriveIdentity(secretKeyHex);
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
  const results = await Promise.allSettled(pool.publish(config.nostr.relays, event));
  pool.close(config.nostr.relays);

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
  const results = await Promise.allSettled(pool.publish(config.nostr.relays, event));
  pool.close(config.nostr.relays);

  return {
    event,
    ok: results.filter((item) => item.status === "fulfilled").length,
    total: results.length
  };
}

async function publishSubmission(secretKeyHex, payload) {
  if (!config.nostr.inboxPubkey) throw new Error("Inbox pubkey is not configured.");
  const submissionId = cleanSlug(payload?.submission_id || payload?.subject || `submission-${Date.now()}`) || `submission-${Date.now()}`;
  const body = {
    protocol: protocolName("submission"),
    submission_id: submissionId,
    updated_at: new Date().toISOString(),
    ...payload
  };
  return publishEncryptedJson({
    secretKeyHex,
    targetPubkey: config.nostr.inboxPubkey,
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
  if (siteIdentity.pubkey !== config.nostr.inboxPubkey) {
    throw new Error("Site key does not match the configured inbox pubkey.");
  }
  return publishEncryptedJson({
    secretKeyHex,
    targetPubkey,
    kind: config.nostr.kinds.adminKeyShare,
    tags: [["d", `site-key:${config.nostr.inboxPubkey}`], ["k", "admin-key-share"]],
    content: {
      protocol: protocolName("admin-key-share"),
      site_pubkey: siteIdentity.pubkey,
      site_secret_key_hex: siteSecretKeyHex,
      shared_at: new Date().toISOString()
    }
  });
}

async function loadAdminKeyShare(secretKeyHex) {
  if (!config.nostr.inboxPubkey) return null;
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
  ]);
  for (const event of events.sort(compareEventDesc)) {
    try {
      const payload = parseObject(await nip04.decrypt(identity.secretKey, event.pubkey, event.content));
      if (!payload || payload.protocol !== protocolName("admin-key-share")) continue;
      const siteSecretKeyHex = String(payload.site_secret_key_hex || "").trim().toLowerCase();
      const siteIdentity = deriveIdentity(siteSecretKeyHex);
      if (siteIdentity.pubkey !== config.nostr.inboxPubkey) continue;
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
  return null;
}

async function loadUserSubmissions(secretKeyHex) {
  if (!config.nostr.inboxPubkey) return [];
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { nip04 } = tools;
  const identity = deriveIdentity(secretKeyHex);
  const events = await queryEvents([
    {
      kinds: [config.nostr.kinds.tip],
      authors: [identity.pubkey],
      "#p": [config.nostr.inboxPubkey],
      "#t": [config.nostr.appTag],
      "#k": ["submission"],
      limit: config.nostr.privateLoadLimit
    }
  ]);
  const submissions = [];
  for (const event of events.sort(compareEventDesc)) {
    try {
      const payload = parseObject(await nip04.decrypt(identity.secretKey, config.nostr.inboxPubkey, event.content));
      if (!payload) continue;
      submissions.push({
        id: cleanSlug(payload.submission_id || firstTag(event, "d")) || event.id,
        author: event.pubkey,
        payload,
        event
      });
    } catch {
      continue;
    }
  }
  return groupSubmissions(submissions);
}

async function loadInboxSubmissions(secretKeyHex) {
  if (!config.nostr.inboxPubkey) return [];
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { nip04 } = tools;
  const identity = deriveIdentity(secretKeyHex);
  if (identity.pubkey !== config.nostr.inboxPubkey) {
    throw new Error("This key cannot decrypt the shared inbox.");
  }
  const events = await queryEvents([
    {
      kinds: [config.nostr.kinds.tip],
      "#p": [identity.pubkey],
      "#t": [config.nostr.appTag],
      "#k": ["submission"],
      limit: config.nostr.privateLoadLimit
    }
  ]);
  const submissions = [];
  for (const event of events.sort(compareEventDesc)) {
    try {
      const payload = parseObject(await nip04.decrypt(identity.secretKey, event.pubkey, event.content));
      if (!payload) continue;
      submissions.push({
        id: cleanSlug(payload.submission_id || firstTag(event, "d")) || event.id,
        author: event.pubkey,
        payload,
        event
      });
    } catch {
      submissions.push({
        id: firstTag(event, "d") || event.id,
        author: event.pubkey,
        payload: null,
        event,
        error: "Could not decrypt this submission."
      });
    }
  }
  return groupSubmissions(submissions);
}

async function loadSubmissionThread(secretKeyHex, submissionId, counterpartPubkey) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { nip04 } = tools;
  const identity = deriveIdentity(secretKeyHex);
  const cleanId = cleanSlug(submissionId);
  const filters = [
    {
      kinds: [config.nostr.kinds.tip],
      authors: [identity.pubkey],
      "#p": [counterpartPubkey],
      "#t": [config.nostr.appTag],
      "#d": [cleanId],
      "#k": ["submission-chat"],
      limit: config.nostr.privateLoadLimit
    },
    {
      kinds: [config.nostr.kinds.tip],
      authors: [counterpartPubkey],
      "#p": [identity.pubkey],
      "#t": [config.nostr.appTag],
      "#d": [cleanId],
      "#k": ["submission-chat"],
      limit: config.nostr.privateLoadLimit
    }
  ];
  const events = await queryEvents(filters);
  const messages = [];
  for (const event of events.sort(compareEventAsc)) {
    const peer = event.pubkey === identity.pubkey ? counterpartPubkey : event.pubkey;
    try {
      const payload = parseObject(await nip04.decrypt(identity.secretKey, peer, event.content));
      if (!payload) continue;
      messages.push({
        id: event.id,
        author: event.pubkey,
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

  try {
    const visitSince = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30;
    const filters = [
      {
        kinds: [
          config.nostr.kinds.adminClaim,
          config.nostr.kinds.adminRole,
          config.nostr.kinds.userMod,
          config.nostr.kinds.nameClaim,
          config.nostr.kinds.profile,
          config.nostr.kinds.entity,
          config.nostr.kinds.draft,
          config.nostr.kinds.comment,
          config.nostr.kinds.commentMod,
          config.nostr.kinds.submissionStatus,
          config.nostr.kinds.adminKeyShare,
          config.nostr.kinds.blobRequest,
          config.nostr.kinds.blobFulfillment
        ],
        "#t": [config.nostr.appTag],
        limit: config.nostr.publicLoadLimit
      },
      {
        kinds: [config.nostr.kinds.visitPulse],
        "#t": [config.nostr.appTag],
        since: visitSince,
        limit: Math.max(800, config.nostr.publicLoadLimit * 4)
      }
    ];
    if (config.nostr.inboxPubkey) {
      filters.push({
        kinds: [config.nostr.kinds.tip],
        "#p": [config.nostr.inboxPubkey],
        "#t": [config.nostr.appTag],
        "#k": ["submission"],
        limit: config.nostr.privateLoadLimit
      });
    }
    const events = await queryEvents(filters);
    return buildPublicState(events, seedEntities);
  } catch (error) {
    return emptyPublicState(String(error?.message || error || "Relay timeout."), seedEntities);
  }
}

function buildPublicState(events, seedEntities = []) {
  const claims = [];
  const roles = [];
  const userModEvents = [];
  const commentModEvents = [];
  const submissionStatusEvents = [];
  const nameClaims = new Map();
  const profiles = new Map();
  const entities = new Map();
  const drafts = new Map();
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
        created_at: toUnix(event.created_at),
        id: event.id,
        _event: event
      };
      mergeLatest(drafts, slug, next);
      continue;
    }

    if (kind === config.nostr.kinds.comment) {
      const payload = parseObject(event.content);
      const commentId = firstTag(event, "d") || event.id;
      const postSlug = cleanSlug(payload?.post_slug || firstTag(event, "a"));
      if (!postSlug) continue;
      const next = {
        id: commentId,
        post_slug: postSlug,
        author: normalizePubkey(event.pubkey),
        markdown: String(payload?.markdown || payload?.body || "").trim(),
        created_at: toUnix(event.created_at),
        id_event: event.id,
        _event: event
      };
      mergeLatest(comments, commentId, next);
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
  const moderation = computeLatestModeration(userModEvents, admins);
  const commentModeration = computeCommentModeration(commentModEvents, admins);
  const submissionStatuses = computeSubmissionStatuses(submissionStatusEvents, admins);

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
      return {
        ...comment,
        visibility: mod?.action === "hide" ? "hidden" : "visible",
        moderation: mod
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
    moderation,
    users,
    entities: entityList,
    approvedEntities: entityList.filter((entity) => entity.status === "approved"),
    drafts: [...drafts.values()].sort((left, right) => right.date.localeCompare(left.date)),
    allComments,
    comments: visibleComments,
    hiddenComments,
    commentsByPost,
    commentsByAuthor,
    commentModeration,
    blobRequests,
    blobFulfillments,
    submissionStatuses,
    submissionCountByAuthor,
    visits: visitMetrics.events,
    metrics: {
      userCount: users.length,
      adminCount: adminState.admins.length,
      submissionCount: submissionCounters.size,
      commentCount: visibleComments.length,
      hiddenCommentCount: hiddenComments.length,
      entityCount: entityList.length,
      approvedEntityCount: entityList.filter((entity) => entity.status === "approved").length,
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
    moderation: new Map(),
    users: [],
    entities,
    approvedEntities,
    drafts: [],
    allComments: [],
    comments: [],
    hiddenComments: [],
    commentsByPost: new Map(),
    commentsByAuthor: new Map(),
    commentModeration: new Map(),
    blobRequests: new Map(),
    blobFulfillments: new Map(),
    submissionStatuses: new Map(),
    submissionCountByAuthor: new Map(),
    visits: [],
    metrics: {
      userCount: 0,
      adminCount: 0,
      submissionCount: 0,
      commentCount: 0,
      hiddenCommentCount: 0,
      entityCount: entities.length,
      approvedEntityCount: approvedEntities.length,
      visitorCount24h: 0,
      visitorCount7d: 0,
      visitEventCount7d: 0
    },
    rawEvents: []
  };
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

async function queryEvents(filters) {
  const tools = getEventTools();
  if (!tools) throw new Error("Nostr tools unavailable.");
  const { SimplePool } = tools;
  const pool = new SimplePool();
  try {
    const normalized = (Array.isArray(filters) ? filters : [filters]).filter((filter) => filter && typeof filter === "object");
    const results = await Promise.allSettled(
      normalized.map((filter) =>
        withTimeout(pool.querySync(config.nostr.relays, filter, {}), config.nostr.connectTimeoutMs)
      )
    );
    const merged = new Map();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const event of result.value) {
        if (!merged.has(event.id)) merged.set(event.id, event);
      }
    }
    return [...merged.values()];
  } finally {
    pool.close(config.nostr.relays);
  }
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

  return {
    getEventTools,
    hasNostrTools,
    ensureEventToolsLoaded,
    shortKey,
    normalizeUsername,
    cleanSlug,
    deriveIdentity,
    loadPublicState,
    publishTaggedJson,
    publishEncryptedJson,
    publishSubmission,
    publishSubmissionChat,
    publishAdminKeyShare,
    loadAdminKeyShare,
    loadUserSubmissions,
    loadInboxSubmissions,
    loadSubmissionThread
  };
}

export default createNostrCmsClient;
