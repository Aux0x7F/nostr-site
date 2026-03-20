# Components Contract

This file describes the reusable component families that `nostr-site` should provide or demonstrate cleanly.

The goal is to make downstream sites extend stable primitives instead of re-solving the same interaction patterns page by page.

Whole UI families should converge into reusable surface modules before they are copied into more page controllers. Route-owned orchestration should move into `scripts/template/features`, and shared state/controllers should stay in `scripts/core`.

## Feature-owned roots

- Shared state should route into feature-owned roots, then into the component regions those features own.
- Mounted shells should update by observed region instead of replacing the whole shell on every state change.
- Unrelated state changes must not reset active form input, open modals, or other local draft UI.
- Local draft UI state and async network/public state should be treated as separate concerns.

## Global shell

### Header and navigation

- The header is static-first and readable before JS enhancement.
- The mobile nav toggle must have a discernible accessible name in HTML.
- The nav drawer is a bounded overlay:
  - drawer scrolls
  - background page locks
  - open/close should not cause whole-page layout churn

### Footer

- Footer structure should remain consistent across public pages.
- Footer copy is site-wide framing, not a page-local implementation note.

## Core shells

### `surface-panel`

- default card shell for content, rails, and focused controls
- should be extensible before inventing new one-off shells

### Rails

- rails support the primary content column
- rails align to the top of the content they support
- rails scroll internally when taller than the viewport
- mobile moves control rails above the result set when they drive filtering

## Search and filter controls

### Attached field pattern

- attached suggestions and dropdowns open from the field itself
- submit-modal entity and location fields are part of this same attached field pattern
- they overlay what sits below instead of pushing the layout
- they support:
  - `ArrowUp`
  - `ArrowDown`
  - `Enter`
  - `Escape`
  - clear `x`
- clearing the field clears the active filter state too

## Lists, cards, and threads

### Card families

- list cards in the same row should align actions consistently
- repeated card families should share structure and class contracts

### Thread view

- nested threads come from a derived data structure, not ad hoc DOM regrouping
- roots and replies may have different ordering rules
- replies stay attached to their parent/root even under partial data
- optimistic updates resolve in place and survive background refresh until fresher trusted state arrives

## Loading and live state

### Live surfaces

All reusable live surfaces should follow:

1. static baseline
2. cached live state if trustworthy
3. background reconcile
4. patch in place through the owning feature or component root

This applies to:

- archive lists
- comments
- map/entity views
- workspace lists
- collaborative overlays

## Workspace and menu surfaces

### Workspace lists and rails

- template workspace panes should converge on shared list and rail behavior before downstream sites customize them
- rails own search, stats, and filters when they drive the list
- refresh should patch rows and counts in place instead of replacing the whole pane
- mounted workspace shells should patch tabs, pane, and overlays independently when only one region changes

### Notifications and profile menu

- notification state lives inside the profile menu surface
- the badge is the compact state; the expanded list is a child state of the same menu
- consuming notifications should not collapse unrelated controls

## Modals and action sheets

- focused actions should happen in context through modals or inline action sheets
- they should not replace the entire page for small tasks
- repeated item-action patterns should converge into one action-sheet family before a new list invents another variation

## Editor shell

- authoring is a composed shell:
  - writing surface
  - metadata rail
  - collaboration or discussion rail
- toolbar actions belong in the toolbar, at cursor
- the shell stays mounted during background repair and sync
- editor shell replacement should only happen when the shell markup actually changes

## Compliance rule

When a repeated pattern appears more than once, the next change should move it toward:

- a portable helper
- a shared template primitive
- or a documented contract here before another divergent copy lands

Current extracted template surface families:

- `scripts/core/request-signer.js`
- `scripts/core/viewer-controller.js`
- `scripts/core/notification-state.js`
- `scripts/core/notification-builders.js`
- `scripts/core/draft-review.js`
- `scripts/template/features/site-runtime.js`
- `scripts/template/features/content-pages.js`
- `scripts/template/features/post-detail.js`
- `scripts/template/features/map-page.js`
- `scripts/core/navigation-state.js`
- `scripts/template/surfaces/navigation.js`
- `scripts/template/surfaces/archive.js`
- `scripts/template/surfaces/comments.js`
- `scripts/template/surfaces/submit-shell.js`
- `scripts/template/surfaces/workspace.js`
- `scripts/template/surfaces/workspace-filters.js`
- `scripts/template/surfaces/workspace-actions.js`
- `scripts/template/surfaces/map.js`
- `scripts/template/surfaces/editor-shell.js`
