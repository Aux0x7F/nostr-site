import SITE from "../../core/site-config.js";
import { buildDraftMarkdown, createUniqueSlug, splitTags } from "../../core/content-utils.js";
import {
  draftOwnerPubkey,
  draftReviewAction,
  draftStatusLabel as reviewStatusLabel
} from "../../core/draft-review.js";
import {
  cleanSlug,
  decryptUploadedBlob,
  deriveIdentity,
  ensureEventToolsLoaded,
  generateSecretKeyHex,
  loadAdminKeyShare,
  loadAdminKeyShares,
  loadInboxSubmissions,
  lookupUsers,
  loadSubmissionThread,
  normalizeUsername,
  publishAdminKeyShare,
  publishAdminKeyRequest,
  publishSiteKeyEvent,
  publishSubmissionChat,
  publishTaggedJson,
  resolveSitePubkey,
  shortKey,
  uploadPublicBlob
} from "../../core/nostr.js";
import { createPublicStateProjectionStore } from "../../core/public-state-projection.js";
import { getSiteRuntimeClient } from "../../core/runtime-client.js";
import { createObservedRegionRouter } from "../../core/observed-regions.js";
import { renderLoadingState } from "../../core/rendering.js";
import { getStoredSession, rebroadcastAccount, resolveStoredSession, signInWithCredentials } from "../../core/session.js";
import {
  dedupeStrings as dedupe,
  escapeAttribute,
  escapeHtml,
  trimmed
} from "../../core/text-utils.js";
import {
  renderChatModal as renderWorkspaceChatModal,
  renderEntityModal as renderWorkspaceEntityModal,
  renderLookupCandidate as renderWorkspaceLookupCandidate,
  renderModerationComment as renderWorkspaceModerationComment,
  renderSubmissionCard as renderWorkspaceSubmissionCard,
  renderUserCard as renderWorkspaceUserCard
} from "../surfaces/workspace-actions.js";
import {
  renderEntityPickerResultsMarkup,
  renderLocationResultsMarkup
} from "../surfaces/workspace-filters.js";
import { renderWorkspaceView } from "../surfaces/workspace.js";
import { createWorkspaceAccountController } from "./workspace-account.js";
import { createWorkspacePageController } from "./workspace-page.js";

const workspacePublicStateStore = createPublicStateProjectionStore({
  getSessionSecretKey: async () => workspaceState.session?.secretKeyHex || "",
  page: "workspace",
  refreshDelayMs: () => 0,
  shouldRefresh: () => false
});

const workspaceState = {
  session: getStoredSession(),
  viewer: null,
  publicState: null,
  siteKeyShares: [],
  siteKeyShare: null,
  inboxSubmissions: [],
  staticSlugs: [],
  activeTab: "login",
  entityModal: null,
  chatModal: null,
  exportValue: "",
  dashboardStatus: "",
  userDirectStatus: "",
  userLookupQuery: "",
  userLookupResult: null,
  keyRequestState: "",
  keyRequestTimer: 0,
  backgroundSyncTimer: 0,
  backgroundSyncInFlight: false,
  inboxLoading: false,
  respondedKeyRequests: new Set(),
  keyRequestCache: null
};
const workspaceRegions = createObservedRegionRouter();
let workspacePage = null;

workspaceState.publicState = workspacePublicStateStore.value;
workspacePublicStateStore.subscribe((snapshot) => {
  workspaceState.publicState = snapshot.value;
  if (snapshot.reason === "source") {
    void refreshWorkspace(true);
  }
});

const workspaceAccount = createWorkspaceAccountController({
  state: workspaceState,
  deps: {
    rebroadcastAccount,
    signInWithCredentials,
    uploadPublicBlob
  },
  callbacks: {
    currentUser,
    refreshWorkspace
  }
});

workspacePage = createWorkspacePageController({
  state: workspaceState,
  deps: {
    getStoredSession
  },
  callbacks: {
    applyEntityPick,
    applyLocationPick,
    createEntityModalState,
    handleAttachmentDownload,
    handleChatSend,
    handleCommentAction,
    handleDirectUserAction,
    handleDirectUserLookup,
    handleEntityAction,
    handleEntitySave,
    handleLogin: (form) => workspaceAccount.handleLogin(form),
    handleProfileSave: (form) => workspaceAccount.handleProfileSave(form),
    handleReviewAction,
    handleSnapshotRequest,
    handleSubmissionAction,
    handleUserAction,
    hydrateChatModal,
    hydrateWorkspaceEnhancements,
    refreshWorkspace,
    renderWorkspace,
    setActiveTab,
    syncWorkspace: (force = true) => syncWorkspaceState(force)
  }
});

export function startTemplateWorkspaceAdminRuntime() {
  return workspacePage?.start();
}

async function refreshWorkspace(force = false) {
  workspaceState.session = await resolveStoredSession({
    persistSession: true
  }).catch(() => getStoredSession());
  if (workspaceState.keyRequestTimer) {
    window.clearTimeout(workspaceState.keyRequestTimer);
    workspaceState.keyRequestTimer = 0;
  }
  if (workspaceState.backgroundSyncTimer) {
    window.clearTimeout(workspaceState.backgroundSyncTimer);
    workspaceState.backgroundSyncTimer = 0;
  }
  workspaceState.viewer = null;
  if (!workspaceState.session) {
    workspaceState.publicState = workspaceState.publicState || null;
    workspaceState.siteKeyShares = [];
    workspaceState.siteKeyShare = null;
    workspaceState.inboxSubmissions = [];
    workspaceState.activeTab = "login";
    renderWorkspace();
    return;
  }

  renderWorkspaceLoading("Looking up workspace...");
  await ensureEventToolsLoaded();
  await hydrateWorkspaceState(force);
  workspaceState.staticSlugs = await loadStaticSlugs().catch(() => []);
  workspaceState.activeTab = chooseInitialTab(workspaceState.activeTab);
  renderWorkspace();
  workspaceState.keyRequestState = "";
  await maybeAutoRespondToKeyRequests().catch(() => {});
  await maybeEnsureCurrentKeyRequest().catch(() => {
    workspaceState.keyRequestState = "error";
  });
  if (currentUserHasInboxAccess()) {
    void hydrateInboxSubmissions();
  } else {
    workspaceState.inboxLoading = false;
    workspaceState.inboxSubmissions = [];
  }
  scheduleWorkspaceSync();
}

function renderWorkspaceLoading(message) {
  const shell = document.querySelector("[data-workspace-shell]");
  const lede = document.querySelector("[data-workspace-lede]");
  if (lede) lede.textContent = message;
  if (shell) shell.innerHTML = renderLoadingState(message);
}

