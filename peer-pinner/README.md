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

## Trust model

- The pinner service key is local to the pinner host. It signs service events such as blob fulfillments, snapshots, and PR receipts.
- The root admin key is not a pinner key. Set `ROOT_ADMIN_PUBKEY` so admin authority remains separate from the service signer.
- The shared site inbox key is also separate. The setup wizard can generate it, wrap it to the root admin pubkey, and avoid storing the plaintext in the pinner env file.
- Give the pinner branch + PR rights, not direct write access to the live deploy branch. If it can push `main` or the publish branch directly, it is effectively root-equivalent.

## Fulfillment rule

Snapshot bakedowns, PR generation, and other downstream actions are only fulfilled when the signer is currently authorized in the mirrored admin state. That blocks revoked admins from triggering new actions even if they still possess older local material.

## Build

```bash
npm install
npm run build
```

## Setup wizard

Run the local wizard on the pinner host:

```bash
npm run setup:wizard
npm run gh:check
npm run bootstrap:host
```

One-line bootstrap for Git Bash / MSYS:

```bash
curl -fsSL https://raw.githubusercontent.com/Aux0x7F/nostr-site/main/peer-pinner/install.sh | bash
```

That wrapper downloads and runs [host-bootstrap.ps1](C:/projects/nostr-site/peer-pinner/host-bootstrap.ps1), which is the actual Windows host installer.

Useful non-interactive variants:

```bash
node setup-wizard.js --check-only --repo=owner/repo --base-branch=main
node setup-wizard.js --non-interactive --repo=owner/repo --repo-dir=/path/to/site --root-admin-pubkey=<hex>
```

The host bootstrap script will:

- install `node`, `gh`, and `git` via `winget` if they are missing
- ensure GitHub CLI auth is present for PR automation
- clone or update the `nostr-site` repo
- run `npm ci` and `npm run build:all`
- run the setup wizard
- register a per-user scheduled task that keeps [service-runner.ps1](C:/projects/nostr-site/peer-pinner/service-runner.ps1) alive and restarts it after updates or crashes

The setup wizard will:

- create or reuse a pinner service identity under `peer-pinner/data/`
- write local runtime config to `peer-pinner/.env.peer-pinner.local`
- inspect relay state to decide between `new-site`, `site-bootstrap`, and `needs-root-selection`
- read checked-in defaults from `site-config.js` and `CNAME` when a repo dir is present
- check GitHub CLI install/auth and repo visibility
- for a new site, wait for a real user account to appear on relays and ask the operator to approve that witnessed username/pubkey as root admin
- for an existing site, reuse the root admin already visible on relays when possible
- generate signed bootstrap events for the pinner account record
- optionally generate a site inbox key and wrap it to the root admin pubkey
- write bootstrap artifacts to `peer-pinner/setup-output/`

By default the bootstrap events are only written to disk. If you want the pinner to publish them to relays immediately, run the wizard with `--publish-bootstrap`.

## Start

```bash
npm start
```

`peer-pinner.js` automatically loads `peer-pinner/.env.peer-pinner.local` if it exists, so the wizard output is picked up without additional wrapper scripts.

For the Windows host flow, the scheduled task launches `service-runner.ps1`, which loops `dist/peer-pinner.js`, logs to `peer-pinner/data/service-logs/`, and restarts after exit.

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
- `ROOT_ADMIN_PUBKEY`
- `PROTOCOL_PREFIX`

## Bootstrap modes

- `new-site`: no meaningful relay noise for this app tag yet. The wizard waits for a freshly created account, then asks the operator to approve it as the root admin witness.
- `site-bootstrap`: relay state already exists and a root admin can be inferred. The wizard uses that identity and can generate or rotate the site inbox key.
- `bootstrap-needs-root-selection`: relay state exists, but no canonical root admin was inferred. The operator must choose one.

## GitHub auth

PR sync uses either:

- `GITHUB_TOKEN`, if set
- `gh auth token`, if the GitHub CLI is authenticated on the pinner host

Recommended minimum capability is:

- read access to the target repo
- branch push access for the bakedown branch
- pull request creation/update

Avoid direct deploy-branch write authority unless you intentionally want the pinner to be root-equivalent.

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

The intended flow is:

- live cleartext content goes dynamic first
- pinner bakes approved state into repo-ready seed files
- pinner updates a dedicated branch or PR
- a human reviews and merges the snapshot into the public static layer

## Optional local blob endpoints

The package still exposes small local blob endpoints for inspection and lab use:

- `PUT /upload`
- `HEAD /upload`
- `GET /<sha256>`
- `HEAD /<sha256>`
