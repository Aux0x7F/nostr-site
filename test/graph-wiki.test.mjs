import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEvidenceGraph,
  buildEntityWikiView,
  filterEvidenceGraph,
  findGraphNodeMatches,
  normalizeWikiEntity,
  normalizeWikiRelationship
} from "../portable/graph-wiki.js";

test("normalizeWikiEntity keeps the expected wiki-ready shape", () => {
  const entity = normalizeWikiEntity({
    slug: "North Valley Processing Campus",
    type: "facility",
    summary: "Processing campus",
    taxonomy: { industry: "animal-agriculture", stage: "processing" },
    quickFacts: [{ label: "County", value: "Maricopa" }]
  });

  assert.ok(entity);
  assert.equal(entity.slug, "north-valley-processing-campus");
  assert.equal(entity.type, "facility");
  assert.deepEqual(entity.taxonomy, ["industry:animal-agriculture", "stage:processing"]);
  assert.deepEqual(entity.quickFacts, [{ label: "County", value: "Maricopa" }]);
});

test("normalizeWikiRelationship keeps qualifiers, evidence, and visibility", () => {
  const relationship = normalizeWikiRelationship({
    source: "north-valley-processing-campus",
    target: "county-line-logistics-yard",
    type: "transports_to",
    qualifiers: { route: "County Line corridor" },
    evidence: [{ investigation: "placeholder-turnstile", note: "Manifest trail" }],
    visibility: "draft"
  });

  assert.ok(relationship);
  assert.equal(relationship.type, "transports_to");
  assert.deepEqual(relationship.qualifiers, [{ label: "route", value: "County Line corridor" }]);
  assert.deepEqual(relationship.evidence, [{ investigation: "placeholder-turnstile", note: "Manifest trail", quote: "" }]);
  assert.equal(relationship.visibility, "draft");
});

test("buildEvidenceGraph merges explicit relationships and investigation citations", () => {
  const graph = buildEvidenceGraph({
    entities: [
      { slug: "animal-agriculture", name: "Animal Agriculture", type: "industry", summary: "Industry shell" },
      { slug: "north-valley-foods", name: "North Valley Foods", type: "company", summary: "Company shell" },
      { slug: "north-valley-processing-campus", name: "North Valley Processing Campus", type: "facility", summary: "Facility shell" }
    ],
    relationships: [
      {
        source: "animal-agriculture",
        target: "north-valley-foods",
        type: "industry_participant",
        weight: 3
      },
      {
        source: "north-valley-foods",
        target: "north-valley-processing-campus",
        type: "owns",
        weight: 4
      }
    ],
    investigations: [
      {
        slug: "placeholder-turnstile",
        title: "Placeholder Turnstile",
        summary: "Investigation summary",
        date: "2026-03-09",
        entity_refs: ["north-valley-processing-campus"]
      }
    ]
  });

  assert.equal(graph.entities.length, 3);
  assert.equal(graph.relationships.length, 2);
  assert.equal(graph.graph.nodes.length, 4);
  assert.equal(graph.graph.edges.length, 3);
  assert.equal(graph.entitiesBySlug.get("north-valley-processing-campus").citation_count, 1);
  assert.equal(graph.graph.defaultNodeTypes.includes("investigation"), true);
});

test("buildEvidenceGraph keeps draft relationships admin-only", () => {
  const publicGraph = buildEvidenceGraph({
    entities: [
      { slug: "a", name: "A", type: "company" },
      { slug: "b", name: "B", type: "facility" }
    ],
    relationships: [],
    draftRelationships: [{ source: "a", target: "b", type: "operates", visibility: "draft" }],
    viewerIsAdmin: false
  });
  const adminGraph = buildEvidenceGraph({
    entities: [
      { slug: "a", name: "A", type: "company" },
      { slug: "b", name: "B", type: "facility" }
    ],
    relationships: [],
    draftRelationships: [{ source: "a", target: "b", type: "operates", visibility: "draft" }],
    viewerIsAdmin: true
  });

  assert.equal(publicGraph.relationships.length, 0);
  assert.equal(adminGraph.relationships.length, 1);
  assert.equal(adminGraph.relationships[0].visibility, "draft");
});

test("filterEvidenceGraph keeps the default high-level graph and highlights search matches", () => {
  const graph = buildEvidenceGraph({
    entities: [
      { slug: "animal-agriculture", name: "Animal Agriculture", type: "industry", summary: "Industry shell" },
      { slug: "north-valley-foods", name: "North Valley Foods", type: "company", summary: "Company shell" },
      { slug: "north-valley-processing-campus", name: "North Valley Processing Campus", type: "facility", summary: "Facility shell" }
    ],
    relationships: [{ source: "animal-agriculture", target: "north-valley-foods", type: "industry_participant" }],
    investigations: [{ slug: "placeholder-turnstile", title: "Placeholder Turnstile", entity_refs: ["north-valley-processing-campus"] }]
  });

  const filtered = filterEvidenceGraph(graph, { query: "north valley" });

  assert.deepEqual(filtered.nodes.map((node) => node.type), ["industry", "company", "investigation"]);
  assert.ok(filtered.highlightedNodeIds.includes("north-valley-foods"));
  assert.ok(filtered.highlightedNodeIds.includes("north-valley-processing-campus"));
});

test("buildEntityWikiView returns rail-ready entity data", () => {
  const graph = buildEvidenceGraph({
    entities: [
      {
        slug: "north-valley-processing-campus",
        name: "North Valley Processing Campus",
        type: "facility",
        summary: "Facility shell",
        body: "Detailed wiki body"
      },
      { slug: "county-line-logistics-yard", name: "County Line Logistics Yard", type: "facility" }
    ],
    relationships: [
      {
        source: "north-valley-processing-campus",
        target: "county-line-logistics-yard",
        type: "transports_to"
      }
    ],
    investigations: [
      { slug: "placeholder-turnstile", title: "Placeholder Turnstile", entity_refs: ["north-valley-processing-campus"] }
    ]
  });

  const wikiView = buildEntityWikiView(graph, "north-valley-processing-campus");

  assert.ok(wikiView);
  assert.equal(wikiView.entity.body, "Detailed wiki body");
  assert.equal(wikiView.relationships.length, 1);
  assert.equal(wikiView.relationships[0].target_label, "County Line Logistics Yard");
  assert.equal(wikiView.relatedInvestigations.length, 1);
  assert.equal(wikiView.citationsCount, 1);
  assert.deepEqual(findGraphNodeMatches(graph, "processing"), [
    "north-valley-processing-campus"
  ]);
});
