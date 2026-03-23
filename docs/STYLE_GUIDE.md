# Style Guide

`nostr-site` is the reusable baseline. It should feel clean, composable, and easy for downstream sites to extend without inheriting page-by-page drift.

## Product feel

- static baseline first
- live updates layered in, not shoved in front
- clear main column with supporting rails
- interactions that feel responsive without becoming noisy
- strong defaults that downstream sites can extend

## Layout rules

- main content leads
- rails support the main story
- rails align to the content they support
- sticky rails scroll internally when needed
- mobile moves control rails above the result set

## Shared primitives

Prefer extending the shared primitives before inventing new ones:

- `surface-panel`
- primary and ghost buttons
- compact tags and metadata rows
- attached search/select controls
- modal cards

Reusable behavior should converge in shared layers instead of getting copied into more page controllers.

## Interaction rules

- loading belongs in the component that is loading
- useful cached state should render immediately
- background refresh should patch in place
- attached dropdowns should feel anchored to their field
- keyboard support matters for pseudo-dropdowns
- controls need accessible names before enhancement

## State and rendering rules

- persistent shared state belongs in runtime/document helpers
- partial remote reads should not erase richer local state
- unrelated updates should not reset active local UI
- reply/thread structure should stay anchored even under partial data

## Authoring feel

- the editor should feel like a real authoring shell
- metadata belongs beside the writing surface
- background sync must not tear the shell down
- downstream sites should be able to extend the model without replacing the whole frame
