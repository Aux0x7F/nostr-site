import test from "node:test";
import assert from "node:assert/strict";
import {
  STRUCTURED_IMAGE_PLACEMENTS,
  applyStructuredDocumentPatch,
  createStructuredDocument,
  normalizeStructuredDocument
} from "../portable/structured-document.js";

test("structured image placements include all required investigation modes", () => {
  assert.deepEqual(STRUCTURED_IMAGE_PLACEMENTS, [
    "float-left",
    "float-right",
    "center",
    "full-width",
    "fill-crop"
  ]);
});

test("normalizeStructuredDocument preserves image placement drag and crop data", () => {
  const document = normalizeStructuredDocument({
    id: "investigation:test",
    kind: "investigation",
    blocks: [{
      id: "image-1",
      type: "image",
      src: "./image.jpg",
      placement: "fill-crop",
      drag: { x: 0.2, y: 0.8 },
      crop: { x: 0.1, y: 0.1, width: 0.7, height: 0.6 }
    }]
  });
  assert.equal(document.blocks[0].placement, "fill-crop");
  assert.deepEqual(document.blocks[0].drag, { x: 0.2, y: 0.8 });
  assert.deepEqual(document.blocks[0].crop, { x: 0.1, y: 0.1, width: 0.7, height: 0.6 });
});

test("applyStructuredDocumentPatch supports block upsert and removal", () => {
  const initial = createStructuredDocument({
    id: "wiki:test",
    kind: "wiki",
    blocks: [{ id: "p1", type: "paragraph", text: "Hello" }]
  });
  const withHeading = applyStructuredDocumentPatch(initial, {
    type: "upsert-block",
    block: { id: "h1", type: "heading", text: "Title" },
    afterId: "p1"
  });
  const withoutParagraph = applyStructuredDocumentPatch(withHeading, {
    type: "remove-block",
    blockId: "p1"
  });
  assert.deepEqual(withHeading.blocks.map((block) => block.id), ["p1", "h1"]);
  assert.deepEqual(withoutParagraph.blocks.map((block) => block.id), ["h1"]);
});

test("normalizeStructuredDocument preserves additional metadata for page-backed documents", () => {
  const document = normalizeStructuredDocument({
    id: "static-page:about",
    kind: "static-page",
    metadata: {
      pageId: "about",
      savedAt: 123,
      pageContent: {
        "about.hero.title": "<strong>About</strong>",
        "about.hero.lede": "<p>Built for people first.</p>"
      }
    }
  });

  assert.equal(document.metadata.pageId, "about");
  assert.equal(document.metadata.savedAt, 123);
  assert.deepEqual(document.metadata.pageContent, {
    "about.hero.title": "<strong>About</strong>",
    "about.hero.lede": "<p>Built for people first.</p>"
  });
});
