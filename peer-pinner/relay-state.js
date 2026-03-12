let eventToolsPromise = null;

const DEFAULT_KINDS = Object.freeze({
  snapshot: 34126,
  adminClaim: 34127,
  adminRole: 34128,
  userMod: 34129,
  nameClaim: 34130,
  profile: 34131,
  snapshotRequest: 34132,
  entity: 34133,
  draft: 34134,
  comment: 34135,
  commentMod: 34136,
  submissionStatus: 34137,
  adminKeyShare: 34138,
  blobRequest: 34139,
  blobFulfillment: 34140,
  visitPulse: 34141,
  siteKey: 34142,
});

async function detectRelaySiteState({
  relays = [],
  appTag = "",
  limit = 500,
  since = 0,
  kinds = DEFAULT_KINDS,
  recentUserWindowSeconds = 3600,
}) {
  const usableRelays = normalizeRelays(relays);
  if (!usableRelays.length || !String(appTag || "").trim()) {
    return emptyState(usableRelays, kinds, recentUserWindowSeconds);
  }
  const { SimplePool } = await loadEventTools();
  const pool = new SimplePool();
  try {
    const filter = {
      kinds: uniqueKindValues(kinds),
      "#t": [String(appTag || "").trim()],
      limit: Math.max(50, Number(limit) || 500),
    };
    if (Number(since) > 0) filter.since = Math.floor(Number(since));
    const events = await pool.querySync(usableRelays, filter, {});
    return summarizeRelayState(events, {
      relays: usableRelays,
      kinds,
      recentUserWindowSeconds,
    });
  } finally {
    pool.close(usableRelays);
  }
}

function summarizeRelayState(events, options = {}) {
  const kinds = options.kinds || DEFAULT_KINDS;
  const now = Math.floor(Date.now() / 1000);
  const countsByKind = {};
  const usersByPubkey = new Map();
  const adminClaims = [];
  const adminRoles = [];
  const uniquePubkeys = new Set();

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== "object") continue;
    const kind = Number(event.kind);
    countsByKind[String(kind)] = (countsByKind[String(kind)] || 0) + 1;
    const pubkey = normalizePubkey(event.pubkey);
    if (pubkey) uniquePubkeys.add(pubkey);

    if (kind === Number(kinds.adminClaim)) {
      const payload = parseObject(event.content);
      const adminPubkey = normalizePubkey(payload?.admin_pubkey || firstTag(event, "admin") || event.pubkey);
      if (isHex64(adminPubkey) && adminPubkey === pubkey) {
        adminClaims.push({
          pubkey: adminPubkey,
          claimed_at: numberOr(payload?.claimed_at || firstTag(event, "version"), event.created_at),
          created_at: numberOr(event.created_at, 0),
          id: String(event.id || ""),
        });
      }
    }

    if (kind === Number(kinds.adminRole)) {
      const payload = parseObject(event.content);
      const action = payload?.action === "grant" ? "grant" : payload?.action === "revoke" ? "revoke" : "";
      const targetPubkey = normalizePubkey(payload?.target_pubkey || firstTag(event, "p"));
      if (action && isHex64(targetPubkey) && isHex64(pubkey)) {
        adminRoles.push({
          pubkey,
          target_pubkey: targetPubkey,
          action,
          created_at: numberOr(event.created_at, 0),
          id: String(event.id || ""),
        });
      }
    }

    if (kind === Number(kinds.nameClaim) || kind === Number(kinds.profile)) {
      const payload = parseObject(event.content) || {};
      const username = normalizeUsername(payload.username || payload.username_normalized || firstTag(event, "u"));
      const displayName = String(payload.display_name || payload.displayName || "").trim();
      const current = usersByPubkey.get(pubkey) || {
        pubkey,
        username: "",
        displayName: "",
        service: false,
        kinds: new Set(),
        seen_at: 0,
        recent: false,
      };
      current.username = username || current.username;
      current.displayName = displayName || current.displayName;
      current.service = current.service || Boolean(payload.service);
      current.kinds.add(kind);
      current.seen_at = Math.max(current.seen_at, numberOr(event.created_at, 0));
      current.recent = current.recent || current.seen_at >= (now - Math.max(300, Number(options.recentUserWindowSeconds) || 3600));
      usersByPubkey.set(pubkey, current);
    }
  }

  const adminState = deriveAdminState(adminClaims, adminRoles);
  const users = [...usersByPubkey.values()]
    .map((user) => ({
      pubkey: user.pubkey,
      username: user.username,
      displayName: user.displayName || user.username || shortKey(user.pubkey),
      service: Boolean(user.service),
      isAdmin: adminState.admins.includes(user.pubkey),
      seen_at: user.seen_at,
      recent: Boolean(user.recent),
      kinds: [...user.kinds.values()].sort((a, b) => a - b),
    }))
    .sort(compareUserCandidates);

  const totalEvents = Object.values(countsByKind).reduce((sum, value) => sum + Number(value || 0), 0);
  const hasNoise = totalEvents > 0;
  const modeSuggestion = !hasNoise
    ? "new-site"
    : adminState.rootAdminPubkey
      ? "site-bootstrap"
      : "bootstrap-needs-root-selection";

  return {
    relays: Array.isArray(options.relays) ? options.relays : [],
    totalEvents,
    hasNoise,
    countsByKind,
    rootAdminPubkey: adminState.rootAdminPubkey,
    admins: adminState.admins,
    users,
    recentUsers: users.filter((user) => user.recent && !user.service),
    modeSuggestion,
  };
}

