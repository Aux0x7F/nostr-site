export function parseContentDocument(raw, fallback = {}, options = {}) {
  const markers = normalizeMarkers(options.markers);
  const match = matchMetaBlock(String(raw || ""), markers);
  let meta = {};
  let body = String(raw || "");

  if (match) {
    try {
      meta = JSON.parse(match.payload);
    } catch {
      meta = {};
    }
    body = body.slice(match.full.length);
  }

  return {
    meta: {
      slug: fallback.slug || "",
      file: fallback.file || "",
      title: meta.title || fallback.title || "Untitled placeholder",
      date: meta.date || fallback.date || "",
      location: meta.location || fallback.location || "Undisclosed location",
      status: meta.status || fallback.status || "Draft",
      summary: meta.summary || fallback.summary || "",
      featured: Boolean(meta.featured || fallback.featured),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      records: Array.isArray(meta.records) ? meta.records : [],
      entity_refs: Array.isArray(meta.entity_refs) ? dedupe(meta.entity_refs) : [],
      tone: meta.tone || ""
    },
    body: body.trim()
  };
}

export function enrichEntityReferences(scope, entities = []) {
  if (!scope || !entities.length) return [];
  const matches = [];
  const normalizedEntities = buildEntityMatcherList(entities);
  if (!normalizedEntities.length) return matches;

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("a, button, code, pre, script, style, textarea, input")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    const nodeMatches = findEntityMatches(node.nodeValue || "", normalizedEntities);
    if (!nodeMatches.length) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of nodeMatches) {
      if (match.start > cursor) fragment.append(document.createTextNode((node.nodeValue || "").slice(cursor, match.start)));
      const link = document.createElement("a");
      link.className = "entity-ref entity-ref--live";
      link.href = `./map.html?entity=${encodeURIComponent(match.entity.slug)}`;
      link.dataset.entityRef = match.entity.slug;
      link.dataset.entityTooltip = buildEntityTooltip(match.entity);
      link.textContent = (node.nodeValue || "").slice(match.start, match.end);
      fragment.append(link);
      matches.push(match.entity.slug);
      cursor = match.end;
    }
    if (cursor < (node.nodeValue || "").length) fragment.append(document.createTextNode((node.nodeValue || "").slice(cursor)));
    node.parentNode.replaceChild(fragment, node);
  }

  return dedupe(matches);
}

export function collectEntityRefsFromText(text, entities = []) {
  return dedupe(findEntityMatches(String(text || ""), buildEntityMatcherList(entities)).map((match) => match.entity.slug));
}

export function buildDraftMarkdown(draft, options = {}) {
  const marker = String(options.marker || "CMSMETA").trim() || "CMSMETA";
  const meta = {
    title: draft.title || "Untitled draft",
    date: draft.date || new Date().toISOString().slice(0, 10),
    location: draft.location || "Undisclosed location",
    status: draft.status || "Draft",
    summary: draft.summary || "",
    featured: Boolean(draft.featured),
    tags: Array.isArray(draft.tags) ? draft.tags : [],
    records: Array.isArray(draft.records) ? draft.records : [],
    entity_refs: Array.isArray(draft.entity_refs) ? dedupe(draft.entity_refs) : []
  };

  return `<!--${marker}\n${JSON.stringify(meta, null, 2)}\n-->\n\n${String(draft.markdown || "").trim()}\n`;
}

export function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createUniqueSlug(seed, taken = []) {
  const used = new Set((Array.isArray(taken) ? taken : []).map((item) => String(item || "").trim().toLowerCase()));
  const base = slugify(seed) || "untitled";
  if (!used.has(base)) return base;
  let counter = 2;
  while (used.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

function matchMetaBlock(text, markers) {
  for (const marker of markers) {
    const pattern = new RegExp(`^\\s*<!--\\s*${escapeRegex(marker)}\\s*([\\s\\S]*?)-->\\s*`, "i");
    const match = text.match(pattern);
    if (match) {
      return {
        full: match[0],
        payload: match[1],
        marker
      };
    }
  }
  return null;
}

function normalizeMarkers(markers) {
  const values = Array.isArray(markers) ? markers : [markers || "CMSMETA"];
  return dedupe(values).map((value) => String(value || "").trim()).filter(Boolean);
}

function buildEntityMatcherList(entities) {
  return dedupeEntities(
    entities
      .filter((entity) => entity && entity.slug && entity.name)
      .map((entity) => ({
        ...entity,
        terms: dedupe([entity.name, ...(Array.isArray(entity.aliases) ? entity.aliases : [])])
          .filter(Boolean)
          .sort((left, right) => String(right).length - String(left).length)
      }))
      .sort((left, right) => String(right.name).length - String(left.name).length)
  );
}

function findEntityMatches(text, entities) {
  const lower = String(text || "").toLowerCase();
  const matches = [];

  for (const entity of entities) {
    for (const term of entity.terms) {
      const needle = String(term || "").toLowerCase();
      if (!needle) continue;
      let index = lower.indexOf(needle);
      while (index !== -1) {
        const end = index + needle.length;
        if (isBoundary(lower, index - 1) && isBoundary(lower, end)) {
          matches.push({ start: index, end, entity });
        }
        index = lower.indexOf(needle, index + needle.length);
      }
    }
  }

  matches.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return right.end - right.start - (left.end - left.start);
  });

  const chosen = [];
  let cursor = -1;
  for (const match of matches) {
    if (match.start < cursor) continue;
    const conflict = chosen.find((item) => !(match.end <= item.start || match.start >= item.end));
    if (conflict) continue;
    chosen.push(match);
    cursor = match.end;
  }
  return chosen.sort((left, right) => left.start - right.start);
}

function isBoundary(text, index) {
  if (index < 0 || index >= text.length) return true;
  return !/[a-z0-9]/i.test(text[index]);
}

function buildEntityTooltip(entity) {
  return [entity.location, entity.type].filter(Boolean).join(" • ");
}

function dedupe(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function dedupeEntities(entities) {
  const seen = new Set();
  const results = [];
  for (const entity of entities) {
    const key = String(entity.slug || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(entity);
  }
  return results;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
