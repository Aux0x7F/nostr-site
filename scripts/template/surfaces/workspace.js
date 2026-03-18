export function renderWorkspaceView({ workspaceState, deps = {} } = {}) {
  const currentUserIsAdmin = deps.currentUserIsAdmin || (() => false);
  const hasSession = Boolean(workspaceState?.session);
  const title = !workspaceState?.session
    ? "Log in"
    : currentUserIsAdmin()
      ? "Workspace"
      : "Profile options";
  const lede = !workspaceState?.session
    ? "Use the same username and password each time to return to this account."
    : currentUserIsAdmin()
      ? "Manage users, submissions, entities, and post review."
      : "Update your profile and review your comments.";
  const tabsMarkup = (deps.tabButtons ? deps.tabButtons() : [])
    .map((tab) => deps.renderTabButton(tab))
    .join("");
  const paneMarkup = hasSession ? renderActivePane(workspaceState, deps) : renderLoginPane();
  const overlayMarkup = `${deps.renderEntityModal?.() || ""}${deps.renderChatModal?.() || ""}`;
  return { title, lede, tabsMarkup, paneMarkup, overlayMarkup };
}

function renderActivePane(workspaceState, deps) {
  switch (workspaceState.activeTab) {
    case "dashboard":
      return renderDashboardPane(workspaceState, deps);
    case "users":
      return renderUsersPane(workspaceState, deps);
    case "submissions":
      return renderSubmissionsPane(workspaceState, deps);
    case "entities":
      return renderEntitiesPane(workspaceState, deps);
    case "review":
      return renderReviewPane(workspaceState, deps);
    case "log":
      return deps.renderLogPane();
    case "comments":
      return renderCommentsPane(workspaceState, deps);
    case "profile":
    default:
      return renderProfilePane(workspaceState, deps);
  }
}

function renderLoginPane() {
  return `
    <section class="surface-panel workspace-auth">
      <form class="tip-form" data-login-form>
        <label>
          <span>Username</span>
          <input name="username" type="text" maxlength="40" placeholder="username" required>
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" maxlength="120" placeholder="••••••••" required>
        </label>
        <div class="button-row">
          <button class="button" type="submit" data-login-submit>Create/Login</button>
        </div>
        <div class="status-box" data-workspace-status>This site uses your username and password to reopen the same account.</div>
      </form>
    </section>
  `;
}

function renderDashboardPane(workspaceState, deps) {
  const metrics = workspaceState.publicState?.metrics || {};
  const locationCount = new Set(
    (workspaceState.publicState?.approvedEntities || []).map((entity) => entity.location).filter(Boolean)
  ).size;
  const snapshot = workspaceState.publicState?.snapshotInfo || null;
  return `
    <div class="workspace-grid">
      <section class="metric-grid">
        <article class="metric-card"><strong>${metrics.visitorCount24h || 0}</strong><p>Visitors (24h)</p></article>
        <article class="metric-card"><strong>${metrics.visitorCount7d || 0}</strong><p>Visitors (7d)</p></article>
        <article class="metric-card"><strong>${metrics.userCount || 0}</strong><p>Known users</p></article>
        <article class="metric-card"><strong>${metrics.submissionCount || 0}</strong><p>Submission threads</p></article>
        <article class="metric-card"><strong>${locationCount}</strong><p>Tracked locations</p></article>
        <article class="metric-card"><strong>${metrics.approvedEntityCount || 0}</strong><p>Approved entities</p></article>
        <article class="metric-card"><strong>${metrics.commentCount || 0}</strong><p>Visible comments</p></article>
        <article class="metric-card"><strong>${metrics.visitEventCount7d || 0}</strong><p>Visit pulses (7d)</p></article>
      </section>
      <section class="surface-panel">
        <div class="eyebrow">Snapshot</div>
        <h2>Static snapshot</h2>
        <p class="muted-text">Create a static snapshot of approved entities and posts. If GitHub is connected, this can also open or update a review PR.</p>
        <div class="button-row">
          <button class="button" type="button" data-request-snapshot>Create snapshot</button>
        </div>
        <div class="status-box">${deps.escapeHtml(workspaceState.dashboardStatus || "No snapshot request sent yet.")}</div>
        ${deps.renderSnapshotSummary(snapshot)}
      </section>
    </div>
  `;
}