async function hydrateWorkspaceState(force = false) {
  workspaceState.session = getStoredSession();
  workspaceState.viewer = workspaceState.session
    ? deriveIdentity(workspaceState.session.secretKeyHex)
    : null;
  const cachedShares = await loadCachedSiteKeyShares();
  const [publicStateResult, remoteShares] = await Promise.all([
    workspacePublicStateStore.hydrate({ force, reason: force ? "workspace-force" : "workspace-hydrate" }),
    workspaceState.session
      ? loadAdminKeyShares(workspaceState.session.secretKeyHex).catch(() => [])
      : Promise.resolve([])
  ]);
  const publicState = publicStateResult.value;
  workspaceState.publicState = publicState;
  const activeSitePubkey = resolveSitePubkey(workspaceState.publicState);
  let mergedShares = mergeSiteKeyShares(remoteShares, cachedShares);
  if (workspaceState.session && activeSitePubkey && !findSiteKeyShareInList(mergedShares, activeSitePubkey)) {
    const currentShare = await loadAdminKeyShare(workspaceState.session.secretKeyHex, activeSitePubkey).catch(() => null);
    mergedShares = mergeSiteKeyShares(currentShare ? [currentShare, ...mergedShares] : mergedShares, []);
  }
  workspaceState.siteKeyShares = mergedShares;
  await persistCachedSiteKeyShares(workspaceState.siteKeyShares);
  workspaceState.siteKeyShare = findSiteKeyShareInList(
    workspaceState.siteKeyShares,
    activeSitePubkey
  );
}

function captureWorkspaceAccessState() {
  return JSON.stringify({
    sessionPubkey: workspaceState.viewer?.pubkey || "",
    admin: currentUserIsAdmin(),
    inbox: currentUserHasInboxAccess(),
    activeSitePubkey: activeSitePubkey()
  });
}

function captureWorkspaceDataState() {
  const publicState = workspaceState.publicState || {};
  return JSON.stringify({
    tab: workspaceState.activeTab,
    keyState: workspaceState.keyRequestState || "",
    users: (publicState.users || []).map((user) => `${user.pubkey}:${user.isAdmin ? 1 : 0}:${user.submissionCount || 0}:${user.commentCount || 0}`),
    pendingKeyRequests: (publicState.pendingAdminKeyRequests || []).map((request) => `${request.id}:${request.requester_pubkey}:${request.site_pubkey}`),
    submissions: (workspaceState.inboxSubmissions || []).map((submission) => `${submission.id}:${submission.latest?.status || submission.status || ""}`),
    entities: (publicState.entities || []).map((entity) => `${entity.slug}:${entity.status}`),
    drafts: (publicState.drafts || []).map((draft) => `${draft.slug}:${draft.status}:${draft.id || draft.created_at || ""}`),
    comments: (publicState.allComments || []).map((comment) => `${comment.id}:${comment.visibility || "visible"}`),
    snapshot: publicState.snapshotInfo?.id || "",
    metrics: publicState.metrics || {}
  });
}

function workspaceSyncDelayMs() {
  if (!workspaceState.session) return 0;
  if (currentUserIsAdmin() && !currentUserHasInboxAccess()) return 2600;
  if (currentUserIsAdmin()) return 6000;
  return 15000;
}

function scheduleWorkspaceSync(delay = workspaceSyncDelayMs()) {
  if (workspaceState.backgroundSyncTimer) {
    window.clearTimeout(workspaceState.backgroundSyncTimer);
    workspaceState.backgroundSyncTimer = 0;
  }
  if (!delay || document.visibilityState === "hidden") return;
  workspaceState.backgroundSyncTimer = window.setTimeout(() => {
    void syncWorkspaceState(true);
  }, delay);
}

async function syncWorkspaceState(force = true) {
  if (workspaceState.backgroundSyncInFlight) return;
  if (!document.querySelector("[data-workspace-page]")) return;
  if (document.visibilityState === "hidden") {
    scheduleWorkspaceSync();
    return;
  }
  if (!getStoredSession()) return;

  const beforeAccess = captureWorkspaceAccessState();
  const beforeData = captureWorkspaceDataState();
  workspaceState.backgroundSyncInFlight = true;
  let didRefresh = false;
  try {
    await ensureEventToolsLoaded();
    await hydrateWorkspaceState(force);
    workspaceState.keyRequestState = "";
    await maybeAutoRespondToKeyRequests().catch(() => {});
    await maybeEnsureCurrentKeyRequest().catch(() => {
      workspaceState.keyRequestState = "error";
    });
    if (currentUserHasInboxAccess()) {
      void hydrateInboxSubmissions();
    } else {
      workspaceState.inboxLoading = false;
      workspaceState.inboxSubmissions = [];
    }
    workspaceState.staticSlugs = await loadStaticSlugs().catch(() => []);
    workspaceState.activeTab = chooseInitialTab(workspaceState.activeTab);
    const afterAccess = captureWorkspaceAccessState();
    const afterData = captureWorkspaceDataState();
    if (beforeAccess !== afterAccess) {
      didRefresh = true;
      renderWorkspace({ soft: true });
    } else if (beforeData !== afterData && shouldSoftRefreshWorkspace()) {
      didRefresh = true;
      renderWorkspace({ soft: true });
    }
  } finally {
    workspaceState.backgroundSyncInFlight = false;
    if (!didRefresh) scheduleWorkspaceSync();
  }
}

async function hydrateInboxSubmissions() {
  if (!currentUserHasInboxAccess()) return;
  workspaceState.inboxLoading = true;
  renderWorkspace({ soft: true });
  workspaceState.inboxSubmissions = await loadInboxSubmissions(workspaceState.siteKeyShares).catch(() => []);
  workspaceState.inboxLoading = false;
  renderWorkspace({ soft: true });
}

function renderWorkspace(options = {}) {
  const shell = document.querySelector("[data-workspace-shell]");
  const title = document.querySelector("[data-workspace-title]");
  const lede = document.querySelector("[data-workspace-lede]");
  if (!shell || !title || !lede) return;
  const surfaceDeps = workspaceSurfaceDeps();
  const view = renderWorkspaceView({
    workspaceState,
    deps: surfaceDeps
  });
  const sharedRegions = [
    { name: "workspace-title", kind: "text", element: title, value: view.title },
    { name: "workspace-lede", kind: "text", element: lede, value: view.lede }
  ];
  const tabs = shell.querySelector("[data-workspace-tabs]");
  const pane = shell.querySelector("[data-workspace-pane]");
  const overlays = shell.querySelector("[data-workspace-overlays]");

  if (tabs && pane && overlays) {
    workspaceRegions.apply([
      ...sharedRegions,
      { name: "workspace-tabs", kind: "markup", element: tabs, value: view.tabsMarkup },
      { name: "workspace-pane", kind: "markup", element: pane, value: view.paneMarkup },
      { name: "workspace-overlays", kind: "markup", element: overlays, value: view.overlayMarkup }
    ]);
  } else {
    const shellMarkup = `
      <div class="workspace-tabs" data-workspace-tabs>
        ${view.tabsMarkup}
      </div>
      <div class="workspace-pane" data-workspace-pane>
        ${view.paneMarkup}
      </div>
      <div data-workspace-overlays>
        ${view.overlayMarkup}
      </div>
    `;
    workspaceRegions.apply(sharedRegions);
    workspaceRegions.apply(
      [{ name: "workspace-shell", kind: "markup", element: shell, value: shellMarkup }],
      { force: true }
    );
    const nextTabs = shell.querySelector("[data-workspace-tabs]");
    const nextPane = shell.querySelector("[data-workspace-pane]");
    const nextOverlays = shell.querySelector("[data-workspace-overlays]");
    workspaceRegions.reset();
    workspaceRegions.remember([
      ...sharedRegions,
      { name: "workspace-tabs", kind: "markup", element: nextTabs, value: view.tabsMarkup },
      { name: "workspace-pane", kind: "markup", element: nextPane, value: view.paneMarkup },
      { name: "workspace-overlays", kind: "markup", element: nextOverlays, value: view.overlayMarkup }
    ]);
  }
  hydrateWorkspaceEnhancements();
}

