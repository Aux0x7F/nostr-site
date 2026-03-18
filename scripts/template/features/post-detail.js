import {
  draftOwnerPubkey,
  draftReviewAction,
  draftStatusLabel,
  draftToPostPreview,
  normalizeDraftStatus,
  reviewActionMessage,
  reviewStatusForAction,
  shortReviewKey
} from "../../core/draft-review.js";
import { escapeAttribute, escapeHtml } from "../../core/text-utils.js";

export function createPostDetailFeature({
  site,
  state,
  viewerController,
  postsStore,
  getPublicState,
  publishTaggedJson,
  publicStateStore,
  notificationState,
  hydrateNotifications,
  contentPagesFeature,
  renderLoadingState,
  renderError,
  renderTagList,
  renderRecordList,
  renderPostCard,
  setText,
  formatDate
} = {}) {
  async function mount() {
    const article = document.querySelector("[data-post-article]");
    if (!(article instanceof HTMLElement)) return;
    article.innerHTML = renderLoadingState("Looking up article...");
    const commentPanel = document.querySelector("[data-comment-panel]");
    const reviewPanel = document.querySelector("[data-post-review]");
    if (commentPanel instanceof HTMLElement) commentPanel.innerHTML = renderLoadingState("Looking up discussion...");

    try {
      const posts = await postsStore.load();
      const publicState = await getPublicState();
      const params = new URLSearchParams(window.location.search);
      const slug = String(params.get("slug") || "").trim();
      const draftSlug = String(params.get("draft") || "").trim();
      const canReview = viewerController.canEdit(publicState);
      const draft = draftSlug
        ? (publicState.drafts || []).find((item) => item.slug === draftSlug) || null
        : null;
      const isDraftPreview = Boolean(draft && canReview);
      if (draftSlug && !isDraftPreview) throw new Error("Draft preview unavailable.");
      const post = isDraftPreview
        ? draftToPostPreview(draft)
        : posts.find((item) => item.slug === slug) || posts[0];
      if (!post) throw new Error("No posts found.");

      contentPagesFeature.renderMarkdown(article, post.body);
      setText("[data-post-title]", post.title);
      setText("[data-post-summary]", post.summary);
      setText("[data-post-date]", formatDate(post.date));
      setText("[data-post-location]", post.location);
      setText("[data-post-status]", post.statusLabel || post.status);
      const tags = document.querySelector("[data-post-tags]");
      if (tags instanceof HTMLElement) tags.innerHTML = renderTagList(post.tags);
      const records = document.querySelector("[data-post-records]");
      if (records instanceof HTMLElement) records.innerHTML = renderRecordList(post.records);
      const related = document.querySelector("[data-post-related]");
      if (related instanceof HTMLElement) {
        related.innerHTML = isDraftPreview
          ? ""
          : posts
              .filter((item) => item.slug !== post.slug)
              .slice(0, 2)
              .map((item) => renderPostCard(item, true))
              .join("");
      }

      contentPagesFeature.enrichArticleEntities(article, publicState);
      if (reviewPanel instanceof HTMLElement) {
        if (isDraftPreview) {
          reviewPanel.hidden = false;
          reviewPanel.innerHTML = renderReviewPreviewPanel(draft, publicState, formatDate);
          bindReviewPreviewPanel(reviewPanel, draft);
        } else {
          reviewPanel.hidden = true;
          reviewPanel.innerHTML = "";
        }
      }
      if (commentPanel instanceof HTMLElement) {
        commentPanel.hidden = isDraftPreview;
        if (!isDraftPreview) {
          await contentPagesFeature.renderComments(post.slug, publicState);
        } else {
          commentPanel.innerHTML = "";
        }
      }
      document.title = `${post.title} | ${site.shortName}`;
    } catch {
      renderError(article, "This post could not be loaded.");
      if (reviewPanel instanceof HTMLElement) {
        reviewPanel.hidden = true;
        reviewPanel.innerHTML = "";
      }
    }
  }

  function renderReviewPreviewPanel(draft, publicState, formatDraftDate) {
    const status = normalizeDraftStatus(draft.status);
    const owner = publicState?.users?.find((user) => user.pubkey === draftOwnerPubkey(draft)) || null;
    const ownerLabel = owner?.displayName || owner?.username || shortReviewKey(draftOwnerPubkey(draft));
    const reviewAction = draftReviewAction(draft);
    const canReview = ["candidate", "review", "submitted"].includes(status);
    return `
      <div class="eyebrow">Review preview</div>
      <h3>${escapeHtml(draftStatusLabel(status, reviewAction))}</h3>
      <p class="muted-text">Submitted by ${escapeHtml(ownerLabel)}. This view is read-only so the decision happens against what was actually submitted.</p>
      <div class="tag-row">
        <span class="tag">${escapeHtml(draftStatusLabel(status, reviewAction))}</span>
        <span class="tag">${escapeHtml(formatDraftDate(draft.date))}</span>
      </div>
      <div class="button-row button-row--tight">
        ${
          canReview
            ? `
              <button class="button" type="button" data-review-action="approve" data-draft-slug="${escapeAttribute(draft.slug)}">Approve</button>
              <button class="button-ghost" type="button" data-review-action="revise" data-draft-slug="${escapeAttribute(draft.slug)}">Request revision</button>
              <button class="button-ghost" type="button" data-review-action="deny" data-draft-slug="${escapeAttribute(draft.slug)}">Deny</button>
            `
            : normalizeDraftStatus(draft.status) === "revision"
              ? `<a class="button-ghost" href="./editor.html?slug=${encodeURIComponent(draft.slug)}">Open in editor</a>`
              : `<a class="button-ghost" href="./blog.html">Back to blog</a>`
        }
      </div>
      <div class="status-box" data-review-status aria-live="polite"></div>
    `;
  }

  function bindReviewPreviewPanel(panel, draft) {
    const buttons = panel.querySelectorAll("[data-review-action]");
    for (const button of buttons) {
      button.addEventListener("click", async () => {
        const action = button.getAttribute("data-review-action") || "";
        const statusBox = panel.querySelector("[data-review-status]");
        if (!state.session || !viewerController.canEdit(state.publicState)) return;
        button.setAttribute("disabled", "disabled");
        if (statusBox instanceof HTMLElement) {
          statusBox.textContent = "Saving review decision...";
          statusBox.dataset.state = "pending";
        }
        try {
          const viewer = state.viewer || await viewerController.get().catch(() => viewerController.primeFromSession(false));
          await publishTaggedJson({
            kind: site.nostr.kinds.draft,
            secretKeyHex: state.session.secretKeyHex,
            tags: [
              ["d", draft.slug],
              ["status", reviewStatusForAction(action)],
              ["review", action]
            ],
            content: {
              ...draft,
              author_pubkey: draftOwnerPubkey(draft),
              status: reviewStatusForAction(action),
              reviewed_at: new Date().toISOString(),
              reviewed_by: viewer?.pubkey || "",
              review_action: action
            }
          });
          state.publicState = (await publicStateStore.hydrate({ force: true, reason: "review-action" })).value;
          notificationState.reset();
          void hydrateNotifications(true);
          if (statusBox instanceof HTMLElement) {
            statusBox.textContent = reviewActionMessage(action);
            statusBox.dataset.state = "success";
          }
          window.setTimeout(() => {
            window.location.href = "./blog.html";
          }, 700);
        } catch (error) {
          if (statusBox instanceof HTMLElement) {
            statusBox.textContent = String(error?.message || error || "Review action failed.");
            statusBox.dataset.state = "error";
          }
        } finally {
          button.removeAttribute("disabled");
        }
      });
    }
  }

  return {
    mount
  };
}
