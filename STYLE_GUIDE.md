# Style Guide

## Purpose
This file is the reusable UI contract for `nostr-site`.

`nostr-site` is the generic baseline. It should demonstrate clean, composable patterns that downstream sites can reuse without inheriting page-by-page drift.

See [COMPONENTS.md](./COMPONENTS.md) for the reusable component families that should converge instead of duplicating.

## Rendering Model
- Static content renders first.
- Live data overlays enrich the baseline without wiping it out.
- Public pages remain readable without authoring or admin state.
- Interactive surfaces should prefer in-place updates over full rerenders.

## Reusable Primitives
- `surface-panel`
- `button` / `button-ghost`
- `tag`
- attached search/select controls
- dropdown pickers anchored to their owning field
- modal cards for focused tasks
- sticky side rails that scroll internally when needed

Whole UI families that compose those primitives should live in `scripts/template/surfaces` before they are copied into more page controllers.

These are the first tools to extend before adding new one-off patterns.

Current extracted surface families:

- `navigation`
- `archive`
- `comments`
- `workspace`

## Layout Rules
- Main content column leads; rails support it.
- Sticky rails align to the top of the content they support.
- Rails should scroll internally instead of overflowing the viewport.
- Mobile layouts should move control rails above the result set when they drive filtering.

## Interaction Rules
- Attached dropdowns open from the field and overlay what sits below them.
- Search fields clear both their value and their active filter state.
- Keyboard support is expected for all pseudo-dropdowns.
- Loading indicators should live inside the component that is loading.
- Cached data should render immediately when available and trustworthy.
- Interactive controls should have a discernible accessible name in the HTML before JavaScript enhancement.

## State Rules
- Shared data logic belongs in portable helpers, not duplicated page scripts.
- Partial remote reads should not erase richer cached state.
- Background sync should patch the active surface instead of rebuilding it unless access or structure changed.
- Reply/thread structures should stay anchored to their parent/root even when data is incomplete.

## Authoring Rules
- Editor chrome should be predictable, not ornamental.
- Metadata belongs beside the writing surface, not mixed into it.
- Authoring surfaces should stay mounted through background sync and repair.

## Convergence Targets
- shared rail/filter helpers
- shared list and card primitives
- shared thread rendering helpers
- shared modal patterns
- shared editor-side rail and collaboration primitives
- browser-compatible enhancement patterns guarded by [BROWSER_SUPPORT.md](./BROWSER_SUPPORT.md)
