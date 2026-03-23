# Testing

`nostr-site` is the shared framework layer. Regressions here spread downstream fast, so the testing bar needs to stay high and predictable.

## Baseline

For most framework changes, the minimum bar is:

- a deterministic unit test for the changed rule
- a feature/runtime test when behavior moves out of an entry file
- a browser or controller-level regression when the failure depends on rerender timing or UI lifecycle
- build validation for touched runtime or template behavior

## What different changes need

### Runtime and projection changes

Cover:

- projection envelope behavior
- last-good value retention during degraded refresh
- cached-first restore
- shared runtime/session behavior when relevant
- durable projection persistence and restore

### Document changes

Cover:

- structured-document normalization
- document-controller behavior
- projection sync behavior
- exporter output
- metadata round-trip, including richer image placement

### Template and surface changes

Cover:

- the surface or feature that owns the behavior
- in-place patching instead of shell teardown
- dropdown or focus behavior when relevant
- preservation of active local input state during unrelated updates

### Browser-sensitive changes

Browser checks matter when the issue depends on:

- boot order
- DOM timing
- dropdown geometry
- shell stability during rerenders
- service worker or build output behavior

## Core scenarios worth keeping honest

Where applicable, tests should exercise:

- cached-first render
- optimistic local changes
- stale merge against richer local state
- nested data integrity
- visible control effect after mutation
- session and integrity edge cases
- durable runtime restore
- structured-document round-trip behavior

## Current commands

- `npm run test:unit`
- `node --test test/runtime-client.test.mjs`
- `node --test test/site-runtime.test.mjs`
- `node --test test/document-controller.test.mjs`
- `node --test test/document-local-state.test.mjs`
- `node --test test/document-projection-sync.test.mjs`
- `node --test test/navigation-notification.test.mjs`
- `node --test test/site-template-build.test.mjs`
- `node --test test/service-worker.test.mjs`
- `npm run build`
- `npm run build:support-lib`
- `npm run smoke:browser`

`npm run test:unit` remains the umbrella unit command.
