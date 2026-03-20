import test from "node:test";
import assert from "node:assert/strict";

import { createDeterministicSessionApi } from "../portable/deterministic-session.js";
import {
  appendUsernameConflictSuffix,
  buildCanonicalUsernameRegistry,
  resolveUsernameConflictOrdinal
} from "../portable/username-claims.js";

test("canonical username registry keeps the earliest explicit claim as owner and marks collisions", () => {
  const claimA = {
    pubkey: "a".repeat(64),
    username: "aux",
    created_at: 10,
    _event: { id: "a", created_at: 10 }
  };
  const claimB = {
    pubkey: "b".repeat(64),
    username: "aux",
    created_at: 20,
    _event: { id: "b", created_at: 20 }
  };

  const registry = buildCanonicalUsernameRegistry({
    nameClaims: new Map([
      [claimA.pubkey, claimA],
      [claimB.pubkey, claimB]
    ])
  });

  const entry = registry.get("aux");
  assert.ok(entry);
  assert.equal(entry.owner_pubkey, claimA.pubkey);
  assert.equal(entry.conflict, true);
  assert.deepEqual(entry.claimant_pubkeys, [claimA.pubkey, claimB.pubkey]);
});

test("username conflict helpers keep owner first and suffix later claimants deterministically", () => {
  const registry = buildCanonicalUsernameRegistry({
    nameClaims: new Map([
      ["b".repeat(64), { pubkey: "b".repeat(64), username: "aux", created_at: 20 }],
      ["a".repeat(64), { pubkey: "a".repeat(64), username: "aux", created_at: 10 }],
      ["c".repeat(64), { pubkey: "c".repeat(64), username: "aux", created_at: 30 }]
    ])
  });

  const entry = registry.get("aux");
  assert.ok(entry);
  assert.deepEqual(entry.claimant_pubkeys, ["a".repeat(64), "b".repeat(64), "c".repeat(64)]);
  assert.equal(resolveUsernameConflictOrdinal(entry, "a".repeat(64)), 1);
  assert.equal(resolveUsernameConflictOrdinal(entry, "b".repeat(64)), 2);
  assert.equal(resolveUsernameConflictOrdinal(entry, "c".repeat(64)), 3);
  assert.equal(appendUsernameConflictSuffix("aux", 2), "aux 2");
});

test("canonical username registry ignores removed pubkeys when resolving ownership", () => {
  const registry = buildCanonicalUsernameRegistry({
    nameClaims: new Map([
      ["a".repeat(64), { pubkey: "a".repeat(64), username: "aux", created_at: 10 }],
      ["b".repeat(64), { pubkey: "b".repeat(64), username: "aux", created_at: 5 }]
    ]),
    ignoredPubkeys: ["b".repeat(64)]
  });

  const entry = registry.get("aux");
  assert.ok(entry);
  assert.equal(entry.owner_pubkey, "a".repeat(64));
  assert.equal(entry.conflict, false);
  assert.deepEqual(entry.claimant_pubkeys, ["a".repeat(64)]);
});

test("canonical username registry treats rotated pubkeys in the same identity chain as one claimant", () => {
  const rootPubkey = "a".repeat(64);
  const rotatedPubkey = "b".repeat(64);
  const registry = buildCanonicalUsernameRegistry({
    identityChain: {
      canonicalByPubkey: new Map([
        [rootPubkey, rootPubkey],
        [rotatedPubkey, rootPubkey]
      ])
    },
    nameClaims: new Map([
      [rootPubkey, { pubkey: rootPubkey, username: "aux", created_at: 10 }],
      [rotatedPubkey, { pubkey: rotatedPubkey, username: "aux", created_at: 20 }]
    ])
  });

  const entry = registry.get("aux");
  assert.ok(entry);
  assert.equal(entry.owner_pubkey, rootPubkey);
  assert.equal(entry.conflict, false);
  assert.deepEqual(entry.claimant_canonical_pubkeys, [rootPubkey]);
  assert.equal(resolveUsernameConflictOrdinal(entry, rootPubkey), 1);
  assert.equal(resolveUsernameConflictOrdinal(entry, rotatedPubkey), 1);
});

test("deterministic session api validates a session before saving it", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };

  const api = createDeterministicSessionApi(
    {
      nostr: {
        storageNamespace: "nostr-site.test",
        appTag: "nostr-site"
      }
    },
    {
      deriveIdentity: () => ({ pubkey: "a".repeat(64) }),
      ensureEventToolsLoaded: async () => {},
      normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
      publishTaggedJson: async () => ({ ok: 1 })
    }
  );

  await assert.rejects(
    api.signInWithCredentials("aux", "secret", {
      validateSession: async () => {
        throw new Error("taken");
      }
    }),
    /taken/
  );
  assert.equal(storage.size, 0);
});
