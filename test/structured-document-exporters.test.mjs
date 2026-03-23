import test from "node:test";
import assert from "node:assert/strict";
import { createStructuredDocument } from "../portable/structured-document.js";
import {
  collectStructuredDocumentCitations,
  extractStructuredDocumentEntityRefs,
  extractStructuredDocumentRelationshipCandidates,
  extractStructuredDocumentSearchText,
  renderStructuredDocumentHtml
} from "../portable/structured-document-exporters.js";

test("structured document exporters derive html search text entities relationships and citations", () => {
  const document = createStructuredDocument({
    id: "investigation:test",
    kind: "investigation",
    title: "Sample investigation",
    metadata: {
      entityRefs: [{ entity: "animal-agriculture" }],
      relationshipCandidates: [{ source: "farm-a", target: "processor-b", type: "supplies" }],
      citations: [{ href: "https://example.com/record", title: "Record" }]
    },
    blocks: [
      { id: "p1", type: "paragraph", text: "Public records show the facility changed owners." },
      { id: "e1", type: "entity-ref", entity: "processor-b", label: "Processor B" },
      { id: "r1", type: "relationship-ref", source: "farm-a", target: "processor-b", relationshipType: "supplies" },
      { id: "c1", type: "citation", href: "https://example.com/source", title: "Source note" },
      { id: "i1", type: "image", src: "./image.jpg", placement: "float-right", alt: "Facility exterior", caption: "Exterior" }
    ]
  });

  const html = renderStructuredDocumentHtml(document);
  assert.match(html, /doc-image--float-right/);
  assert.match(html, /Processor B/);
  assert.match(extractStructuredDocumentSearchText(document), /Sample investigation/);
  assert.deepEqual(extractStructuredDocumentEntityRefs(document), ["animal-agriculture", "processor-b"]);
  assert.deepEqual(extractStructuredDocumentRelationshipCandidates(document), [
    { source: "farm-a", target: "processor-b", type: "supplies", label: "" }
  ]);
  assert.deepEqual(collectStructuredDocumentCitations(document), [
    { href: "https://example.com/record", title: "Record", note: "" },
    { href: "https://example.com/source", title: "Source note", note: "" }
  ]);
});

test("structured document exporters preserve markdown blocks for downstream rendering", () => {
  const document = createStructuredDocument({
    id: "investigation:markdown",
    kind: "investigation",
    blocks: [
      { id: "md-1", type: "markdown", text: "## Heading\n\nParagraph with **emphasis**." }
    ]
  });

  const html = renderStructuredDocumentHtml(document);
  assert.match(html, /data-doc-markdown="true"/);
  assert.match(extractStructuredDocumentSearchText(document), /Heading/);
});
