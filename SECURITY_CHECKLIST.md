# Security Checklist

Use this before calling a `nostr-site` deployment production-ready.

## Automated Gate

Run these first:

```bash
npm install
npm run build:all
npm run audit:security
```

For a live deployment, also run the browser smoke suite with real environment values:

```bash
SMOKE_BASE_URL=https://your-site.example \
SMOKE_ADMIN_USERNAME=... \
SMOKE_ADMIN_PASSWORD=... \
SMOKE_USER_USERNAME=... \
SMOKE_USER_PASSWORD=... \
npm run smoke:browser
```

`npm run release:check` bundles the build plus the static audit. The browser smoke run stays separate because it requires a real deployed target and real operator credentials.

## GitHub and Snapshot Safety

- The pinner must only have branch + PR authority, not direct write access to the live deploy branch.
- `GITHUB_REPO` must point at the intended site repo, not the generic runtime repo by accident.
- `SNAPSHOT_REPO_DIR` must be the checked-out site repo that receives baked files.
- Review the bakedown branch naming and confirm it cannot resolve to the base branch.
- Confirm a human reviews and merges bakedown PRs.
- Confirm GitHub auth is repo-scoped and limited to `Contents: Read and write` and `Pull requests: Read and write`.

## Host and Operator Safety

- Run the pinner on Linux as the primary deployment target.
- Keep the pinner service isolated from unrelated operators and services on the host.
- Ensure the runtime user only has the filesystem access it actually needs.
- Keep `gh` auth and any env files out of shared shells and dotfiles.
- Verify restart behavior after reboot and after a failed process exit.

## Key and Identity Safety

- Confirm `ROOT_ADMIN_PUBKEY` is the real root admin, not the pinner service key.
- Confirm the generic site template does not ship with a populated inbox or root admin pubkey.
- Confirm site inbox key rotation works after admin revoke.
- Confirm remaining admins can still decrypt current submissions after rotation.
- Confirm revoked admins cannot trigger new bakedowns, blob fulfillments, or other admin-only actions.
- Accept that older material already encrypted to an old inbox key remains readable to anyone who already held that key.

## Relay and Data Safety

- Verify the relay set is intentional and stable for the site.
- Verify the app tag and protocol prefix are unique to the site.
- Keep relay compatibility tested as peer, admin, and comment counts grow.
- Confirm the site remains usable when some relays are delayed or missing events.
- Confirm the map, comments, and admin views degrade cleanly when live relay data is incomplete.

## Blob and Submission Safety

- Keep public avatars cleartext and treat them as public.
- Keep submission attachments encrypted client-side before upload.
- Confirm the configured blob cache host is correct.
- Confirm peer pinners can re-warm cache misses without exposing private plaintext.
- Confirm non-admins can only trigger public blob refreshes.
- Confirm private submission fulfillment stays limited to currently authorized admins.

## UI and Workflow Safety

- Verify anonymous visitors only get guest-level public actions.
- Verify sign-in-gated flows stay gated in the live UI.
- Verify admin-only moderation, status changes, and publishing actions are role-checked in the live UI.
- Verify audit views show meaningful admin and submission history.
- Verify the login, submit, admin, and comment flows work on mobile as well as desktop.

## Reader-Facing Release Check

- Review committed placeholder content and sample copy so nothing reads like leaked internal discussion or fake expertise.
- Check docs for machine-local usernames, hostnames, passwords, IPs, or repo-specific operator notes.
- Confirm `README.md` reflects the actual structure and workflow.
- Confirm public calls to action point to the intended donate, merch, YouTube, and contact destinations.
