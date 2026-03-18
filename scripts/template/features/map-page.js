import { buildEntityUsage } from "../../core/posts-store.js";
import { escapeHtml } from "../../core/text-utils.js";

export function createMapPageFeature({
  state,
  postsStore,
  getPublicState,
  collectEntityRefsFromText,
  renderMapPageSurface,
  renderLeafletMapSurface,
  bindMapEntityCards,
  requestedMapEntity,
  scheduleLeafletFocus,
  cleanSlug,
  renderError,
  renderLoadingState
} = {}) {
  async function mount() {
    const list = document.querySelector("[data-map-list]");
    const canvas = document.querySelector("[data-map-canvas]");
    if (!(list instanceof HTMLElement) || !(canvas instanceof HTMLElement)) return;
    list.innerHTML = renderLoadingState("Looking up map entries...");
    canvas.innerHTML = renderLoadingState("Looking up map data...");
    const publicState = await getPublicState();
    if (!publicState.approvedEntities.length) {
      list.innerHTML = `<div class="empty-state">Published entities will appear here once approved entries are available.</div>`;
      canvas.innerHTML = `<div class="map-empty">Map data unavailable.</div>`;
      return;
    }
    const posts = await postsStore.load().catch(() => []);
    const entityUsage = buildEntityUsage(posts, publicState.approvedEntities, collectEntityRefsFromText);
    renderMapPageSurface(list, canvas, publicState.approvedEntities, entityUsage, mapSurfaceDeps());
  }

  function renderEntityCard(entity, posts) {
    return `
      <article class="entity-card entity-card--interactive" id="entity-card-${entity.slug}" data-entity-card="${entity.slug}" tabindex="0">
        <div class="eyebrow">${escapeHtml(entity.type || "entity")}</div>
        <h3>${escapeHtml(entity.name)}</h3>
        <p>${escapeHtml(entity.location)}</p>
        <p>${escapeHtml(entity.notes || "Placeholder description for this entity entry.")}</p>
        <div class="tag-row"><span class="tag">${escapeHtml(entity.status)}</span></div>
        <div class="entity-card__links">${posts.length ? posts.map((post) => `<a href="./post.html?slug=${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a>`).join("") : `<span class="muted-text">No post mentions this entry yet.</span>`}</div>
      </article>
    `;
  }

  function mapSurfaceDeps() {
    return {
      mapState: state,
      escapeHtml,
      renderEntityCard,
      renderLeafletMapSurface: (canvas, entities) =>
        renderLeafletMapSurface(canvas, entities, state, {
          escapeHtml,
          scheduleMapEntityFocus,
          queryEntityCard: (slug) => document.querySelector(`[data-entity-card="${slug}"]`)
        }),
      bindMapEntityCards: () => bindMapEntityCards((slug) => scheduleMapEntityFocus(slug)),
      focusRequestedEntity,
      queryEntityCard: (slug) => document.querySelector(`[data-entity-card="${slug}"]`)
    };
  }

  function scheduleMapEntityFocus(slug, options = {}, attempt = 0) {
    scheduleLeafletFocus(
      slug,
      state,
      {
        cleanSlug,
        queryEntityCard: (value) => document.querySelector(`[data-entity-card="${value}"]`)
      },
      options,
      attempt
    );
  }

  function focusRequestedEntity() {
    const requested = requestedMapEntity(window.location.search, cleanSlug);
    if (!requested) return;
    scheduleMapEntityFocus(requested);
  }

  return {
    mount
  };
}
