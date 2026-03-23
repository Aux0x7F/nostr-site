# Nostr Site

`nostr-site` is the reusable framework/runtime layer between [`nostr-crdt`](https://github.com/YousefED/nostr-crdt) and a downstream site such as [`truecost`](https://github.com/Aux0x7F/truecost). It owns the generic site runtime, projection model, document plumbing, support bundle, and pinner-facing bakedown path.

## What this repo is for

Use `nostr-site` when you want a static-first site that can still support:

- deterministic accounts
- relay-backed live state
- reusable workspace/admin patterns
- runtime-backed documents and projections
- bakedown back into reviewed static output

It is the framework layer, not the finished site.

## What it owns

- portable runtime and document logic in `portable/`
- shared browser/runtime helpers in `scripts/core/`
- template-level features and surfaces in `scripts/template/`
- reusable support bundle output in `support-lib/`
- pinner integration and bakedown helpers

## What it does not own

- site-specific copy, branding, and product choices
- downstream moderation policy beyond the reusable baseline
- the transport layer itself

For transport, see [`nostr-crdt`](https://github.com/YousefED/nostr-crdt).

## Repo layout

- `portable/`
  - reusable source-of-truth runtime and document logic
- `scripts/core/`
  - shared browser/runtime helpers
- `scripts/template/features/`
  - route and feature orchestration for the template site
- `scripts/template/surfaces/`
  - reusable template UI families
- `site-src/`
  - source pages and page definitions
- `support-lib/`
  - browser bundle built from portable logic
- `peer-pinner/`
  - bakedown and fulfillment tooling
- `docs/`
  - architecture, integration, testing, workflow, and security notes
- `dist/`
  - generated site output

## Start here

- Want the framework model?
  - [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- Want the transport boundary?
  - [docs/INTEGRATION.md](./docs/INTEGRATION.md)
- Working on shared UI or template behavior?
  - [docs/COMPONENTS.md](./docs/COMPONENTS.md)
  - [docs/STYLE_GUIDE.md](./docs/STYLE_GUIDE.md)
- Touching runtime behavior?
  - [docs/TESTING.md](./docs/TESTING.md)
- Shipping or reviewing changes?
  - [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)
  - [docs/SECURITY_CHECKLIST.md](./docs/SECURITY_CHECKLIST.md)
- Want the docs map?
  - [docs/README.md](./docs/README.md)
