import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRuntimeDatabase } from "../portable/runtime-db.js";
import { createRuntimeHost } from "../portable/runtime-host.js";

test("runtime host seeds session and exposes session and viewer projections", async () => {
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase()
  });
  await host.seedSession({
    username: "aux",
    secretKeyHex: "deadbeef",
    pubkey: "abc123"
  });
  assert.deepEqual(await host.getSession(), {
    username: "aux",
    secretKeyHex: "deadbeef",
    pubkey: "abc123"
  });
  const viewerProjection = await host.getProjection("viewer");
  assert.equal(viewerProjection.status, "ready");
  assert.deepEqual(viewerProjection.value, {
    username: "aux",
    pubkey: "abc123"
  });
});

test("runtime host caches refreshed projections and notifies subscribers", async () => {
  let loads = 0;
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase(),
    projectionLoaders: {
      graph: async () => {
        loads += 1;
        return { nodes: [{ id: "animal-agriculture" }], relationships: [] };
      }
    }
  });
  let latest = null;
  const unsubscribe = await host.subscribeProjection("graph", {}, (event) => {
    latest = event.envelope;
  });
  const projection = await host.getProjection("graph", {}, { preferFresh: true });
  unsubscribe();
  assert.equal(loads >= 1, true);
  assert.equal(projection.status, "ready");
  assert.deepEqual(projection.value, { nodes: [{ id: "animal-agriculture" }], relationships: [] });
  assert.deepEqual(latest?.value, { nodes: [{ id: "animal-agriculture" }], relationships: [] });
});

test("runtime host scopes viewer-dependent projections by session", async () => {
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase(),
    projectionLoaders: {
      graph: async ({ session }) => ({
        viewer: session?.pubkey || "anonymous"
      })
    }
  });

  const anonymousGraph = await host.getProjection("graph", {}, { preferFresh: true });
  assert.deepEqual(anonymousGraph.value, { viewer: "anonymous" });

  await host.seedSession({
    username: "aux",
    secretKeyHex: "deadbeef",
    pubkey: "abc123"
  }, { force: true });

  const signedInGraph = await host.getProjection("graph", {}, { preferFresh: false });
  assert.deepEqual(signedInGraph.value, { viewer: "abc123" });
});

test("runtime host stores structured documents and derived document projections", async () => {
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase()
  });
  const opened = await host.openDocument({
    docId: "doc:guide",
    kind: "guide"
  });
  assert.equal(opened.value.document.id, "doc:guide");
  const updated = await host.applyDocument({
    docId: "doc:guide",
    patch: {
      type: "upsert-block",
      block: { id: "p1", type: "paragraph", text: "Hello world" }
    }
  });
  assert.match(updated.value.searchText, /Hello world/);
  assert.match(updated.value.html, /Hello world/);
});

test("runtime host preserves last good value when refresh fails", async () => {
  let loads = 0;
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase(),
    projectionLoaders: {
      graph: async () => {
        loads += 1;
        if (loads === 1) {
          return { nodes: [{ id: "ok" }], relationships: [] };
        }
        throw new Error("relay unavailable");
      }
    }
  });

  const first = await host.getProjection("graph", {}, { preferFresh: true });
  const second = await host.refreshProjection("graph", {}, { reason: "retry" });

  assert.equal(first.status, "ready");
  assert.deepEqual(first.value, { nodes: [{ id: "ok" }], relationships: [] });
  assert.equal(second.status, "error");
  assert.deepEqual(second.value, { nodes: [{ id: "ok" }], relationships: [] });
});

test("runtime host projections can carry markdown blocks for downstream renderers", async () => {
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase()
  });

  const updated = await host.applyDocument({
    docId: "doc:investigation",
    document: {
      id: "doc:investigation",
      kind: "investigation",
      blocks: [
        {
          id: "md-1",
          type: "markdown",
          text: "## Title\n\nBody copy"
        }
      ]
    }
  });

  assert.match(updated.value.html, /data-doc-markdown="true"/);
  assert.match(updated.value.searchText, /Body copy/);
});
