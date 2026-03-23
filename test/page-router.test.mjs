import test from "node:test";
import assert from "node:assert/strict";

import { createPageRouter } from "../scripts/core/page-router.js";

test("page router mounts matching routes and always-handlers in scheduled order", () => {
  const calls = [];
  const router = createPageRouter({
    page: "map",
    schedule: (callback) => callback()
  });

  router
    .when("home", () => calls.push("home"))
    .when(["map", "post"], () => calls.push("map"))
    .always(() => calls.push("always"))
    .mount();

  assert.deepEqual(calls, ["map", "always"]);
});
