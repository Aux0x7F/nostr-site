# Testing Contract

`nostr-site` is the generic policy and state layer. Regressions here propagate into every host site.

## Minimum bar

Any change that affects live state, cached state, or public rendering should have:

- a deterministic unit test for the data contract
- a syntax/build pass
- a note about which surface behavior was validated
- a compatibility note when introducing non-baseline browser features

## Required live-state cases

Where applicable, tests should cover:

- cached-first render
- stale remote merge against richer local state
- optimistic update persistence
- stable identifiers across publish and reload
- hierarchy preservation for nested data
- visible control effect after local mutation when the change affects local interactive state

## Preferred test split

- `portable/*`
  - pure unit tests for parsing, derivation, merge, and cache behavior
- browser smoke
  - high-value end-to-end user flows

See [BROWSER_SUPPORT.md](./BROWSER_SUPPORT.md) for the compatibility fallback expectations that should be validated when relevant.

## Current commands

- `npm run test:unit`
- `node --test test/archive-surface.test.mjs`
- `npm run build`
- `npm run build:support-lib`
- `npm run smoke:browser`

`npm run test:unit` should remain the umbrella command for all `test/*.test.mjs` unit coverage.
