function cleanSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dedupe(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeWeight(value, fallback = 1) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function humanizeToken(value) {
  const clean = String(value || "").trim().replace(/[_-]+/g, " ");
  if (!clean) return "";
  return clean.replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeQuickFacts(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const label = normalizeText(item.label || item.key);
      const nextValue = normalizeText(item.value);
      if (!label || !nextValue) return null;
      return { label, value: nextValue };
    })
    .filter(Boolean);
}

export function normalizeWikiEntity(entity = {}) {
  const slug = cleanSlug(entity.slug || entity.id || entity.name);
  if (!slug) return null;
  const type = normalizeText(entity.type || "entity").toLowerCase() || "entity";
  const subtype = normalizeText(entity.subtype || "");
  const status = normalizeText(entity.status || "approved").toLowerCase() || "approved";
  return {
    slug,
    id: normalizeText(entity.id || `entity:${slug}`) || `entity:${slug}`,
    name: normalizeText(entity.name || humanizeToken(slug)) || humanizeToken(slug),
    type,
    subtype,
    summary: normalizeText(entity.summary || entity.description || entity.notes || ""),
    body: normalizeText(entity.body || ""),
    location: normalizeText(entity.location || ""),
    lat: Number.isFinite(Number(entity.lat)) ? Number(entity.lat) : null,
    lng: Number.isFinite(Number(entity.lng)) ? Number(entity.lng) : null,
    aliases: dedupe(entity.aliases),
    taxonomy: Array.isArray(entity.taxonomy)
      ? dedupe(entity.taxonomy)
      : typeof entity.taxonomy === "object" && entity.taxonomy
        ? Object.entries(entity.taxonomy)
            .flatMap(([key, value]) =>
              Array.isArray(value)
                ? value.map((item) => `${key}:${item}`)
                : value
                  ? [`${key}:${value}`]
                  : []
            )
        : [],
    quickFacts: normalizeQuickFacts(entity.quickFacts || entity.quick_facts),
    image: entity.image && typeof entity.image === "object"
      ? {
          src: normalizeText(entity.image.src || entity.image.url || ""),
          alt: normalizeText(entity.image.alt || entity.name || "")
        }
      : null,
    status,
    visibility: normalizeText(entity.visibility || (status === "draft" ? "draft" : "public")).toLowerCase() || "public"
  };
}

export function normalizeWikiRelationship(relationship = {}) {
  const source = cleanSlug(relationship.source || relationship.from);
  const target = cleanSlug(relationship.target || relationship.to);
  if (!source || !target || source === target) return null;
  const type = normalizeText(relationship.type || relationship.kind || "related_to").toLowerCase() || "related_to";
  const id = normalizeText(relationship.id || `${source}:${type}:${target}`) || `${source}:${type}:${target}`;
  return {
    id,
    source,
    target,
    type,
    label: normalizeText(relationship.label || humanizeToken(type)) || humanizeToken(type),
    summary: normalizeText(relationship.summary || relationship.description || ""),
    qualifiers: normalizeQuickFacts(
      Array.isArray(relationship.qualifiers)
        ? relationship.qualifiers
        : typeof relationship.qualifiers === "object" && relationship.qualifiers
          ? Object.entries(relationship.qualifiers).map(([key, value]) => ({ label: key, value }))
          : []
    ),
    start_at: normalizeText(relationship.start_at || relationship.start || ""),
    end_at: normalizeText(relationship.end_at || relationship.end || ""),
    weight: normalizeWeight(relationship.weight, type === "cites" ? 1 : 2),
    evidence: (Array.isArray(relationship.evidence) ? relationship.evidence : [])
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const investigation = cleanSlug(item.investigation || item.slug || "");
        if (!investigation) return null;
        return {
          investigation,
          note: normalizeText(item.note || item.summary || ""),
          quote: normalizeText(item.quote || "")
        };
      })
      .filter(Boolean),
    visibility: normalizeText(relationship.visibility || "public").toLowerCase() || "public"
  };
}

