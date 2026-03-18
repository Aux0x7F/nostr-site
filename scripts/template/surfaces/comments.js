export function renderComment(comment, publicState, options = {}, deps = {}, depth = 0) {
  const author = publicState.users.find((user) => user.pubkey === comment.author);
  const authorLabel = author?.displayName || author?.username || "User";
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  const renderAvatarBadge = deps.renderAvatarBadge || (() => "");
  const formatDateTime = deps.formatDateTime || ((value) => String(value || ""));
  const renderMiniMarkdown = deps.renderMiniMarkdown || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return `
    <article class="comment-card ${depth ? "comment-card--reply" : ""}" id="comment-${escapeAttribute(comment.id)}" data-comment-id="${escapeAttribute(comment.id)}">
      <div class="comment-card__shell">
        ${renderAvatarBadge(author, authorLabel, "comment-card__avatar")}
        <div class="comment-card__main">
          <div class="comment-card__meta">
            <div>
              <strong>${escapeHtml(authorLabel)}</strong>
              <span>${formatDateTime(comment.created_at)}</span>
            </div>
          </div>
          <div class="comment-card__body">${renderMiniMarkdown(comment.markdown)}</div>
          <div class="comment-card__actions">
            ${options.canReply ? `<button type="button" class="button-ghost" data-reply-comment="${escapeAttribute(comment.id)}">Reply</button>` : ""}
            ${options.isAdmin ? `<button type="button" class="button-ghost" data-hide-comment="${escapeAttribute(comment.id)}">Hide</button>` : ""}
          </div>
          ${
            replies.length
              ? `<div class="comment-card__children">${replies.map((reply) => renderComment(reply, publicState, options, deps, depth + 1)).join("")}</div>`
              : ""
          }
        </div>
      </div>
    </article>
  `;
}

export function renderCommentCountLabel(count) {
  return `${count} visible comment${count === 1 ? "" : "s"}`;
}
