export function createWorkspacePageController({
  state,
  deps = {},
  callbacks = {}
} = {}) {
  const runtime = {
    document: globalThis.document,
    window: globalThis.window,
    getStoredSession: () => null,
    sessionChangedEvent: "nostrsite:session-changed",
    ...deps
  };
  const hooks = {
    applyEntityPick: () => {},
    applyLocationPick: () => {},
    createEntityModalState: () => null,
    handleAttachmentDownload: async () => {},
    handleChatSend: async () => {},
    handleCommentAction: async () => {},
    handleDirectUserAction: async () => {},
    handleDirectUserLookup: async () => {},
    handleEntityAction: async () => {},
    handleEntitySave: async () => {},
    handleLogin: async () => {},
    handleProfileSave: async () => {},
    handleReviewAction: async () => {},
    handleSnapshotRequest: async () => {},
    handleSubmissionAction: async () => {},
    handleUserAction: async () => {},
    hydrateChatModal: async () => {},
    hydrateWorkspaceEnhancements: () => {},
    refreshWorkspace: async () => {},
    renderWorkspace: () => {},
    setActiveTab: () => {},
    syncWorkspace: async () => {},
    ...callbacks
  };

  let started = false;

  function start() {
    if (started) return false;
    if (!runtime.document?.querySelector?.("[data-workspace-page]")) return false;
    bindWorkspace();
    runtime.window?.addEventListener?.(runtime.sessionChangedEvent, handleSessionChanged);
    runtime.document?.addEventListener?.("visibilitychange", handleVisibilityChange);
    runtime.window?.addEventListener?.("focus", handleWindowFocus);
    started = true;
    void hooks.refreshWorkspace();
    return true;
  }

  async function handleSessionChanged() {
    state.session = runtime.getStoredSession();
    state.viewer = null;
    await hooks.refreshWorkspace(true);
  }

  function handleVisibilityChange() {
    if (runtime.document?.visibilityState === "visible") {
      void hooks.syncWorkspace(true);
    }
  }

  function handleWindowFocus() {
    void hooks.syncWorkspace(true);
  }

  function bindWorkspace() {
    const shell = runtime.document?.querySelector?.("[data-workspace-shell]");
    if (!shell?.addEventListener) return;

    shell.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const tab = target.closest("[data-workspace-tab]");
      if (tab) {
        hooks.setActiveTab(tab.getAttribute("data-workspace-tab") || "profile");
        hooks.renderWorkspace();
        return;
      }

      const openEntityModal = target.closest("[data-open-entity-modal]");
      if (openEntityModal) {
        state.entityModal = hooks.createEntityModalState(openEntityModal);
        hooks.renderWorkspace();
        return;
      }

      const moderationButton = target.closest("[data-user-action]");
      if (moderationButton) {
        await hooks.handleUserAction(moderationButton);
        return;
      }

      const directUserAction = target.closest("[data-quick-user-action]");
      if (directUserAction) {
        await hooks.handleDirectUserAction(directUserAction);
        return;
      }

      const findUserAction = target.closest("[data-find-user]");
      if (findUserAction) {
        await hooks.handleDirectUserLookup();
        return;
      }

      const entityAction = target.closest("[data-entity-action]");
      if (entityAction) {
        await hooks.handleEntityAction(entityAction);
        return;
      }

      const commentAction = target.closest("[data-comment-action]");
      if (commentAction) {
        await hooks.handleCommentAction(commentAction);
        return;
      }

      const reviewAction = target.closest("[data-review-action]");
      if (reviewAction) {
        await hooks.handleReviewAction(reviewAction);
        return;
      }

      const entityPick = target.closest("[data-entity-pick]");
      if (entityPick) {
        hooks.applyEntityPick(entityPick);
        return;
      }

      const locationPick = target.closest("[data-location-pick]");
      if (locationPick) {
        hooks.applyLocationPick(locationPick);
        return;
      }

      const submissionAction = target.closest("[data-submission-action]");
      if (submissionAction) {
        await hooks.handleSubmissionAction(submissionAction);
        return;
      }

      const attachmentAction = target.closest("[data-download-attachment]");
      if (attachmentAction) {
        await hooks.handleAttachmentDownload(attachmentAction);
        return;
      }

      const snapshotRequest = target.closest("[data-request-snapshot]");
      if (snapshotRequest) {
        await hooks.handleSnapshotRequest(snapshotRequest);
        return;
      }

      const openChat = target.closest("[data-open-chat]");
      if (openChat) {
        state.chatModal = {
          submissionId: openChat.getAttribute("data-open-chat") || "",
          targetPubkey: openChat.getAttribute("data-chat-target") || "",
          loading: true,
          messages: []
        };
        hooks.renderWorkspace();
        await hooks.hydrateChatModal();
        return;
      }

      if (target.closest("[data-modal-close]")) {
        state.entityModal = null;
        state.chatModal = null;
        hooks.renderWorkspace();
      }
    });

    shell.addEventListener("submit", async (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();

      if (form.matches("[data-login-form]")) {
        await hooks.handleLogin(form);
        return;
      }
      if (form.matches("[data-profile-form]")) {
        await hooks.handleProfileSave(form);
        return;
      }
      if (form.matches("[data-entity-form]")) {
        await hooks.handleEntitySave(form);
        return;
      }
      if (form.matches("[data-chat-form]")) {
        await hooks.handleChatSend(form);
      }
    });

    shell.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.matches("[data-entity-picker-input], [data-location-input]")) {
        hooks.hydrateWorkspaceEnhancements();
      }
    });
  }

  return {
    handleSessionChanged,
    handleVisibilityChange,
    handleWindowFocus,
    start
  };
}

export default createWorkspacePageController;
