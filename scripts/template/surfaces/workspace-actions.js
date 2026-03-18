export function renderUserCard(user, workspaceState, deps = {}) {
  const isRootAdmin = user.pubkey === workspaceState.publicState?.rootAdminPubkey;
  const canChangeAdmin = deps.currentUserIsAdmin() && !isRootAdmin && user.pubkey !== workspaceState.viewer?.pubkey;
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(user.displayName)}</strong>
          <span>${user.username ? `@${escapeHtml(user.username)}` : deps.shortKey(user.pubkey)}</span>
        </div>
        <div class="tag-row">
          ${user.isAdmin ? `<span class="tag">admin</span>` : ""}
          ${user.moderation ? `<span class="tag">${escapeHtml(user.moderation.action)}</span>` : ""}
        </div>
      </div>
      <span>${user.submissionCount} submissions • ${user.commentCount} comments</span>
      <span class="mono">${user.pubkey}</span>
      ${
        deps.currentUserIsAdmin()
          ? `
            <div class="button-row button-row--tight">
              ${
                canChangeAdmin
                  ? `<button class="button-ghost" type="button" data-user-action="admin" data-target-pubkey="${user.pubkey}" ${user.isAdmin ? 'data-mode="revoke"' : 'data-mode="grant"'}>${user.isAdmin ? "Remove admin" : "Make admin"}</button>`
                  : isRootAdmin
                    ? `<span class="tag">root admin</span>`
                    : ""
              }
              ${
                user.isAdmin && user.pubkey !== workspaceState.viewer?.pubkey && workspaceState.siteKeyShare
                  ? `<button class="button-ghost" type="button" data-user-action="share-site-key" data-target-pubkey="${user.pubkey}">Share site key</button>`
                  : ""
              }
              <button class="button-ghost" type="button" data-user-action="mod" data-target-pubkey="${user.pubkey}" data-mode="temp-ban">Temp ban</button>
              <button class="button-ghost" type="button" data-user-action="mod" data-target-pubkey="${user.pubkey}" data-mode="full-ban">Full ban</button>
              <button class="button-ghost" type="button" data-user-action="mod" data-target-pubkey="${user.pubkey}" data-mode="clear">Clear</button>
            </div>
          `
          : ""
      }
    </article>
  `;
}

export function renderLookupCandidate(workspaceState, deps = {}) {
  const user = workspaceState.userLookupResult;
  if (!user) return "";
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(user.displayName || user.username || deps.shortKey(user.pubkey))}</strong>
          <span>${user.username ? `@${escapeHtml(user.username)}` : deps.shortKey(user.pubkey)}</span>
        </div>
        <div class="tag-row">
          ${user.isAdmin ? `<span class="tag">admin</span>` : `<span class="tag">member</span>`}
        </div>
      </div>
      <span class="mono">${escapeHtml(user.pubkey)}</span>
    </article>
  `;
}

export function renderSubmissionCard(item, workspaceState, deps = {}) {
  const latest = item.latest?.payload || {};
  const status = workspaceState.publicState?.submissionStatuses.get(item.id)?.status || "received";
  const entityRefs = Array.isArray(latest.entity_refs) ? latest.entity_refs : [];
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(latest.subject || "Untitled submission")}</strong>
          <span>${escapeHtml(latest.location || "No location supplied")}</span>
        </div>
        <div class="tag-row">
          <span class="tag">${escapeHtml(status)}</span>
        </div>
      </div>
      <span>${escapeHtml(deps.trimmed(latest.details || "", 180))}</span>
      ${
        entityRefs.length
          ? `<span class="muted-text">Entities: ${escapeHtml(entityRefs.map(deps.resolveEntityDisplayValue).join(", "))}</span>`
          : ""
      }
      ${
        latest.suggested_entity?.name
          ? `<span class="muted-text">Suggested entity: ${escapeHtml(latest.suggested_entity.name)}${latest.suggested_entity.location ? ` • ${escapeHtml(latest.suggested_entity.location)}` : ""}</span>`
          : ""
      }
      <span class="mono">${item.author}</span>
      <div class="button-row button-row--tight">
        <button class="button-ghost" type="button" data-submission-action="status" data-submission-id="${item.id}" data-author-pubkey="${item.author}" data-status="approved">Approve</button>
        <button class="button-ghost" type="button" data-submission-action="status" data-submission-id="${item.id}" data-author-pubkey="${item.author}" data-status="rejected">Reject</button>
        ${latest.attachment?.url ? `<button class="button-ghost" type="button" data-download-attachment="${item.id}">Attachment</button>` : ""}
        <button class="button-ghost" type="button" data-open-chat="${item.id}" data-chat-target="${item.author}">Chat</button>
      </div>
    </article>
  `;
}

export function renderModerationComment(comment, workspaceState, deps = {}) {
  const author = (workspaceState.publicState?.users || []).find((user) => user.pubkey === comment.author);
  const authorLabel = author?.displayName || author?.username || deps.shortKey(comment.author);
  const moderation = comment.moderation || null;
  const action = comment.visibility === "hidden" ? "restore" : "hide";
  const actionLabel = action === "restore" ? "Restore" : "Hide";
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(authorLabel)}</strong>
          <span>${escapeHtml(comment.post_slug)} • ${escapeHtml(new Date(comment.created_at * 1000).toLocaleString())}</span>
        </div>
        <div class="tag-row">
          <span class="tag">${escapeHtml(comment.visibility)}</span>
        </div>
      </div>
      <span>${escapeHtml(deps.trimmed(comment.markdown, 260))}</span>
      ${
        moderation?.note
          ? `<span class="muted-text">Moderation note: ${escapeHtml(moderation.note)}</span>`
          : ""
      }
      <label class="comment-note-field">
        <span>Moderation note</span>
        <textarea data-comment-note="${escapeAttribute(comment.id)}" placeholder="Optional note for hide or restore">${escapeHtml(moderation?.note || "")}</textarea>
      </label>
      <div class="button-row button-row--tight">
        <a class="text-link" href="./post.html?slug=${encodeURIComponent(comment.post_slug)}">Open post</a>
        <button class="button-ghost" type="button" data-comment-action="${action}" data-comment-id="${escapeAttribute(comment.id)}">${actionLabel}</button>
      </div>
    </article>
  `;
}

