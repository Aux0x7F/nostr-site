import { createUniqueSlug } from "./content-docs.js";

export function createEmptyGraphRecordState() {
  return {
    entities: [],
    relationships: []
  };
}

export function normalizeGraphRecordState(state = null) {
  const nextState = state && typeof state === "object" ? state : {};
  return {
    entities: Array.isArray(nextState.entities)
      ? nextState.entities.map((entity) => ({ ...entity }))
      : [],
    relationships: Array.isArray(nextState.relationships)
      ? nextState.relationships.map((relationship) => ({ ...relationship }))
      : []
  };
}

export function appendGraphEntityRecord(state = null, payload = {}, existingSlugs = []) {
  const nextState = normalizeGraphRecordState(state);
  const taken = [
    ...(Array.isArray(existingSlugs) ? existingSlugs : []),
    ...nextState.entities.map((entity) => entity.slug)
  ];
  const slug = createUniqueSlug(String(payload.name || "").trim() || "entity", taken);
  nextState.entities.push({
    slug,
    id: `entity:${slug}`,
    name: String(payload.name || "").trim() || slug,
    type: String(payload.type || "entity").trim().toLowerCase() || "entity",
    subtype: String(payload.subtype || "").trim(),
    summary: String(payload.summary || "").trim(),
    body: String(payload.body || "").trim(),
    location: String(payload.location || "").trim(),
    taxonomy: splitCommaValue(payload.taxonomy),
    quickFacts: normalizeQuickFacts(payload.quickFacts),
    visibility: "draft",
    status: "draft"
  });
  return nextState;
}

export function appendGraphRelationshipRecord(state = null, payload = {}) {
  const nextState = normalizeGraphRecordState(state);
  const source = String(payload.source || "").trim().toLowerCase();
  const target = String(payload.target || "").trim().toLowerCase();
  const type = String(payload.type || "related_to").trim().toLowerCase();
  if (!source || !target || source === target) return nextState;
  nextState.relationships.push({
    id: `draft:${source}:${type}:${target}:${Date.now()}`,
    source,
    target,
    type,
    label: String(payload.label || "").trim(),
    summary: String(payload.summary || "").trim(),
    start_at: String(payload.start_at || "").trim(),
    end_at: String(payload.end_at || "").trim(),
    weight: Number.isFinite(Number(payload.weight)) ? Number(payload.weight) : 1,
    evidence: splitCommaValue(payload.evidence).map((investigation) => ({
      investigation,
      note: "",
      quote: ""
    })),
    qualifiers: splitCommaValue(payload.qualifiers).map((value) => {
      const [label, detail] = String(value || "").split(":");
      return {
        label: String(label || "").trim() || "detail",
        value: String(detail || "").trim() || String(value || "").trim()
      };
    }),
    visibility: "draft"
  });
  return nextState;
}

function splitCommaValue(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeQuickFacts(value = "") {
  return splitCommaValue(value).map((item) => {
    const [label, detail] = String(item || "").split(":");
    return {
      label: String(label || "").trim() || "Detail",
      value: String(detail || "").trim() || String(item || "").trim()
    };
  });
}

