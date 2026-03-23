import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryRuntimeDatabase } from "../portable/runtime-db.js";
import { createPersistentSessionStore } from "../portable/session-storage.js";

test("persistent session store hydrates from runtime meta and persists updates", async () => {
  const database = createMemoryRuntimeDatabase();
  const legacy = new Map();
  await database.setMeta("session/current", {
    session: {
      username: "aux",
      secretKeyHex: "deadbeef",
      pubkey: "abc123"
    },
    updatedAt: 1
  });

  const store = createPersistentSessionStore({
    namespace: "nostr-site.test",
    database,
    legacyStorage: {
      getItem: (key) => legacy.get(key) || null,
      setItem: (key, value) => legacy.set(key, value),
      removeItem: (key) => legacy.delete(key)
    }
  });

  await store.hydrate();
  assert.deepEqual(store.getStoredSession(), {
    username: "aux",
    secretKeyHex: "deadbeef",
    pubkey: "abc123"
  });

  store.saveSession({
    username: "clippy",
    secretKeyHex: "feedface",
    pubkey: "def456"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const persisted = await database.getMeta("session/current");
  assert.deepEqual(persisted?.session, {
    username: "clippy",
    secretKeyHex: "feedface",
    pubkey: "def456"
  });
  assert.equal(typeof persisted?.updatedAt, "number");
  assert.equal(legacy.get("nostr-site.test.session"), JSON.stringify({
    username: "clippy",
    secretKeyHex: "feedface",
    pubkey: "def456"
  }));
});

test("persistent session store migrates legacy browser storage into runtime meta", async () => {
  const database = createMemoryRuntimeDatabase();
  const legacy = new Map([
    ["nostr-site.test.session", JSON.stringify({
      username: "Aux",
      secretKeyHex: "deadbeef",
      pubkey: "abc123"
    })],
    ["nostr-site.test.guest", JSON.stringify({
      guestId: "guest-1",
      secretKeyHex: "feedface",
      pubkey: "def456",
      createdAt: "2026-03-21T00:00:00.000Z"
    })]
  ]);
  const legacyStorage = {
    getItem: (key) => legacy.get(key) || null,
    setItem: (key, value) => legacy.set(key, value),
    removeItem: (key) => legacy.delete(key)
  };

  const store = createPersistentSessionStore({
    namespace: "nostr-site.test",
    database,
    legacyStorage
  });

  assert.deepEqual(store.getStoredSession(), {
    username: "aux",
    secretKeyHex: "deadbeef",
    pubkey: "abc123"
  });

  await store.hydrate();

  assert.deepEqual(store.getStoredSession(), {
    username: "aux",
    secretKeyHex: "deadbeef",
    pubkey: "abc123"
  });
  assert.deepEqual(store.getStoredGuestSession(), {
    kind: "guest",
    guestId: "guest-1",
    secretKeyHex: "feedface",
    pubkey: "def456",
    createdAt: "2026-03-21T00:00:00.000Z"
  });
  assert.equal(legacy.size, 2);
  assert.equal(
    legacy.get("nostr-site.test.session"),
    JSON.stringify({
      username: "aux",
      secretKeyHex: "deadbeef",
      pubkey: "abc123"
    })
  );
});
