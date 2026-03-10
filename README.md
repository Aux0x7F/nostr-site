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

## Structure

- `blog.html` and `post.html`: generic blog index and detail pages
- `content/blog/`: committed blog markdown and index manifest
- `content/data/entities.json`: committed baked entity seed data
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

## Security caveats

- Fulfillment-time revocation is handled at the pinner boundary: revoked admins should not be able to trigger new downstream actions once their signer is no longer authorized.
- This does not revoke access to material already encrypted to an old shared site key. Key rotation is still the missing piece there.

## Storage caveats

- Clients upload blobs to the configured cache host in `site-config.js`.
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
```

## Peer pinner package

```bash
cd peer-pinner
npm install
npm run build
```

## Support library package

See `support-lib/README.md`. This is the minified reusable browser layer intended for other sites to consume once the generic API is stable.

When you want another site to consume the generic layer, the current plan is:

1. build `support-lib`
2. publish or vendor the resulting `support-lib/dist/*`
3. wrap site-specific config and UI around that package

That is the path `truecost` should move onto once `nostr-site` is pushed and the generic bundle location is settled.
