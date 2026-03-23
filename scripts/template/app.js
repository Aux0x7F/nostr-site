import SITE from "../core/site-config.js";
import {
  collectEntityRefsFromText,
  enrichEntityReferences,
  parseContentDocument,
  slugify
} from "../core/content-utils.js";
import { setText } from "../core/dom.js";
import { formatDate, sortDateValue } from "../core/formatting.js";
import { createFeatureManifest } from "../core/feature-manifest.js";
import { fetchJson, fetchText } from "../core/http.js";
import {
  cleanSlug,
  deriveIdentity,
  ensureBlobAvailable,
  ensureEventToolsLoaded,
  hasNostrTools,
  publishTaggedJson
} from "../core/nostr.js";
import { createPublicStateProjectionStore } from "../core/public-state-projection.js";
import { createContentPostStore } from "../core/posts-store.js";
import { createSiteSignerClient } from "../core/site-signer.js";
import {
  buildToc,
  renderError,
  renderLoadingState,
  renderMiniMarkdown,
  renderRecordList,
  renderTagList
} from "../core/rendering.js";
import { createViewerController } from "../core/viewer-controller.js";
import { createNavigationUiState } from "../core/navigation-state.js";
import { createNotificationState } from "../core/notification-state.js";
import { createPageRouter } from "../core/page-router.js";
import {
  draftReviewAction,
  draftStatusLabel,
  normalizeDraftStatus
} from "../core/draft-review.js";
import { getOrCreateGuestSession, getStoredGuestSession, getStoredSession, saveSession } from "../core/session.js";
import { createQueryState } from "../core/query-state.js";
import NAV_KEYS from "./core/nav-keys.js";
import { createSiteRuntime } from "./features/site-runtime.js";
import { createSiteShellFeature } from "./features/site-shell.js";

const navigationUi = createNavigationUiState();
const queryState = createQueryState();
let appRuntime = null;
let siteShellFeature = null;
let signerClient = null;

const publicStateStore = createPublicStateProjectionStore({
  getSessionSecretKey: async () => (signerClient ? signerClient.resolveSecretKey() : ""),
  page: () => document.body.dataset.page || "site",
  refreshDelayMs: () => 0,
  shouldRefresh: () => false
});

const postsStore = createContentPostStore({
  indexPath: "./content/blog/index.json",
  contentDir: "./content/blog",
  cacheKey: `${SITE.nostr.storageNamespace}.blog-cache`,
  initialPosts: [],
  fetchJson,
  fetchText,
  parseContentDocument,
  slugify
});

const state = {
  session: getStoredSession(),
  guestSession: getStoredGuestSession(),
  viewer: null,
  publicState: publicStateStore.value,
  commentReply: null,
  navigationUi,
  map: null,
  markers: null,
  mapCanvas: null,
  markerIndex: null,
  pendingMapEntitySlug: ""
};

signerClient = createSiteSignerClient({
  state,
  ensureEventToolsLoaded,
  getOrCreateGuestSession
});

const viewerController = createViewerController({
  state,
  site: SITE,
  deriveIdentity,
  hasNostrTools,
  persistSession: saveSession
});

const notificationState = createNotificationState({
  storageNamespace: SITE.nostr.storageNamespace,
  onChange: () => siteShellFeature?.renderNavigation?.(),
  getSession: () => state.session,
  getViewerPubkey: () =>
    state.viewer?.pubkey ||
    viewerController.resolvedSessionPubkey?.({ deriveWhenAvailable: true }) ||
    ""
});

appRuntime = createSiteRuntime({
  site: SITE,
  state,
  publicStateStore,
  viewerController,
  notificationState,
  postsStore,
  ensureEventToolsLoaded,
  publishTaggedJson,
  ensureBlobAvailable,
  resolveSignerSecretKey: () => signerClient.resolveSecretKey()
});

siteShellFeature = createSiteShellFeature({
  site: SITE,
  state,
  navKeys: NAV_KEYS,
  notificationState,
  viewerController,
  refreshAvatarFromCache: (target) => appRuntime.refreshAvatarFromCache(target)
});