export function renderEntityModal(workspaceState, deps = {}) {
  if (!workspaceState.entityModal) return "";
  const draft = workspaceState.entityModal || {};
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <div class="modal-backdrop">
      <section class="modal-card">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Entity</div>
            <h2>Add entity</h2>
          </div>
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        </div>
        <form class="tip-form" data-entity-form>
          <label>
            <span>Name</span>
            <input name="name" type="text" maxlength="140" value="${escapeAttribute(draft.seedName || "")}" required>
          </label>
          <div class="tip-form__split">
            <label>
              <span>Location</span>
              <input name="location" type="text" maxlength="160" placeholder="City, state" value="${escapeAttribute(draft.seedLocation || "")}" data-location-input required>
            </label>
            <label>
              <span>Type</span>
              <input name="type" type="text" maxlength="80" placeholder="factory farm, store, headquarters" value="${escapeAttribute(draft.seedType || "")}">
            </label>
          </div>
          <div class="picker-results" data-location-results></div>
          <div class="tip-form__split">
            <label>
              <span>Latitude</span>
              <input name="lat" type="number" step="0.0001" value="${escapeAttribute(draft.seedLat ?? "")}">
            </label>
            <label>
              <span>Longitude</span>
              <input name="lng" type="number" step="0.0001" value="${escapeAttribute(draft.seedLng ?? "")}">
            </label>
          </div>
          <label>
            <span>Notes</span>
            <textarea name="notes" placeholder="Short note for the map and index">${escapeHtml(draft.seedNotes || "")}</textarea>
          </label>
          <div class="button-row">
            <button class="button" type="submit">Publish entity</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

export function renderChatModal(workspaceState, deps = {}) {
  if (!workspaceState.chatModal) return "";
  const submission = workspaceState.inboxSubmissions.find((item) => item.id === workspaceState.chatModal.submissionId);
  const messages = workspaceState.chatModal.messages || [];
  const loading = workspaceState.chatModal.loading;
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <div class="modal-backdrop">
      <section class="modal-card modal-card--wide">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Submission chat</div>
            <h2>${escapeHtml(submission?.latest?.payload?.subject || workspaceState.chatModal.submissionId)}</h2>
          </div>
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        </div>
        <div class="chat-thread">
          ${
            loading
              ? deps.renderLoadingState("Looking up chat...")
              : messages.length
                ? messages
                    .map(
                      (message) => `
                        <article class="chat-message ${message.author === workspaceState.viewer?.pubkey ? "is-self" : ""}">
                          <strong>${message.author === workspaceState.viewer?.pubkey ? "You" : deps.shortKey(message.author)}</strong>
                          <p>${escapeHtml(message.payload.body || "")}</p>
                        </article>
                      `
                    )
                    .join("")
                : `<div class="empty-state">No messages yet.</div>`
          }
        </div>
        <form class="tip-form" data-chat-form>
          <input name="submissionId" type="hidden" value="${escapeAttribute(workspaceState.chatModal.submissionId)}">
          <input name="targetPubkey" type="hidden" value="${escapeAttribute(workspaceState.chatModal.targetPubkey)}">
          <label>
            <span>Reply</span>
            <textarea name="body" placeholder="Write a reply" required></textarea>
          </label>
          <div class="button-row">
            <button class="button" type="submit">Send message</button>
          </div>
        </form>
      </section>
    </div>
  `;
}
