import { buildEntityUsage } from "../../core/posts-store.js";
import { formatDateTime } from "../../core/formatting.js";
import { renderAvatarBadge } from "../../core/profile-markup.js";
import { escapeAttribute, escapeHtml } from "../../core/text-utils.js";
import { profileInitials } from "../surfaces/navigation.js";
import { renderComment, renderCommentCountLabel } from "../surfaces/comments.js";
import { buildBlogArchiveEntries, renderAuthoringLeadCard, renderPostCard } from "../surfaces/archive.js";

export function createContentPagesFeature({
  site,
  state,
  viewerController,
  postsStore,
  getPublicState,
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
  draftHelpers
} = {}) {
  function mountCards() {
    void initBlogCards();
    void initAuthoringEntry();
  }

  async function initBlogCards() {
    const homeGrid = document.querySelector("[data-home-posts]");
    const listGrid = document.querySelector("[data-blog-list]");
    if (!(homeGrid instanceof HTMLElement) && !(listGrid instanceof HTMLElement)) return;
    if (homeGrid instanceof HTMLElement) homeGrid.innerHTML = renderLoadingState("Looking up featured posts...");
    if (listGrid instanceof HTMLElement) listGrid.innerHTML = renderLoadingState("Looking up posts...");
    try {
      const posts = await postsStore.load();
      const publicState = await getPublicState();
      const canEdit = viewerController.canEdit(publicState);
      if (homeGrid instanceof HTMLElement) {
        const count = Number(homeGrid.getAttribute("data-count") || "2");
        homeGrid.innerHTML = posts.filter((post) => post.featured).slice(0, count).map((post) => renderPostCard(post, true)).join("");
      }
      if (listGrid instanceof HTMLElement) {
        const drafts = draftHelpers.list(publicState.drafts || []);
        const entries = buildBlogArchiveEntries(posts, drafts, {
          canEdit,
          draftReviewAction: draftHelpers.draftReviewAction,
          draftStatusLabel: draftHelpers.draftStatusLabel,
          normalizeDraftStatus: draftHelpers.normalizeDraftStatus,
          sortDateValue: draftHelpers.sortDateValue
        });
        listGrid.innerHTML = `${canEdit ? renderAuthoringLeadCard() : ""}${entries.map((entry) => renderPostCard(entry, false)).join("")}`;
      }
    } catch {
      renderError(homeGrid || listGrid, "Blog feed unavailable.");
    }
  }

  async function initAuthoringEntry() {
    const host = document.querySelector("[data-authoring-entry]");
    if (!(host instanceof HTMLElement)) return;
    const publicState = await getPublicState();
    host.innerHTML = viewerController.canEdit(publicState) ? `<a class="button" href="./editor.html">Create post</a>` : "";
  }

  async function initMarkdownArticles() {
    const article = document.querySelector("[data-markdown-article]");
    if (!(article instanceof HTMLElement)) return;
    article.innerHTML = renderLoadingState("Looking up article...");
    try {
      const source = article.getAttribute("data-markdown-src");
      if (!source) throw new Error("Markdown source missing.");
      const markdown = await fetchText(source);
      renderMarkdown(article, markdown);
      buildToc(article, document.querySelector("[data-article-toc]"));
      const publicState = await getPublicState();
      enrichArticleEntities(article, publicState);
    } catch {
      renderError(article, "This article could not be loaded.");
    }
  }

  async function renderComments(postSlug, publicState) {
    const panel = document.querySelector("[data-comment-panel]");
    if (!(panel instanceof HTMLElement)) return;
    const threadedComments = (publicState.commentThreadsByPost?.get(postSlug) || []).slice();
    const renderedCount = countRenderedCommentNodes(threadedComments);
    const isLoggedIn = Boolean(state.session);
    const isAdmin = Boolean(state.viewer && viewerController.trustedPubkeys(publicState).includes(state.viewer.pubkey));
    const currentUser = isLoggedIn && state.viewer ? publicState.users.find((user) => user.pubkey === state.viewer.pubkey) || null : null;
    const replyTarget = state.commentReply?.postSlug === postSlug ? publicState.commentIndex?.get(state.commentReply.commentId) || null : null;
    if (state.commentReply?.postSlug === postSlug && !replyTarget) state.commentReply = null;

    panel.innerHTML = `
      <div class="comment-panel__head"><div><div class="eyebrow">Discussion</div><h2>Comments</h2></div><p>${renderCommentCountLabel(renderedCount)}</p></div>
      ${
        isLoggedIn
          ? `<section class="comment-composer">${renderAvatarBadge(currentUser, state.session?.username || "You", "comment-composer__avatar", profileInitials)}<form class="comment-composer__form" data-comment-form><div class="comment-composer__head"><strong>${replyTarget ? "Write a reply" : "Add a comment"}</strong><span>${replyTarget ? "Your reply will appear under the selected comment." : "Keep it specific and tied to the post."}</span></div>${replyTarget ? `<div class="comment-composer__reply"><span>Replying to ${escapeHtml(commentAuthorLabel(replyTarget, publicState))}</span><button class="button-ghost" type="button" data-cancel-reply>Cancel</button></div>` : ""}<label class="sr-only" for="commentComposerInput">Comment</label><textarea id="commentComposerInput" class="comment-composer__input" name="markdown" placeholder="${replyTarget ? "Write a reply..." : "Write a comment..."}" required></textarea><div class="comment-composer__footer"><span class="muted-text">${replyTarget ? "Replying keeps the thread together." : "Comments show up with your profile."}</span><button class="button" type="submit">${replyTarget ? "Reply" : "Post comment"}</button></div><div class="status-box" data-comment-status aria-live="polite"></div></form></section>`
          : `<div class="empty-state">Log in to comment or reply.</div>`
      }
      ${
        threadedComments.length
          ? `<div class="comment-list">${threadedComments.map((comment) => renderComment(comment, publicState, { isAdmin, canReply: isLoggedIn }, { escapeAttribute, escapeHtml, formatDateTime, renderAvatarBadge: (user, fallbackLabel, className) => renderAvatarBadge(user, fallbackLabel, className, profileInitials), renderMiniMarkdown })).join("")}</div>`
          : isLoggedIn
            ? `<div class="comment-list"><div class="empty-state">No comments yet. Start the discussion.</div></div>`
            : ""
      }
    `;

    const form = panel.querySelector("[data-comment-form]");
    if (form instanceof HTMLFormElement) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = panel.querySelector("[data-comment-status]");
        const textarea = form.elements.namedItem("markdown");
        const submitButton = form.querySelector('button[type="submit"]');
        const markdown = String(textarea?.value || "").trim();
        if (!markdown) return;
        const activeReply = state.commentReply?.postSlug === postSlug ? publicState.commentIndex?.get(state.commentReply.commentId) || null : null;
        const parentId = activeReply?.id || "";
        const rootId = activeReply ? String(activeReply.root_id || activeReply.parent_id || activeReply.id || "").trim() : "";
        try {
          const viewer = await viewerController.get();
          if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
          if (status instanceof HTMLElement) {
            status.textContent = activeReply ? "Posting reply..." : "Posting comment...";
            status.dataset.state = "pending";
          }
          await publishTaggedJson({
            kind: site.nostr.kinds.comment,
            secretKeyHex: state.session.secretKeyHex,
            tags: [["a", postSlug], ...(parentId ? [["e", parentId], ["parent", parentId]] : []), ...(rootId ? [["root", rootId]] : [])],
            content: { post_slug: postSlug, markdown, parent_id: parentId, root_id: rootId }
          });
          form.reset();
          state.commentReply = null;
          panel.innerHTML = renderLoadingState("Looking up discussion...");
          state.publicState = (await getPublicState(true));
          state.viewer = viewer;
          await renderComments(postSlug, state.publicState);
        } catch (error) {
          if (status instanceof HTMLElement) {
            status.textContent = String(error?.message || error || "Comment failed.");
            status.dataset.state = "error";
          }
        } finally {
          if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
        }
      });
    }

    for (const replyButton of panel.querySelectorAll("[data-reply-comment]")) {
      replyButton.addEventListener("click", async () => {
        state.commentReply = { postSlug, commentId: replyButton.getAttribute("data-reply-comment") || "" };
        await renderComments(postSlug, publicState);
        const input = panel.querySelector("#commentComposerInput");
        if (input instanceof HTMLTextAreaElement) input.focus();
      });
    }

    const cancelReply = panel.querySelector("[data-cancel-reply]");
    if (cancelReply) {
      cancelReply.addEventListener("click", async () => {
        state.commentReply = null;
        await renderComments(postSlug, publicState);
      });
    }
  }

  function renderMarkdown(node, markdown) {
    if (window.marked) {
      window.marked.setOptions({ gfm: true, breaks: false });
      node.innerHTML = window.marked.parse(String(markdown || ""));
    } else {
      node.innerHTML = renderMiniMarkdown(markdown);
    }
    for (const heading of node.querySelectorAll("h2, h3")) {
      heading.id = heading.id || slugify(heading.textContent || "section");
    }
    for (const link of node.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") || "";
      if (/^https?:\/\//.test(href)) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    }
  }

  function enrichArticleEntities(scope, publicState) {
    if (!scope || !publicState?.approvedEntities?.length) return;
    enrichEntityReferences(scope, publicState.approvedEntities);
  }

  function countRenderedCommentNodes(nodes) {
    return (Array.isArray(nodes) ? nodes : []).reduce((total, node) => total + 1 + countRenderedCommentNodes(node?.replies || []), 0);
  }

  function commentAuthorLabel(comment, publicState) {
    const author = publicState.users.find((user) => user.pubkey === comment.author);
    return author?.displayName || author?.username || "User";
  }

  return {
    mountCards,
    initMarkdownArticles,
    renderComments,
    renderMarkdown,
    enrichArticleEntities
  };
}