function workspaceSurfaceDeps() {
  const actionDeps = workspaceActionSurfaceDeps();
  return {
    tabButtons,
    renderTabButton,
    currentUserIsAdmin,
    currentUserHasInboxAccess,
    currentUserPendingKeyRequest,
    currentUser,
    escapeHtml,
    escapeAttribute,
    renderSnapshotSummary,
    renderLookupCandidate: () => renderWorkspaceLookupCandidate(workspaceState, actionDeps),
    renderUserCard: (user) => renderWorkspaceUserCard(user, workspaceState, actionDeps),
    renderSubmissionCard: (item) => renderWorkspaceSubmissionCard(item, workspaceState, actionDeps),
    renderReviewCard,
    renderReviewedCard,
    renderModerationComment: (comment) => renderWorkspaceModerationComment(comment, workspaceState, actionDeps),
    renderEntityModal: () => renderWorkspaceEntityModal(workspaceState, actionDeps),
    renderChatModal: () => renderWorkspaceChatModal(workspaceState, actionDeps),
    renderLogPane,
    trimmed
  };
}

function workspaceActionSurfaceDeps() {
  return {
    currentUserIsAdmin,
    shortKey,
    escapeHtml,
    escapeAttribute,
    resolveEntityDisplayValue,
    trimmed,
    renderLoadingState
  };
}

function renderLogEvent(event) {
  const target = logTarget(event);
  return `
    <article class="roster-item">
      <strong>${escapeHtml(logLabel(event))}</strong>
      <span>${escapeHtml(target.description)}</span>
      <div class="button-row button-row--tight">
        <a class="text-link" href="${target.href}">Open</a>
      </div>
    </article>
  `;
}

function renderLogPane() {
  const logEvents = (workspaceState.publicState?.rawEvents || [])
    .filter((event) =>
      [
        SITE.nostr.kinds.snapshot,
        SITE.nostr.kinds.adminClaim,
        SITE.nostr.kinds.adminRole,
        SITE.nostr.kinds.userMod,
        SITE.nostr.kinds.snapshotRequest,
        SITE.nostr.kinds.entity,
        SITE.nostr.kinds.draft,
        SITE.nostr.kinds.commentMod,
        SITE.nostr.kinds.submissionStatus,
        SITE.nostr.kinds.adminKeyShare,
        SITE.nostr.kinds.siteKey
      ].includes(Number(event.kind))
    )
    .slice(0, 40);
  return `
    <section class="surface-panel">
      <div class="eyebrow">Log</div>
      <h2>Audit events</h2>
      <div class="roster-list">
        ${
          logEvents.length
            ? logEvents.map((event) => renderLogEvent(event)).join("")
            : `<div class="empty-state">No audit events visible yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderReviewCard(draft) {
  const authorPubkey = draftOwnerPubkey(draft);
  const author = (workspaceState.publicState?.users || []).find((user) => user.pubkey === authorPubkey);
  const authorLabel = author?.displayName || author?.username || shortKey(authorPubkey);
  const revisionLabel = draft.revisionCount > 1 ? `${draft.revisionCount} saved versions` : "1 saved version";
  return `
    <article class="review-card">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(draft.title)}</strong>
          <span>${escapeHtml(draft.date)} • ${escapeHtml(revisionLabel)}</span>
        </div>
        <div class="tag-row">
          <span class="tag">Ready for review</span>
        </div>
      </div>
      <p class="review-card__summary">${escapeHtml(draft.summary || "No summary added yet.")}</p>
      <span class="muted-text">By ${escapeHtml(authorLabel)}${draft.entity_refs?.length ? ` • ${escapeHtml(draft.entity_refs.map(resolveEntityDisplayValue).join(", "))}` : ""}</span>
      <div class="button-row button-row--tight">
        <a class="text-link" href="./post.html?draft=${encodeURIComponent(draft.slug)}">Open preview</a>
        <button class="button-ghost" type="button" data-review-action="approve" data-draft-slug="${escapeAttribute(draft.slug)}">Approve for publish</button>
        <button class="button-ghost" type="button" data-review-action="revise" data-draft-slug="${escapeAttribute(draft.slug)}">Request revision</button>
        <button class="button-ghost" type="button" data-review-action="deny" data-draft-slug="${escapeAttribute(draft.slug)}">Deny</button>
      </div>
    </article>
  `;
}

function renderReviewedCard(draft) {
  const reviewAction = draftReviewAction(draft);
  return `
    <article class="review-card review-card--history">
      <strong>${escapeHtml(draft.title)}</strong>
      <span>${escapeHtml(reviewStatusLabel(draft.status, reviewAction))} • ${escapeHtml(draft.date)}</span>
      <p class="review-card__summary">${escapeHtml(trimmed(draft.summary || draft.markdown || "", 180))}</p>
      <div class="button-row button-row--tight">
        <a class="text-link" href="${escapeAttribute(reviewedDraftHref(draft))}">${escapeHtml(reviewedDraftAction(draft))}</a>
      </div>
    </article>
  `;
}

function reviewedDraftHref(draft) {
  const status = String(draft?.status || "").trim().toLowerCase();
  return status === "revision"
    ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
    : `./post.html?draft=${encodeURIComponent(draft.slug)}`;
}

function reviewedDraftAction(draft) {
  return String(draft?.status || "").trim().toLowerCase() === "revision"
    ? "Open draft"
    : "Open preview";
}

async function handleAttachmentDownload(button) {
  if (!currentUserHasInboxAccess()) return;
  const submission = workspaceState.inboxSubmissions.find((item) => item.id === (button.getAttribute("data-download-attachment") || ""));
  const attachment = submission?.latest?.payload?.attachment;
  if (!attachment?.url) return;
  const siteKeyShare = findSiteKeyShare(attachment.recipient_pubkey || submission?.latest?.recipient_pubkey || "");
  if (!siteKeyShare) {
    window.alert("No matching site key share is loaded for this attachment.");
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Decrypting";
  try {
    const file = await decryptUploadedBlob(
      siteKeyShare.siteSecretKeyHex,
      attachment.author_pubkey || submission.author,
      attachment
    );
    triggerBrowserDownload(file);
    button.textContent = "Downloaded";
  } catch (error) {
    button.textContent = "Retry";
    window.alert(String(error?.message || error || "Attachment download failed."));
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
      button.textContent = original;
    }, 900);
  }
}

