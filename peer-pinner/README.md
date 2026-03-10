# Nostr Site Peer Pinner

Reusable peer pinner package for `nostr-site`.

## Purpose

- mirror tagged relay events locally
- expose a small relay-compatible WebSocket endpoint
- retain blob refs announced in relay events
- refresh the public blob cache when signed blob requests arrive
- keep admin, alias, and snapshot state available to downstream tools
- act as the fulfillment gate for higher-impact actions

## Fulfillment rule

If you add PR generation, seed snapshots, or other downstream actions here, the request should only be fulfilled when the signer is currently authorized in the mirrored admin state. That blocks revoked admins from triggering new actions even if they still possess older local material.

## Build

```bash
npm install
npm run build
```

## Start

```bash
npm start
```

## Useful environment variables

- `PORT`
- `APP_TAG`
- `APP_KINDS`
- `UPSTREAM_RELAYS`
- `DATA_DIR`
- `EVENTS_FILE`
- `IDENTITY_FILE`
- `BLOBS_DIR`
- `BLOB_CACHE_BASE_URL`
- `MAX_BLOB_BYTES`

## Blob workflow

- clients upload to the configured cache host
- relay events announce clear or encrypted blob refs
- peer pinner follows those refs and keeps local copies by `sha256`
- signed `blobRequest` events ask the peer to republish a retained blob to the cache host
- peer pinner emits a `blobFulfillment` event once the cache host is warm again

The access rule is:

- public blobs can be refreshed for any signed requester
- encrypted blobs should only be refreshed for currently authorized admins

## Optional local blob endpoints

The package still exposes small local blob endpoints for inspection and lab use:

- `PUT /upload`
- `HEAD /upload`
- `GET /<sha256>`
- `HEAD /<sha256>`
