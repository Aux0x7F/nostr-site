import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRuntimeDatabase } from "../portable/runtime-db.js";
import { createRuntimeHost } from "../portable/runtime-host.js";
import { createSharedRuntimeClient } from "../portable/runtime-client.js";
import {
  createSiteRuntimeClient,
  getCachedSiteRuntimeProjection
} from "../scripts/core/runtime-client.js";

test("runtime client fallback host shares projection and session state", async () => {
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase(),
    auth: {
      async signIn({ username, password }) {
        return {
          session: {
            username,
            secretKeyHex: password,
            pubkey: `${username}-pubkey`
          }
        };
      }
    },
    projectionLoaders: {
      publicState: async () => ({ users: [], connected: true })
    }
  });

  let latestSession = null;
  const client = createSharedRuntimeClient({
    hostFactory: () => host,
    onSessionChanged: (session) => {
      latestSession = session;
    }
  });

  const signIn = await client.signIn({
    username: "aux",
    password: "password123"
  });
  const publicState = await client.getProjection("publicState", {}, { preferFresh: true });

  assert.equal(signIn.session.pubkey, "aux-pubkey");
  assert.deepEqual(latestSession, signIn.session);
  assert.equal(publicState.status, "ready");
  assert.deepEqual(publicState.value, { users: [], connected: true });
});

test("runtime client publishes seeded session changes through the shared session subscription", async () => {
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase()
  });

  let latestSession = null;
  const client = createSharedRuntimeClient({
    hostFactory: () => host,
    onSessionChanged: (session) => {
      latestSession = session;
    }
  });

  await client.seedSession({
    username: "aux",
    secretKeyHex: "password123",
    pubkey: "aux-pubkey"
  }, { force: true });

  assert.deepEqual(latestSession, {
    username: "aux",
    secretKeyHex: "password123",
    pubkey: "aux-pubkey"
  });
});

test("runtime client subscription receives projection envelopes", async () => {
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase(),
    projectionLoaders: {
      graph: async () => ({ nodes: [{ id: "animal-agriculture" }], relationships: [] })
    }
  });
  const client = createSharedRuntimeClient({
    hostFactory: () => host
  });
  let latest = null;
  const unsubscribe = await client.subscribeProjection("graph", {}, (envelope) => {
    latest = envelope;
  }, {
    emitCurrent: false,
    refresh: true
  });
  await client.refreshProjection("graph", {}, { reason: "test" });
  unsubscribe();
  assert.equal(latest?.status, "ready");
  assert.deepEqual(latest?.value, { nodes: [{ id: "animal-agriculture" }], relationships: [] });
});

test("site runtime client keeps a sync bootstrap snapshot for cached public state", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase(),
    projectionLoaders: {
      publicState: async () => ({
        admins: ["admin-pubkey"],
        users: [{ pubkey: "admin-pubkey", username: "editor", displayName: "Editor" }]
      })
    }
  });
  const client = createSiteRuntimeClient({
    workerUrl: "",
    hostFactory: () => host
  });

  await client.refreshProjection("publicState", {}, { reason: "bootstrap-test" });
  const cached = getCachedSiteRuntimeProjection("publicState", {});

  assert.equal(cached?.value?.admins?.includes("admin-pubkey"), true);
  assert.equal(cached?.value?.users?.[0]?.displayName, "Editor");

  client.destroy();
});

test("site runtime client seeds public state from the runtime bootstrap envelope without hitting the host loader", async () => {
  const storage = new Map();
  const bootstrapKey = "nostrsite.template.runtime-public-state-bootstrap";
  storage.set(bootstrapKey, JSON.stringify({
    value: {
      admins: ["bootstrap-admin"],
      users: [{ pubkey: "bootstrap-admin", username: "editor", displayName: "Editor" }]
    },
    status: "ready",
    digest: "bootstrap-digest",
    updatedAt: 1,
    meta: { source: "runtime-bootstrap" }
  }));
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };

  let loaderCalls = 0;
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase(),
    projectionLoaders: {
      publicState: async () => {
        loaderCalls += 1;
        return { admins: ["loader-admin"], users: [] };
      }
    }
  });
  const client = createSiteRuntimeClient({
    workerUrl: "",
    hostFactory: () => host
  });

  await client.seedSession(null, { force: false });
  const cached = client.getCachedProjection("publicState", {});

  assert.equal(cached?.value?.admins?.includes("bootstrap-admin"), true);
  assert.equal(loaderCalls, 0);

  client.destroy();
});

test("site runtime client keeps sync bootstrap snapshots for global projection state", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase()
  });
  const client = createSiteRuntimeClient({
    workerUrl: "",
    hostFactory: () => host
  });

  await client.rememberProjection(
    "accountHistory",
    { username: "editor", __projectionScope: "global" },
    {
      username: "editor",
      currentPubkey: "pubkey-current",
      knownPubkeys: ["pubkey-old", "pubkey-current"],
      updatedAt: 1
    },
    { source: "test" }
  );

  const cached = getCachedSiteRuntimeProjection("accountHistory", {
    username: "editor",
    __projectionScope: "global"
  });

  assert.equal(cached?.value?.currentPubkey, "pubkey-current");
  assert.deepEqual(cached?.value?.knownPubkeys, ["pubkey-old", "pubkey-current"]);

  client.destroy();
});
