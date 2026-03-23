import test from "node:test";
import assert from "node:assert/strict";

import { createEditorPageController } from "../scripts/template/features/editor-page.js";

test("template editor page controller routes session and page lifecycle through callbacks", async () => {
  const windowListeners = new Map();
  const calls = [];
  const documentStub = {
    querySelector(selector) {
      return selector === "[data-editor-page]" ? {} : null;
    }
  };
  const windowStub = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    }
  };

  const controller = createEditorPageController({
    deps: {
      document: documentStub,
      window: windowStub,
      sessionChangedEvent: "nostrsite:session-changed"
    },
    callbacks: {
      beforeSessionRefresh: async () => {
        calls.push("before-session");
      },
      beforePageHide: async () => {
        calls.push("before-pagehide");
      },
      initPage: async (force = false) => {
        calls.push(`init:${force ? "force" : "normal"}`);
      }
    }
  });

  assert.equal(controller.start(), true);
  await Promise.resolve();
  assert.deepEqual(calls, ["init:normal"]);

  await windowListeners.get("nostrsite:session-changed")();
  await windowListeners.get("pagehide")();
  assert.deepEqual(calls, [
    "init:normal",
    "before-session",
    "init:force",
    "before-pagehide"
  ]);
});
