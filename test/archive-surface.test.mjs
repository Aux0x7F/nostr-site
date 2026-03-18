import test from "node:test";
import assert from "node:assert/strict";

import { buildBlogArchiveEntries } from "../scripts/template/surfaces/archive.js";

test("buildBlogArchiveEntries keeps published posts and drafts in one ordered archive view", () => {
  const posts = [
    { slug: "published", title: "Published", date: "2026-03-01", location: "Phoenix", summary: "Published summary" }
  ];
  const drafts = [
    { slug: "draft-post", title: "Draft Post", status: "draft", created_at: 2000000000, location: "Mesa", summary: "Draft summary", markdown: "Body" },
    { slug: "published", title: "Published", status: "approved", created_at: 11, markdown: "Approved duplicate" }
  ];

  const entries = buildBlogArchiveEntries(posts, drafts, {
    normalizeDraftStatus: (value) => String(value || "").trim().toLowerCase(),
    draftReviewAction: () => "",
    draftStatusLabel: (status) => status === "draft" ? "Draft" : "Approved",
    sortDateValue: (item) => Number(item.created_at || Date.parse(`${item.date}T00:00:00`) / 1000 || 0)
  });

  assert.deepEqual(entries.map((entry) => entry.slug), ["draft-post", "published"]);
  assert.equal(entries[0].actionLabel, "Continue writing");
  assert.equal(entries[1].actionLabel, "Open post");
});
