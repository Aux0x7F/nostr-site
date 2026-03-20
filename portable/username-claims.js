import { resolveCanonicalIdentityPubkey } from "./identity-chain.js";

function normalizeClaimUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeClaimPubkey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function reorderClaimantPubkeys(ownerPubkey, claimantPubkeys = []) {
  const cleanOwnerPubkey = normalizeClaimPubkey(ownerPubkey);
  const uniqueClaimants = [...new Set((Array.isArray(claimantPubkeys) ? claimantPubkeys : []).map(normalizeClaimPubkey).filter(Boolean))];
  if (!cleanOwnerPubkey) return uniqueClaimants;
  return [
    cleanOwnerPubkey,
    ...uniqueClaimants.filter((pubkey) => pubkey !== cleanOwnerPubkey)
  ];
}

export function compareUsernameOwnerCandidate(left, right) {
  const leftRank = left?.source === "claim" ? 0 : 1;
  const rightRank = right?.source === "claim" ? 0 : 1;
  if (leftRank !== rightRank) return leftRank - rightRank;
  const leftCreated = Number(left?.created_at || 0) || 0;
  const rightCreated = Number(right?.created_at || 0) || 0;
  if (leftCreated !== rightCreated) return leftCreated - rightCreated;
  return String(left?.pubkey || "").localeCompare(String(right?.pubkey || ""));
}

export function buildCanonicalUsernameRegistry({
  nameClaims = new Map(),
  profiles = new Map(),
  pubkeys = [],
  ignoredPubkeys = [],
  identityChain = null
} = {}) {
  const registry = new Map();
  const ignored = new Set((Array.isArray(ignoredPubkeys) ? ignoredPubkeys : []).map(normalizeClaimPubkey).filter(Boolean));
  const seenPubkeys = new Set([
    ...nameClaims.keys(),
    ...profiles.keys(),
    ...(Array.isArray(pubkeys) ? pubkeys : [])
  ]);
  const candidatesByUsername = new Map();

  for (const pubkey of seenPubkeys) {
    if (ignored.has(normalizeClaimPubkey(pubkey))) continue;
    const claim = nameClaims.get(pubkey) || null;
    const profile = profiles.get(pubkey) || null;
    const username = normalizeClaimUsername(claim?.username || profile?.username || "");
    if (!username) continue;

    const candidate = {
      pubkey: normalizeClaimPubkey(pubkey),
      canonical_pubkey: normalizeClaimPubkey(resolveCanonicalIdentityPubkey(identityChain, pubkey) || pubkey),
      username,
      source: claim?.username ? "claim" : "profile",
      created_at: Number(claim?.created_at || profile?.created_at || 0) || 0
    };
    const usernameCandidates = candidatesByUsername.get(username) || [];
    usernameCandidates.push(candidate);
    candidatesByUsername.set(username, usernameCandidates);
  }

  for (const [username, rawCandidates] of candidatesByUsername.entries()) {
    const groupsByCanonical = new Map();
    for (const candidate of rawCandidates) {
      const canonicalPubkey = normalizeClaimPubkey(candidate.canonical_pubkey || candidate.pubkey);
      const current = groupsByCanonical.get(canonicalPubkey) || {
        canonical_pubkey: canonicalPubkey,
        representative: null,
        pubkeys: []
      };
      if (!current.representative || compareUsernameOwnerCandidate(candidate, current.representative) < 0) {
        current.representative = candidate;
      }
      current.pubkeys = [...new Set([...current.pubkeys, candidate.pubkey])].filter(Boolean).sort();
      groupsByCanonical.set(canonicalPubkey, current);
    }

    const orderedGroups = [...groupsByCanonical.values()].sort((left, right) =>
      compareUsernameOwnerCandidate(left.representative, right.representative)
    );
    const ownerGroup = orderedGroups[0];
    const claimantCanonicalPubkeys = orderedGroups.map((group) => group.canonical_pubkey);
    const claimantPubkeys = orderedGroups.flatMap((group) => group.pubkeys);
    const claimantCanonicalByPubkey = Object.fromEntries(
      orderedGroups.flatMap((group) => group.pubkeys.map((pubkey) => [pubkey, group.canonical_pubkey]))
    );

    registry.set(username, {
      username,
      owner_pubkey: ownerGroup?.canonical_pubkey || "",
      owner_source: ownerGroup?.representative?.source || "",
      owner_created_at: ownerGroup?.representative?.created_at || 0,
      claimant_pubkeys: claimantPubkeys,
      claimant_canonical_pubkeys: claimantCanonicalPubkeys,
      claimant_canonical_by_pubkey: claimantCanonicalByPubkey,
      conflict: claimantCanonicalPubkeys.length > 1
    });
  }

  return registry;
}

export function resolveUsernameConflictOrdinal(entry = null, pubkey = "") {
  const cleanPubkey = normalizeClaimPubkey(pubkey);
  if (!cleanPubkey) return 0;
  const canonicalByPubkey = entry?.claimant_canonical_by_pubkey && typeof entry.claimant_canonical_by_pubkey === "object"
    ? entry.claimant_canonical_by_pubkey
    : null;
  const cleanCanonicalPubkey = normalizeClaimPubkey(canonicalByPubkey?.[cleanPubkey] || cleanPubkey);
  const claimantCanonicalPubkeys = reorderClaimantPubkeys(
    normalizeClaimPubkey(entry?.owner_pubkey),
    entry?.claimant_canonical_pubkeys || []
  );
  const index = claimantCanonicalPubkeys.findIndex((claimantPubkey) => claimantPubkey === cleanCanonicalPubkey);
  return index >= 0 ? index + 1 : 0;
}

export function appendUsernameConflictSuffix(displayName = "", ordinal = 0) {
  const cleanDisplayName = String(displayName || "").trim();
  const numericOrdinal = Number(ordinal || 0) || 0;
  if (!cleanDisplayName) return numericOrdinal > 1 ? `User ${numericOrdinal}` : "User";
  if (numericOrdinal <= 1) return cleanDisplayName;
  return /\s\d+$/.test(cleanDisplayName)
    ? cleanDisplayName
    : `${cleanDisplayName} ${numericOrdinal}`;
}
