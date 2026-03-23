import { createAvatarCacheRefresher } from "../../core/avatar-cache.js";
import { scheduleNonCriticalTask } from "../../core/non-critical-tasks.js";
import {
  initTemplateSiteLinkPrefetch,
  refreshTemplateSiteNavigation,
  startTemplateSiteBackgroundPrefetch
} from "../../core/site-runtime-browser.js";
import { createSiteActivityClient } from "../../core/runtime-activity.js";
import { getStoredSession, resolveStoredSession } from "../../core/session.js";

export function createSiteRuntime({
  site,
  state,
  publicStateStore,
  viewerController,
  notificationState,
  postsStore,
  ensureEventToolsLoaded,
  ensureBlobAvailable,
  resolveSignerSecretKey = async () => ""
} = {}) {
  let features = {};
  let started = false;

  const siteActivity = createSiteActivityClient({
    site,
    resolveSecretKey: resolveSignerSecretKey
  });

  const avatarCache = createAvatarCacheRefresher({
    resolveSecretKey: resolveSignerSecretKey,
    ensureBlobAvailable
  });

  publicStateStore.subscribe((snapshot) => {
    state.publicState = snapshot.value;
    if (started && snapshot.reason === "source" && snapshot.valueChanged) {
      refreshTemplateSiteNavigation({
        features,
        state,
        hydrateNotifications
      });
    }
  });

  function connectFeatures(nextFeatures) {
    features = { ...features, ...nextFeatures };
  }

  function start() {
    started = true;
    void bootstrap();
    initTemplateSiteLinkPrefetch({ document, window });
    startTemplateSiteBackgroundPrefetch({
      scheduleNonCriticalTask,
      postsStore
    });
    window.addEventListener("nostrsite:session-changed", handleSessionChanged);
  }

  async function bootstrap() {
    try {
      state.session = await resolveStoredSession({
        persistSession: true
      }).catch(() => getStoredSession());
      state.publicState = (await publicStateStore.hydrate({ force: false, reason: "bootstrap" })).value;
      if (state.session) {
        state.viewer = viewerController.primeFromSession(true);
      }
    } catch {
      state.publicState = state.publicState || publicStateStore.value;
    }
    scheduleNonCriticalTask(() => siteActivity.publishVisitPulse(), { initialDelayMs: 1400 });
    void hydrateNotifications();
    features.siteShellFeature?.renderNavigation?.();
  }

  async function getPublicState(force = false) {
    if (!force && state.publicState) return state.publicState;
    try {
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

  return {
    connectFeatures,
    getPublicState,
    hydrateNotifications,
    refreshAvatarFromCache: avatarCache.refreshAvatarFromCache,
    start
  };
}
