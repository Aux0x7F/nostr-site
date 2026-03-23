import test from "node:test";
import assert from "node:assert/strict";

import { createSiteRuntime } from "../scripts/template/features/site-runtime.js";

function installDom() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = [];
  const fetches = [];
  globalThis.document = {
    body: { dataset: { page: "site" } },
    querySelector: () => null,
    addEventListener: (type, handler) => documentListeners.set(type, handler)
  };
  globalThis.window = {
    addEventListener: (type, handler) => windowListeners.set(type, handler),
    requestIdleCallback: null,
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    location: {
      href: "https://example.com/index.html",
      pathname: "/index.html",
      search: "",
      hash: ""
    }
  };
  globalThis.fetch = async (url) => {
    fetches.push(String(url));
    return { ok: true };
  };
  return { documentListeners, windowListeners, timers, fetches };
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

test("template site runtime public-state boot no longer loads event tools on the critical path", async () => {
  const { timers } = installDom();
  let ensureCalls = 0;
  const runtime = createSiteRuntime({
    site: { nostr: { storageNamespace: "template", kinds: {}, appTag: "nostr-site" } },
    state: {
      session: null,
      guestSession: null,
      viewer: null,
      publicState: null
    },
    publicStateStore: {
      value: null,
      subscribe(handler) {
        this.listener = handler;
      },
      hydrate: async () => ({
        value: { admins: [], users: [], approvedEntities: [], commentsByPost: new Map(), commentIndex: new Map(), commentThreadsByPost: new Map() }
      })
    },
    viewerController: {
      primeFromSession: () => ({ pubkey: "" }),
      canEdit: () => false
    },
    notificationState: {
      reset() {},
      hydrate: async () => {}
    },
    postsStore: {
      hydrateCache: async () => [],
      refresh: async () => []
    },
    ensureEventToolsLoaded: async () => {
      ensureCalls += 1;
    },
    publishTaggedJson: async () => {},
    ensureBlobAvailable: async () => {}
  });

  runtime.start();
  await runtime.getPublicState(true);

  assert.equal(ensureCalls, 0);
  assert.ok(timers.length > 0);
});

test("template site runtime background warming avoids route and content fetch bursts", async () => {
  const { timers, fetches } = installDom();
  let refreshCount = 0;
  let hydrateCacheCount = 0;
  let hydrateCount = 0;

  const runtime = createSiteRuntime({
    site: { nostr: { storageNamespace: "template", kinds: {}, appTag: "nostr-site" } },
    state: {
      session: null,
      guestSession: null,
      viewer: null,
      publicState: null
    },
    publicStateStore: {
      value: null,
      subscribe(handler) {
        this.listener = handler;
      },
      hydrate: async () => {
        hydrateCount += 1;
        return {
          value: { admins: [], users: [], approvedEntities: [], commentsByPost: new Map(), commentIndex: new Map(), commentThreadsByPost: new Map() }
        };
      }
    },
    viewerController: {
      primeFromSession: () => ({ pubkey: "" }),
      canEdit: () => false
    },
    notificationState: {
      reset() {},
      hydrate: async () => {}
    },
    postsStore: {
      hydrateCache: async () => {
        hydrateCacheCount += 1;
        return [];
      },
      refresh: async () => {
        refreshCount += 1;
        return [];
      }
    },
    ensureEventToolsLoaded: async () => {},
    publishTaggedJson: async () => {},
    ensureBlobAvailable: async () => {}
  });

  runtime.start();
  await Promise.resolve();
  for (let index = 0; index < 10 && index < timers.length; index += 1) {
    await timers[index]();
  }

  assert.equal(hydrateCacheCount, 1);
  assert.equal(refreshCount, 0);
  assert.ok(hydrateCount <= 1, "background warming should not run an extra public-state hydrate");
  assert.deepEqual(fetches, [], "background warming should not fetch route HTML or content packs during boot");
});
