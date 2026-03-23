export const STRUCTURED_DOCUMENT_SCHEMA = "nostr-site/structured-document@1";
export const STRUCTURED_IMAGE_PLACEMENTS = Object.freeze([
  "float-left",
  "float-right",
  "center",
  "full-width",
  "fill-crop"
]);

export function createStructuredDocument({
  id = "",
  kind = "page",
  title = "",
  summary = "",
  blocks = [],
  metadata = {}
} = {}) {
  return normalizeStructuredDocument({
    schema: STRUCTURED_DOCUMENT_SCHEMA,
    id,
    kind,
    title,
    summary,
    blocks,
    metadata
  });
}

export function normalizeStructuredDocument(document = {}) {
  const nextDocument = document && typeof document === "object" ? document : {};
  return {
    schema: STRUCTURED_DOCUMENT_SCHEMA,
    id: String(nextDocument.id || "").trim(),
    kind: String(nextDocument.kind || "page").trim().toLowerCase() || "page",
    title: String(nextDocument.title || "").trim(),
    summary: String(nextDocument.summary || "").trim(),
    metadata: normalizeDocumentMetadata(nextDocument.metadata),
    blocks: normalizeDocumentBlocks(nextDocument.blocks)
  };
}

export function applyStructuredDocumentPatch(document, patch) {
  const current = normalizeStructuredDocument(document);
  if (Array.isArray(patch)) {
    return patch.reduce((nextDocument, entry) => applyStructuredDocumentPatch(nextDocument, entry), current);
  }
  if (!patch || typeof patch !== "object") return current;
  const kind = String(patch.type || "").trim().toLowerCase();
  if (!kind) return current;

  if (kind === "replace-document") {
    return normalizeStructuredDocument(patch.document);
  }

  if (kind === "set-meta") {
    return normalizeStructuredDocument({
      ...current,
      title: patch.title ?? current.title,
      summary: patch.summary ?? current.summary,
      metadata: {
        ...current.metadata,
        ...(patch.metadata && typeof patch.metadata === "object" ? patch.metadata : {})
      }
    });
  }

  if (kind === "replace-blocks") {
    return normalizeStructuredDocument({
      ...current,
      blocks: Array.isArray(patch.blocks) ? patch.blocks : current.blocks
    });
  }

  if (kind === "upsert-block") {
    const block = normalizeDocumentBlock(patch.block, { fallbackId: patch.blockId || createBlockId() });
    const existingIndex = current.blocks.findIndex((entry) => entry.id === block.id);
    const nextBlocks = [...current.blocks];
    if (existingIndex >= 0) {
      nextBlocks[existingIndex] = block;
    } else {
      const afterId = String(patch.afterId || "").trim();
      const insertIndex = afterId
        ? nextBlocks.findIndex((entry) => entry.id === afterId) + 1
        : nextBlocks.length;
      nextBlocks.splice(Math.max(0, insertIndex), 0, block);
    }
    return normalizeStructuredDocument({
      ...current,
      blocks: nextBlocks
    });
  }

  if (kind === "remove-block") {
    const blockId = String(patch.blockId || "").trim();
    return normalizeStructuredDocument({
      ...current,
      blocks: current.blocks.filter((entry) => entry.id !== blockId)
    });
  }

  if (kind === "move-block") {
    const blockId = String(patch.blockId || "").trim();
    const afterId = String(patch.afterId || "").trim();
    const currentIndex = current.blocks.findIndex((entry) => entry.id === blockId);
    if (currentIndex < 0) return current;
    const nextBlocks = [...current.blocks];
    const [moved] = nextBlocks.splice(currentIndex, 1);
    const afterIndex = afterId ? nextBlocks.findIndex((entry) => entry.id === afterId) : -1;
    nextBlocks.splice(afterIndex >= 0 ? afterIndex + 1 : nextBlocks.length, 0, moved);
    return normalizeStructuredDocument({
      ...current,
      blocks: nextBlocks
    });
  }

  return current;
}

export function normalizeDocumentBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : []).map((block, index) =>
    normalizeDocumentBlock(block, { fallbackId: `block-${index + 1}` })
  );
}