export function buildEvidenceGraph({
  entities = [],
  relationships = [],
  draftRelationships = [],
  investigations = [],
  viewerIsAdmin = false
} = {}) {
  const entityMap = new Map();
  for (const entity of Array.isArray(entities) ? entities : []) {
    const next = normalizeWikiEntity(entity);
    if (!next) continue;
    const existing = entityMap.get(next.slug);
    entityMap.set(next.slug, existing ? mergeEntity(existing, next) : next);
  }

  const normalizedInvestigations = (Array.isArray(investigations) ? investigations : [])
    .map((investigation) => normalizeInvestigation(investigation))
    .filter(Boolean);

  const explicitRelationships = dedupeRelationships(
    [
      ...(Array.isArray(relationships) ? relationships : []),
      ...(viewerIsAdmin ? Array.isArray(draftRelationships) ? draftRelationships : [] : [])
    ]
      .map((relationship) => normalizeWikiRelationship(relationship))
      .filter(Boolean)
      .filter((relationship) => entityMap.has(relationship.source) && entityMap.has(relationship.target))
  );

  const citationsByEntity = new Map();
  const citationEdges = [];
  for (const investigation of normalizedInvestigations) {
    for (const slug of investigation.entity_refs) {
      if (!entityMap.has(slug)) continue;
      const citedBy = citationsByEntity.get(slug) || [];
      citedBy.push(investigation);
      citationsByEntity.set(slug, dedupeInvestigations(citedBy));
      citationEdges.push({
        id: `cite:${investigation.slug}:${slug}`,
        source: investigation.id,
        target: slug,
        type: "cites",
        label: "Cites",
        summary: investigation.summary,
        qualifiers: [],
        start_at: investigation.date,
        end_at: "",
        weight: 1,
        evidence: [{ investigation: investigation.slug, note: investigation.summary, quote: "" }],
        visibility: "public",
        kind: "citation"
      });
    }
  }

  const entityRelationships = new Map();
  for (const relationship of explicitRelationships) {
    const sourceEntity = entityMap.get(relationship.source);
    const targetEntity = entityMap.get(relationship.target);
    const sourceList = entityRelationships.get(relationship.source) || [];
    sourceList.push({
      ...relationship,
      direction: "outbound",
      source_label: sourceEntity?.name || humanizeToken(relationship.source),
      target_label: targetEntity?.name || humanizeToken(relationship.target)
    });
    entityRelationships.set(relationship.source, sourceList);
    const targetList = entityRelationships.get(relationship.target) || [];
    targetList.push({
      ...relationship,
      direction: "inbound",
      source_label: sourceEntity?.name || humanizeToken(relationship.source),
      target_label: targetEntity?.name || humanizeToken(relationship.target)
    });
    entityRelationships.set(relationship.target, targetList);
  }

  const entityList = [...entityMap.values()].map((entity) => ({
    ...entity,
    citation_count: (citationsByEntity.get(entity.slug) || []).length,
    related_investigations: dedupeInvestigations(citationsByEntity.get(entity.slug) || []),
    relationships: (entityRelationships.get(entity.slug) || []).sort(compareRelationshipDisplay)
  }));

  const nodeList = [
    ...entityList.map((entity) => ({
      id: entity.slug,
      slug: entity.slug,
      label: entity.name,
      kind: "entity",
      type: entity.type,
      subtype: entity.subtype,
      summary: entity.summary,
      image: entity.image,
      taxonomy: entity.taxonomy,
      citation_count: entity.citation_count,
      visibility: entity.visibility
    })),
    ...normalizedInvestigations.map((investigation) => ({
      id: investigation.id,
      slug: investigation.slug,
      label: investigation.title,
      kind: "investigation",
      type: "investigation",
      subtype: "",
      summary: investigation.summary,
      image: null,
      taxonomy: [],
      citation_count: investigation.entity_refs.length,
      visibility: "public"
    }))
  ];

  const edgeList = [
    ...explicitRelationships.map((relationship) => ({ ...relationship, kind: "relationship" })),
    ...citationEdges
  ];

  return {
    entities: entityList,
    entitiesBySlug: new Map(entityList.map((entity) => [entity.slug, entity])),
    investigations: normalizedInvestigations,
    investigationsBySlug: new Map(normalizedInvestigations.map((investigation) => [investigation.slug, investigation])),
    relationships: explicitRelationships,
    graph: {
      nodes: nodeList,
      edges: edgeList,
      defaultNodeTypes: inferDefaultNodeTypes(nodeList),
      availableNodeTypes: dedupe(nodeList.map((node) => node.type)),
      availableRelationshipTypes: dedupe(explicitRelationships.map((relationship) => relationship.type))
    }
  };
}

