# Components

This file is the reusable UI playbook for `nostr-site`. Use it to keep template patterns consistent and to avoid solving the same interaction problem differently in every page.

## Ownership

Keep responsibilities clean:

- `scripts/core`
  - shared helpers, controllers, and state logic
- `scripts/template/features`
  - route and feature orchestration
- `scripts/template/surfaces`
  - rendering families and DOM patching

Features subscribe to the state they need. Surfaces render and patch the regions they own.

## Global shell

### Header and navigation

- The shell must be readable before enhancement.
- Navigation should come alive early from local state, then improve when heavier runtime state arrives.
- The mobile nav toggle needs an accessible name in the HTML.
- `Map` is a public destination and must not be gated by account or relay state.
- The nav drawer is an overlay, not a page re-layout.

### Footer

- Footer structure stays consistent across public pages.
- Footer content should read like site framing, not internal notes.

## Panels, rails, and cards

### Panels

- `surface-panel` is the default card shell.
- Extend it before adding a one-off shell.

### Rails

- Rails support the main content column.
- They align to the content they support.
- They scroll internally when needed.
- On mobile, control rails move above the result set.

### Lists and threads

- Repeated card families should share structure.
- Nested threads come from derived data, not ad hoc DOM regrouping.
- Replies stay attached to their thread even when data is partial.
- Background refresh should patch in place when structure has not changed.

## Search and attached fields

Use one attached-field pattern for:

- template search/filter controls
- submit pickers
- workspace lookup and filter fields

That pattern should:

- open from the field itself
- overlay what sits below it
- support keyboard navigation
- clear both the field and the active filter state

## Workspace surfaces

- Workspace tabs, pane content, and overlays should patch independently.
- Search, filters, and summary state belong in the rail when they drive a list.
- Notifications live with the profile menu family, not as a disconnected surface.
- Username is an immutable handle in profile settings.

## Editor shell

- The editor is a composed shell, not a long form with side features bolted on.
- Writing surface, metadata rail, and collaboration/live state should stay separate.
- The shell stays mounted during background sync.

## Host boundary

Upstream should keep the reusable patterns and ownership rules here.
Downstream sites decide the product-specific layout, copy, and presentation choices layered on top.
