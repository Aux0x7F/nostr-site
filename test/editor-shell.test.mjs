import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorModalView, renderEditorShellView } from "../scripts/template/surfaces/editor-shell.js";

test("renderEditorShellView returns the template editor shell for admins", () => {
  const view = renderEditorShellView({
    editorState: {
      session: { username: "editor" },
      currentSlug: "",
      document: {
        title: "Draft title",
        summary: "Draft summary",
        date: "2026-03-17",
        tags: ["updates"],
        primaryEntity: "Target",
        entityRefs: ["Campaign"]
      }
    },
    deps: {
      currentUserIsAdmin: () => true,
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.equal(view.title, "Create post");
  assert.match(view.shellMarkup, /data-editor-form/);
  assert.match(view.shellMarkup, /Save draft now/);
  assert.match(view.shellMarkup, /Target/);
});

test("renderEditorModalView returns entity modal markup when entity modal is active", () => {
  const markup = renderEditorModalView({
    editorState: {
      entityModal: {
        seedName: "County Line",
        seedLocation: "Phoenix",
        seedType: "processor",
        seedNotes: "Notes"
      }
    },
    deps: {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.match(markup, /Create an entity without leaving the draft/);
  assert.match(markup, /County Line/);
  assert.match(markup, /data-editor-location-results/);
});
