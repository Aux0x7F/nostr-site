import test from "node:test";
import assert from "node:assert/strict";

import {
  renderEntityPickerResultsMarkup,
  renderLocationResultsMarkup
} from "../scripts/template/surfaces/workspace-filters.js";

test("template workspace filter helpers keep picker markup in a shared surface module", () => {
  const entityMarkup = renderEntityPickerResultsMarkup(
    "entityRefs",
    "yard",
    [{ slug: "county-yard", name: "County Yard", location: "Phoenix, Arizona" }],
    {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  );
  assert.match(entityMarkup, /data-entity-pick="county-yard"/);

  const locationMarkup = renderLocationResultsMarkup(
    "phoenix",
    ["Phoenix, Arizona"],
    {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  );
  assert.match(locationMarkup, /data-location-pick="Phoenix, Arizona"/);
});