function deriveAdminState(adminClaims, adminRoles) {
  const claims = [...(Array.isArray(adminClaims) ? adminClaims : [])].sort(compareAdminClaims);
  const roles = [...(Array.isArray(adminRoles) ? adminRoles : [])].sort(compareAdminRoles);
  const rootAdminPubkey = normalizePubkey(claims[0]?.pubkey || "");
  const admins = new Set(rootAdminPubkey ? [rootAdminPubkey] : []);
  for (const role of roles) {
    if (!admins.has(role.pubkey)) continue;
    if (role.action === "grant") {
      admins.add(role.target_pubkey);
    } else if (role.action === "revoke" && role.target_pubkey !== rootAdminPubkey) {
      admins.delete(role.target_pubkey);
    }
  }
  return {
    rootAdminPubkey,
    admins: [...admins.values()].sort(),
  };
}

function emptyState(relays, kinds, recentUserWindowSeconds) {
  return summarizeRelayState([], {
    relays,
    kinds,
    recentUserWindowSeconds,
  });
}

function uniqueKindValues(kinds) {
  return [...new Set(Object.values(kinds || DEFAULT_KINDS).map((value) => Number(value)).filter(Number.isFinite))];
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeRelays(relays) {
  const out = [];
  const seen = new Set();
  for (const relay of Array.isArray(relays) ? relays : String(relays || "").split(",")) {
    const value = String(relay || "").trim();
    if (!value || seen.has(value)) continue;
    if (!(value.startsWith("wss://") || value.startsWith("ws://"))) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function normalizePubkey(value) {
  return String(value || "").trim().toLowerCase();
}

function isHex64(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function firstTag(event, key) {
  const match = Array.isArray(event?.tags)
    ? event.tags.find((tag) => Array.isArray(tag) && tag[0] === key)
    : null;
  return match ? String(match[1] || "") : "";
}

function numberOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : Math.floor(Number(fallback) || 0);
}

function shortKey(value) {
  const text = String(value || "");
  if (text.length < 12) return text;
  return `${text.slice(0, 8)}..${text.slice(-6)}`;
}

function compareAdminClaims(left, right) {
  if (left.claimed_at !== right.claimed_at) return left.claimed_at - right.claimed_at;
  if (left.created_at !== right.created_at) return left.created_at - right.created_at;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function compareAdminRoles(left, right) {
  if (left.created_at !== right.created_at) return left.created_at - right.created_at;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function compareUserCandidates(left, right) {
  if (Boolean(left.isAdmin) !== Boolean(right.isAdmin)) return left.isAdmin ? -1 : 1;
  if (Boolean(left.recent) !== Boolean(right.recent)) return left.recent ? -1 : 1;
  if ((right.seen_at || 0) !== (left.seen_at || 0)) return (right.seen_at || 0) - (left.seen_at || 0);
  return String(left.displayName || left.username || "").localeCompare(String(right.displayName || right.username || ""));
}

async function loadEventTools() {
  if (!eventToolsPromise) {
    eventToolsPromise = import("nostr-tools");
  }
  return eventToolsPromise;
}

module.exports = {
  DEFAULT_KINDS,
  detectRelaySiteState,
  summarizeRelayState,
};
