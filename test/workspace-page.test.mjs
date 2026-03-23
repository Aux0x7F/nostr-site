import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspacePageController } from "../scripts/template/features/workspace-page.js";

test("template workspace page controller routes tab clicks and refresh lifecycle through callbacks", async () => {
  class FakeElement {}
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLFormElement = class HTMLFormElement extends FakeElement {};

  const shellListeners = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const shell = {
    addEventListener(type, handler) {
      shellListeners.set(type, handler);
    }
  };
  const state = {};
  const calls = [];
  const documentStub = {
    visibilityState: "visible",
    querySelector(selector) {
      if (selector === "[data-workspace-page]") return {};
      if (selector === "[data-workspace-shell]") return shell;
      return null;
    },
    addEventListener(type, handler) {
      documentListeners.set(type, handler);
    }
  };
  const windowStub = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    }
  };

  const controller = createWorkspacePageController({
    state,
    deps: {
      document: documentStub,
      window: windowStub,
      getStoredSession: () => ({ username: "aux" })
    },
    callbacks: {
      refreshWorkspace: async () => {
        calls.push("refresh");
      },
      renderWorkspace: () => {
        calls.push("render");
      },
      setActiveTab: (tab) => {
        calls.push(`tab:${tab}`);
      },
      syncWorkspace: async (force) => {
        calls.push(`sync:${force ? "force" : "normal"}`);
      }
    }
  });

  assert.equal(controller.start(), true);
  await Promise.resolve();
  assert.deepEqual(calls, ["refresh"]);

  class TabTarget extends FakeElement {
    closest(selector) {
      if (selector === "[data-workspace-tab]") {
        return {
          getAttribute(name) {
            return name === "data-workspace-tab" ? "dashboard" : "";
          }
        };
      }
      return null;
    }
  }

  await shellListeners.get("click")({ target: new TabTarget() });
  assert.deepEqual(calls.slice(-2), ["tab:dashboard", "render"]);

  documentListeners.get("visibilitychange")();
  windowListeners.get("focus")();
  assert.deepEqual(calls.slice(-2), ["sync:force", "sync:force"]);
});
