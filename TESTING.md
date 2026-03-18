# Testing Contract

`nostr-site` is the generic policy and state layer. Regressions here propagate into every host site.

## Minimum bar

Any change that affects live state, cached state, or public rendering should have:

- a deterministic unit test for the data contract
- a syntax/build pass
- a note about which surface behavior was validated

## Required live-state cases

Where applicable, tests should cover:

- cached-first render
- stale remote merge against richer local state
- optimistic update persistence
- stable identifiers across publish and reload
- hierarchy preservation for nested data

## Preferred test split

- `portable/*`
  - pure unit tests for parsing, derivation, merge, and cache behavior
- browser smoke
  - high-value end-to-end user flows

## Current commands

- `npm run test:unit`
- `npm run build`
- `npm run build:support-lib`
- `npm run smoke:browser`
