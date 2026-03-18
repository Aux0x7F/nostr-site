import test from "node:test";
import assert from "node:assert/strict";

import { buildCommentThreadState } from "../portable/comment-state.js";
import {
  deserializePublicStateSnapshot,
  parsePublicCommentEvent,
  serializePublicStateSnapshot
} from "../portable/nostr-cms-core.js";

test("parsePublicCommentEvent uses the signed event id instead of the d tag", () => {
  const event = {
    id: "event-123",
    pubkey: "f".repeat(64),
    created_at: 123,
    tags: [
      ["d", "comment-alias"],
      ["a", "Post Slug"],
      ["parent", "parent-1"],
      ["root", "root-1"]
    ],
    content: JSON.stringify({
      post_slug: "Post Slug",
      markdown: "Hello"
    })
  };

  const parsed = parsePublicCommentEvent(event);
  assert.ok(parsed);
  assert.equal(parsed.id, "event-123");
  assert.equal(parsed.id_event, "event-123");
  assert.equal(parsed.post_slug, "post-slug");
  assert.equal(parsed.parent_id, "parent-1");
  assert.equal(parsed.root_id, "root-1");
});

test("buildCommentThreadState keeps replies nested and does not promote orphans", () => {
  const threadState = buildCommentThreadState([
    { id: "c-low", post_slug: "post", author: "a", markdown: "Low", parent_id: "", root_id: "", created_at: 1, score: 1 },
    { id: "c-high", post_slug: "post", author: "b", markdown: "High", parent_id: "", root_id: "", created_at: 2, score: 9 },
    { id: "r-2", post_slug: "post", author: "c", markdown: "Second reply", parent_id: "c-low", root_id: "c-low", created_at: 4 },
    { id: "r-1", post_slug: "post", author: "d", markdown: "First reply", parent_id: "c-low", root_id: "c-low", created_at: 3 },
    { id: "orphan", post_slug: "post", author: "e", markdown: "Orphan", parent_id: "missing", root_id: "missing", created_at: 5 }
  ]);

  const roots = threadState.threadsByPost.get("post") || [];
  const orphans = threadState.orphansByPost.get("post") || [];

  assert.deepEqual(roots.map((comment) => comment.id), ["c-high", "c-low"]);
  assert.deepEqual((roots[1]?.replies || []).map((comment) => comment.id), ["r-1", "r-2"]);
  assert.deepEqual(orphans.map((comment) => comment.id), ["orphan"]);
});

test("public state snapshot round-trip preserves cached comment thread maps", () => {
  const state = {
    admins: ["a".repeat(64)],
    users: [],
    commentsByPost: new Map([["post", [{ id: "c1" }]]]),
    commentThreadsByPost: new Map([[
      "post",
      [{
        id: "c1",
        replies: [{ id: "r1", replies: [] }]
      }]
    ]]),
    commentIndex: new Map([
      ["c1", { id: "c1" }],
      ["r1", { id: "r1", parent_id: "c1" }]
    ]),
    commentVotes: new Map([
      ["c1", { score: 3, byPubkey: new Map([["p1", 1]]) }]
    ]),
    rawEvents: [{ id: "raw-1" }]
  };

  const restored = deserializePublicStateSnapshot(serializePublicStateSnapshot(state));
  assert.ok(restored.commentThreadsByPost instanceof Map);
  assert.deepEqual((restored.commentThreadsByPost.get("post") || []).map((comment) => comment.id), ["c1"]);
  assert.deepEqual((((restored.commentThreadsByPost.get("post") || [])[0] || {}).replies || []).map((comment) => comment.id), ["r1"]);
  assert.equal(restored.rawEvents, undefined);
  assert.equal(restored.commentVotes.get("c1").score, 3);
  assert.equal(restored.commentVotes.get("c1").byPubkey.get("p1"), 1);
});