export function normalizeDocumentBlock(block = {}, { fallbackId = "" } = {}) {
  const nextBlock = block && typeof block === "object" ? block : {};
  const type = String(nextBlock.type || "paragraph").trim().toLowerCase() || "paragraph";
  const normalized = {
    id: String(nextBlock.id || fallbackId || createBlockId()).trim(),
    type
  };

  if (type === "image") {
    return {
      ...normalized,
      src: String(nextBlock.src || "").trim(),
      alt: String(nextBlock.alt || "").trim(),
      caption: String(nextBlock.caption || "").trim(),
      placement: normalizeImagePlacement(nextBlock.placement),
      drag: normalizeImageDrag(nextBlock.drag),
      crop: normalizeImageCrop(nextBlock.crop)
    };
  }

  if (type === "entity-ref") {
    return {
      ...normalized,
      entity: String(nextBlock.entity || "").trim().toLowerCase(),
      label: String(nextBlock.label || nextBlock.entity || "").trim()
    };
  }

  if (type === "relationship-ref") {
    return {
      ...normalized,
      source: String(nextBlock.source || "").trim().toLowerCase(),
      target: String(nextBlock.target || "").trim().toLowerCase(),
      relationshipType: String(nextBlock.relationshipType || nextBlock.typeName || "related_to").trim().toLowerCase(),
      label: String(nextBlock.label || "").trim(),
      qualifiers: normalizeMetadataArray(nextBlock.qualifiers)
    };
  }

  if (type === "citation") {
    return {
      ...normalized,
      title: String(nextBlock.title || "").trim(),
      href: String(nextBlock.href || "").trim(),
      note: String(nextBlock.note || "").trim()
    };
  }

  return {
    ...normalized,
    text: String(nextBlock.text || nextBlock.content || "").trim()
  };
}

export function normalizeImagePlacement(value) {
  const cleanValue = String(value || "").trim().toLowerCase();
  return STRUCTURED_IMAGE_PLACEMENTS.includes(cleanValue) ? cleanValue : "center";
}

function normalizeImageDrag(value) {
  const nextValue = value && typeof value === "object" ? value : {};
  return {
    x: normalizeFraction(nextValue.x, 0.5),
    y: normalizeFraction(nextValue.y, 0.5)
  };
}

function normalizeImageCrop(value) {
  const nextValue = value && typeof value === "object" ? value : {};
  return {
    x: normalizeFraction(nextValue.x, 0),
    y: normalizeFraction(nextValue.y, 0),
    width: normalizeFraction(nextValue.width, 1),
    height: normalizeFraction(nextValue.height, 1)
  };
}

function normalizeDocumentMetadata(metadata = {}) {
  const nextValue = metadata && typeof metadata === "object" ? metadata : {};
  const normalized = {
    slug: String(nextValue.slug || "").trim().toLowerCase(),
    tags: normalizeMetadataArray(nextValue.tags),
    citations: normalizeMetadataArray(nextValue.citations),
    entityRefs: normalizeMetadataArray(nextValue.entityRefs),
    relationshipCandidates: normalizeMetadataArray(nextValue.relationshipCandidates)
  };

  for (const [key, value] of Object.entries(nextValue)) {
    if (key in normalized) continue;
    normalized[key] = normalizeArbitraryMetadataValue(value);
  }

  return normalized;
}

function normalizeMetadataArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return String(entry || "").trim();
      }
      return Object.fromEntries(
        Object.entries(entry).map(([key, itemValue]) => [key, String(itemValue || "").trim()])
      );
    })
    .filter((entry) => {
      if (typeof entry === "string") return Boolean(entry);
      return Object.values(entry).some(Boolean);
    });
}

function normalizeArbitraryMetadataValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeArbitraryMetadataValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, normalizeArbitraryMetadataValue(entry)])
        .filter(([, entry]) => typeof entry !== "undefined")
    );
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "undefined") {
    return undefined;
  }
  return String(value ?? "");
}

function normalizeFraction(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function createBlockId() {
  return `block-${Math.random().toString(36).slice(2, 10)}`;
}

export default {
  STRUCTURED_DOCUMENT_SCHEMA,
  STRUCTURED_IMAGE_PLACEMENTS,
  applyStructuredDocumentPatch,
  createStructuredDocument,
  normalizeDocumentBlock,
  normalizeStructuredDocument
};
