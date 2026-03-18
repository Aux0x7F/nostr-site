import { createRequestSigner } from "../../core/request-signer.js";
import { getStoredSession, getOrCreateGuestSession } from "../../core/session.js";

export function createSiteRuntime({
  site,
  state,
  publicStateStore,
  viewerController,
  notificationState,
  postsStore,
  ensureEventToolsLoaded,
  publishTaggedJson,
  ensureBlobAvailable
} = {}) {
  let features = {};

  const requestSigner = createRequestSigner({
    state,
    site,
    ensureEventToolsLoaded,
    getOrCreateGuestSession,
    ensureBlobAvailable,
    publishTaggedJson
  });

  publicStateStore.subscribe((snapshot) => {
    state.publicState = snapshot.value;
  });

  function connectFeatures(nextFeatures) {
    features = { ...features, ...nextFeatures };
  }

  function start() {
    void bootstrap();
    initLinkPrefetch();
    startBackgroundPrefetch();
    window.addEventListener("nostrsite:session-changed", handleSessionChanged);
  }

  async function bootstrap() {
    try {
      await ensureEventToolsLoaded();
      if (!state.guestSession) {
        state.guestSession = await getOrCreateGuestSession().catch(() => null);
      }
      state.publicState = (await publicStateStore.hydrate({ force: false, reason: "bootstrap" })).value;
      if (state.session) {
        state.viewer = viewerController.primeFromSession(true);
      }
    } catch {
      state.publicState = state.publicState || publicStateStore.value;
    }
    void requestSigner.publishVisitPulse();
    void hydrateNotifications();
    features.siteShellFeature?.renderNavigation?.();
  }

  async function getPublicState(force = false) {
    if (!force && state.publicState) return state.publicState;
    try {
      await ensureEventToolsLoaded();
      if (!state.guestSession) {
        state.guestSession = await getOrCreateGuestSession().catch(() => null);
      }
      state.publicState = (await publicStateStore.hydrate({
        force: Boolean(force),
        reason: force ? "forced-get-public-state" : "get-public-state"
      })).value;
      if (state.session && !state.viewer) {
        state.viewer = viewerController.primeFromSession(false);
      }
      if (state.session) {
        void hydrateNotifications(force);
      }
      features.siteShellFeature?.renderNavigation?.();
      return state.publicState;
    } catch {
      state.publicState = {
        connected: false,
        approvedEntities: [],
        commentsByPost: new Map(),
        commentIndex: new Map(),
        commentThreadsByPost: new Map(),
        admins: []
      };
      return state.publicState;
    }
  }

  async function hydrateNotifications(force = false) {
    const publicState = await getPublicState();
    if (!viewerController.canEdit(publicState) && !state.viewer && state.session?.secretKeyHex) {
      state.viewer = viewerController.primeFromSession(true);
    }
    await notificationState.hydrate({ publicState, force });
  }

  function handleSessionChanged() {
    state.session = getStoredSession();
    state.viewer = null;
    notificationState.reset();
    features.siteShellFeature?.closeProfileMenus?.();
    viewerController.primeFromSession(true);
    features.siteShellFeature?.renderNavigation?.();
    if (state.session) {
      void hydrateNotifications(true);
    }
  }

  function startBackgroundPrefetch() {
    const task = () => {
      const routes = [
        "./index.html",
        "./blog.html",
        "./map.html",
        "./about.html",
        "./guide.html",
        "./submit.html",
        "./get-involved.html",
        "./merch.html",
        "./post.html",
        "./editor.html",
        "./admin.html?tab=login"
      ];
      for (const route of routes) {
        fetch(route, { cache: "force-cache" }).catch(() => null);
      }
      fetch("./content/blog/index.json", { cache: "force-cache" }).catch(() => null);
      fetch("./vendor/leaflet.js", { cache: "force-cache" }).catch(() => null);
      fetch("./vendor/leaflet.css", { cache: "force-cache" }).catch(() => null);
      void postsStore.refresh().catch(() => []);
      void publicStateStore.hydrate({ force: false, reason: "prefetch", requestRepair: false }).catch(() => null);
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(task, { timeout: 1800 });
      return;
    }
    window.setTimeout(task, 900);
  }

  function initLinkPrefetch() {
    const prefetched = new Set();
    const maybePrefetch = (value) => {
      try {
        const url = new URL(value, window.location.href);
        if (url.origin !== window.location.origin || prefetched.has(url.href)) return;
        prefetched.add(url.href);
        fetch(url.href, { cache: "force-cache" }).catch(() => null);
      } catch {
        return;
      }
    };
    const primeTarget = (target) => {
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      maybePrefetch(link.href);
    };
    document.addEventListener("pointerover", (event) => primeTarget(event.target), { passive: true });
    document.addEventListener("focusin", (event) => primeTarget(event.target));
  }

  return {
    connectFeatures,
    getPublicState,
    getRequestSignerSecretKey: requestSigner.getSecretKey,
    hydrateNotifications,
    refreshAvatarFromCache: requestSigner.refreshAvatarFromCache,
    start
  };
}
