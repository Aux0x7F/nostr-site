import {
  normalizeDocumentBlock,
  normalizeStructuredDocument
} from "./structured-document.js";

export function renderStructuredDocumentHtml(document = {}) {
  const normalized = normalizeStructuredDocument(document);
  return normalized.blocks.map((block) => renderDocumentBlock(block)).join("\n");
}

export function extractStructuredDocumentSearchText(document = {}) {
  const normalized = normalizeStructuredDocument(document);
  const parts = [normalized.title, normalized.summary];
  for (const block of normalized.blocks) {
    if (block.type === "image") {
      parts.push(block.alt, block.caption);
      continue;
    }
    if (block.type === "entity-ref") {
      parts.push(block.label, block.entity);
      continue;
    }
    if (block.type === "relationship-ref") {
      parts.push(block.label, block.source, block.target, block.relationshipType);
      continue;
    }
    if (block.type === "citation") {
      parts.push(block.title, block.note);
      continue;
    }
    parts.push(block.text);
  }
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join(" ").trim();
}

export function extractStructuredDocumentEntityRefs(document = {}) {
  const normalized = normalizeStructuredDocument(document);
  const refs = new Set(
    normalized.metadata.entityRefs
      .map((entry) => (typeof entry === "string" ? entry : entry?.entity || entry?.slug || ""))
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  );
  for (const block of normalized.blocks) {
    const normalizedBlock = normalizeDocumentBlock(block);
    if (normalizedBlock.type !== "entity-ref") continue;
    refs.add(String(normalizedBlock.entity || "").trim().toLowerCase());
  }
  return [...refs].filter(Boolean);
}

export function extractStructuredDocumentRelationshipCandidates(document = {}) {
  const normalized = normalizeStructuredDocument(document);
  const candidates = normalized.metadata.relationshipCandidates
    .map((entry) => normalizeRelationshipCandidate(entry))
    .filter(Boolean);
  for (const block of normalized.blocks) {
    const normalizedBlock = normalizeDocumentBlock(block);
    if (normalizedBlock.type !== "relationship-ref") continue;
    const candidate = normalizeRelationshipCandidate({
      source: normalizedBlock.source,
      target: normalizedBlock.target,
      type: normalizedBlock.relationshipType,
      label: normalizedBlock.label
    });
    if (candidate) candidates.push(candidate);
  }
  return dedupeRelationshipCandidates(candidates);
}

export function collectStructuredDocumentCitations(document = {}) {
  const normalized = normalizeStructuredDocument(document);
  const citations = normalized.metadata.citations
    .map((entry) => normalizeCitation(entry))
    .filter(Boolean);
  for (const block of normalized.blocks) {
    const normalizedBlock = normalizeDocumentBlock(block);
    if (normalizedBlock.type !== "citation") continue;
    const citation = normalizeCitation(normalizedBlock);
    if (citation) citations.push(citation);
  }
  return citations;
}

function renderDocumentBlock(block = {}) {
  const normalizedBlock = normalizeDocumentBlock(block);
  if (normalizedBlock.type === "image") {
    return `
      <figure class="doc-image doc-image--${escapeHtml(normalizedBlock.placement)}" data-doc-image-placement="${escapeHtml(normalizedBlock.placement)}" data-doc-image-drag="${escapeHtml(`${normalizedBlock.drag.x},${normalizedBlock.drag.y}`)}">
        <div class="doc-image__frame">
          <img src="${escapeHtml(normalizedBlock.src)}" alt="${escapeHtml(normalizedBlock.alt)}" loading="lazy">
        </div>
        ${normalizedBlock.caption ? `<figcaption>${escapeHtml(normalizedBlock.caption)}</figcaption>` : ""}
      </figure>
    `;
  }
  if (normalizedBlock.type === "entity-ref") {
    return `<p class="doc-entity-ref" data-entity-ref="${escapeHtml(normalizedBlock.entity)}">${escapeHtml(normalizedBlock.label || normalizedBlock.entity)}</p>`;
  }
  if (normalizedBlock.type === "relationship-ref") {
    return `<p class="doc-relationship-ref" data-relationship-source="${escapeHtml(normalizedBlock.source)}" data-relationship-target="${escapeHtml(normalizedBlock.target)}" data-relationship-type="${escapeHtml(normalizedBlock.relationshipType)}">${escapeHtml(normalizedBlock.label || `${normalizedBlock.source} ${normalizedBlock.relationshipType} ${normalizedBlock.target}`)}</p>`;
  }
  if (normalizedBlock.type === "citation") {
    const title = escapeHtml(normalizedBlock.title || normalizedBlock.href || "Citation");
    const note = normalizedBlock.note ? `<span class="doc-citation__note">${escapeHtml(normalizedBlock.note)}</span>` : "";
    return `<p class="doc-citation"><a href="${escapeHtml(normalizedBlock.href)}">${title}</a>${note}</p>`;
  }
  if (normalizedBlock.type === "markdown") {
    return `<div class="doc-markdown" data-doc-markdown="true">${escapeHtml(normalizedBlock.text)}</div>`;
  }
  if (normalizedBlock.type === "heading") {
    return `<h2>${escapeHtml(normalizedBlock.text)}</h2>`;
  }
  if (normalizedBlock.type === "quote") {
    return `<blockquote>${escapeHtml(normalizedBlock.text)}</blockquote>`;
  }
  if (normalizedBlock.type === "list") {
    return `<ul>${String(normalizedBlock.text || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }
  return `<p>${escapeHtml(normalizedBlock.text)}</p>`;
}

function normalizeRelationshipCandidate(value) {
  if (!value || typeof value !== "object") return null;
  const source = String(value.source || "").trim().toLowerCase();
  const target = String(value.target || "").trim().toLowerCase();
  const type = String(value.type || value.relationshipType || "").trim().toLowerCase();
  if (!source || !target || !type) return null;
  return {
    source,
    target,
    type,
    label: String(value.label || "").trim()
  };
}

function normalizeCitation(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const href = String(value || "").trim();
    return href ? { href, title: "", note: "" } : null;
  }
  const href = String(value.href || "").trim();
  const title = String(value.title || "").trim();
  const note = String(value.note || "").trim();
  if (!href && !title && !note) return null;
  return {
    href,
    title,
    note
  };
}

function dedupeRelationshipCandidates(candidates = []) {
  const seen = new Set();
  return candidates.filter((entry) => {
    const key = `${entry.source}:${entry.type}:${entry.target}:${entry.label || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export default {
  collectStructuredDocumentCitations,
  extractStructuredDocumentEntityRefs,
  extractStructuredDocumentRelationshipCandidates,
  extractStructuredDocumentSearchText,
  renderStructuredDocumentHtml
};
