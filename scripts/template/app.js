import SITE from "../core/site-config.js";
import {
  collectEntityRefsFromText,
  enrichEntityReferences,
  parseContentDocument,
  slugify
} from "../core/content-utils.js";
import { formatDate, sortDateValue } from "../core/formatting.js";
import { fetchJson, fetchText } from "../core/http.js";
import { setText } from "../core/dom.js";
import {
  cleanSlug,
  deriveIdentity,
  ensureBlobAvailable,
  ensureEventToolsLoaded,
  loadAdminKeyShare,
  loadInboxSubmissions,
  loadSubmissionThread,
  loadUserSubmissions,
  publishTaggedJson
} from "../core/nostr.js";
import { createPublicStateStore } from "../core/public-state-store.js";
import { createContentPostStore } from "../core/posts-store.js";
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
import { createSiteNotificationBuilder } from "../core/notification-builders.js";
import {
  draftReviewAction,
  draftStatusLabel,
  normalizeDraftStatus
} from "../core/draft-review.js";
import { getStoredGuestSession, getStoredSession } from "../core/session.js";
import {
  bindMapEntityCards as bindMapSurfaceEntityCards,
  renderLeafletMapSurface,
  renderMapPageSurface,
  requestedMapEntity,
  scheduleMapEntityFocus as scheduleSurfaceMapEntityFocus
} from "./surfaces/map.js";
import { renderPostCard } from "./surfaces/archive.js";
import { createContentPagesFeature } from "./features/content-pages.js";
import { createMapPageFeature } from "./features/map-page.js";
import { createPostDetailFeature } from "./features/post-detail.js";
import { createSiteRuntime } from "./features/site-runtime.js";
import { createSiteShellFeature } from "./features/site-shell.js";

const NAV_KEYS = {
  home: ["home"],
  blog: ["blog", "post", "investigations", "investigation", "editor"],
  guide: ["guide"],
  submit: ["submit"],
  "get-involved": ["get-involved"],
  about: ["about"],
  merch: ["merch"],
  map: ["map"],
  workspace: ["workspace"]
};

const navigationUi = createNavigationUiState();
let appRuntime = null;

const publicStateStore = createPublicStateStore({
  getSessionSecretKey: async () => (appRuntime ? appRuntime.getRequestSignerSecretKey() : ""),
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

const viewerController = createViewerController({
  state,
  site: SITE,
  deriveIdentity
});

let siteShellFeature = null;

const buildSiteNotifications = createSiteNotificationBuilder({
  deps: {
    loadAdminKeyShare,
    loadInboxSubmissions,
    loadSubmissionThread,
    loadUserSubmissions
  }
});

const notificationState = createNotificationState({
  storageNamespace: SITE.nostr.storageNamespace,
  onChange: () => siteShellFeature?.renderNavigation(),
  getSession: () => state.session,
  getViewerPubkey: () => state.viewer?.pubkey || "",
  getPublicState: (force) => appRuntime?.getPublicState(force),
  buildNotifications: ({ publicState }) =>
    buildSiteNotifications({
      publicState,
      viewer: state.viewer,
      sessionSecretKeyHex: state.session?.secretKeyHex || ""
    })
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
  ensureBlobAvailable
});

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

const mapPageFeature = createMapPageFeature({
  state,
  postsStore,
  getPublicState: (force) => appRuntime.getPublicState(force),
  collectEntityRefsFromText,
  renderMapPageSurface,
  renderLeafletMapSurface,
  bindMapEntityCards: bindMapSurfaceEntityCards,
  requestedMapEntity,
  scheduleLeafletFocus: scheduleSurfaceMapEntityFocus,
  cleanSlug,
  renderError,
  renderLoadingState
});

siteShellFeature = createSiteShellFeature({
  site: SITE,
  state,
  navKeys: NAV_KEYS,
  notificationState,
  viewerController,
  refreshAvatarFromCache: (target) => appRuntime.refreshAvatarFromCache(target)
});

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

document.addEventListener("DOMContentLoaded", () => {
  siteShellFeature.mount();
  contentPagesFeature.mountCards();
  void postDetailFeature.mount();
  contentPagesFeature.initMarkdownArticles();
  mapPageFeature.mount();
  appRuntime.connectFeatures({
    contentPagesFeature,
    mapPageFeature,
    postDetailFeature,
    siteShellFeature
  });
  appRuntime.start();
});
