export function renderPostCard(post, compact, deps = {}) {
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const formatDate = deps.formatDate || ((value) => String(value || ""));
  const renderTagList = deps.renderTagList || (() => "");
  const href = post.href || `./post.html?slug=${encodeURIComponent(post.slug)}`;
  const eyebrow = post.eyebrow || "Blog post";
  const actionLabel = post.actionLabel || "Open post";
  const statusPill = post.statusLabel
    ? `<span class="status-pill status-pill--${escapeAttribute(post.archiveStatus || "posted")}">${escapeHtml(post.statusLabel)}</span>`
    : "";
  if (!compact) {
    return `
      <article class="post-card post-card--list ${post.cardClass || ""}">
        <div class="post-card__body">
          <div class="post-card__head">
            <div class="eyebrow">${escapeHtml(eyebrow)}</div>
            ${statusPill}
          </div>
          <h3><a href="${href}">${escapeHtml(post.title)}</a></h3>
          <p class="card-meta">${escapeHtml(post.location)} <span>${escapeHtml(formatDate(post.date))}</span></p>
          <p class="card-summary">${escapeHtml(post.summary)}</p>
          <div class="tag-row">${renderTagList((post.tags || []).slice(0, 4))}</div>
        </div>
        <div class="post-card__rail">
          <a class="text-link" href="${href}">${escapeHtml(actionLabel)}</a>
        </div>
      </article>
    `;
  }
  return `
    <article class="post-card ${compact ? "post-card--compact" : ""}">
      <div class="post-card__head">
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        ${statusPill}
      </div>
      <h3><a href="${href}">${escapeHtml(post.title)}</a></h3>
      <p class="card-meta">${escapeHtml(post.location)} <span>${escapeHtml(formatDate(post.date))}</span></p>
      <p>${escapeHtml(post.summary)}</p>
      <div class="tag-row">${renderTagList((post.tags || []).slice(0, compact ? 2 : 4))}</div>
      <a class="text-link" href="${href}">${escapeHtml(actionLabel)}</a>
    </article>
  `;
}

export function buildBlogArchiveEntries(posts, drafts, deps = {}) {
  const normalizeDraftStatus = deps.normalizeDraftStatus || ((value) => String(value || "").trim().toLowerCase());
  const draftReviewAction = deps.draftReviewAction || (() => "");
  const draftStatusLabel = deps.draftStatusLabel || (() => "Draft");
  const sortDateValue = deps.sortDateValue || (() => 0);
  const staticSlugs = new Set((Array.isArray(posts) ? posts : []).map((post) => post.slug));
  const published = (Array.isArray(posts) ? posts : []).map((post) => ({
    ...post,
    archiveStatus: "posted",
    statusLabel: "Posted",
    href: `./post.html?slug=${encodeURIComponent(post.slug)}`,
    actionLabel: "Open post"
  }));
  const relayEntries = (Array.isArray(drafts) ? drafts : [])
    .filter((draft) => !(staticSlugs.has(draft.slug) && normalizeDraftStatus(draft.status) === "approved"))
    .map((draft) => {
      const status = normalizeDraftStatus(draft.status);
      const reviewAction = draftReviewAction(draft);
      const archived = status === "approved" ? "approved" : status;
      const isEditable = status === "draft" || status === "revision";
      const href = isEditable
        ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
        : `./post.html?draft=${encodeURIComponent(draft.slug)}`;
      return {
        ...draft,
        body: draft.markdown || "",
        archiveStatus: archived,
        statusLabel: draftStatusLabel(status, reviewAction),
        href,
        actionLabel: isEditable ? "Continue writing" : "Open preview",
        location: draft.location || "Draft location pending",
        summary: draft.summary || "This post does not have a summary yet.",
        eyebrow: "Blog post"
      };
    });
  return [...relayEntries, ...published]
    .sort((left, right) => {
      const leftStamp = sortDateValue(left);
      const rightStamp = sortDateValue(right);
      if (leftStamp !== rightStamp) return rightStamp - leftStamp;
      return String(left.title || "").localeCompare(String(right.title || ""));
    });
}

export function renderAuthoringLeadCard() {
  return `
    <article class="surface-panel authoring-card">
      <div class="eyebrow">For editors</div>
      <h3>Write in the full editor</h3>
      <p>Drafts save as you work, submitted posts open in review preview, and approved posts roll into the next bakedown.</p>
      <div class="button-row"><a class="button" href="./editor.html">Create post</a></div>
    </article>
  `;
}