function renderProfilePane(workspaceState, deps) {
  const current = deps.currentUser();
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return `
    <div class="workspace-grid">
      <section class="surface-panel">
        <div class="eyebrow">Profile</div>
        <h2>Profile settings</h2>
        <form class="tip-form" data-profile-form>
          <label>
            <span>Display name</span>
            <input name="displayName" type="text" maxlength="80" value="${escapeAttribute(current?.displayName || "")}">
          </label>
          <label>
            <span>Bio</span>
            <textarea name="bio" placeholder="Short bio">${escapeHtml(current?.bio || "")}</textarea>
          </label>
          <label>
            <span>Avatar</span>
            <input name="avatarFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif">
          </label>
          <label>
            <span>Social links</span>
            <textarea name="socialLinks" placeholder="One URL per line">${escapeHtml((current?.socialLinks || []).join("\n"))}</textarea>
          </label>
          <div class="button-row">
            <button class="button" type="submit">Save profile</button>
          </div>
          <div class="status-box" data-workspace-status>Save changes to update your public profile.</div>
        </form>
      </section>
    </div>
  `;
}

function renderUsersPane(workspaceState, deps) {
  return `
    <div class="workspace-grid">
      <section class="surface-panel">
        <div class="eyebrow">Find user</div>
        <h2>Lookup by username or pubkey</h2>
        <p class="muted-text">Use a username when the roster is behind. If you already have the pubkey, you can act on it directly.</p>
        <label>
          <span>Username or pubkey</span>
          <input data-quick-user-input type="text" maxlength="80" placeholder="aux or 64-character pubkey" value="${deps.escapeAttribute(workspaceState.userLookupQuery || "")}">
        </label>
        <div class="button-row button-row--tight">
          <button class="button-ghost" type="button" data-find-user>Find user</button>
          <button class="button-ghost" type="button" data-quick-user-action="admin" data-mode="grant">Make admin</button>
          ${
            workspaceState.siteKeyShare
              ? `<button class="button-ghost" type="button" data-quick-user-action="share-site-key">Share current key</button>`
              : ""
          }
        </div>
        <div class="status-box">${deps.escapeHtml(workspaceState.userDirectStatus || "Find a user first, or paste a pubkey to act directly.")}</div>
        ${deps.renderLookupCandidate()}
      </section>
      <section class="surface-panel">
        <div class="eyebrow">User Management</div>
        <h2>Shared roster</h2>
        <div class="roster-list">
          ${
            (workspaceState.publicState?.users || [])
              .map((user) => deps.renderUserCard(user))
              .join("") || `<div class="empty-state">No users visible yet.</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderSubmissionsPane(workspaceState, deps) {
  if (deps.currentUserHasInboxAccess()) {
    return `
      <section class="surface-panel">
        <div class="eyebrow">Encrypted submissions</div>
        <h2>Shared inbox</h2>
        <div class="roster-list">
          ${
            workspaceState.inboxSubmissions.length
              ? workspaceState.inboxSubmissions.map((item) => deps.renderSubmissionCard(item)).join("")
              : `<div class="empty-state">No submissions decrypted from the inbox yet.</div>`
          }
        </div>
      </section>
    `;
  }

  return `
    <section class="surface-panel">
      <div class="eyebrow">Submission intake</div>
      <h2>Metadata view</h2>
      <p class="muted-text">${
        deps.currentUserPendingKeyRequest() || workspaceState.keyRequestState === "pending"
          ? "Waiting for the current shared inbox key. Public status updates still work while that access catches up."
          : "This account can manage public status updates while shared inbox access is still catching up."
      }</p>
      <div class="roster-list">
        ${
          (workspaceState.publicState?.users || [])
            .filter((user) => user.submissionCount > 0)
            .map(
              (user) => `
                <article class="roster-item">
                  <strong>${deps.escapeHtml(user.displayName)}</strong>
                  <span>${user.submissionCount} submission threads</span>
                  <span class="mono">${deps.escapeHtml(user.pubkey)}</span>
                </article>
              `
            )
            .join("") || `<div class="empty-state">No submission metadata visible yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderEntitiesPane(workspaceState, deps) {
  return `
    <section class="surface-panel">
      <div class="workspace-list__row">
        <div>
          <div class="eyebrow">Entities</div>
          <h2>Locations and targets</h2>
        </div>
        <button class="button" type="button" data-open-entity-modal>Add entity</button>
      </div>
      <div class="roster-list">
        ${
          (workspaceState.publicState?.entities || [])
            .map(
              (entity) => `
                <article class="roster-item">
                  <div class="workspace-list__row">
                    <div>
                      <strong>${deps.escapeHtml(entity.name)}</strong>
                      <span>${deps.escapeHtml(entity.location)} • ${deps.escapeHtml(entity.type)}</span>
                    </div>
                    <div class="tag-row">
                      <span class="tag">${deps.escapeHtml(entity.status)}</span>
                    </div>
                  </div>
                  <span>${deps.escapeHtml(entity.notes || "No public note yet.")}</span>
                  ${
                    deps.currentUserIsAdmin()
                      ? `
                        <div class="button-row button-row--tight">
                          <button class="button-ghost" type="button" data-entity-action="approve" data-entity-slug="${entity.slug}">Approve</button>
                          <button class="button-ghost" type="button" data-entity-action="deny" data-entity-slug="${entity.slug}">Deny</button>
                        </div>
                      `
                      : ""
                  }
                </article>
              `
            )
            .join("") || `<div class="empty-state">No entities published yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderReviewPane(workspaceState, deps) {
  const drafts = (workspaceState.publicState?.drafts || []).slice();
  const pending = drafts.filter((draft) => ["candidate", "submitted", "review"].includes(String(draft.status || "").toLowerCase()));
  const recentlyDecided = drafts
    .filter((draft) => ["approved", "revision", "denied"].includes(String(draft.status || "").toLowerCase()))
    .slice(0, 10);
  return `
    <div class="review-stack">
      <section class="surface-panel">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Post Review</div>
            <h2>Ready for review</h2>
          </div>
          <div class="tag-row">
            <span class="tag">${pending.length} waiting</span>
          </div>
        </div>
        <p class="muted-text">Writers use the editor to save working drafts and send finished versions here for review. Approving keeps the post in the next bakedown queue.</p>
        <div class="roster-list">
          ${
            pending.length
              ? pending.map((draft) => deps.renderReviewCard(draft)).join("")
              : `<div class="empty-state">No posts are waiting for review.</div>`
          }
        </div>
      </section>
      <section class="surface-panel">
        <div class="eyebrow">Recent decisions</div>
        <h2>Reviewed posts</h2>
        <div class="roster-list">
          ${
            recentlyDecided.length
              ? recentlyDecided.map((draft) => deps.renderReviewedCard(draft)).join("")
              : `<div class="empty-state">Approved, denied, and revision requests will appear here.</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderCommentsPane(workspaceState, deps) {
  const ownComments = workspaceState.publicState?.commentsByAuthor.get(workspaceState.viewer?.pubkey || "") || [];
  if (deps.currentUserIsAdmin()) {
    const allComments = (workspaceState.publicState?.allComments || []).slice().reverse();
    const hiddenCount = workspaceState.publicState?.hiddenComments?.length || 0;
    return `
      <section class="surface-panel">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Comments</div>
            <h2>Review comments</h2>
          </div>
          <div class="tag-row">
            <span class="tag">${allComments.length - hiddenCount} shown</span>
            <span class="tag">${hiddenCount} hidden</span>
          </div>
        </div>
        <div class="roster-list">
          ${
            allComments.length
              ? allComments.map((comment) => deps.renderModerationComment(comment)).join("")
              : `<div class="empty-state">No comments yet.</div>`
          }
        </div>
      </section>
    `;
  }
  return `
    <section class="surface-panel">
      <div class="eyebrow">Comments</div>
      <h2>Your comments</h2>
      <div class="roster-list">
        ${
          ownComments.length
            ? ownComments
                .slice()
                .reverse()
                .map(
                  (comment) => `
                    <article class="roster-item">
                      <strong>${deps.escapeHtml(comment.post_slug)}</strong>
                      <span>${deps.escapeHtml(deps.trimmed(comment.markdown, 220))}</span>
                    </article>
                  `
                )
                .join("")
            : `<div class="empty-state">No comments yet.</div>`
        }
      </div>
    </section>
  `;
}
