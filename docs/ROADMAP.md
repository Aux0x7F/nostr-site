# Roadmap

`nostr-site` has moved past the old controller-heavy model. The framework now has a shared runtime, projection envelopes, document plumbing, template surface splits, and `dist/`-first site output.

## Recently finished

- hard cutover away from the old local seam files
- shared runtime host/client and durable projection plumbing
- route-thin template entry files for admin, editor, and site runtime
- source pages in `site-src` with generated output in `dist/`
- service worker and feature-manifest support for the template shell
- structured-document schema, exporters, and document-controller groundwork
- reusable graph/wiki data helpers for downstream sites

## Current focus

- keep tightening the generic runtime model so downstream sites need less page-level orchestration
- push more reusable behavior into framework-level helpers instead of template controller sprawl
- deepen the structured-document and projection model so richer authoring and review flows have a solid base
- keep the framework readable and safe to ship, including docs, tests, and release checks

## Next likely moves

- stronger framework support for relationship records and review flows
- a cleaner structured-document-native authoring path
- broader smoke coverage around operator-critical template flows
- more reusable live-unit shells for downstream sites

## Longer bets

- fuller template-level graph/wiki demonstrations
- richer collaboration rails and discussion patterns
- cleaner pinner workflows for more kinds of approved output
- more reusable launch paths for future downstream sites
