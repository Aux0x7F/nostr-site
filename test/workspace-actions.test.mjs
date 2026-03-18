import test from "node:test";
import assert from "node:assert/strict";

import {
  renderLookupCandidate,
  renderModerationComment,
  renderSubmissionCard,
  renderUserCard
} from "../scripts/template/surfaces/workspace-actions.js";

function deps() {
  return {
    currentUserIsAdmin: () => true,
    shortKey: (value) => String(value || "").slice(0, 8),
    escapeHtml: (value) => String(value || ""),
    escapeAttribute: (value) => String(value || ""),
    resolveEntityDisplayValue: (value) => value,
    trimmed: (value) => String(value || ""),
    renderLoadingState: (message) => `<div>${message}</div>`
  };
}

test("renderUserCard keeps template roster actions inside the action surface", () => {
  const markup = renderUserCard(
    {
      pubkey: "user-1",
      username: "author",
      displayName: "Author",
      submissionCount: 2,
      commentCount: 3,
      isAdmin: false
    },
    { publicState: { rootAdminPubkey: "root" }, viewer: { pubkey: "viewer" }, siteKeyShare: null },
    deps()
  );

  assert.match(markup, /Make admin/);
  assert.match(markup, /Temp ban/);
});

test("renderLookupCandidate stays isolated to the lookup result surface", () => {
  const markup = renderLookupCandidate(
    {
      userLookupResult: {
        pubkey: "user-1",
        username: "author",
        displayName: "Author",
        isAdmin: false
      }
    },
    deps()
  );

  assert.match(markup, /member/);
  assert.match(markup, /author/);
});

test("renderSubmissionCard keeps submission actions in the action surface", () => {
  const markup = renderSubmissionCard(
    {
      id: "submission-1",
      author: "user-1",
      latest: {
        payload: {
          subject: "Lead",
          location: "Phoenix",
          details: "Details",
          entity_refs: ["county-line"]
        }
      }
    },
    { publicState: { submissionStatuses: new Map([["submission-1", { status: "received" }]]) } },
    deps()
  );

  assert.match(markup, /Approve/);
  assert.match(markup, /Reject/);
  assert.match(markup, /Chat/);
});

test("renderModerationComment keeps moderation controls in the action surface", () => {
  const markup = renderModerationComment(
    {
      id: "comment-1",
      author: "user-1",
      post_slug: "post",
      markdown: "Comment",
      created_at: 1,
      visibility: "visible"
    },
    { publicState: { users: [] } },
    deps()
  );

  assert.match(markup, /Moderation note/);
  assert.match(markup, /Hide/);
});
