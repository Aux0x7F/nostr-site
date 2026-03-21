# Architecture

This repo is the host-application layer that sits between a generic CRDT transport and a concrete site implementation.

## Repo boundary

The three-repo split is:

- `nostr-crdt`
  - generic CRDT transport over Nostr
  - room identity, replay, checkpoints, buffered updates
  - no site-specific auth, review, publishing, or bakedown policy
- `nostr-site`
  - generic site framework and policy layer
  - account model, admin model, moderation model, draft model, bakedown requests, peer pinner integration
  - decides how and when a trusted live overlay should affect site state
- `truecost`
  - project-specific pages, content, copy, styling, and operating choices

`nostr-site` consumes a generic transport library. It does not become the transport library.

## Current state

Today, `nostr-site` already provides:

- deterministic accounts
- earliest-claim username ownership with collision detection
- admin grant and revoke model
- public drafts, entities, comments, and moderation state
- encrypted submission intake
- peer-pinner-driven bakedown and PR support
- static-first rendering with relay-backed enrichment
- generic CRDT transport bridge to `nostr-crdt`
- generic static-page live overlay helper with host-provided trust rules
- generic structured live-unit overlay helper for post-like and record-like documents
- cached public-event replay and peer-assisted repair requests for partial relay reads, limited to locally verified signed events
- generic comment vote aggregation in public state
- reusable trusted HTML sanitization helpers for host renderers
- shared evidence-graph and wiki helpers:
  - entity normalization
  - relationship normalization
  - graph build/filter/highlight helpers
  - wiki-view derivation for host rails and entity pages

Today, `nostr-site` does not yet provide:

- a full template-level consumer for every collaborative unit type
- a generic template-level graph explorer or wiki route shell

## Target model

The framework model is:

1. Static content is the baseline.
2. Clients optionally connect to Nostr after load.
3. Clients receive newer live unit state through a generic CRDT transport.
4. Clients only apply that live state if the signer is currently trusted by the host application's auth model.
5. Peer pinner periodically materializes the latest trusted state into repo files and opens or updates a PR.
6. Merge of that PR advances the static baseline.

This keeps first load fast and deterministic while still supporting live collaboration.

The reusable surface and compatibility expectations that should govern that work now live in:

- `COMPONENTS.md`
- `STYLE_GUIDE.md`
- `BROWSER_SUPPORT.md`

The concrete template and downstream sites should keep moving toward a `scripts/core -> scripts/template/features -> scripts/template/surfaces` split, where shared services live in core, route-owned logic lives in features, and UI families live in surfaces instead of accumulating inside page controllers. The template now applies that directly for site runtime/bootstrap, content pages, post detail, navigation, archive, comments, submit shell rendering, workspace rendering, workspace account flows, workspace filters, workspace actions, map shells, editor-shell rendering, notification/profile-menu state through dedicated core helpers, and a shared `scripts/core/public-state-store.js` boundary for public/workspace/editor lifecycle.

Graph/wiki boundaries follow the same split:

- `portable/graph-wiki.js`
  - reusable evidence-graph and wiki-view helpers
- downstream host
  - chooses routes, visual language, draft relationship workflows, and graph/wiki shell behavior

Mounted shell updates should now follow an observed-region rule:

- features observe the state slices they care about
- features route updates to the specific DOM regions they own
- unchanged overlays and active form roots stay mounted
- full shell replacement is reserved for actual structural changes

Route query params should use the same architecture:

- shared query-state helper in `scripts/core`
- features subscribe only to the params they consume
- features route param changes to the DOM regions they own
- page controllers should not keep reintroducing direct `window.location.search` reads for mounted interactive behavior

## Cache-first live state contract

Every live surface in the framework must follow the same boot order:

1. render static baseline if available
2. render cached live state immediately if a trustworthy cache exists
3. reconcile against relays in the background
4. patch the mounted surface in place through the owning feature or region root

Live surfaces must not blank useful cached content just because a network refresh is in flight.

Async network state and local draft UI state should stay separate. Background refresh must not wipe active input that does not depend on the changed state.

This applies to:

- archive views
- comment threads
- map/entity views
- workspace lists
- collaborative document overlays

## Collaborative units

The host framework should think in terms of one collaborative unit per document:

- page
- post
- entity or wiki record

The framework should not encourage one giant site-wide document.

The framework also should not force a specific CRDT engine into all state. Only the units that benefit from live collaboration should use the transport layer.

## Testing contract

New live-state features are not complete without regression coverage for:

- cached-first render
- optimistic local update behavior
- reload resilience
- stale remote merge behavior
- nested structure integrity where threading or hierarchy exists

Manual browser checks are still useful, but they do not replace deterministic regression tests for these cases.

## Trust boundary

`nostr-site` is where signer trust becomes product behavior.

The generic transport verifies event shape and Nostr signatures, but `nostr-site` decides whether a signer is allowed to affect visible state.

The trust rule is:

- live content events are signed by the editor's own key
- `nostr-site` reconstructs the current allowed admin set from its existing admin grant and revoke chain
- only updates from currently trusted signers are applied to privileged live overlay state

This is a host-app concern, not a transport concern.

For deterministic accounts, `nostr-site` also establishes canonical username ownership from the earliest explicit claim and marks later same-name claimants as conflicts. Host applications can use that derived state to block conflicted sessions from acting until they choose a unique username, and to verify ownership against a direct username lookup before persisting a session locally.

`nostr-site` also supports a stronger signed moderation state for identities labeled `removed`. Removed pubkeys should be excluded from normal user/entity/comment projections and from username-ownership resolution, while still allowing host applications to treat that pubkey as explicitly removed for session validation and operator handling. This is intended as an operator/root-level action, not a normal workspace control.

## Peer pinner role

Peer pinner is not the transport layer and not the source of truth for merge logic.

Peer pinner should act as:

- durable peer
- checkpoint helper
- bakedown worker
- PR automation worker

It should not own application auth policy beyond enforcing the current trusted signer set when fulfilling privileged downstream actions.

## Publishing contract

For trusted live content, the publishing model is:

- editors change collaborative units live
- clients receive and verify the live overlay
- pinner periodically materializes the latest trusted state into repo files
- Git PR review keeps the static baseline auditable

This is intentionally simpler than a heavy manual snapshot queue for every edit.

## Implementation guidance

When `nostr-site` adopts `nostr-crdt`, the first integration should target:

- static pages
- posts
- entity or wiki records

The reusable helpers are now split accordingly:

- `createStaticPageOverlayApi(config)` for page-field overlays
- `createStructuredUnitOverlayApi(config)` for object-like collaborative units such as posts and entity records

Submissions, admin logs, moderation events, and other workflow records can stay event-shaped rather than CRDT-shaped unless a real collaboration need appears.

## Open questions

- whether all admins should remain publishers, or whether `editor` and `publisher` should diverge later
- how much checkpointing should happen in browsers versus durable peers
- whether entity wiki data should be a richer structured document than page and post content