const featureManifest = createFeatureManifest({
  contentPages: async () => {
    const { createContentPagesFeature } = await import("./features/content-pages.js");
    const contentPagesFeature = createContentPagesFeature({
      site: SITE,
      state,
      viewerController,
      postsStore,
      getPublicState: (force) => appRuntime.getPublicState(force),
      publishTaggedJson,
      renderLoadingState,
      renderError,
      renderTagList,
      renderMiniMarkdown,
      buildToc,
      fetchText,
      slugify,
      enrichEntityReferences,
      parseContentDocument,
      draftHelpers: {
        list: (drafts) => (Array.isArray(drafts) ? drafts : []),
        draftReviewAction,
        draftStatusLabel,
        normalizeDraftStatus,
        sortDateValue
      }
    });
    appRuntime.connectFeatures({ contentPagesFeature });
    return { contentPagesFeature };
  },
  mapPage: async () => {
    const [
      { createMapPageFeature },
      {
        bindMapEntityCards,
        renderLeafletMapSurface,
        renderMapPageSurface,
        scheduleMapEntityFocus
      }
    ] = await Promise.all([
      import("./features/map-page.js"),
      import("./surfaces/map.js")
    ]);
    const mapPageFeature = createMapPageFeature({
      state,
      postsStore,
      getPublicState: (force) => appRuntime.getPublicState(force),
      queryState,
      collectEntityRefsFromText,
      renderMapPageSurface,
      renderLeafletMapSurface,
      bindMapEntityCards,
      scheduleLeafletFocus: scheduleMapEntityFocus,
      cleanSlug,
      renderError,
      renderLoadingState
    });
    appRuntime.connectFeatures({ mapPageFeature });
    return { mapPageFeature };
  },
  postDetail: async () => {
    const [
      { createPostDetailFeature },
      { renderPostCard },
      { contentPagesFeature }
    ] = await Promise.all([
      import("./features/post-detail.js"),
      import("./surfaces/archive.js"),
      featureManifest.load("contentPages")
    ]);
    const postDetailFeature = createPostDetailFeature({
      site: SITE,
      state,
      viewerController,
      postsStore,
      getPublicState: (force) => appRuntime.getPublicState(force),
      publishTaggedJson,
      publicStateStore,
      notificationState,
      hydrateNotifications: (force) => appRuntime.hydrateNotifications(force),
      contentPagesFeature,
      renderLoadingState,
      renderError,
      renderTagList,
      renderRecordList,
      renderPostCard,
      setText,
      formatDate
    });
    appRuntime.connectFeatures({ postDetailFeature });
    return { postDetailFeature };
  }
});

function preloadFeatureGroups(page) {
  const pagePreloads = {
    home: ["contentPages", "mapPage"],
    blog: ["contentPages", "postDetail"],
    post: ["postDetail", "contentPages"],
    map: ["mapPage", "contentPages"],
    guide: ["contentPages"],
    about: ["contentPages"],
    "get-involved": ["contentPages"],
    merch: ["contentPages"],
    submit: ["contentPages"]
  };
  featureManifest.preload(pagePreloads[page] || ["contentPages"]);
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page || "";
  window.__nostrSiteImmediateShell?.destroy?.();
  siteShellFeature.mount();
  appRuntime.connectFeatures({ siteShellFeature });
  void postsStore.hydrateCache().catch(() => []);
  appRuntime.start();

  createPageRouter({ page })
    .when(["home", "blog"], async () => {
      const { contentPagesFeature } = await featureManifest.load("contentPages");
      contentPagesFeature.mountCards();
    })
    .when("post", async () => {
      const { postDetailFeature } = await featureManifest.load("postDetail");
      await postDetailFeature.mount();
    })
    .when("map", async () => {
      const { mapPageFeature } = await featureManifest.load("mapPage");
      await mapPageFeature.mount();
    })
    .when(["guide", "about", "get-involved", "merch", "submit"], async () => {
      const { contentPagesFeature } = await featureManifest.load("contentPages");
      await contentPagesFeature.initMarkdownArticles();
    })
    .mount();

  preloadFeatureGroups(page);
});