async function handleUserAction(button) {
  if (!currentUserIsAdmin()) return;
  const targetPubkey = button.getAttribute("data-target-pubkey") || "";
  const action = button.getAttribute("data-user-action") || "";
  const mode = button.getAttribute("data-mode") || "";
  await performUserAction(targetPubkey, action, mode);
  await refreshWorkspace(true);
}

async function handleDirectUserAction(button) {
  if (!currentUserIsAdmin()) return;
  const targetPubkey = resolveDirectUserPubkey();
  if (!targetPubkey) {
    workspaceState.userDirectStatus = "Find a user first, or paste a valid 64-character pubkey.";
    renderWorkspace();
    return;
  }
  const action = button.getAttribute("data-quick-user-action") || "";
  const mode = button.getAttribute("data-mode") || "";
  await performUserAction(targetPubkey, action, mode);
  workspaceState.userDirectStatus =
    action === "share-site-key"
      ? `Shared the current inbox key with ${shortKey(targetPubkey)}.`
      : `${mode === "grant" ? "Granted" : "Updated"} access for ${shortKey(targetPubkey)}.`;
  await refreshWorkspace(true);
}

async function handleDirectUserLookup() {
  const input = document.querySelector("[data-quick-user-input]");
  const rawValue = String(input instanceof HTMLInputElement ? input.value : workspaceState.userLookupQuery || "").trim();
  workspaceState.userLookupQuery = rawValue;
  workspaceState.userLookupResult = null;
  if (!rawValue) {
    workspaceState.userDirectStatus = "Enter a username or pubkey.";
    renderWorkspace();
    return;
  }

  const localMatch = findLocalUserCandidate(rawValue);
  if (localMatch) {
    workspaceState.userLookupQuery = localMatch.pubkey;
    workspaceState.userLookupResult = localMatch;
    workspaceState.userDirectStatus = `Found ${localMatch.username ? `@${localMatch.username}` : shortKey(localMatch.pubkey)} in the current roster.`;
    renderWorkspace();
    return;
  }

  const remoteMatches = await lookupUsers(rawValue).catch(() => []);
  if (remoteMatches.length) {
    const match = hydrateLookupCandidate(remoteMatches[0]);
    workspaceState.userLookupQuery = match.pubkey;
    workspaceState.userLookupResult = match;
    workspaceState.userDirectStatus = `Found ${match.username ? `@${match.username}` : shortKey(match.pubkey)} from the authority relays.`;
    renderWorkspace();
    return;
  }

  const directPubkey = normalizeDirectPubkey(rawValue);
  if (directPubkey) {
    workspaceState.userLookupQuery = directPubkey;
    workspaceState.userLookupResult = hydrateLookupCandidate({
      pubkey: directPubkey,
      username: "",
      displayName: "Direct pubkey",
      isAdmin: workspaceState.publicState?.admins?.includes(directPubkey)
    });
    workspaceState.userDirectStatus = "No public profile found yet. You can still act on this pubkey.";
    renderWorkspace();
    return;
  }

  workspaceState.userDirectStatus = "No matching user found yet.";
  renderWorkspace();
}

async function performUserAction(targetPubkey, action, mode = "") {
  if (!currentUserIsAdmin() || !targetPubkey) return;
  if (action === "share-site-key" && workspaceState.siteKeyShare) {
    await publishAdminKeyShare(
      workspaceState.session.secretKeyHex,
      targetPubkey,
      workspaceState.siteKeyShare.siteSecretKeyHex
    );
  }

  if (action === "admin") {
    await publishTaggedJson({
      kind: SITE.nostr.kinds.adminRole,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [["d", `admin-role:${targetPubkey}`], ["p", targetPubkey], ["op", mode]],
      content: {
        action: mode,
        target_pubkey: targetPubkey
      }
    });
    if (mode === "grant" && workspaceState.siteKeyShare && targetPubkey !== workspaceState.viewer?.pubkey) {
      await publishAdminKeyShare(
        workspaceState.session.secretKeyHex,
        targetPubkey,
        workspaceState.siteKeyShare.siteSecretKeyHex
      );
    }
    if (mode === "revoke") {
      try {
        await rotateSiteInboxKey([targetPubkey], "admin-revoke");
      } catch (error) {
        window.alert(`Admin revoked, but site inbox key rotation failed: ${String(error?.message || error || "Unknown error.")}`);
      }
    }
  }

  if (action === "mod") {
    await publishTaggedJson({
      kind: SITE.nostr.kinds.userMod,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [["d", `user-mod:${targetPubkey}`], ["p", targetPubkey], ["op", mode]],
      content: {
        action: mode,
        target_pubkey: targetPubkey
      }
    });
  }
}

async function handleEntitySave(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const taken = (workspaceState.publicState?.entities || []).map((entity) => entity.slug);
  const slug = createUniqueSlug(name, taken);
  await publishTaggedJson({
    kind: SITE.nostr.kinds.entity,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["d", slug]],
    content: {
      slug,
      name,
      location: String(formData.get("location") || "").trim(),
      type: String(formData.get("type") || "").trim() || "entity",
      lat: parseMaybeNumber(formData.get("lat")),
      lng: parseMaybeNumber(formData.get("lng")),
      notes: String(formData.get("notes") || "").trim(),
      status: currentUserIsAdmin() ? "approved" : "pending"
    }
  });
  workspaceState.entityModal = null;
  await refreshWorkspace(true);
}

async function handleEntityAction(button) {
  if (!currentUserIsAdmin()) return;
  const slug = button.getAttribute("data-entity-slug") || "";
  const action = button.getAttribute("data-entity-action") || "";
  const entity = (workspaceState.publicState?.entities || []).find((item) => item.slug === slug);
  if (!entity) return;
  await publishTaggedJson({
    kind: SITE.nostr.kinds.entity,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["d", entity.slug]],
    content: {
      slug: entity.slug,
      name: entity.name,
      location: entity.location,
      type: entity.type,
      lat: entity.lat,
      lng: entity.lng,
      notes: entity.notes,
      aliases: entity.aliases || [],
      status: action === "approve" ? "approved" : "denied"
    }
  });
  await refreshWorkspace(true);
}

async function handleCommentAction(button) {
  if (!currentUserIsAdmin()) return;
  const action = button.getAttribute("data-comment-action") || "";
  const commentId = button.getAttribute("data-comment-id") || "";
  if (!commentId || !action) return;
  const noteField = document.querySelector(`[data-comment-note="${commentId}"]`);
  const note = noteField instanceof HTMLTextAreaElement ? noteField.value.trim() : "";
  await publishTaggedJson({
    kind: SITE.nostr.kinds.commentMod,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["e", commentId], ["op", action]],
    content: {
      target_id: commentId,
      action,
      note
    }
  });
  applyLocalCommentModeration(commentId, action, note);
  renderWorkspace();
  window.setTimeout(() => {
    void refreshWorkspace(true);
  }, 1800);
}

