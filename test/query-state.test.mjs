import test from "node:test";
import assert from "node:assert/strict";

import {
  createQueryState,
  normalizeQuerySlug
} from "../scripts/core/query-state.js";

test("query state updates watched params and responds to popstate", () => {
  let href = "https://example.test/map.html?entity=county-line";
  const listeners = new Set();
  const notifications = [];
  const queryState = createQueryState({
    getHref: () => href,
    getSearch: () => new URL(href).search,
    replaceUrl: (url) => {
      href = String(url);
    },
    addPopstateListener: (listener) => listeners.add(listener),
    removePopstateListener: (listener) => listeners.delete(listener)
  });

  queryState.subscribe(["entity"], (selection) => {
    notifications.push(selection.entity);
  }, {
    normalizers: {
      entity: normalizeQuerySlug
    }
  });

  assert.deepEqual(notifications, ["county-line"]);
  assert.equal(queryState.set("entity", "North Valley Foods", { normalize: normalizeQuerySlug }), true);
  assert.deepEqual(notifications, ["county-line", "north-valley-foods"]);

  const popListener = [...listeners][0];
  href = "https://example.test/map.html?entity=phoenix-cold-storage";
  popListener();
  assert.deepEqual(notifications, ["county-line", "north-valley-foods", "phoenix-cold-storage"]);
});
