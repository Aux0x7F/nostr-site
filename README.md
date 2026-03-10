# Nostr Site

Portable static-first site template for campaign, publishing, and research projects that want:

- markdown-backed public pages
- relay-backed collaborative state
- deterministic username/password accounts
- encrypted submission intake
- a route from live relay state to committed cleartext content
- a reusable browser support library for follow-on sites

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

Live relay state can enrich or override that material at runtime. If relays are unavailable, the committed seed data still gives the public site something durable to render.

## Bakedowns and pull requests

The long-term path is for peer pinner to materialize approved cleartext events into seed files and append them to tagged GitHub pull requests for human review. That bridge is a process contract in this repo, but not a complete end-to-end GitHub automation stack yet.

Current expectation:

- live drafts and entities can appear dynamically first
- approved cleartext items are then baked down into `content/blog/` and `content/data/entities.json`
- a human with GitHub access reviews and merges the resulting PR or committed snapshot

## Security caveats

- Fulfillment-time revocation is handled at the pinner boundary: revoked admins should not be able to trigger new downstream actions once their signer is no longer authorized.
- This does not revoke access to material already encrypted to an old shared site key. Key rotation is still the missing piece there.

## Storage caveats

- Blob storage is not built into this repo yet.
- Profile pictures currently use `avatar_url` fields, not uploaded blobs.
- Submission/file binary handling still needs a real blob strategy if you want more than small text payloads and metadata.

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