async function handleReviewAction(button) {
  if (!currentUserIsAdmin() || !workspaceState.session) return;
  const action = button.getAttribute("data-review-action") || "";
  const slug = cleanSlug(button.getAttribute("data-draft-slug") || "");
  const draft = (workspaceState.publicState?.drafts || []).find((item) => item.slug === slug);
  if (!draft || !["approve", "revise", "deny"].includes(action)) return;
  const nextStatus = action === "approve" ? "approved" : action === "deny" ? "denied" : "revision";
  button.setAttribute("disabled", "disabled");
  try {
    await publishTaggedJson({
      kind: SITE.nostr.kinds.draft,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [["d", draft.slug], ["status", nextStatus], ["review", action]],
      content: {
        ...draft,
        author_pubkey: draftOwnerPubkey(draft),
        status: nextStatus,
        reviewed_at: new Date().toISOString(),
        reviewed_by: workspaceState.viewer?.pubkey || "",
        review_action: action
      }
    });
    await refreshWorkspace(true);
  } finally {
    button.removeAttribute("disabled");
  }
}

async function handleDraftSave(form) {
  if (!currentUserIsAdmin()) return;
  const formData = new FormData(form);
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const primaryEntityInput = String(formData.get("primaryEntity") || "").trim();
  const primaryEntity = resolveEntityByNameOrSlug(primaryEntityInput);
  const additionalEntityRefs = splitTags(formData.get("entityRefs"));
  const entityRefs = dedupe([
    primaryEntity?.slug || "",
    ...additionalEntityRefs.map((value) => resolveEntityByNameOrSlug(value)?.slug || cleanSlug(value))
  ]);
  const taken = [...workspaceState.staticSlugs, ...(workspaceState.publicState?.drafts || []).map((draft) => draft.slug)];
  const slug = createUniqueSlug(title, taken);
  const draft = {
    slug,
    title,
    date: String(formData.get("date") || "").trim() || new Date().toISOString().slice(0, 10),
    location: primaryEntity?.name || primaryEntity?.location || "Undisclosed location",
    status: String(formData.get("status") || "draft").trim(),
    summary: String(formData.get("summary") || "").trim(),
    tags: splitTags(formData.get("tags")),
    entity_refs: entityRefs,
    featured: false,
    markdown: String(formData.get("markdown") || "").trim(),
    records: []
  };
  await publishTaggedJson({
    kind: SITE.nostr.kinds.draft,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["d", draft.slug], ["status", draft.status]],
    content: draft
  });
  workspaceState.exportValue = buildDraftMarkdown(draft);
  await refreshWorkspace(true);
  workspaceState.exportValue = buildDraftMarkdown(draft);
  renderWorkspace();
}

async function handleSubmissionAction(button) {
  if (!currentUserIsAdmin()) return;
  const submissionId = button.getAttribute("data-submission-id") || "";
  const authorPubkey = button.getAttribute("data-author-pubkey") || "";
  const status = button.getAttribute("data-status") || "received";
  await publishTaggedJson({
    kind: SITE.nostr.kinds.submissionStatus,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["d", submissionId], ["p", authorPubkey]],
    content: {
      submission_id: submissionId,
      author_pubkey: authorPubkey,
      status
    }
  });
  await refreshWorkspace(true);
}

