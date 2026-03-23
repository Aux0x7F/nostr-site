# Architecture

`nostr-site` is the generic site framework layer. It sits between [`nostr-crdt`](https://github.com/YousefED/nostr-crdt) and a downstream site such as [`truecost`](https://github.com/Aux0x7F/truecost).

## Repo split

- `nostr-crdt`
  - transport and sync
- `nostr-site`
  - site runtime, projections, document plumbing, support bundle, pinner integration
- downstream site
  - product choices, styling, content, workflows, and policy on top of the framework

`nostr-site` should stay generic. It is not the transport library, and it is not the final site.

## Framework model

The framework is built around a static-first site:

1. a built snapshot loads first
2. the shell becomes interactive quickly
3. runtime state restores from durable local data when available
4. live relay-backed state reconciles in the background
5. mounted features patch their own regions instead of tearing whole pages down

That keeps the baseline fast, crawlable, and understandable while still allowing live behavior.

## Browser runtime

The browser runtime is split into four parts:

- shared worker
  - same-origin runtime owner
  - auth/session actions
  - relay-backed reduction
  - shared projection state
- IndexedDB
  - durable store for projections, documents, cached events, and session metadata
- service worker
  - cache and fetch boundary for pages, assets, and materialized snapshots
- template or host feature controllers
  - subscribe to projection slices and patch only their own DOM regions

Shared runtime state uses one envelope shape:

- `value`
- `status`
- `digest`
- `updatedAt`

When a refresh degrades, the runtime keeps the last good value and updates `status` instead of blanking the surface.

## What upstream owns

`nostr-site` owns reusable behavior such as:

- deterministic account/session plumbing
- shared runtime host/client behavior
- projection storage and restore behavior
- document controller and structured-document plumbing
- template shell and reusable surface patterns
- pinner-facing bakedown integration

## What downstream sites own

Downstream sites own:

- product copy and branding
- page structure and content choices
- site-specific moderation and workflow rules
- site-specific graph/wiki presentation
- anything too opinionated to belong in a generic framework

## Code layout

- `portable/`
  - reusable source-of-truth logic
- `scripts/core/`
  - browser/runtime helpers shared across the template
- `scripts/template/features/`
  - route and feature orchestration
- `scripts/template/surfaces/`
  - reusable template UI families

Keep the split strict:

- shared persistent state belongs in runtime/document logic
- orchestration belongs in features
- rendering belongs in surfaces
- downstream product behavior stays downstream

## Publication and pinner

The browser is not the final publisher.

The publish path is:

1. trusted live state exists on relays
2. admins work against the live layer
3. pinner materializes approved state into reviewed output
4. merge advances the static baseline

That keeps the framework aligned with a reviewed-publication model instead of turning the browser into the last word.

## A few terms

- static-first
  - useful built output before live state arrives
- projection
  - reduced runtime view of shared state
- document controller
  - the layer that owns document open/apply/close behavior
- bakedown
  - turning approved live state into reviewed static output
- pinner
  - service that materializes approved state and opens or updates PRs