export function filterEvidenceGraph(graphState, filters = {}) {
  const graph = graphState?.graph || { nodes: [], edges: [], defaultNodeTypes: [] };
  const selectedNodeTypes = Array.isArray(filters.nodeTypes) && filters.nodeTypes.length
    ? dedupe(filters.nodeTypes.map((value) => String(value || "").trim().toLowerCase()))
    : graph.defaultNodeTypes;
  const selectedRelationshipTypes = Array.isArray(filters.relationshipTypes) && filters.relationshipTypes.length
    ? dedupe(filters.relationshipTypes.map((value) => String(value || "").trim().toLowerCase()))
    : graph.availableRelationshipTypes;

  const nodeTypeSet = new Set(selectedNodeTypes);
  const relationshipTypeSet = new Set(selectedRelationshipTypes);
  const visibleNodes = graph.nodes.filter((node) => nodeTypeSet.has(node.type));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => {
    if (!relationshipTypeSet.has(edge.type)) return false;
    return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
  });
  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    highlightedNodeIds: findGraphNodeMatches(graphState, filters.query)
  };
}

export function findGraphNodeMatches(graphState, query = "") {
  const cleanQuery = normalizeText(query).toLowerCase();
  if (!cleanQuery) return [];
  return (graphState?.graph?.nodes || [])
    .filter((node) => {
      const haystack = [
        node.label,
        node.summary,
        ...(Array.isArray(node.taxonomy) ? node.taxonomy : [])
      ]
        .map((value) => String(value || "").toLowerCase())
        .join("\n");
      return haystack.includes(cleanQuery);
    })
    .map((node) => node.id);
}

export function buildEntityWikiView(graphState, slug = "") {
  const clean = cleanSlug(slug);
  if (!clean) return null;
  const entity = graphState?.entitiesBySlug?.get(clean) || null;
  if (!entity) return null;
  return {
    entity,
    relationships: Array.isArray(entity.relationships) ? entity.relationships : [],
    relatedInvestigations: Array.isArray(entity.related_investigations) ? entity.related_investigations : [],
    citationsCount: Number(entity.citation_count || 0) || 0
  };
}

function normalizeInvestigation(investigation = {}) {
  const slug = cleanSlug(investigation.slug || investigation.id || investigation.title);
  if (!slug) return null;
  return {
    id: `investigation:${slug}`,
    slug,
    title: normalizeText(investigation.title || humanizeToken(slug)) || humanizeToken(slug),
    summary: normalizeText(investigation.summary || ""),
    date: normalizeText(investigation.date || ""),
    entity_refs: dedupe(investigation.entity_refs)
      .map((value) => cleanSlug(value))
      .filter(Boolean)
  };
}

function mergeEntity(previousEntity, nextEntity) {
  return {
    ...previousEntity,
    ...nextEntity,
    aliases: dedupe([...(previousEntity.aliases || []), ...(nextEntity.aliases || [])]),
    taxonomy: dedupe([...(previousEntity.taxonomy || []), ...(nextEntity.taxonomy || [])]),
    quickFacts: dedupeQuickFacts([...(previousEntity.quickFacts || []), ...(nextEntity.quickFacts || [])]),
    body: nextEntity.body || previousEntity.body,
    summary: nextEntity.summary || previousEntity.summary,
    image: nextEntity.image?.src ? nextEntity.image : previousEntity.image
  };
}

function dedupeQuickFacts(values) {
  const seen = new Set();
  const results = [];
  for (const fact of Array.isArray(values) ? values : []) {
    const label = normalizeText(fact?.label);
    const value = normalizeText(fact?.value);
    const key = `${label}:${value}`.toLowerCase();
    if (!label || !value || seen.has(key)) continue;
    seen.add(key);
    results.push({ label, value });
  }
  return results;
}

function dedupeRelationships(values) {
  const map = new Map();
  for (const relationship of Array.isArray(values) ? values : []) {
    if (!relationship?.id) continue;
    map.set(String(relationship.id).trim().toLowerCase(), relationship);
  }
  return [...map.values()].sort(compareRelationshipDisplay);
}

function dedupeInvestigations(values) {
  const map = new Map();
  for (const investigation of Array.isArray(values) ? values : []) {
    const slug = cleanSlug(investigation?.slug || "");
    if (!slug) continue;
    map.set(slug, investigation);
  }
  return [...map.values()].sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
}

function compareRelationshipDisplay(left, right) {
  const leftWeight = Number(left?.weight || 0) || 0;
  const rightWeight = Number(right?.weight || 0) || 0;
  if (leftWeight !== rightWeight) return rightWeight - leftWeight;
  return String(left?.label || left?.type || "").localeCompare(String(right?.label || right?.type || ""));
}

function inferDefaultNodeTypes(nodes = []) {
  const preferred = ["industry", "company", "investigation"];
  const available = new Set((Array.isArray(nodes) ? nodes : []).map((node) => String(node?.type || "").trim().toLowerCase()).filter(Boolean));
  const defaults = preferred.filter((type) => available.has(type));
  return defaults.length ? defaults : [...available.values()];
}
