# Nostr Site Support Library

Minified reusable browser library built from the `portable/` source layer.

## Outputs

- `dist/nostr-site-support.esm.js`
- `dist/nostr-site-support.iife.js`

## Includes

- `createNostrCmsClient`
- `createDeterministicSessionApi`
- `createBlobStoreApi`
- content parsing and enrichment helpers
- generic admin key-share and relay-state helpers through `createNostrCmsClient`
- dynamic site-key helpers through `createNostrCmsClient`

`createBlobStoreApi` handles:

- uploads to the configured writable cache host
- signed `blobRequest` events on cache miss
- polling relay state for `blobFulfillment` before retrying reads

`createDeterministicSessionApi` now supports both named account sessions and persistent guest identities for anonymous signed public actions.

`createNostrCmsClient` now also supports:

- public site-key announcement events for inbox rotation
- loading multiple admin key shares at once for backward reads across rotated inbox keys
- resolving the active site inbox pubkey from relay state instead of only static config

## Build

```bash
npm run build:support-lib
```

## Consumption

Another site can either:

- vendor `dist/nostr-site-support.esm.js` into its own repo and import from that file
- publish the bundle elsewhere and import it as a stable external dependency

The current `truecost` repo follows the vendored-bundle path.
