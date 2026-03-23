# Security Checklist

Use this before calling a `nostr-site` deployment production-ready.

## Build and release gate

Run these first:

```bash
npm install
npm run build:all
npm run audit:security
```

For a live deployment, also run the browser smoke suite against a real target:

```bash
SMOKE_BASE_URL=https://your-site.example \
SMOKE_ADMIN_USERNAME=... \
SMOKE_ADMIN_PASSWORD=... \
SMOKE_USER_USERNAME=... \
SMOKE_USER_PASSWORD=... \
npm run smoke:browser
```

`npm run release:check` covers the build plus the static audit. Browser smoke is still separate because it needs a real deployed environment.

## GitHub and bakedown safety

- pinner should have branch and PR authority, not direct write access to the live deploy branch
- `GITHUB_REPO` must point at the intended site repo
- `SNAPSHOT_REPO_DIR` must be the site checkout that receives baked output
- bakedown branch naming should never resolve to the base branch
- a human should review and merge bakedown PRs

## Host and operator safety

- run pinner on Linux
- keep the service isolated from unrelated workloads
- give the runtime user only the filesystem access it actually needs
- keep `gh` auth and env files out of shared shell history and dotfiles
- verify restart behavior after reboot and after failure

## Key and identity safety

- `ROOT_ADMIN_PUBKEY` should be a real admin key, not the pinner service signer
- template defaults should not ship with a live inbox or root admin key filled in
- site-key rotation should still work after admin revoke
- revoked admins should not be able to trigger new bakedowns or admin-only actions
- older ciphertext already addressed to an old key is still readable to people who already held that key

## Relay and data safety

- verify the relay set is intentional
- keep the app tag and protocol prefix site-specific
- make sure the site still behaves reasonably when some relays are noisy or incomplete
- verify map, comments, and admin views degrade cleanly under partial live data

## Blob and submission safety

- avatars are public; treat them that way
- submission attachments should be encrypted client-side before upload
- verify the blob cache host is correct
- verify peer pinners can re-warm cache misses without exposing private plaintext
- keep private fulfillment limited to currently authorized admins

## UI and workflow safety

- check CSP, referrer policy, and permissions policy on public HTML entries
- verify anonymous visitors only get guest-level actions
- verify admin-only flows are still gated in the live UI
- verify audit/history views remain useful
- verify login, submit, admin, and comment flows on mobile as well as desktop

## Reader-facing release sanity check

- remove placeholder or machine-local content that should not ship
- check docs for local usernames, hostnames, passwords, IPs, or filesystem paths
- make sure `README.md` still matches the actual repo
- confirm public calls to action point to the right destinations
