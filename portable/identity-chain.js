function normalizeIdentityPubkey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function compareIdentityEvents(left, right) {
  const leftCreated = Number(left?.created_at || 0) || 0;
  const rightCreated = Number(right?.created_at || 0) || 0;
  if (leftCreated !== rightCreated) return leftCreated - rightCreated;
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function pairKey(oldPubkey, newPubkey) {
  return `${normalizeIdentityPubkey(oldPubkey)}:${normalizeIdentityPubkey(newPubkey)}`;
}

function wouldCreateCycle(successorByPubkey, oldPubkey, newPubkey) {
  let current = normalizeIdentityPubkey(newPubkey);
  const target = normalizeIdentityPubkey(oldPubkey);
  while (current) {
    if (current === target) return true;
    current = normalizeIdentityPubkey(successorByPubkey.get(current));
  }
  return false;
}

function resolveRoot(predecessorByPubkey, pubkey) {
  let current = normalizeIdentityPubkey(pubkey);
  while (current && predecessorByPubkey.has(current)) {
    current = normalizeIdentityPubkey(predecessorByPubkey.get(current));
  }
  return current;
}

function resolveHead(successorByPubkey, pubkey) {
  let current = normalizeIdentityPubkey(pubkey);
  while (current && successorByPubkey.has(current)) {
    current = normalizeIdentityPubkey(successorByPubkey.get(current));
  }
  return current;
}

export function buildCanonicalIdentityRegistry({ rotationEvents = [] } = {}) {
  const pairs = new Map();
  const allPubkeys = new Set();

  for (const event of (Array.isArray(rotationEvents) ? rotationEvents : []).slice().sort(compareIdentityEvents)) {
    const action = String(event?.action || "").trim().toLowerCase();
    const oldPubkey = normalizeIdentityPubkey(event?.old_pubkey);
    const newPubkey = normalizeIdentityPubkey(event?.new_pubkey);
    const authorPubkey = normalizeIdentityPubkey(event?.pubkey);
    if (!oldPubkey || !newPubkey || oldPubkey === newPubkey) continue;
    if (action !== "propose" && action !== "accept") continue;
    const key = pairKey(oldPubkey, newPubkey);
    const current = pairs.get(key) || {
      old_pubkey: oldPubkey,
      new_pubkey: newPubkey,
      propose: null,
      accept: null
    };
    if (action === "propose" && authorPubkey === oldPubkey && !current.propose) current.propose = event;
    if (action === "accept" && authorPubkey === newPubkey && !current.accept) current.accept = event;
    pairs.set(key, current);
    allPubkeys.add(oldPubkey);
    allPubkeys.add(newPubkey);
  }

  const predecessorByPubkey = new Map();
  const successorByPubkey = new Map();
  const validLinks = [];
  const pendingLinks = [];

  for (const pair of [...pairs.values()].sort((left, right) => {
    const leftCreated = Math.max(Number(left?.propose?.created_at || 0) || 0, Number(left?.accept?.created_at || 0) || 0);
    const rightCreated = Math.max(Number(right?.propose?.created_at || 0) || 0, Number(right?.accept?.created_at || 0) || 0);
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return pairKey(left.old_pubkey, left.new_pubkey).localeCompare(pairKey(right.old_pubkey, right.new_pubkey));
  })) {
    if (!pair.propose || !pair.accept) {
      pendingLinks.push({
        old_pubkey: pair.old_pubkey,
        new_pubkey: pair.new_pubkey,
        propose: pair.propose,
        accept: pair.accept
      });
      continue;
    }
    if (successorByPubkey.has(pair.old_pubkey)) continue;
    if (predecessorByPubkey.has(pair.new_pubkey)) continue;
    if (wouldCreateCycle(successorByPubkey, pair.old_pubkey, pair.new_pubkey)) continue;
    successorByPubkey.set(pair.old_pubkey, pair.new_pubkey);
    predecessorByPubkey.set(pair.new_pubkey, pair.old_pubkey);
    validLinks.push({
      old_pubkey: pair.old_pubkey,
      new_pubkey: pair.new_pubkey,
      propose: pair.propose,
      accept: pair.accept
    });
  }

  const canonicalByPubkey = new Map();
  const membersByCanonical = new Map();
  const headByCanonical = new Map();
  const currentByPubkey = new Map();
  for (const pubkey of allPubkeys.values()) {
    const canonical = resolveRoot(predecessorByPubkey, pubkey);
    if (!canonical) continue;
    canonicalByPubkey.set(pubkey, canonical);
    const members = membersByCanonical.get(canonical) || [];
    members.push(pubkey);
    membersByCanonical.set(canonical, [...new Set(members)].sort());
  }
  for (const canonical of membersByCanonical.keys()) {
    const head = resolveHead(successorByPubkey, canonical);
    if (!head) continue;
    headByCanonical.set(canonical, head);
    for (const member of membersByCanonical.get(canonical) || []) {
      currentByPubkey.set(member, head);
    }
  }

  return {
    validLinks,
    pendingLinks,
    predecessorByPubkey,
    successorByPubkey,
    canonicalByPubkey,
    membersByCanonical,
    headByCanonical,
    currentByPubkey
  };
}

export function resolveCanonicalIdentityPubkey(registry, pubkey = "") {
  const cleanPubkey = normalizeIdentityPubkey(pubkey);
  if (!cleanPubkey) return "";
  const mapped = registry?.canonicalByPubkey instanceof Map
    ? registry.canonicalByPubkey.get(cleanPubkey)
    : "";
  return normalizeIdentityPubkey(mapped || cleanPubkey);
}

export function expandCanonicalIdentityPubkeys(registry, pubkey = "") {
  const canonical = resolveCanonicalIdentityPubkey(registry, pubkey);
  if (!canonical) return [];
  if (!(registry?.membersByCanonical instanceof Map)) return [canonical];
  return [...new Set(registry.membersByCanonical.get(canonical) || [canonical])];
}

export function resolveCurrentIdentityPubkey(registry, pubkey = "") {
  const canonical = resolveCanonicalIdentityPubkey(registry, pubkey);
  if (!canonical) return "";
  if (registry?.headByCanonical instanceof Map) {
    return normalizeIdentityPubkey(registry.headByCanonical.get(canonical) || canonical);
  }
  return resolveHead(registry?.successorByPubkey instanceof Map ? registry.successorByPubkey : new Map(), canonical) || canonical;
}

export function identityPubkeyIsCurrent(registry, pubkey = "") {
  const cleanPubkey = normalizeIdentityPubkey(pubkey);
  if (!cleanPubkey) return false;
  return resolveCurrentIdentityPubkey(registry, cleanPubkey) === cleanPubkey;
}
