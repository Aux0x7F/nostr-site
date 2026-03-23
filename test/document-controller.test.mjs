import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryRuntimeDatabase } from "../portable/runtime-db.js";
import { createRuntimeHost } from "../portable/runtime-host.js";
import { createSharedRuntimeClient } from "../portable/runtime-client.js";
import { createDocumentController } from "../portable/document-controller.js";

test("document controller opens, subscribes, and applies structured document patches", async () => {
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase()
  });
  const client = createSharedRuntimeClient({
    hostFactory: () => host
  });
  const controller = createDocumentController({
    runtimeClient: client,
    docId: "investigation:test",
    kind: "investigation"
  });

  const seen = [];
  const unsubscribe = controller.subscribe((envelope) => {
    seen.push(envelope?.value?.document?.blocks?.length || 0);
  });

  const opened = await controller.open();
  assert.equal(opened.value.document.id, "investigation:test");

  const patched = await controller.applyPatch({
    type: "upsert-block",
    block: {
      id: "md-1",
      type: "markdown",
      text: "## Hello world"
    }
  });

  assert.equal(patched.value.document.blocks.length, 1);
  assert.match(patched.value.searchText, /Hello world/);
  assert.equal(seen.includes(1), true);

  unsubscribe();
  await controller.destroy();
});
