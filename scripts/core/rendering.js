import { escapeAttribute, escapeHtml } from "./text-utils.js";

export function buildToc(article, target) {
  if (!(target instanceof HTMLElement) || !(article instanceof HTMLElement)) return;
  const items = [...article.querySelectorAll("h2, h3")];
  if (!items.length) {
    target.innerHTML = "<p>No sections available.</p>";
    return;
  }
  target.innerHTML = items
    .map(
      (item) => `
        <a class="toc-link toc-link--${item.tagName.toLowerCase()}" href="#${escapeAttribute(item.id)}">
          ${escapeHtml(item.textContent || "")}
        </a>
      `
    )
    .join("");
}

export function renderError(node, message) {
  if (!(node instanceof HTMLElement)) return;
  node.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

export function renderLoadingState(message) {
  return `
    <div class="loading-state loading-state--panel" role="status" aria-live="polite">
      <div class="loading-state__message">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span>${escapeHtml(message)}</span>
      </div>
    </div>
  `;
}

export function renderTagList(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => `<a class="tag tag--link" href="./blog.html?tag=${encodeURIComponent(String(tag || "").trim())}">${escapeHtml(String(tag))}</a>`)
    .join("");
}

export function renderMiniMarkdown(markdown) {
  const source = String(markdown || "").trim();
  if (!source) return "";
  if (window.marked) {
    window.marked.setOptions({ gfm: true, breaks: true });
    return window.marked.parse(source);
  }
  const escaped = escapeHtml(source);
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function renderRecordList(records) {
  if (!Array.isArray(records) || !records.length) {
    return `<div class="empty-state">No structured notes attached to this post.</div>`;
  }
  return records
    .map((record) => {
      const label = escapeHtml(String(record.label || "Untitled note"));
      const note = record.note ? `<small>${escapeHtml(String(record.note))}</small>` : "";
      if (record.href) {
        return `<a class="record-item" href="${escapeAttribute(record.href)}"><strong>${label}</strong>${note}</a>`;
      }
      return `<div class="record-item"><strong>${label}</strong>${note}</div>`;
    })
    .join("");
}
