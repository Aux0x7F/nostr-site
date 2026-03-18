import test from "node:test";
import assert from "node:assert/strict";

import { createSiteRuntime } from "../scripts/template/features/site-runtime.js";

function installDom() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  globalThis.document = {
    body: { dataset: { page: "site" } },
    querySelector: () => null,
    addEventListener: (type, handler) => documentListeners.set(type, handler)
  };
  globalThis.window = {
    addEventListener: (type, handler) => windowListeners.set(type, handler),
    requestIdleCallback: null,
    setTimeout: () => 1,
    location: {
      href: "https://example.com/index.html",
      pathname: "/index.html",
      search: "",
      hash: ""
    }
  };
  globalThis.fetch = async () => ({ ok: true });
}

test("template site runtime hydrates shared public state and routes notifications through the shared store", async () => {
  installDom();
  const state = {
    session: { secretKeyHex: "sekret" },
    guestSession: null,
    viewer: null,
    publicState: null
  };
  const publicStateStore = {
    value: null,
    subscribe(handler) {
      this.listener = handler;
    },
    hydrate: async () => ({
      value: { admins: ["pub"], users: [], approvedEntities: [], commentsByPost: new Map(), commentIndex: new Map(), commentThreadsByPost: new Map() }
    })
  };
  let navigationRenders = 0;
  let notificationHydrates = 0;
  const runtime = createSiteRuntime({
    site: { nostr: { storageNamespace: "template", kinds: {}, appTag: "template" } },
    state,
    publicStateStore,
    viewerController: {
      primeFromSession: () => ({ pubkey: "pub" }),
      canEdit: () => true
    },
    notificationState: {
      reset() {},
      hydrate: async () => {
        notificationHydrates += 1;
      }
    },
    postsStore: { refresh: async () => [] },
    ensureEventToolsLoaded: async () => {},
    publishTaggedJson: async () => {},
    ensureBlobAvailable: async () => {}
  });
  runtime.connectFeatures({
    siteShellFeature: {
      renderNavigation: () => {
        navigationRenders += 1;
      }
    }
  });

  const publicState = await runtime.getPublicState(true);
  assert.deepEqual(publicState.admins, ["pub"]);
  assert.equal(navigationRenders, 1);
  assert.equal(notificationHydrates, 1);
});
