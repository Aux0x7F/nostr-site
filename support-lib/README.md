# Nostr Site Support Library

Minified reusable browser library built from the `portable/` source layer.

## Outputs

- `dist/nostr-site-support.esm.js`
- `dist/nostr-site-support.iife.js`

## Includes

- `createNostrCmsClient`
- `createDeterministicSessionApi`
- content parsing and enrichment helpers
- generic admin key-share and relay-state helpers through `createNostrCmsClient`

## Build

```bash
npm run build:support-lib
```

## Consumption

Another site can either:

- vendor `dist/nostr-site-support.esm.js` into its own repo and import from that file
- publish the bundle elsewhere and import it as a stable external dependency

The current `truecost` repo follows the vendored-bundle path.
