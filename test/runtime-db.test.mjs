import test from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryRuntimeDatabase,
  projectionCacheKey,
  stableSerializeKey
} from "../portable/runtime-db.js";

test("stableSerializeKey sorts object keys deterministically", () => {
  assert.equal(
    stableSerializeKey({ b: 2, a: 1, nested: { d: 4, c: 3 } }),
    stableSerializeKey({ nested: { c: 3, d: 4 }, a: 1, b: 2 })
  );
});

test("projectionCacheKey includes stable params", () => {
  assert.equal(
    projectionCacheKey("graph", { b: 2, a: 1 }),
    projectionCacheKey("graph", { a: 1, b: 2 })
  );
});

test("memory runtime database stores meta projections and documents", async () => {
  const database = createMemoryRuntimeDatabase();
  await database.setMeta("session/current", { username: "aux" });
  await database.setProjection("graph", { focus: "animal-agriculture" }, { value: { nodes: [] } });
  await database.setDocument("doc:guide", { value: { id: "doc:guide" } });

  assert.deepEqual(await database.getMeta("session/current"), { username: "aux" });
  assert.deepEqual(await database.getProjection("graph", { focus: "animal-agriculture" }), { value: { nodes: [] } });
  assert.deepEqual(await database.getDocument("doc:guide"), { value: { id: "doc:guide" } });
});
