export {
  enrichEntityReferences,
  collectEntityRefsFromText,
  splitTags,
  slugify,
  createUniqueSlug
} from "./portable/content-docs.js";

import {
  parseContentDocument as parseGenericContentDocument,
  buildDraftMarkdown as buildGenericDraftMarkdown
} from "./portable/content-docs.js";

const MARKERS = ["CMSMETA"];

export function parseContentDocument(raw, fallback = {}) {
  return parseGenericContentDocument(raw, fallback, { markers: MARKERS });
}

export function buildDraftMarkdown(draft) {
  return buildGenericDraftMarkdown(draft, { marker: "CMSMETA" });
}
