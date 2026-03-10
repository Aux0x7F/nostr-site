# Nostr Site Peer Pinner

Reusable peer pinner package for `nostr-site`.

## Purpose

- mirror tagged relay events locally
- expose a small relay-compatible WebSocket endpoint
- retain blob refs announced in relay events
- refresh the public blob cache when signed blob requests arrive
- keep admin, alias, and snapshot state available to downstream tools
- act as the fulfillment gate for higher-impact actions
- materialize approved public content into seed snapshots on signed admin request

## Fulfillment rule

Snapshot bakedowns, PR generation, and other downstream actions are only fulfilled when the signer is currently authorized in the mirrored admin state. That blocks revoked admins from triggering new actions even if they still possess older local material.

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
- `SNAPSHOT_DIR`
- `SNAPSHOT_REPO_DIR`
- `SNAPSHOT_BLOG_DIR`
- `SNAPSHOT_BLOG_INDEX`
- `SNAPSHOT_ENTITIES_PATH`
- `SNAPSHOT_MANAGED_PATH`
- `GIT_REMOTE`
- `GITHUB_REPO`
- `GITHUB_TOKEN`
- `GITHUB_BASE_BRANCH`
- `GITHUB_BRANCH_PREFIX`

## Blob workflow

- clients upload to the configured cache host
- relay events announce clear or encrypted blob refs
- peer pinner follows those refs and keeps local copies by `sha256`
- signed `blobRequest` events ask the peer to republish a retained blob to the cache host
- peer pinner emits a `blobFulfillment` event once the cache host is warm again

The access rule is:

- public blobs can be refreshed for any signed requester
- encrypted blobs should only be refreshed for currently authorized admins

## Snapshot workflow

- an admin publishes a signed `snapshotRequest` event with `op=bake`
- peer pinner verifies the signer is still an admin
- peer pinner rebuilds approved entities and bakeable posts from mirrored relay state
- files are materialized into a local snapshot tree
- if `SNAPSHOT_REPO_DIR` is configured, the same managed files are synced into that repo
- if GitHub env is configured too, peer pinner updates a dedicated bakedown branch and opens or reuses a PR
- peer pinner publishes a signed `snapshot` event with counts, file entries, and optional PR metadata

## Optional local blob endpoints

The package still exposes small local blob endpoints for inspection and lab use:

- `PUT /upload`
- `HEAD /upload`
- `GET /<sha256>`
- `HEAD /<sha256>`
