import test from "node:test";
import assert from "node:assert/strict";

import {
  appendGraphEntityRecord,
  appendGraphRelationshipRecord,
  createEmptyGraphRecordState,
  normalizeGraphRecordState
} from "../portable/graph-records.js";

test("createEmptyGraphRecordState returns an empty graph record shell", () => {
  assert.deepEqual(createEmptyGraphRecordState(), {
    entities: [],
    relationships: []
  });
});

test("appendGraphEntityRecord creates a normalized draft entity", () => {
  const next = appendGraphEntityRecord(createEmptyGraphRecordState(), {
    name: "North Valley Processing Campus",
    type: "Company",
    taxonomy: "food, logistics",
    quickFacts: "State:CA, Size:Regional"
  });

  assert.equal(next.entities.length, 1);
  assert.equal(next.entities[0].slug, "north-valley-processing-campus");
  assert.equal(next.entities[0].type, "company");
  assert.deepEqual(next.entities[0].taxonomy, ["food", "logistics"]);
  assert.deepEqual(next.entities[0].quickFacts, [
    { label: "State", value: "CA" },
    { label: "Size", value: "Regional" }
  ]);
});

test("appendGraphRelationshipRecord normalizes relationship payloads", () => {
  const next = appendGraphRelationshipRecord(createEmptyGraphRecordState(), {
    source: "north-valley-processing-campus",
    target: "county-line-logistics-yard",
    type: "transports_to",
    evidence: "placeholder-investigation",
    qualifiers: "period:2026"
  });

  assert.equal(next.relationships.length, 1);
  assert.equal(next.relationships[0].source, "north-valley-processing-campus");
  assert.equal(next.relationships[0].target, "county-line-logistics-yard");
  assert.equal(next.relationships[0].type, "transports_to");
  assert.deepEqual(next.relationships[0].evidence, [
    { investigation: "placeholder-investigation", note: "", quote: "" }
  ]);
  assert.deepEqual(next.relationships[0].qualifiers, [
    { label: "period", value: "2026" }
  ]);
});

test("normalizeGraphRecordState clones incoming graph record state", () => {
  const state = {
    entities: [{ slug: "entity-a", name: "Entity A" }],
    relationships: [{ source: "entity-a", target: "entity-b", type: "owns" }]
  };
  const normalized = normalizeGraphRecordState(state);
  normalized.entities[0].name = "Changed";
  normalized.relationships[0].type = "changed";
  assert.equal(state.entities[0].name, "Entity A");
  assert.equal(state.relationships[0].type, "owns");
});
