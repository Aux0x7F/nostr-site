export function renderEntityPickerResultsMarkup(fieldName, query, matches, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  if (!query) return "";
  if (!matches.length) {
    return `<div class="picker-hint">No match yet. Use the create button to add a new entity.</div>`;
  }
  return matches
    .map(
      (entity) => `
        <button class="picker-chip" type="button" data-entity-pick="${escapeAttribute(entity.slug)}" data-target-field="${fieldName}">
          <strong>${escapeHtml(entity.name)}</strong>
          <span>${escapeHtml(entity.location)}</span>
        </button>
      `
    )
    .join("");
}

export function renderLocationResultsMarkup(query, matches, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  if (!query && !matches.length) return "";
  if (!matches.length) {
    return `<div class="picker-hint">No saved location matches. Keep the typed value to create a new one.</div>`;
  }
  return matches
    .map(
      (location) => `
        <button class="picker-chip" type="button" data-location-pick="${escapeAttribute(location)}">
          <strong>${escapeHtml(location)}</strong>
        </button>
      `
    )
    .join("");
}
