# Nostr Site

Portable static-first site template for blogs, archives, documentation hubs, and small publishing teams that want:

- markdown-backed public pages
- relay-backed collaborative state
- optional cache-backed blobs for avatars and encrypted attachments
- deterministic username/password accounts
- persistent guest identities for signed public requests
- encrypted submission intake
- a route from live relay state to committed cleartext content
- a reusable browser support library for follow-on sites
- guest-backed visit telemetry for lightweight dashboard metrics
- submit-side pending entity suggestions that admins can moderate later
- admin-requested seed bakedowns with optional GitHub PR sync via peer pinner
- site-key rotation events with re-shared admin inbox access
- lightweight browser smoke tests under `tooling/browser-smoke`
- a repeatable production hardening checklist in `SECURITY_CHECKLIST.md`

## Structure

- `blog.html` and `post.html`: generic blog index and detail pages
- `content/blog/`: committed blog markdown and index manifest
- `content/data/entities.json`: committed baked entity seed data
- `ARCHITECTURE.md`: generic host-app contract and live-overlay model
- `INTEGRATION.md`: how the framework should consume a generic CRDT transport
- `scripts/`: browser entrypoints and template implementation
- `scripts/core/`: site config, session, content, and Nostr helpers
- `portable/`: source-of-truth reusable Nostr/CMS logic
- `support-lib/`: minified reusable browser package built from `portable/`
- `peer-pinner/`: self-hosted relay mirror / fulfillment gate package

## Included

- placeholder public pages
- generic placeholder content
- reusable Nostr/CMS helpers in `portable/`
- reusable blob upload + cache refresh helpers in `portable/`
- pending entity publishing from non-admin submit flows
- reusable minified browser library in `support-lib/`
- bundled peer pinner package in `peer-pinner/`
- build output to `dist/`
- GitHub Pages workflow in `.github/workflows/deploy.yml`

## Operating model

See `ARCHITECTURE.md` for the intended long-term split between generic transport, host-app trust policy, and site-specific implementation.

The intended workflow is:

1. collaborative state lives on relays
2. admins approve public drafts and entities in the live workspace
3. approved public content gets baked down into committed files
4. GitHub Pages serves the committed snapshot

In this template, the baked public layer is:

- blog markdown in `content/blog/`
- baked entity data in `content/data/entities.json`

The repo ships with placeholder baked entities in `content/data/entities.json` so the map and inline entity enrichment work before any live relay data exists.

Live relay state can enrich or override that material at runtime. If relays are unavailable, the committed seed data still gives the public site something durable to render.

## Bakedowns and pull requests

Peer pinner can now fulfill signed admin snapshot requests by:

- materializing approved cleartext content into deterministic seed files
- writing a local snapshot tree under the pinner snapshot directory
- optionally syncing those files into a configured site repo
- optionally force-updating a dedicated bakedown branch and opening or reusing a GitHub PR

Current expectation:

- live drafts and entities appear dynamically first
- an admin requests a bakedown from the workspace dashboard
- peer pinner writes reviewed seed files such as `content/blog/` and `content/data/entities.json`
- if GitHub env is configured on the pinner host, it pushes the bakedown branch and reuses or opens a PR
- a human with GitHub access reviews and merges the resulting PR or committed snapshot

If you adopt this template for another site, treat the live relay layer as the working state and the committed markdown/JSON as the reviewed snapshot.

The intended trust split is:

- root admin authority stays with an actual admin key
- the pinner only holds its own service signer
- the shared site inbox key can be wrapped to admins without persisting it on the pinner
- GitHub access should be limited to branch + PR automation, not direct live-branch writes

## Security caveats

- Fulfillment-time revocation is handled at the pinner boundary: revoked admins should not be able to trigger new downstream actions once their signer is no longer authorized.
- Site-key rotation is now handled in the browser/admin layer: revoking an admin can rotate the active site inbox pubkey and re-share it to the remaining admins without hand-editing config.
- Older encrypted material is still not retroactively re-encrypted. A revoked admin who already has an old site key can still read older submissions addressed to that old key.
- If the pinner can push directly to the live deploy branch, it is operationally root-equivalent regardless of the Nostr governance model.

## Storage caveats

- Clients upload blobs to the configured cache host in `scripts/core/site-config.js`.
- Clear avatars upload as public blobs.
- Submission attachments upload as ciphertext, encrypted client-side to the site inbox key.
- Blob refs are published in relay-visible metadata so peer pinners can retain them without decrypting private submissions.
- On cache miss, signed `blobRequest` events ask a peer pinner to republish the retained blob to the cache host and emit a `blobFulfillment` event.
- There is no server-side per-user blob ACL layer in this minimal build. Private attachment safety comes from client-side encryption, not storage secrecy.

## Cache refresh model

The blob path is intentionally split:

1. clients upload to a writable cache host such as a Blossom server
2. signed Nostr events carry the blob refs
3. peer pinners retain blobs locally by following those refs
4. cache misses trigger signed blob requests on the relay layer
5. a peer pinner re-uploads the retained blob to the cache host and publishes a fulfillment event

That keeps the pinner in a peer-retention role instead of making it the first-hop blob origin.

Anonymous visitors can still participate in public cache refreshes through a persistent local guest identity. That guest signer is only intended for public actions such as blob refresh and visitor-side telemetry, not authenticated workspace actions.

## Build

```bash
npm install
npm run build
npm run build:support-lib
npm run audit:security
```

`npm run release:check` runs the build plus the static security audit. For an actual deployment, run the live browser smoke suite separately with real `SMOKE_*` environment values.

## Peer pinner package

```bash
cd peer-pinner
npm install
npm run build
npm run setup:wizard
```

For Windows hosts, there is also a single-entry bootstrap path:

```bash
curl -fsSL https://raw.githubusercontent.com/Aux0x7F/nostr-site/main/peer-pinner/install.sh | bash
```

Linux is now the primary target for that one-liner. It installs missing dependencies, updates the runtime repo, runs the wizard, and registers the pinner as a restartable `systemd` service. On Windows shells it falls back to the PowerShell host bootstrap path.

For actual deployments, the runtime repo can stay `nostr-site` while the pinner targets a separate site repo for `scripts/core/site-config.js`, `CNAME`, and baked content snapshots.

## Support library package

See `support-lib/README.md`. This is the minified reusable browser layer intended for other sites to consume once the generic API is stable.

When you want another site to consume the generic layer, the current plan is:

1. build `support-lib`
2. publish or vendor the resulting `support-lib/dist/*`
3. wrap site-specific config and UI around that package

That is the path `truecost` should move onto once `nostr-site` is pushed and the generic bundle location is settled.

## Browser smoke harness

`tooling/browser-smoke/` contains a small Playwright suite for live deployed sites. It is intended for admin/login/submission/comment smoke coverage against a real URL, not as part of the shipped client bundle.

## Production hardening

Use `SECURITY_CHECKLIST.md` as the release gate. The short version is:

1. `npm run release:check`
2. run the live browser smoke suite against the deployed site
3. review GitHub branch/PR-only permissions and pinner host config
4. verify the admin revoke / rotation path on the live environment
