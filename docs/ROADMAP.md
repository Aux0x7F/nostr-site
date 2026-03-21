# Roadmap

`nostr-site` is the reusable framework and policy layer. The current build already proves the static-first plus live-overlay model; the next work is about tightening that model into cleaner, more reusable surfaces.

## Completed Recently

- Contract, security, and roadmap docs now live under `docs/` instead of cluttering the repo root.
- Cache-first public-state restore is now a documented framework contract.
- Comment thread derivation and comment vote aggregation are now explicit reusable state behavior.
- Static-page and structured-unit live overlay helpers are in place.
- Browser-compatibility fallback rules are now documented for the template layer.
- Branch-purpose-squash is now the documented contribution pattern.
- Downstream validation has now proven the first broad extracted surface split for navigation, archive, comment, and workspace behavior.
- The template now applies that same split directly in code through `scripts/template/surfaces`, including workspace actions, map shells, and editor-shell rendering.
- The template now also shares one extracted public-state store boundary for public, workspace, and editor lifecycle instead of repeating repair and hydrate mechanics in each controller.
- Notification state and profile-menu UI state now live in dedicated core modules instead of controller-local toggles and storage logic.
- Submit-shell rendering now lives in a dedicated template surface module, so the modal family matches the rest of the extracted surface split.
- Workspace picker and filter suggestion markup now live in dedicated template surface modules instead of staying embedded in admin controllers.
- The template root controller is now reduced to a route/bootstrap entrypoint backed by explicit `scripts/core`, `scripts/template/features`, and `scripts/template/surfaces` layers.
- Shared observed-region routing now governs mounted workspace/admin, submit, and editor shell updates so unrelated async state changes do not replace active form roots.
- Shared evidence-graph and wiki helpers now exist upstream for downstream graph explorer and entity wiki shells.
- Template workspace login and profile save now live behind a dedicated workspace account controller instead of staying embedded in the template admin controller.

## Next Tightening Step

- Expand the normalized template shell into richer collaborative rails, broader live-unit overlays, and stronger downstream browser validation.
- Apply the same controller-to-feature reduction pattern to the remaining heavy admin/workspace controllers so the template no longer has one large secondary root script, with upload/download and moderation-detail handlers now the next obvious seam.

That specifically means:

- reusable rail/filter helpers
- reusable modal/action-sheet patterns
- reusable list/card families
- map shells and preview helpers that are still page-controller responsibilities
- clearer browser-compat fallback coverage for those shared primitives

## Near Term

- Decide how much of the first graph/wiki UI should become a generic template demonstration instead of staying only in downstream sites.
- Expand graph/wiki testing around entity references, relationship qualifiers, and wiki-view derivation.
- Extend the generic live overlay model from page units into post and entity-facing template surfaces.
- Expand deterministic tests for cache-first restore, stale merge behavior, and nested thread integrity.
- Expand browser smoke coverage for mobile navigation, workspace flows, and fallback behavior.
- Keep tightening peer-heal and degraded relay behavior without weakening signature or trust guarantees.

## Longer Term

- Add stronger entity/wiki support as a generic structured-unit target, including explicit relationship records and evidence-aware graph helpers.
- Tighten collaboration shells so downstream sites can adopt richer editor rails and discussion patterns without forking the template model.
- Keep the peer-pinner bakedown path aligned with the live collaborative unit model rather than older one-off review flows.
