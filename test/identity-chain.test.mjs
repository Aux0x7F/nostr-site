import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanonicalIdentityRegistry,
  expandCanonicalIdentityPubkeys,
  identityPubkeyIsCurrent,
  resolveCanonicalIdentityPubkey,
  resolveCurrentIdentityPubkey
} from "../portable/identity-chain.js";
import { createDeterministicSessionApi } from "../portable/deterministic-session.js";

test("identity chain keeps only fully paired rotations and resolves the oldest root as canonical", () => {
  const registry = buildCanonicalIdentityRegistry({
    rotationEvents: [
      {
        id: "p1",
        pubkey: "a".repeat(64),
        action: "propose",
        old_pubkey: "a".repeat(64),
        new_pubkey: "b".repeat(64),
        created_at: 10
      },
      {
        id: "a1",
        pubkey: "b".repeat(64),
        action: "accept",
        old_pubkey: "a".repeat(64),
        new_pubkey: "b".repeat(64),
        created_at: 11
      },
      {
        id: "p2",
        pubkey: "b".repeat(64),
        action: "propose",
        old_pubkey: "b".repeat(64),
        new_pubkey: "c".repeat(64),
        created_at: 12
      },
      {
        id: "a2",
        pubkey: "c".repeat(64),
        action: "accept",
        old_pubkey: "b".repeat(64),
        new_pubkey: "c".repeat(64),
        created_at: 13
      },
      {
        id: "dangling",
        pubkey: "d".repeat(64),
        action: "propose",
        old_pubkey: "d".repeat(64),
        new_pubkey: "e".repeat(64),
        created_at: 14
      }
    ]
  });

  assert.equal(registry.validLinks.length, 2);
  assert.equal(registry.pendingLinks.length, 1);
  assert.equal(resolveCanonicalIdentityPubkey(registry, "c".repeat(64)), "a".repeat(64));
  assert.equal(resolveCurrentIdentityPubkey(registry, "a".repeat(64)), "c".repeat(64));
  assert.equal(identityPubkeyIsCurrent(registry, "a".repeat(64)), false);
  assert.equal(identityPubkeyIsCurrent(registry, "c".repeat(64)), true);
  assert.deepEqual(expandCanonicalIdentityPubkeys(registry, "b".repeat(64)), [
    "a".repeat(64),
    "b".repeat(64),
    "c".repeat(64)
  ]);
});

test("identity chain rejects cyclic links", () => {
  const registry = buildCanonicalIdentityRegistry({
    rotationEvents: [
      {
        id: "p1",
        pubkey: "a".repeat(64),
        action: "propose",
        old_pubkey: "a".repeat(64),
        new_pubkey: "b".repeat(64),
        created_at: 10
      },
      {
        id: "a1",
        pubkey: "b".repeat(64),
        action: "accept",
        old_pubkey: "a".repeat(64),
        new_pubkey: "b".repeat(64),
        created_at: 11
      },
      {
        id: "p2",
        pubkey: "b".repeat(64),
        action: "propose",
        old_pubkey: "b".repeat(64),
        new_pubkey: "a".repeat(64),
        created_at: 12
      },
      {
        id: "a2",
        pubkey: "a".repeat(64),
        action: "accept",
        old_pubkey: "b".repeat(64),
        new_pubkey: "a".repeat(64),
        created_at: 13
      }
    ]
  });

  assert.equal(registry.validLinks.length, 1);
  assert.equal(resolveCanonicalIdentityPubkey(registry, "b".repeat(64)), "a".repeat(64));
});

test("deterministic session api publishes a paired password rotation and saves the new session", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };

  const publishes = [];
  const api = createDeterministicSessionApi(
    {
      nostr: {
        storageNamespace: "nostr-site.test",
        appTag: "nostr-site",
        kinds: {
          profile: 1,
          nameClaim: 2,
          identityRotation: 3
        }
      }
    },
    {
      deriveIdentity: (secretKeyHex) => ({
        pubkey: secretKeyHex.slice(0, 64)
      }),
      ensureEventToolsLoaded: async () => {},
      normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
      publishTaggedJson: async (payload) => {
        publishes.push(payload);
        return { ok: true, event: { id: `${publishes.length}` } };
      }
    }
  );

  const currentSession = {
    username: "aux",
    secretKeyHex: "a".repeat(64),
    pubkey: "a".repeat(64)
  };

  const result = await api.rotateAccountCredentials(currentSession, "new-password");

  assert.equal(result.previousPubkey, "a".repeat(64));
  assert.equal(result.session.username, "aux");
  assert.equal(result.proposed, true);
  assert.equal(result.accepted, true);
  assert.equal(publishes.length, 2);
  assert.deepEqual(publishes.map((entry) => entry.content.action), ["propose", "accept"]);
  assert.equal(api.getStoredSession().pubkey, result.session.pubkey);
});