async function handleSnapshotRequest(button) {
  if (!currentUserIsAdmin() || !workspaceState.session) return;
  button.setAttribute("disabled", "disabled");
  try {
    const requestId = `snapshot:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await publishTaggedJson({
      kind: SITE.nostr.kinds.snapshotRequest,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [
        ["d", requestId],
        ["req", requestId],
        ["op", "bake"]
      ],
      content: {
        protocol: `${SITE.nostr.protocolPrefix}-snapshot-request/v1`,
        request_id: requestId,
        op: "bake",
        requested_at: new Date().toISOString()
      }
    });
    workspaceState.dashboardStatus = "Snapshot request sent. The pinner can now build the latest approved content and update the review branch.";
    await refreshWorkspace(true);
  } catch (error) {
    workspaceState.dashboardStatus = String(error?.message || error || "Snapshot request failed.");
    renderWorkspace();
  } finally {
    button.removeAttribute("disabled");
  }
}

async function hydrateChatModal() {
  if (!workspaceState.chatModal || !currentUserHasInboxAccess()) return;
  workspaceState.chatModal.loading = true;
  renderWorkspace();
  workspaceState.chatModal.messages = await loadSubmissionThread(
    workspaceState.siteKeyShares,
    workspaceState.chatModal.submissionId,
    workspaceState.chatModal.targetPubkey
  ).catch(() => []);
  workspaceState.chatModal.loading = false;
  renderWorkspace();
}

async function handleChatSend(form) {
  if (!currentUserHasInboxAccess()) return;
  const formData = new FormData(form);
  const body = String(formData.get("body") || "").trim();
  if (!body) return;
  if (!workspaceState.siteKeyShare) {
    window.alert("This admin account does not have the current inbox key yet.");
    return;
  }
  await publishSubmissionChat(workspaceState.siteKeyShare.siteSecretKeyHex, {
    targetPubkey: String(formData.get("targetPubkey") || ""),
    submissionId: String(formData.get("submissionId") || ""),
    body,
    role: "admin"
  });
  await hydrateChatModal();
}

async function copyExport() {
  const area = document.querySelector("[data-draft-export]");
  if (!(area instanceof HTMLTextAreaElement) || !area.value.trim()) return;
  try {
    await navigator.clipboard.writeText(area.value);
  } catch {
    return;
  }
}

function loadDraft(slug) {
  const draft = (workspaceState.publicState?.drafts || []).find((item) => item.slug === slug);
  if (!draft) return;
  workspaceState.exportValue = buildDraftMarkdown(draft);
  renderWorkspace();
  const form = document.querySelector("[data-draft-form]");
  if (!(form instanceof HTMLFormElement)) return;
  form.elements.namedItem("title").value = draft.title;
  form.elements.namedItem("date").value = draft.date;
  form.elements.namedItem("status").value = draft.status;
  form.elements.namedItem("summary").value = draft.summary;
  form.elements.namedItem("tags").value = (draft.tags || []).join(", ");
  form.elements.namedItem("primaryEntity").value = resolveEntityDisplayValue((draft.entity_refs || [])[0]);
  form.elements.namedItem("entityRefs").value = (draft.entity_refs || []).join(", ");
  form.elements.namedItem("markdown").value = draft.markdown;
  hydrateWorkspaceEnhancements();
}

function hydrateWorkspaceEnhancements() {
  renderEntityPickerResults("primaryEntity");
  renderEntityPickerResults("entityRefs");
  renderLocationResults();
}

function createEntityModalState(trigger) {
  const fieldName = trigger?.getAttribute?.("data-entity-seed-from") || "";
  const sourceField = fieldName ? document.querySelector(`[name="${fieldName}"]`) : null;
  const sourceValue = sourceField instanceof HTMLInputElement ? sourceField.value.trim() : "";
  const locationField = document.querySelector('[name="location"]');
  const locationValue = locationField instanceof HTMLInputElement ? locationField.value.trim() : "";
  const seedName = fieldName === "entityRefs" ? lastCommaValue(sourceValue) : sourceValue;
  return {
    mode: "create",
    seedName,
    seedLocation: locationValue
  };
}

function renderEntityPickerResults(fieldName) {
  const host = document.querySelector(`[data-entity-picker-results="${fieldName}"]`);
  const input = document.querySelector(`[name="${fieldName}"]`);
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const query = fieldName === "entityRefs" ? lastCommaValue(input.value) : input.value.trim();
  const matches = matchEntities(query).slice(0, 6);
  host.innerHTML = renderEntityPickerResultsMarkup(fieldName, query, matches, {
    escapeAttribute,
    escapeHtml
  });
}

function renderLocationResults() {
  const host = document.querySelector("[data-location-results]");
  const input = document.querySelector("[data-location-input]");
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const query = input.value.trim().toLowerCase();
  const matches = uniqueLocations()
    .filter((location) => !query || location.toLowerCase().includes(query))
    .slice(0, 6);
  host.innerHTML = renderLocationResultsMarkup(query, matches, {
    escapeAttribute,
    escapeHtml
  });
}

function applyEntityPick(button) {
  const slug = button.getAttribute("data-entity-pick") || "";
  const fieldName = button.getAttribute("data-target-field") || "";
  const entity = (workspaceState.publicState?.approvedEntities || []).find((item) => item.slug === slug);
  const input = document.querySelector(`[name="${fieldName}"]`);
  if (!entity || !(input instanceof HTMLInputElement)) return;
  if (fieldName === "entityRefs") {
    const existing = splitTags(input.value)
      .map((value) => resolveEntityByNameOrSlug(value)?.slug || cleanSlug(value))
      .filter(Boolean);
    input.value = dedupe([...existing, entity.slug]).join(", ");
  } else {
    input.value = entity.name;
  }
  hydrateWorkspaceEnhancements();
}

function applyLocationPick(button) {
  const value = button.getAttribute("data-location-pick") || "";
  const input = document.querySelector("[data-location-input]");
  if (!(input instanceof HTMLInputElement)) return;
  input.value = value;
  hydrateWorkspaceEnhancements();
}

function matchEntities(query) {
  const clean = String(query || "").trim().toLowerCase();
  if (!clean) return [];
  return (workspaceState.publicState?.approvedEntities || []).filter((entity) => {
    const haystacks = [
      entity.name,
      entity.slug,
      entity.location,
      ...(Array.isArray(entity.aliases) ? entity.aliases : [])
    ]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);
    return haystacks.some((value) => value.includes(clean));
  });
}

function uniqueLocations() {
  return dedupe((workspaceState.publicState?.entities || []).map((entity) => entity.location));
}

function resolveEntityDisplayValue(value) {
  const entity = resolveEntityByNameOrSlug(value);
  return entity?.name || String(value || "");
}

function lastCommaValue(value) {
  return String(value || "").split(",").pop().trim();
}

function chooseInitialTab(current) {
  const requested = cleanSlug(new URLSearchParams(window.location.search).get("tab") || "");
  return normalizeWorkspaceTab(requested || current);
}

function setActiveTab(tab) {
  workspaceState.activeTab = normalizeWorkspaceTab(tab);
  const url = new URL(window.location.href);
  url.searchParams.set("tab", workspaceState.activeTab);
  history.replaceState({}, "", url);
}

function normalizeWorkspaceTab(value) {
  if (cleanSlug(value) === "drafts") return "review";
  const valid = new Set(tabButtons().map((tab) => tab.id));
  const requested = cleanSlug(value);
  if (requested && valid.has(requested)) return requested;
  return currentUserIsAdmin() ? "dashboard" : "profile";
}

function tabButtons() {
  if (!workspaceState.session) return [{ id: "login", label: "Log in" }];
  const base = [{ id: "profile", label: "Profile" }, { id: "comments", label: "Comments" }];
  if (!currentUserIsAdmin()) return base;
  return [
    { id: "dashboard", label: "Dashboard" },
    ...base,
    { id: "users", label: "User Management" },
    { id: "submissions", label: "Submissions" },
    { id: "entities", label: "Entities" },
    { id: "review", label: "Post Review" },
    { id: "log", label: "Log" }
  ];
}

function renderTabButton(tab) {
  return `<button class="workspace-tab ${workspaceState.activeTab === tab.id ? "is-current" : ""}" type="button" data-workspace-tab="${tab.id}">${escapeHtml(tab.label)}</button>`;
}

function currentUser() {
  return (workspaceState.publicState?.users || []).find((user) => user.pubkey === workspaceState.viewer?.pubkey) || null;
}

function currentUserIsAdmin() {
  return Boolean(workspaceState.viewer && workspaceState.publicState?.admins?.includes(workspaceState.viewer.pubkey));
}

function currentUserHasInboxAccess() {
  return Boolean(
    currentUserIsAdmin() &&
      workspaceState.siteKeyShare &&
      workspaceState.siteKeyShare.sitePubkey === activeSitePubkey()
  );
}

function currentUserPendingKeyRequest() {
  if (!workspaceState.viewer) return null;
  return (workspaceState.publicState?.pendingAdminKeyRequests || []).find(
    (request) =>
      request.requester_pubkey === workspaceState.viewer.pubkey &&
      request.site_pubkey === activeSitePubkey()
  ) || null;
}

function renderSnapshotSummary(snapshot) {
  if (!snapshot) {
    return `<p class="muted-text">No baked snapshot event is visible yet.</p>`;
  }
  const generatedAt = snapshot.generated_at
    ? new Date(snapshot.generated_at).toLocaleString()
    : new Date((snapshot.event?.created_at || snapshot.version_ts || 0) * 1000).toLocaleString();
  const prUrl = snapshot.git?.pr_url || "";
  const branch = snapshot.git?.branch || "";
  const commit = snapshot.git?.commit || "";
  return `
    <div class="roster-list">
      <article class="roster-item">
        <strong>Latest snapshot</strong>
        <span>${escapeHtml(snapshot.status || "ready")} • ${escapeHtml(generatedAt)}</span>
        <span>${escapeHtml(`${snapshot.counts?.posts || 0} posts • ${snapshot.counts?.entities || 0} entities`)}</span>
        ${
          branch
            ? `<span class="mono">${escapeHtml(branch)}${commit ? ` @ ${escapeHtml(String(commit).slice(0, 12))}` : ""}</span>`
            : ""
        }
        ${prUrl ? `<a class="text-link" href="${escapeAttribute(prUrl)}" target="_blank" rel="noreferrer">Open PR</a>` : ""}
      </article>
    </div>
  `;
}

function resolveEntityByNameOrSlug(value) {
  const clean = String(value || "").trim().toLowerCase();
  return (workspaceState.publicState?.approvedEntities || []).find(
    (entity) => entity.slug === cleanSlug(clean) || entity.name.toLowerCase() === clean
  );
}

function logLabel(event) {
  switch (Number(event.kind)) {
    case SITE.nostr.kinds.snapshot:
      return "Snapshot";
    case SITE.nostr.kinds.adminClaim:
      return "Root admin claim";
    case SITE.nostr.kinds.adminRole:
      return "Admin role change";
    case SITE.nostr.kinds.userMod:
      return "User moderation";
    case SITE.nostr.kinds.snapshotRequest:
      return "Snapshot request";
    case SITE.nostr.kinds.entity:
      return "Entity update";
    case SITE.nostr.kinds.draft:
      return "Post update";
    case SITE.nostr.kinds.commentMod:
      return "Comment moderation";
    case SITE.nostr.kinds.submissionStatus:
      return "Submission status";
    case SITE.nostr.kinds.adminKeyShare:
      return "Site key share";
    case SITE.nostr.kinds.siteKey:
      return "Site key rotation";
    default:
      return `Event ${event.kind}`;
  }
}

function logTarget(event) {
  const slug = firstTag(event, "d");
  switch (Number(event.kind)) {
    case SITE.nostr.kinds.snapshot:
    case SITE.nostr.kinds.snapshotRequest:
      return { href: "./admin.html?tab=dashboard", description: slug || shortKey(event.pubkey) };
    case SITE.nostr.kinds.adminClaim:
    case SITE.nostr.kinds.adminRole:
    case SITE.nostr.kinds.userMod:
    case SITE.nostr.kinds.adminKeyShare:
    case SITE.nostr.kinds.siteKey:
      return { href: "./admin.html?tab=users", description: shortKey(event.pubkey) };
    case SITE.nostr.kinds.entity:
      return { href: "./admin.html?tab=entities", description: slug || shortKey(event.pubkey) };
    case SITE.nostr.kinds.draft:
      return { href: "./admin.html?tab=review", description: slug || shortKey(event.pubkey) };
    case SITE.nostr.kinds.commentMod:
      return { href: "./admin.html?tab=comments", description: firstTag(event, "e") || shortKey(event.pubkey) };
    case SITE.nostr.kinds.submissionStatus:
      return { href: "./admin.html?tab=submissions", description: slug || shortKey(event.pubkey) };
    default:
      return { href: "./admin.html?tab=dashboard", description: shortKey(event.pubkey) };
  }
}

function firstTag(event, key) {
  const hit = (event.tags || []).find((tag) => Array.isArray(tag) && tag[0] === key);
  return hit ? String(hit[1] || "") : "";
}

function activeSitePubkey() {
  return resolveSitePubkey(workspaceState.publicState);
}

function findSiteKeyShare(sitePubkey = "") {
  const targetPubkey = String(sitePubkey || "").trim().toLowerCase() || activeSitePubkey();
  return workspaceState.siteKeyShares.find((share) => share.sitePubkey === targetPubkey) || null;
}

function renderSiteKeyShareStatus() {
  if (workspaceState.siteKeyShare) {
    const olderCount = Math.max(0, workspaceState.siteKeyShares.length - 1);
    return olderCount
      ? `This account can read new private submissions and ${olderCount} older encrypted record${olderCount === 1 ? "" : "s"}.`
      : "This account can read new private submissions.";
  }
  if (currentUserPendingKeyRequest() || workspaceState.keyRequestState === "pending") {
    return "Checking shared inbox access. This usually updates on its own in a few seconds.";
  }
  if (workspaceState.siteKeyShares.length) {
    return "Waiting for the current shared inbox key.";
  }
  return "Waiting for shared inbox access.";
}

function applyLocalCommentModeration(commentId, action, note) {
  const publicState = workspaceState.publicState;
  if (!publicState || !Array.isArray(publicState.allComments)) return;
  const moderation = {
    action: action === "restore" ? "restore" : "hide",
    note: String(note || "").trim(),
    updated_at: Math.floor(Date.now() / 1000),
    by: workspaceState.viewer?.pubkey || ""
  };
  publicState.allComments = publicState.allComments.map((comment) =>
    comment.id === commentId
      ? {
          ...comment,
          visibility: moderation.action === "hide" ? "hidden" : "visible",
          moderation
        }
      : comment
  );
  publicState.comments = publicState.allComments.filter((comment) => comment.visibility !== "hidden");
  publicState.hiddenComments = publicState.allComments.filter((comment) => comment.visibility === "hidden");
  publicState.commentsByPost = regroupComments(publicState.comments, "post_slug");
  publicState.commentsByAuthor = regroupComments(publicState.comments, "author");
  if (publicState.metrics) {
    publicState.metrics.commentCount = publicState.comments.length;
    publicState.metrics.hiddenCommentCount = publicState.hiddenComments.length;
  }
  for (const user of publicState.users || []) {
    user.commentCount = (publicState.commentsByAuthor.get(user.pubkey) || []).length;
  }
}

function regroupComments(comments, key) {
  const buckets = new Map();
  for (const comment of Array.isArray(comments) ? comments : []) {
    const bucketKey = String(comment?.[key] || "").trim();
    if (!bucketKey) continue;
    const bucket = buckets.get(bucketKey) || [];
    bucket.push(comment);
    buckets.set(bucketKey, bucket);
  }
  return buckets;
}

async function rotateSiteInboxKey(excludedPubkeys = [], reason = "rotation") {
  if (!workspaceState.session || !currentUserIsAdmin()) {
    throw new Error("Only an active admin can rotate the shared inbox key.");
  }
  const nextSiteSecretKeyHex = await generateSecretKeyHex();
  const previousSitePubkey = activeSitePubkey();
  const sharedAt = new Date().toISOString();
  const recipients = dedupe(
    (workspaceState.publicState?.admins || []).filter(
      (pubkey) => !excludedPubkeys.includes(pubkey) && pubkey !== workspaceState.viewer?.pubkey
    )
  );
  await publishSiteKeyEvent(workspaceState.session.secretKeyHex, nextSiteSecretKeyHex, {
    previousSitePubkey,
    reason
  });
  for (const pubkey of recipients) {
    await publishAdminKeyShare(
      workspaceState.session.secretKeyHex,
      pubkey,
      nextSiteSecretKeyHex
    );
  }
  const currentShare = buildCachedSiteKeyShare(nextSiteSecretKeyHex, {
    senderPubkey: workspaceState.viewer?.pubkey || "",
    sharedAt
  });
  workspaceState.siteKeyShares = mergeSiteKeyShares([currentShare, ...workspaceState.siteKeyShares], []);
  workspaceState.siteKeyShare = currentShare;
  await persistCachedSiteKeyShares(workspaceState.siteKeyShares);
  workspaceState.keyRequestState = "";
  if (workspaceState.publicState?.siteInfo) {
    workspaceState.publicState.siteInfo = {
      ...workspaceState.publicState.siteInfo,
      activePubkey: currentShare.sitePubkey
    };
  }
}

async function maybeAutoRespondToKeyRequests() {
  if (!currentUserHasInboxAccess() || !workspaceState.session || !workspaceState.siteKeyShare) return;
  for (const request of workspaceState.publicState?.pendingAdminKeyRequests || []) {
    if (!request || request.requester_pubkey === workspaceState.viewer?.pubkey) continue;
    if (workspaceState.respondedKeyRequests.has(request.id)) continue;
    try {
      await publishAdminKeyShare(
        workspaceState.session.secretKeyHex,
        request.requester_pubkey,
        workspaceState.siteKeyShare.siteSecretKeyHex
      );
      workspaceState.respondedKeyRequests.add(request.id);
    } catch {
      continue;
    }
  }
}

async function maybeEnsureCurrentKeyRequest() {
  if (!workspaceState.session || !currentUserIsAdmin() || currentUserHasInboxAccess()) return;
  const sitePubkey = activeSitePubkey();
  if (!sitePubkey) return;

  const pendingRequest = currentUserPendingKeyRequest();
  if (!pendingRequest) {
    const recentlyRequested =
      workspaceState.keyRequestCache &&
      workspaceState.keyRequestCache.sitePubkey === sitePubkey &&
      Date.now() - workspaceState.keyRequestCache.requestedAt < 20000;
    if (!recentlyRequested) {
      await publishAdminKeyRequest(workspaceState.session.secretKeyHex, sitePubkey);
      workspaceState.keyRequestCache = {
        sitePubkey,
        requestedAt: Date.now()
      };
    }
  }

  workspaceState.keyRequestState = "pending";
  workspaceState.keyRequestTimer = window.setTimeout(() => {
    void syncWorkspaceState(true);
  }, 3200);
}

function shouldSoftRefreshWorkspace() {
  if (workspaceState.entityModal || workspaceState.chatModal) return false;
  const active = document.activeElement;
  return !(
    active instanceof HTMLElement &&
    active.closest("[data-workspace-shell]") &&
    active.matches("input, textarea, select, [contenteditable='true']")
  );
}

async function loadStaticSlugs() {
  const response = await fetch("./content/blog/index.json");
  if (!response.ok) return [];
  const data = await response.json();
  return (Array.isArray(data.files) ? data.files : []).map((file) => cleanSlug(String(file).replace(/\.md$/i, "")));
}

function siteKeyShareCacheKey(pubkey = workspaceState.viewer?.pubkey || "") {
  return `workspaceSiteKeyShares:${String(pubkey || "").trim().toLowerCase()}`;
}

async function loadCachedSiteKeyShares() {
  if (!workspaceState.viewer?.pubkey) return [];
  try {
    const runtimeClient = await getSiteRuntimeClient();
    const parsed = await runtimeClient.getProjection("workspaceSiteKeys", {
      viewerPubkey: String(workspaceState.viewer.pubkey || "").trim().toLowerCase()
    }, {
      reason: "workspace-site-key-cache-load",
      preferFresh: false
    }).then((projection) => projection?.value?.siteKeyShares || []);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => buildCachedSiteKeyShare(entry?.siteSecretKeyHex || entry?.site_secret_key_hex || "", entry || {}))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function persistCachedSiteKeyShares(shares) {
  if (!workspaceState.viewer?.pubkey) return;
  const serialized = mergeSiteKeyShares(shares, []).map((share) => ({
    siteSecretKeyHex: share.siteSecretKeyHex,
    sitePubkey: share.sitePubkey,
    senderPubkey: share.senderPubkey || "",
    sharedAt: share.sharedAt || ""
  }));
  const runtimeClient = await getSiteRuntimeClient().catch(() => null);
  if (!runtimeClient) return;
  await runtimeClient.rememberProjection("workspaceSiteKeys", {
    viewerPubkey: String(workspaceState.viewer.pubkey || "").trim().toLowerCase()
  }, {
    siteKeyShares: serialized
  }, {
    source: "workspace-site-key-cache"
  }).catch(() => null);
}

function mergeSiteKeyShares(primary, secondary) {
  const merged = new Map();
  for (const share of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const normalized = normalizeCachedSiteKeyShare(share);
    if (!normalized || merged.has(normalized.sitePubkey)) continue;
    merged.set(normalized.sitePubkey, normalized);
  }
  return [...merged.values()];
}

function normalizeCachedSiteKeyShare(share) {
  if (!share) return null;
  if (typeof share === "string") return buildCachedSiteKeyShare(share);
  return buildCachedSiteKeyShare(share.siteSecretKeyHex || share.site_secret_key_hex || "", share);
}

function buildCachedSiteKeyShare(siteSecretKeyHex, meta = {}) {
  const clean = String(siteSecretKeyHex || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) return null;
  let identity;
  try {
    identity = deriveIdentity(clean);
  } catch {
    return null;
  }
  return {
    siteSecretKeyHex: clean,
    sitePubkey: identity.pubkey,
    senderPubkey: String(meta.senderPubkey || meta.sender_pubkey || meta.shared_by || "").trim().toLowerCase(),
    sharedAt: String(meta.sharedAt || meta.shared_at || "").trim(),
    event: meta.event || null
  };
}

function findSiteKeyShareInList(shares, sitePubkey = "") {
  const targetSitePubkey = String(sitePubkey || "").trim().toLowerCase();
  if (!targetSitePubkey) return (Array.isArray(shares) ? shares : [])[0] || null;
  return (Array.isArray(shares) ? shares : []).find((share) => share.sitePubkey === targetSitePubkey) || null;
}

function resolveDirectUserPubkey() {
  return workspaceState.userLookupResult?.pubkey || normalizeDirectPubkey(workspaceState.userLookupQuery);
}

function normalizeDirectPubkey(value) {
  const clean = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(clean) ? clean : "";
}

function findLocalUserCandidate(value) {
  const raw = String(value || "").trim();
  const username = normalizeUsername(raw);
  const pubkey = normalizeDirectPubkey(raw);
  const lowered = raw.toLowerCase();
  const match = (workspaceState.publicState?.users || []).find((user) =>
    (pubkey && user.pubkey === pubkey) ||
    (username && normalizeUsername(user.username) === username) ||
    lowered === String(user.displayName || "").trim().toLowerCase()
  );
  return match ? hydrateLookupCandidate(match) : null;
}

function hydrateLookupCandidate(user) {
  const current = (workspaceState.publicState?.users || []).find((item) => item.pubkey === user.pubkey) || {};
  return {
    ...current,
    ...user,
    displayName: user.displayName || current.displayName || user.username || shortKey(user.pubkey),
    username: user.username || current.username || "",
    isAdmin: workspaceState.publicState?.admins?.includes(user.pubkey) || current.isAdmin || false
  };
}

function parseMaybeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function triggerBrowserDownload(file) {
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name || "download.bin";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
