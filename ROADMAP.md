# Roadmap

`nostr-site` is the reusable framework and policy layer. The current build already proves the static-first plus live-overlay model; the next work is about tightening that model into cleaner, more reusable surfaces.

## Completed Recently

- Cache-first public-state restore is now a documented framework contract.
- Comment thread derivation and comment vote aggregation are now explicit reusable state behavior.
- Static-page and structured-unit live overlay helpers are in place.
- Browser-compatibility fallback rules are now documented for the template layer.
- Branch-purpose-squash is now the documented contribution pattern.

## Next Tightening Step

- Finish the split between portable state logic and reusable surface primitives so high-churn UI patterns stop living inside large page controllers.

That specifically means:

- reusable rail/filter helpers
- reusable thread rendering helpers
- reusable modal/action-sheet patterns
- reusable list/card families
- clearer browser-compat fallback coverage for those shared primitives

## Near Term

- Extend the generic live overlay model from page units into post and entity-facing template surfaces.
- Expand deterministic tests for cache-first restore, stale merge behavior, and nested thread integrity.
- Expand browser smoke coverage for mobile navigation, workspace flows, and fallback behavior.
- Keep tightening peer-heal and degraded relay behavior without weakening signature or trust guarantees.

## Longer Term

- Add stronger entity/wiki support as a generic structured-unit target.
- Tighten collaboration shells so downstream sites can adopt richer editor rails and discussion patterns without forking the template model.
- Keep the peer-pinner bakedown path aligned with the live collaborative unit model rather than older one-off review flows.