test("deterministic session api can derive login and rotation sessions without persisting them", async () => {
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
        appTag: "nostr-site",
        kinds: {
          profile: 1,
          nameClaim: 2,
          identityRotation: 3
        }
      }
    },
    {
      deriveIdentity: (secretKeyHex) => ({
        pubkey: secretKeyHex.slice(0, 64)
      }),
      ensureEventToolsLoaded: async () => {},
      normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
      publishTaggedJson: async () => ({ ok: true, event: { id: "1" } })
    }
  );

  const signInSession = await api.signInWithCredentials("aux", "secret", { persistSession: false });
  assert.equal(api.getStoredSession(), null);

  const rotation = await api.rotateAccountCredentials(
    {
      username: "aux",
      secretKeyHex: signInSession.secretKeyHex,
      pubkey: signInSession.pubkey
    },
    "new-password",
    { persistSession: false }
  );

  assert.equal(api.getStoredSession(), null);
  assert.notEqual(rotation.session.pubkey, signInSession.pubkey);
});

test("deterministic session api repairs a legacy session missing pubkey and can persist it", async () => {
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
        appTag: "nostr-site",
        kinds: {
          profile: 1,
          nameClaim: 2,
          identityRotation: 3
        }
      }
    },
    {
      deriveIdentity: (secretKeyHex) => ({
        pubkey: secretKeyHex.slice(0, 64)
      }),
      ensureEventToolsLoaded: async () => {},
      normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
      publishTaggedJson: async () => ({ ok: true, event: { id: "1" } })
    }
  );

  const repaired = await api.repairSession(
    {
      username: "Aux",
      secretKeyHex: "a".repeat(64),
      pubkey: ""
    },
    { persistSession: false }
  );

  assert.equal(repaired.username, "aux");
  assert.equal(repaired.pubkey, "a".repeat(64));
  assert.equal(api.getStoredSession(), null);

  const persisted = await api.repairSession({
    username: "Aux",
    secretKeyHex: "a".repeat(64),
    pubkey: ""
  });

  assert.equal(persisted.pubkey, "a".repeat(64));
  assert.equal(api.getStoredSession().pubkey, "a".repeat(64));
});

test("deterministic session api resolves and repairs the stored session before consumers read it", async () => {
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
        appTag: "nostr-site",
        kinds: {
          profile: 1,
          nameClaim: 2,
          identityRotation: 3
        }
      }
    },
    {
      deriveIdentity: (secretKeyHex) => ({
        pubkey: secretKeyHex.slice(0, 64)
      }),
      ensureEventToolsLoaded: async () => {},
      normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
      publishTaggedJson: async () => ({ ok: true, event: { id: "1" } })
    }
  );

  api.saveSession({
    username: "Aux",
    secretKeyHex: "b".repeat(64),
    pubkey: ""
  });

  const resolved = await api.resolveStoredSession();

  assert.equal(resolved.username, "aux");
  assert.equal(resolved.pubkey, "b".repeat(64));
  assert.equal(api.getStoredSession().pubkey, "b".repeat(64));
});

test("deterministic session api does not save a partially published password rotation", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };

  let callCount = 0;
  const api = createDeterministicSessionApi(
    {
      nostr: {
        storageNamespace: "nostr-site.test",
        appTag: "nostr-site",
        kinds: {
          profile: 1,
          nameClaim: 2,
          identityRotation: 3
        }
      }
    },
    {
      deriveIdentity: (secretKeyHex) => ({
        pubkey: secretKeyHex.slice(0, 64)
      }),
      ensureEventToolsLoaded: async () => {},
      normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
      publishTaggedJson: async (payload) => {
        callCount += 1;
        return { ok: payload.content.action === "propose", event: { id: `${callCount}` } };
      }
    }
  );

  const currentSession = {
    username: "aux",
    secretKeyHex: "a".repeat(64),
    pubkey: "a".repeat(64)
  };
  api.saveSession(currentSession);

  await assert.rejects(
    api.rotateAccountCredentials(currentSession, "new-password"),
    /Could not fully publish this password rotation/
  );
  assert.equal(api.getStoredSession().pubkey, currentSession.pubkey);
});
