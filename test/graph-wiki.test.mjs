import test from "node:test";
import assert from "node:assert/strict";

import { buildEvidenceGraph } from "../portable/graph-wiki.js";

test("graph builder derives relationship edges from investigation candidates", () => {
  const graphState = buildEvidenceGraph({
    entities: [
      { slug: "farm-a", name: "Farm A", type: "company" },
      { slug: "processor-b", name: "Processor B", type: "facility" }
    ],
    investigations: [
      {
        slug: "supply-chain-1",
        title: "Supply Chain 1",
        summary: "Investigation summary",
        date: "2026-03-20",
        entity_refs: ["farm-a", "processor-b"],
        relationship_candidates: [
          {
            source: "farm-a",
            target: "processor-b",
            type: "supplies",
            label: "Supplies"
          }
        ]
      }
    ]
  });

  assert.equal(graphState.relationships.some((relationship) => relationship.type === "supplies"), true);
  assert.equal(graphState.graph.edges.some((edge) => edge.id.includes("investigation-rel:supply-chain-1")), true);
});

test("graph builder keeps draft investigation relationship candidates admin-only", () => {
  const graphState = buildEvidenceGraph({
    entities: [
      { slug: "farm-a", name: "Farm A", type: "company" },
      { slug: "processor-b", name: "Processor B", type: "facility", visibility: "draft", status: "draft" }
    ],
    draftInvestigations: [
      {
        slug: "supply-chain-draft",
        title: "Supply Chain Draft",
        summary: "Draft summary",
        relationship_candidates: [
          {
            source: "farm-a",
            target: "processor-b",
            type: "supplies"
          }
        ]
      }
    ],
    viewerIsAdmin: true
  });

  const edge = graphState.graph.edges.find((entry) => entry.id.includes("investigation-rel:supply-chain-draft"));
  assert.equal(edge?.visibility, "draft");
});
