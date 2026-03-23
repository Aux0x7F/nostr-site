import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryRuntimeDatabase } from "../portable/runtime-db.js";
import { createCmsCacheStorage } from "../portable/cms-cache-storage.js";

test("cms cache storage hydrates persisted snapshot and events from runtime meta", async () => {
  const database = createMemoryRuntimeDatabase();
  await database.setMeta("nostr-cms/public-events", {
    events: [{ id: "1", kind: 1 }]
  });
  await database.setMeta("nostr-cms/public-state-snapshot", {
    value: { users: [{ pubkey: "abc123" }] }
  });

  const storage = createCmsCacheStorage({
    namespace: "nostr-site.test",
    database,
    legacyStorage: null
  });

  await storage.hydrate();

  assert.deepEqual(storage.getCachedPublicEvents(), [{ id: "1", kind: 1 }]);
  assert.deepEqual(storage.getCachedPublicStateSnapshot(), { users: [{ pubkey: "abc123" }] });
});

test("cms cache storage migrates legacy browser cache into runtime meta", async () => {
  const database = createMemoryRuntimeDatabase();
  const legacy = new Map([
    ["nostr-site.test.public-event-cache", JSON.stringify([{ id: "1", kind: 1 }])],
    ["nostr-site.test.public-state-snapshot", JSON.stringify({ users: [{ pubkey: "abc123" }] })]
  ]);
  const legacyStorage = {
    getItem: (key) => legacy.get(key) || null,
    removeItem: (key) => legacy.delete(key)
  };

  const storage = createCmsCacheStorage({
    namespace: "nostr-site.test",
    database,
    legacyStorage
  });

  await storage.hydrate();

  assert.deepEqual(storage.getCachedPublicEvents(), [{ id: "1", kind: 1 }]);
  assert.deepEqual(storage.getCachedPublicStateSnapshot(), { users: [{ pubkey: "abc123" }] });
  assert.equal(legacy.size, 0);
});
